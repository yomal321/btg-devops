import { findFindingsByAudit, insertFinding, findFindingById, updateFinding, deleteFinding } from '../models/findings'
import { Finding } from '../types'

export async function listFindingsController(auditId: string) {
  const findings = await findFindingsByAudit(auditId)
  return { data: findings, status: 200 }
}

export async function saveFindingsController(auditId: string, findings: Omit<Finding, 'id' | 'audit_id' | 'created_at'>[]) {
  if (!Array.isArray(findings) || findings.length === 0) {
    return { error: 'findings array required', status: 400 }
  }
  for (const f of findings) {
    await insertFinding(auditId, f)
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
  body: { severity?: string; resource_type?: string; resource_name?: string; issue?: string; recommendation?: string }
) {
  const validSeverities = ['Critical', 'Warning', 'Info']
  if (body.severity && !validSeverities.includes(body.severity)) {
    return { error: 'severity must be Critical, Warning, or Info', status: 400 }
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
