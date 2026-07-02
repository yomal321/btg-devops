import { findAllAudits, findAuditById, findAuditResource, updateClaudeAnalysis, insertAudit, updateAudit, deleteAudit, clearClaudeAnalysis, findAnalysisById } from '../models/audit'
import { findResourceBySlug } from '../models/resource'

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
