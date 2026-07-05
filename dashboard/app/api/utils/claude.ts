import { findAuditById, updateClaudeAnalysis, findAnalysisById, findAuditCostUsageRaw, findAuditUsageRaw, findAuditCostRaw } from '../models/audit'
import { insertFinding, findFindingsByAudit, deleteFindingsByScope, findPriorLiveFindings, deleteFindingsByIds, resolveFindingsByIds } from '../models/findings'
import { ChatMessage, Finding } from '../types'
import { callLLM, LLMProvider, LLMMessage } from './llm'
import { buildUsageGroups } from './usage'

const DEFAULT_PROVIDER: LLMProvider = 'claude'
const DEFAULT_MODEL = 'claude-sonnet-4-6'

interface AnalysisFinding {
  severity: 'Critical' | 'Warning' | 'Info'
  category: string
  resource_type: string
  resource_name: string
  issue: string
  recommendation: string
}

export interface ClaudeAnalysis {
  summary: string
  findings: AnalysisFinding[]
  generated_at: string
  model: string
}

/** claude_analysis JSONB column shape: either the full-audit analysis, or one
 *  analysis per resource type, or both (whichever the user has run so far). */
export interface ClaudeAnalysisStore {
  all?: ClaudeAnalysis
  by_resource?: Record<string, ClaudeAnalysis>
}

function normalizeStore(raw: unknown): ClaudeAnalysisStore {
  if (!raw || typeof raw !== 'object') return {}
  const obj = raw as Record<string, unknown>
  if ('all' in obj || 'by_resource' in obj) return obj as ClaudeAnalysisStore
  if ('findings' in obj) return { all: obj as unknown as ClaudeAnalysis } // legacy flat shape
  return {}
}

function extractJSON(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = fenced ? fenced[1] : text
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('no JSON object in Claude response')
  return JSON.parse(candidate.slice(start, end + 1))
}

async function analyzeWithLLM(
  data: unknown,
  instruction: string,
  provider: LLMProvider,
  model: string
): Promise<{ analysis: ClaudeAnalysis } | { error: string; status: number }> {
  let text: string
  try {
    text = await callLLM({
      provider,
      model,
      maxTokens: 8000,
      messages: [{
        role: 'user',
        content: `Azure audit data (cleaned resource snapshot):
${JSON.stringify(data)}

${instruction}

Respond with ONLY a JSON object in this exact shape, no other text:
{
  "summary": "2-3 sentence overall assessment",
  "findings": [
    {
      "severity": "Critical" | "Warning" | "Info",
      "category": "Security" | "Cost Waste" | "Misconfiguration" | "Governance" | "Performance",
      "resource_type": "one of the resource type keys from the data (e.g. storage, iam, nsg)",
      "resource_name": "the specific resource affected",
      "issue": "what the problem is, concretely",
      "recommendation": "how to fix it, concretely"
    }
  ]
}`,
      }],
    })
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'LLM call failed', status: 502 }
  }

  if (!text) return { error: 'empty response from model', status: 502 }

  let parsed: { summary?: string; findings?: AnalysisFinding[] }
  try {
    parsed = extractJSON(text) as { summary?: string; findings?: AnalysisFinding[] }
  } catch {
    return { error: 'could not parse model analysis response', status: 502 }
  }

  return {
    analysis: {
      summary: parsed.summary || '',
      findings: Array.isArray(parsed.findings) ? parsed.findings : [],
      generated_at: new Date().toISOString(),
      model: `${provider}:${model}`,
    },
  }
}

// Cross-audit identity for a finding. resource_type + resource_name +
// category is the most stable signal available — the issue TEXT can't be
// used because the LLM words it slightly differently on every run.
function findingKey(f: { resource_type?: string | null; resource_name?: string | null; category?: string | null }): string {
  const norm = (s?: string | null) => (s || '').trim().toLowerCase()
  return `${norm(f.resource_type)}|${norm(f.resource_name)}|${norm(f.category)}`
}

