import pool from './client'
import { Finding } from '../types'

const FINDING_COLS = `id, audit_id, severity, category, resource_type, resource_name,
            issue, recommendation, scope, status, first_seen_at, resolved_at, created_at`

export async function findFindingsByAudit(auditId: string, scope?: string): Promise<Finding[]> {
  const params: unknown[] = [auditId]
  let where = `audit_id = $1`
  if (scope) {
    params.push(scope)
    where += ` AND scope = $2`
  }
  const { rows } = await pool.query(
    `SELECT ${FINDING_COLS}
     FROM findings WHERE ${where}
     ORDER BY CASE severity WHEN 'Critical' THEN 1 WHEN 'Warning' THEN 2 ELSE 3 END, created_at ASC`,
    params
  )
  return rows
}

export async function insertFinding(
  auditId: string,
  finding: { severity: string; category?: string; resource_type: string; resource_name: string; issue: string; recommendation: string },
  scope?: string,
  lifecycle?: { status?: string; firstSeenAt?: Date }
): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO findings (audit_id, severity, category, resource_type, resource_name, issue, recommendation, scope, status, first_seen_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [
      auditId, finding.severity, finding.category || null, finding.resource_type, finding.resource_name,
      finding.issue, finding.recommendation, scope || null,
      lifecycle?.status || 'open', lifecycle?.firstSeenAt || new Date(),
    ]
  )
  return rows[0].id
}

// Deletes all findings previously saved for this exact scope on this audit —
// called right before inserting a fresh batch, so re-analyzing a scope
// replaces its old findings instead of accumulating duplicates alongside
// them. Rows from other scopes (or pre-scope-tracking legacy rows with a
// NULL scope) are untouched.
export async function deleteFindingsByScope(auditId: string, scope: string): Promise<number> {
  const { rowCount } = await pool.query(
    `DELETE FROM findings WHERE audit_id = $1 AND scope = $2`,
    [auditId, scope]
  )
  return rowCount ?? 0
}

export interface PriorFinding {
  id: string
  resource_type: string
  resource_name: string
  category: string | null
  status: string
  first_seen_at: Date
}

// Live (open or dismissed) findings for the same subscription + scope from
// audits OLDER than the given one. Used by saveFindings to (a) carry each
// issue's original first_seen_at forward so age survives across audits,
// (b) keep dismissals sticky, and (c) auto-resolve issues that stopped
// appearing. Only older audits are considered so re-analyzing an old audit
// can't absorb or resolve findings that belong to a newer one.
export async function findPriorLiveFindings(auditId: string, scope: string): Promise<PriorFinding[]> {
  const { rows } = await pool.query(
    `SELECT f.id, f.resource_type, f.resource_name, f.category, f.status, f.first_seen_at
     FROM findings f
     JOIN audits a   ON a.id = f.audit_id
     JOIN audits cur ON cur.id = $1
     WHERE a.subscription_id = cur.subscription_id
       AND a.created_at < cur.created_at
       AND f.scope = $2
       AND f.status IN ('open', 'dismissed')`,
    [auditId, scope]
  )
  return rows
}

export async function deleteFindingsByIds(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0
  const { rowCount } = await pool.query(`DELETE FROM findings WHERE id = ANY($1)`, [ids])
  return rowCount ?? 0
}

export async function resolveFindingsByIds(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0
  const { rowCount } = await pool.query(
    `UPDATE findings SET status = 'resolved', resolved_at = NOW() WHERE id = ANY($1)`,
    [ids]
  )
  return rowCount ?? 0
}

export async function findTopFindings(limit: number): Promise<Finding[]> {
  const { rows } = await pool.query(
    `SELECT ${FINDING_COLS}
     FROM findings
     WHERE status = 'open'
     ORDER BY CASE severity WHEN 'Critical' THEN 1 WHEN 'Warning' THEN 2 ELSE 3 END, created_at DESC
     LIMIT $1`,
    [limit]
  )
  return rows
}

export async function findFindingById(findingId: number): Promise<Finding | null> {
  const { rows } = await pool.query(
    `SELECT ${FINDING_COLS}
     FROM findings WHERE id = $1`,
    [findingId]
  )
  return rows[0] || null
}

export async function updateFinding(
  findingId: number,
  fields: { severity?: string; resource_type?: string; resource_name?: string; issue?: string; recommendation?: string; status?: string }
): Promise<boolean> {
  const sets: string[] = []
  const values: unknown[] = [findingId]
  let i = 2
  if (fields.severity !== undefined) { sets.push(`severity = $${i++}`); values.push(fields.severity) }
  if (fields.resource_type !== undefined) { sets.push(`resource_type = $${i++}`); values.push(fields.resource_type) }
  if (fields.resource_name !== undefined) { sets.push(`resource_name = $${i++}`); values.push(fields.resource_name) }
  if (fields.issue !== undefined) { sets.push(`issue = $${i++}`); values.push(fields.issue) }
  if (fields.recommendation !== undefined) { sets.push(`recommendation = $${i++}`); values.push(fields.recommendation) }
  if (fields.status !== undefined) {
    sets.push(`status = $${i++}`)
    values.push(fields.status)
    // resolved_at mirrors the status: stamped when resolved, cleared when reopened/dismissed.
    sets.push(fields.status === 'resolved' ? `resolved_at = NOW()` : `resolved_at = NULL`)
  }
  if (sets.length === 0) return false
  const { rowCount } = await pool.query(
    `UPDATE findings SET ${sets.join(', ')} WHERE id = $1`,
    values
  )
  return (rowCount ?? 0) > 0
}

export async function deleteFinding(findingId: number): Promise<boolean> {
  const { rowCount } = await pool.query(`DELETE FROM findings WHERE id = $1`, [findingId])
  return (rowCount ?? 0) > 0
}
