import Anthropic from '@anthropic-ai/sdk'
import { findAuditById, updateClaudeAnalysis, findAnalysisById } from '../models/audit'
import { insertFinding, findFindingsByAudit } from '../models/findings'
import { ChatMessage, Finding } from '../types'

const MODEL = 'claude-sonnet-4-6'

let client: Anthropic | null = null
function getClient(): Anthropic {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY.startsWith('your-')) {
      throw new Error('ANTHROPIC_API_KEY is not configured')
    }
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  }
  return client
}

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

async function analyzeWithClaude(data: unknown, instruction: string): Promise<{ analysis: ClaudeAnalysis } | { error: string; status: number }> {
  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 8000,
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

  const block = response.content.find(b => b.type === 'text')
  if (!block || block.type !== 'text') {
    return { error: 'empty response from Claude', status: 502 }
  }

  let parsed: { summary?: string; findings?: AnalysisFinding[] }
  try {
    parsed = extractJSON(block.text) as { summary?: string; findings?: AnalysisFinding[] }
  } catch {
    return { error: 'could not parse Claude analysis response', status: 502 }
  }

  return {
    analysis: {
      summary: parsed.summary || '',
      findings: Array.isArray(parsed.findings) ? parsed.findings : [],
      generated_at: new Date().toISOString(),
      model: MODEL,
    },
  }
}

async function saveFindings(auditId: string, findings: AnalysisFinding[]) {
  const validSeverities = ['Critical', 'Warning', 'Info']
  for (const f of findings) {
    if (!validSeverities.includes(f.severity)) continue
    await insertFinding(auditId, {
      severity: f.severity,
      resource_type: f.resource_type || '',
      resource_name: f.resource_name || '',
      issue: f.issue || '',
      recommendation: f.recommendation || '',
    })
  }
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
  resourceSlug?: string
): Promise<{ analysis?: ClaudeAnalysis; error?: string; status: number; cached?: boolean }> {
  const audit = await findAuditById(auditId)
  if (!audit) return { error: 'audit not found', status: 404 }

  const existing = normalizeStore(await findAnalysisById(auditId))

  if (resourceSlug) {
    const cached = existing.by_resource?.[resourceSlug]
    if (cached) return { analysis: cached, status: 200, cached: true }

    const resourceData = (audit.raw_data as Record<string, unknown> | undefined)?.[resourceSlug]
    if (resourceData === undefined) {
      return { error: `no data for resource type "${resourceSlug}" in this audit`, status: 400 }
    }

    const result = await analyzeWithClaude(
      { [resourceSlug]: resourceData },
      `Analyze the "${resourceSlug}" resources in this Azure subscription as a senior DevOps engineer would. Find all problems, inefficiencies, misconfigurations, security gaps, and cost issues specific to this resource type.`
    )
    if ('error' in result) return result

    const merged: ClaudeAnalysisStore = {
      ...existing,
      by_resource: { ...(existing.by_resource || {}), [resourceSlug]: result.analysis },
    }
    await updateClaudeAnalysis(auditId, merged)
    await saveFindings(auditId, result.analysis.findings)
    return { analysis: result.analysis, status: 200, cached: false }
  }

  if (existing.all) return { analysis: existing.all, status: 200, cached: true }

  if (!audit.raw_data || Object.keys(audit.raw_data).length === 0) {
    return { error: 'audit has no resource data to analyze', status: 400 }
  }

  const result = await analyzeWithClaude(
    audit.raw_data,
    'Analyze this Azure subscription. Find all problems, inefficiencies, misconfigurations, security gaps, and cost issues. Look across all resource types together — cross-resource patterns matter (e.g. a database in one region used by an app in another).'
  )
  if ('error' in result) return result

  const merged: ClaudeAnalysisStore = { ...existing, all: result.analysis }
  await updateClaudeAnalysis(auditId, merged)
  await saveFindings(auditId, result.analysis.findings)
  return { analysis: result.analysis, status: 200, cached: false }
}

export async function runChat(auditId: string, question: string, history: ChatMessage[]): Promise<{ reply?: string; error?: string; status: number }> {
  const audit = await findAuditById(auditId)
  if (!audit) return { error: 'audit not found', status: 404 }

  let findings: Finding[] = []
  try { findings = await findFindingsByAudit(auditId) } catch { /* findings are optional context */ }

  const context = `You are the assistant inside the BTG DevOps dashboard. You answer questions about ONE specific Azure audit, scoped to the data below. Be concrete and reference specific resources by name. If asked something outside this audit's data, say you only have access to this audit.

Audit metadata: id=${audit.id}, created_at=${audit.created_at}, subscription=${audit.subscription_name || audit.subscription_id}, status=${audit.status}

Resource data:
${JSON.stringify(audit.raw_data)}

${findings.length > 0 ? `Existing analysis findings:\n${JSON.stringify(findings)}` : ''}`

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: context },
    { role: 'assistant', content: 'Understood. I have the audit data loaded and I am ready to answer questions about it.' },
    ...history.slice(-10).map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
    { role: 'user', content: question },
  ]

  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 4000,
    messages,
  })

  const block = response.content.find(b => b.type === 'text')
  if (!block || block.type !== 'text') {
    return { error: 'empty response from Claude', status: 502 }
  }

  return { reply: block.text, status: 200 }
}
