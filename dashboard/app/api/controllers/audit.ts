import { findAllAudits, findAuditById, findAuditResource, findAuditRawData, findAuditCostRaw, findAuditUsageRaw, updateClaudeAnalysis, insertAudit, updateAudit, deleteAudit, clearClaudeAnalysis, findAnalysisById } from '../models/audit'
import { findResourceBySlug } from '../models/resource'
import { insertAnalysisRequest, findLatestAnalysisRequest, findAnalysisRequestById } from '../models/analysisRequests'
import { runAnalysis, getAnalysisForScope } from '../utils/claude'
import { LLMProvider } from '../utils/llm'
import { buildUsageGroups, listUsageTypes } from '../utils/usage'
import { computeRegionDistribution, computeCrossRegionMismatches } from '../utils/region'
import { CostSummary, UsageSummary, RegionSummary } from '../types'

// Coerce an untrusted provider string from the request into a valid provider,
// or undefined (which makes runAnalysis/runChat fall back to their default).
function coerceProvider(p?: string): LLMProvider | undefined {
  return p === 'claude' || p === 'gemini' || p === 'openrouter' ? p : undefined
}

function formatUsageDate(n: number): string {
  const s = String(n)
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
}

const GITHUB_REPO = 'yomal321/btg-devops'
const GITHUB_WORKFLOW = 'scheduled-audit.yml'
const GITHUB_REF = 'production'