// Saves one scope's findings with full lifecycle handling:
//
// 1. Replace, don't append: this audit+scope's previous rows are deleted
//    first, so re-analyzing after a cache clear doesn't duplicate.
// 2. Age carry-forward: if the same issue (per findingKey) was already open
//    in an EARLIER audit of this subscription, the new row inherits that
//    row's first_seen_at — so an unfixed problem shows "7 days old" next
//    week instead of resetting to "new" on every audit. The superseded
//    older row is deleted (its audit's cached claude_analysis JSON still
//    preserves what that audit reported, so no display history is lost).
// 3. Sticky dismissals: if the matched prior row was dismissed, the new row
//    stays dismissed — a new audit doesn't resurrect issues someone already
//    marked "won't fix".
// 4. Auto-resolve: prior OPEN issues that no longer appear in this fresh
//    analysis get status='resolved' — the signal that something actually
//    got fixed. (Dismissed ones are left alone.)
async function saveFindings(auditId: string, findings: AnalysisFinding[], scope: string) {
  await deleteFindingsByScope(auditId, scope)

  const prior = await findPriorLiveFindings(auditId, scope)
  const priorByKey = new Map(prior.map(p => [findingKey(p), p]))

  const validSeverities = ['Critical', 'Warning', 'Info']
  const matchedPriorIds: string[] = []
  const newKeys = new Set<string>()

  for (const f of findings) {
    if (!validSeverities.includes(f.severity)) continue
    const key = findingKey(f)
    newKeys.add(key)
    const match = priorByKey.get(key)
    if (match) matchedPriorIds.push(match.id)
    await insertFinding(auditId, {
      severity: f.severity,
      category: f.category || undefined,
      resource_type: f.resource_type || '',
      resource_name: f.resource_name || '',
      issue: f.issue || '',
      recommendation: f.recommendation || '',
    }, scope, {
      status: match?.status === 'dismissed' ? 'dismissed' : 'open',
      firstSeenAt: match ? new Date(match.first_seen_at) : new Date(),
    })
  }

  // Matched older copies are superseded by the rows just inserted.
  await deleteFindingsByIds(matchedPriorIds)

  // Open issues from earlier audits that no longer appear → fixed.
  const disappeared = prior
    .filter(p => p.status === 'open' && !newKeys.has(findingKey(p)))
    .map(p => p.id)
  await resolveFindingsByIds(disappeared)
}

/**
 * Analyzes one audit with Claude. By default (no resourceSlug) this only
 * scopes to a single resource type — cheap and fast. Pass resourceSlug
 * omitted and scope "all" explicitly from the caller to analyze the entire
 * audit (all resource types) in one request — slower and more expensive,
 * so the frontend gates that behind a confirmation dialog.
 */
export async function runAnalysis(
  auditId: string,
  resourceSlug?: string,
  provider: LLMProvider = DEFAULT_PROVIDER,
  model: string = DEFAULT_MODEL
): Promise<{ analysis?: ClaudeAnalysis; error?: string; status: number; cached?: boolean }> {
  const audit = await findAuditById(auditId)
  if (!audit) return { error: 'audit not found', status: 404 }

  const existing = normalizeStore(await findAnalysisById(auditId))

  if (resourceSlug) {
    const cached = existing.by_resource?.[resourceSlug]
    if (cached) return { analysis: cached, status: 200, cached: true }

    // cost/usage live in their own DB columns, not raw_data — see
    // findAuditCostRaw/findAuditUsageRaw's doc comments for why they're kept
    // separate. "usage:<type>" analyzes one resource type's utilization only
    // (e.g. "usage:storage"), matching the same per-type split used by the
    // Resource Utilization dropdown and the scope selectors in the UI.
    let resourceData: unknown
    let instruction: string
    if (resourceSlug === 'cost') {
      resourceData = (await findAuditCostRaw(auditId))?.cost
      instruction = 'Analyze the Cost Management data for this Azure subscription as a senior DevOps engineer would. Find cost waste, unexpected spend spikes, and opportunities to reduce spend.'
    } else if (resourceSlug.startsWith('usage:')) {
      const usageType = resourceSlug.slice('usage:'.length)
      const usageRaw = await findAuditUsageRaw(auditId)
      const groups = buildUsageGroups(usageRaw?.metrics || [], usageType)
      resourceData = groups.length > 0 ? { type: usageType, groups } : undefined
      instruction = `Analyze the utilization metrics for "${usageType}" resources in this Azure subscription as a senior DevOps engineer would. Find idle, over-provisioned, or under-utilized resources.`
    } else if (resourceSlug === 'usage') {
      resourceData = (await findAuditCostUsageRaw(auditId))?.usage // legacy combined scope, kept for old cache entries only
      instruction = 'Analyze the Azure Monitor usage data for this subscription as a senior DevOps engineer would. Find idle, over-provisioned, or under-utilized resources.'
    } else {
      resourceData = (audit.raw_data as Record<string, unknown> | undefined)?.[resourceSlug]
      instruction = `Analyze the "${resourceSlug}" resources in this Azure subscription as a senior DevOps engineer would. Find all problems, inefficiencies, misconfigurations, security gaps, and cost issues specific to this resource type.`
    }
    if (resourceData === undefined || resourceData === null) {
      return { error: `no data for resource type "${resourceSlug}" in this audit`, status: 400 }
    }

    const result = await analyzeWithLLM(
      { [resourceSlug]: resourceData },
      instruction,
      provider,
      model
    )
    if ('error' in result) return result

    const merged: ClaudeAnalysisStore = {
      ...existing,
      by_resource: { ...(existing.by_resource || {}), [resourceSlug]: result.analysis },
    }
    await updateClaudeAnalysis(auditId, merged)
    await saveFindings(auditId, result.analysis.findings, resourceSlug)
    return { analysis: result.analysis, status: 200, cached: false }
  }

  if (existing.all) return { analysis: existing.all, status: 200, cached: true }

  if (!audit.raw_data || Object.keys(audit.raw_data).length === 0) {
    return { error: 'audit has no resource data to analyze', status: 400 }
  }

  // "Analyze All" sends the complete picture to Claude — cost/usage are
  // merged back in here even though they're stored in their own DB columns,
  // so the full-subscription analysis doesn't lose visibility into spend
  // and utilization data.
  const costUsage = await findAuditCostUsageRaw(auditId)
  const fullData = {
    ...audit.raw_data,
    ...(costUsage?.cost ? { cost: costUsage.cost } : {}),
    ...(costUsage?.usage ? { usage: costUsage.usage } : {}),
  }

  const result = await analyzeWithLLM(
    fullData,
    'Analyze this Azure subscription. Find all problems, inefficiencies, misconfigurations, security gaps, and cost issues. Look across all resource types together — cross-resource patterns matter (e.g. a database in one region used by an app in another).',
    provider,
    model
  )
  if ('error' in result) return result

  const merged: ClaudeAnalysisStore = { ...existing, all: result.analysis }
  await updateClaudeAnalysis(auditId, merged)
  await saveFindings(auditId, result.analysis.findings, 'all')
  return { analysis: result.analysis, status: 200, cached: false }
}

