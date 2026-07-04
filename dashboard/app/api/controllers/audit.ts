import { findAllAudits, findAuditById, findAuditResource, findAuditCostUsageRaw, updateClaudeAnalysis, insertAudit, updateAudit, deleteAudit, clearClaudeAnalysis, findAnalysisById } from '../models/audit'
import { findResourceBySlug } from '../models/resource'
import { runAnalysis } from '../utils/claude'
import { CostUsageSummary } from '../types'

function formatUsageDate(n: number): string {
  const s = String(n)
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
}

export async function getCostUsageSummaryController(auditId: string) {
  const raw = await findAuditCostUsageRaw(auditId)
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

  const metrics = raw.usage?.metrics || []
  const byResource = new Map<string, { metric_name: string; unit: string; avg: number | null; total: number | null; rank: number }[]>()
  for (const m of metrics) {
    const points = m.data_points || []
    const avgPoints = points.filter(p => p.average !== undefined)
    const totalPoints = points.filter(p => p.total !== undefined)
    const avg = avgPoints.length ? avgPoints.reduce((s, p) => s + (p.average || 0), 0) / avgPoints.length : null
    const total = totalPoints.length ? totalPoints.reduce((s, p) => s + (p.total || 0), 0) : null
    const list = byResource.get(m.resource_id) || []
    list.push({ metric_name: m.metric_name, unit: m.unit, avg, total, rank: total ?? avg ?? 0 })
    byResource.set(m.resource_id, list)
  }

  const usageByResource = Array.from(byResource.entries())
    .map(([resource_id, list]) => ({
      resource_id,
      rank: Math.max(0, ...list.map(m => m.rank)),
      metrics: list.map(m => ({ metric_name: m.metric_name, unit: m.unit, avg: m.avg, total: m.total })),
    }))
    .sort((a, b) => b.rank - a.rank)
    .map(({ resource_id, metrics }) => ({ resource_id, metrics }))

  const summary: CostUsageSummary = {
    currency,
    period_from: raw.cost?.period_from || raw.usage?.period_from || '',
    period_to: raw.cost?.period_to || raw.usage?.period_to || '',
    total_cost_rows: raw.cost?.total_rows || 0,
    daily_cost: dailyCost,
    top_services: topServices,
    total_resources_sampled: raw.usage?.total_resources_sampled || 0,
    usage_by_resource: usageByResource,
    claude_analysis: raw.claude_analysis,
  }

  return { data: summary, status: 200 }
}

export async function runAnalysisController(auditId: string, resourceSlug?: string) {
  try {
    const result = await runAnalysis(auditId, resourceSlug)
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
  return { data: audit, status: 200 }
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