// Dispatches the same GitHub Actions workflow the daily cron uses, so a
// dashboard-triggered manual audit reuses the Go CLI's collection logic
// unchanged instead of duplicating it in TypeScript. Analysis requests get
// queued automatically once collect.go finishes (see collect.go); this
// endpoint only starts the audit, it doesn't wait for it.
export async function triggerAuditController() {
  const token = process.env.GITHUB_DISPATCH_TOKEN
  if (!token) {
    return { error: 'GITHUB_DISPATCH_TOKEN is not configured on the server', status: 500 }
  }

  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/${GITHUB_WORKFLOW}/dispatches`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref: GITHUB_REF, inputs: { trigger_label: 'manual-dashboard' } }),
    }
  )

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    return { error: `GitHub dispatch failed (${res.status}): ${body}`, status: 502 }
  }

  return { data: { triggered: true, triggered_at: new Date().toISOString() }, status: 202 }
}

// getCostSummaryController computes daily/service cost aggregates from
// cost_data (its own column — never touches the 12-resource-type raw_data
// blob) and lists which usage resource types have data, so the frontend can
// populate a type dropdown without fetching all usage data up front.
export async function getCostSummaryController(auditId: string) {
  // cost_data and usage_data are independent columns — fetching them in
  // parallel means total wait is the slower of the two, not the sum.
  const [raw, usage] = await Promise.all([
    findAuditCostRaw(auditId),
    findAuditUsageRaw(auditId),
  ])
  if (!raw) return { error: 'audit not found', status: 404 }

  const actualRows = raw.cost?.actual_cost_rows || []
  const currency = actualRows[0]?.Currency || 'USD'

  const byDate = new Map<number, number>()
  const byService = new Map<string, number>()
  for (const row of actualRows) {
    byDate.set(row.UsageDate, (byDate.get(row.UsageDate) || 0) + row.Cost)
    const service = row.ServiceName || 'Unknown'
    byService.set(service, (byService.get(service) || 0) + row.Cost)
  }

  const dailyCost = Array.from(byDate.entries())
    .sort(([a], [b]) => a - b)
    .map(([date, cost]) => ({ date: formatUsageDate(date), cost: Math.round(cost * 100) / 100 }))

  const topServices = Array.from(byService.entries())
    .map(([service, cost]) => ({ service, cost: Math.round(cost * 100) / 100 }))
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 10)

  const usageTypes = listUsageTypes(usage?.metrics || [])

  const summary: CostSummary = {
    currency,
    period_from: raw.cost?.period_from || '',
    period_to: raw.cost?.period_to || '',
    total_cost_rows: raw.cost?.total_rows || 0,
    daily_cost: dailyCost,
    top_services: topServices,
    total_resources_sampled: usage?.total_resources_sampled || 0,
    usage_types: usageTypes,
    claude_analysis: raw.claude_analysis,
  }

  return { data: summary, status: 200 }
}

// getUsageSummaryController aggregates utilization data for ONE resource
// type only, computed on demand — the frontend calls this after the user
// picks a type from the dropdown, instead of loading all resource types'
// usage data up front.
export async function getUsageSummaryController(auditId: string, type: string) {
  const usage = await findAuditUsageRaw(auditId)
  if (!usage) return { error: 'no usage data for this audit', status: 404 }

  const summary: UsageSummary = { type, groups: buildUsageGroups(usage.metrics || [], type) }
  return { data: summary, status: 200 }
}

// getRegionSummaryController computes region distribution and cross-region
// compute/data mismatches from raw_data alone (its own column read — never
// touches cost_data/usage_data). Deterministic, no LLM call.
export async function getRegionSummaryController(auditId: string) {
  const rawData = await findAuditRawData(auditId)
  if (!rawData) return { error: 'audit not found or has no resource data', status: 404 }

  const summary: RegionSummary = {
    distribution: computeRegionDistribution(rawData),
    mismatches: computeCrossRegionMismatches(rawData),
  }
  return { data: summary, status: 200 }
}

export async function runAnalysisController(auditId: string, resourceSlug?: string, provider?: string, model?: string) {
  try {
    const result = await runAnalysis(auditId, resourceSlug, coerceProvider(provider), model || undefined)
    if (result.error) return { error: result.error, status: result.status }
    return {
      data: { audit_id: auditId, resource: resourceSlug || null, cached: result.cached, analysis: result.analysis },
      status: 200,
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : 'analysis failed'
    return { error: message, status: 500 }
  }
}

// Enqueues an analysis run instead of calling an LLM directly (spec 8) — a
// scheduled Claude Code agent claims the pending row through the MCP server
// and writes the result back via saveAnalysisResult/getAnalysisForScope, the
// same functions runAnalysis itself uses for the (still-supported)
// synchronous path.
export async function createAnalysisRequestController(auditId: string, scope: string) {
  const audit = await findAuditById(auditId)
  if (!audit) return { error: 'audit not found', status: 404 }

  // Reuse an already-pending request for this exact scope rather than
  // enqueueing a duplicate — e.g. a double-click or a re-mounted poll.
  const latest = await findLatestAnalysisRequest(auditId, scope)
  if (latest && latest.status === 'pending') {
    return { data: { requestId: latest.id, status: latest.status }, status: 200 }
  }

  const request = await insertAnalysisRequest(auditId, scope)
  return { data: { requestId: request.id, status: request.status }, status: 201 }
}

export async function getAnalysisRequestController(auditId: string, requestId: string) {
  const request = await findAnalysisRequestById(requestId)
  if (!request || request.audit_id !== auditId) return { error: 'analysis request not found', status: 404 }

  if (request.status !== 'done') {
    return {
      data: { requestId: request.id, status: request.status, error_message: request.error_message },
      status: 200,
    }
  }

  const analysis = await getAnalysisForScope(auditId, request.scope)
  return { data: { requestId: request.id, status: request.status, analysis }, status: 200 }
}

export async function listAuditsController() {
  const audits = await findAllAudits()
  return { data: audits, status: 200 }
}

export async function getAuditController(auditId: string, resourceSlug?: string | null) {
  if (resourceSlug) {
    const resource = await findResourceBySlug(resourceSlug)
    if (!resource) {
      return { error: 'unknown resource type: ' + resourceSlug, status: 404 }
    }
    const data = await findAuditResource(auditId, resourceSlug)
    if (!data) {
      return { error: 'no data for this resource in audit', status: 404 }
    }
    return { data: { audit_id: auditId, resource, data }, status: 200 }
  }

  const audit = await findAuditById(auditId)
  if (!audit) return { error: 'audit not found', status: 404 }

  // usage_types lets the frontend build a per-resource-type scope dropdown
  // (Analyze, Chat) without fetching all usage data up front.
  let usageTypes: ReturnType<typeof listUsageTypes> = []
  if (audit.has_usage) {
    const usage = await findAuditUsageRaw(auditId)
    usageTypes = listUsageTypes(usage?.metrics || [])
  }

  return { data: { ...audit, usage_types: usageTypes }, status: 200 }
}

export async function saveAnalysisController(auditId: string, body: object) {
  await updateClaudeAnalysis(auditId, body)
  return { data: { message: 'analysis saved' }, status: 200 }
}

export async function createAuditController(body: { subscription_id: string; subscription_name: string; trigger_type: string }) {
  const { subscription_id, subscription_name, trigger_type } = body
  if (!subscription_id || !trigger_type) {
    return { error: 'subscription_id and trigger_type required', status: 400 }
  }
  if (!['manual', 'scheduled'].includes(trigger_type)) {
    return { error: 'trigger_type must be manual or scheduled', status: 400 }
  }
  const id = await insertAudit(subscription_id, subscription_name || '', trigger_type)
  return { data: { id }, status: 201 }
}

export async function updateAuditController(
  auditId: string,
  body: { status?: string; error_message?: string; subscription_name?: string }
) {
  const validStatuses = ['running', 'completed', 'failed']
  if (body.status && !validStatuses.includes(body.status)) {
    return { error: 'status must be running, completed, or failed', status: 400 }
  }
  const updated = await updateAudit(auditId, body)
  if (!updated) return { error: 'audit not found or no fields to update', status: 404 }
  return { data: { message: 'updated' }, status: 200 }
}

export async function deleteAuditController(auditId: string) {
  const deleted = await deleteAudit(auditId)
  if (!deleted) return { error: 'audit not found', status: 404 }
  return { data: { message: 'deleted' }, status: 200 }
}

export async function getAnalysisController(auditId: string) {
  const audit = await findAuditById(auditId)
  if (!audit) return { error: 'audit not found', status: 404 }
  const analysis = await findAnalysisById(auditId)
  if (!analysis) return { error: 'no analysis for this audit', status: 404 }
  return { data: { audit_id: auditId, analysis }, status: 200 }
}

export async function deleteAnalysisController(auditId: string) {
  const cleared = await clearClaudeAnalysis(auditId)
  if (!cleared) return { error: 'audit not found', status: 404 }
  return { data: { message: 'analysis cleared' }, status: 200 }
}
