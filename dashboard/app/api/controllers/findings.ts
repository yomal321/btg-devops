import { findFindingsByAudit, insertFinding, findFindingById, updateFinding, deleteFinding, findTopFindings } from '../models/findings'
import { Finding } from '../types'

export async function topFindingsController(limit = 8) {
  const findings = await findTopFindings(limit)
  return { data: findings, status: 200 }
}

export async function listFindingsController(auditId: string, scope?: string) {
  const findings = await findFindingsByAudit(auditId, scope)
  return { data: findings, status: 200 }
}

export async function saveFindingsController(auditId: string, findings: Partial<Finding>[]) {
  if (!Array.isArray(findings) || findings.length === 0) {
    return { error: 'findings array required', status: 400 }
  }
  for (const f of findings) {
    await insertFinding(auditId, {
      severity: f.severity || 'Info',
      category: f.category || undefined,
      resource_type: f.resource_type || '',
      resource_name: f.resource_name || '',
      issue: f.issue || '',
      recommendation: f.recommendation || '',
    }, f.scope || undefined)
  }
  return { data: { saved: findings.length }, status: 201 }
}

export async function getFindingController(findingId: number) {
  const finding = await findFindingById(findingId)
  if (!finding) return { error: 'finding not found', status: 404 }
  return { data: finding, status: 200 }
}

export async function updateFindingController(
  findingId: number,
  body: { severity?: string; resource_type?: string; resource_name?: string; issue?: string; recommendation?: string; status?: string }
) {
  const validSeverities = ['Critical', 'Warning', 'Info']
  if (body.severity && !validSeverities.includes(body.severity)) {
    return { error: 'severity must be Critical, Warning, or Info', status: 400 }
  }
  // Status is validated here rather than a DB CHECK constraint — see schema.go.
  if (body.status && !['open', 'resolved', 'dismissed'].includes(body.status)) {
    return { error: 'status must be open, resolved, or dismissed', status: 400 }
  }
  const updated = await updateFinding(findingId, body)
  if (!updated) return { error: 'finding not found or no fields to update', status: 404 }
  return { data: { message: 'updated' }, status: 200 }
}

export async function deleteFindingController(findingId: number) {
  const deleted = await deleteFinding(findingId)
  if (!deleted) return { error: 'finding not found', status: 404 }
  return { data: { message: 'deleted' }, status: 200 }
}
