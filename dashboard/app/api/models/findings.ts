import pool from './client'
import { Finding } from '../types'

export async function findFindingsByAudit(auditId: string): Promise<Finding[]> {
  const { rows } = await pool.query(
    `SELECT id, audit_id, severity, resource_type, resource_name, issue, recommendation, created_at
     FROM findings WHERE audit_id = $1
     ORDER BY CASE severity WHEN 'Critical' THEN 1 WHEN 'Warning' THEN 2 ELSE 3 END, created_at ASC`,
    [auditId]
  )
  return rows
}

export async function insertFinding(
  auditId: string,
  finding: Omit<Finding, 'id' | 'audit_id' | 'created_at'>
): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO findings (audit_id, severity, resource_type, resource_name, issue, recommendation)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [auditId, finding.severity, finding.resource_type, finding.resource_name, finding.issue, finding.recommendation]
  )
  return rows[0].id
}

export async function findFindingById(findingId: number): Promise<Finding | null> {
  const { rows } = await pool.query(
    `SELECT id, audit_id, severity, resource_type, resource_name, issue, recommendation, created_at
     FROM findings WHERE id = $1`,
    [findingId]
  )
  return rows[0] || null
}

export async function updateFinding(
  findingId: number,
  fields: { severity?: string; resource_type?: string; resource_name?: string; issue?: string; recommendation?: string }
): Promise<boolean> {
  const sets: string[] = []
  const values: unknown[] = [findingId]
  let i = 2
  if (fields.severity !== undefined) { sets.push(`severity = $${i++}`); values.push(fields.severity) }
  if (fields.resource_type !== undefined) { sets.push(`resource_type = $${i++}`); values.push(fields.resource_type) }
  if (fields.resource_name !== undefined) { sets.push(`resource_name = $${i++}`); values.push(fields.resource_name) }
  if (fields.issue !== undefined) { sets.push(`issue = $${i++}`); values.push(fields.issue) }
  if (fields.recommendation !== undefined) { sets.push(`recommendation = $${i++}`); values.push(fields.recommendation) }
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