// Narrows chat context to one scope (a resource type, "cost", "usage:<type>",
// or undefined/"all" for everything) — same scope values the Analyze panel
// uses, so switching the Chat dropdown and the Analyze dropdown feel like
// the same concept. Narrowing keeps requests smaller and answers focused
// when the user only cares about one part of the audit.
async function buildChatContextData(auditId: string, audit: { raw_data: Record<string, unknown> }, scope?: string): Promise<unknown> {
  if (!scope || scope === 'all') {
    const costUsage = await findAuditCostUsageRaw(auditId)
    return {
      ...audit.raw_data,
      ...(costUsage?.cost ? { cost: costUsage.cost } : {}),
      ...(costUsage?.usage ? { usage: costUsage.usage } : {}),
    }
  }
  if (scope === 'cost') {
    return { cost: (await findAuditCostRaw(auditId))?.cost }
  }
  if (scope.startsWith('usage:')) {
    const usageType = scope.slice('usage:'.length)
    const usageRaw = await findAuditUsageRaw(auditId)
    return { usage: { type: usageType, groups: buildUsageGroups(usageRaw?.metrics || [], usageType) } }
  }
  if (scope in audit.raw_data) {
    return { [scope]: audit.raw_data[scope] }
  }
  // Unknown scope — fail open to full context rather than erroring the chat.
  const costUsage = await findAuditCostUsageRaw(auditId)
  return {
    ...audit.raw_data,
    ...(costUsage?.cost ? { cost: costUsage.cost } : {}),
    ...(costUsage?.usage ? { usage: costUsage.usage } : {}),
  }
}

export async function runChat(
  auditId: string,
  question: string,
  history: ChatMessage[],
  provider: LLMProvider = DEFAULT_PROVIDER,
  model: string = DEFAULT_MODEL,
  scope?: string
): Promise<{ reply?: string; error?: string; status: number }> {
  const audit = await findAuditById(auditId)
  if (!audit) return { error: 'audit not found', status: 404 }

  let findings: Finding[] = []
  try { findings = await findFindingsByAudit(auditId) } catch { /* findings are optional context */ }

  const scopedData = await buildChatContextData(auditId, audit, scope)

  const context = `You are the assistant inside the BTG DevOps dashboard. You answer questions about ONE specific Azure audit, scoped to the data below. Be concrete and reference specific resources by name. If asked something outside this audit's data, say you only have access to this audit.

Audit metadata: id=${audit.id}, created_at=${audit.created_at}, subscription=${audit.subscription_name || audit.subscription_id}, status=${audit.status}

Resource data:
${JSON.stringify(scopedData)}

${findings.length > 0 ? `Existing analysis findings:\n${JSON.stringify(findings)}` : ''}`

  const messages: LLMMessage[] = [
    { role: 'user', content: context },
    { role: 'assistant', content: 'Understood. I have the audit data loaded and I am ready to answer questions about it.' },
    ...history.slice(-10).map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
    { role: 'user', content: question },
  ]

  let reply: string
  try {
    reply = await callLLM({ provider, model, maxTokens: 4000, messages })
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'chat call failed', status: 502 }
  }
  if (!reply) return { error: 'empty response from model', status: 502 }

  return { reply, status: 200 }
}
