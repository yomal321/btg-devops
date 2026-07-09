import pool from './client'
import { Audit, AuditDetail, CostDataRaw, UsageDataRaw } from '../types'

export interface AuditCostUsageRaw {
  cost: CostDataRaw | null
  usage: UsageDataRaw | null
  claude_analysis: Record<string, unknown> | null
}

export interface AuditCostRaw {
  cost: CostDataRaw | null
  claude_analysis: Record<string, unknown> | null
}

export async function findAllAudits(): Promise<Audit[]> {
  const { rows } = await pool.query(
    `SELECT id, created_at, subscription_id,
            COALESCE(subscription_name, '') AS subscription_name,
            trigger_type, status, current_step,
            COALESCE(error_message, '') AS error_message,
            COALESCE(resource_counts, '{}'::jsonb) AS resource_counts,
            claude_analysis IS NOT NULL AS has_analysis
     FROM audits ORDER BY created_at DESC`
  )
  return rows
}

export async function findAuditById(auditId: string): Promise<AuditDetail | null> {
  const { rows } = await pool.query(
    `SELECT id, created_at, subscription_id,
            COALESCE(subscription_name, '') AS subscription_name,
            trigger_type, status,
            COALESCE(error_message, '') AS error_message,
            COALESCE(resource_counts, '{}'::jsonb) AS resource_counts,
            claude_analysis IS NOT NULL AS has_analysis,
            cost_data IS NOT NULL AS has_cost,
            usage_data IS NOT NULL AS has_usage,
            COALESCE(raw_data, '{}'::jsonb) AS raw_data,
            claude_analysis
     FROM audits WHERE id = $1`,
    [auditId]
  )
  return rows[0] || null
}

// findAuditRawData reads only raw_data — used by the region-summary
// endpoint, which needs the 12-resource-type inventory but not cost_data,
// usage_data, or claude_analysis (same column-isolation rationale as
// findAuditCostRaw/findAuditUsageRaw below).
export async function findAuditRawData(auditId: string): Promise<Record<string, unknown> | null> {
  const { rows } = await pool.query(
    `SELECT raw_data FROM audits WHERE id = $1`,
    [auditId]
  )
  return rows[0]?.raw_data || null
}

// findAuditCostRaw reads cost_data + claude_analysis. cost_data is its own
// column (not nested in raw_data), so this never touches the 12-resource-type
// blob at all — fast regardless of how large raw_data has grown.
export async function findAuditCostRaw(auditId: string): Promise<AuditCostRaw | null> {
  const { rows } = await pool.query(
    `SELECT cost_data AS cost, claude_analysis FROM audits WHERE id = $1`,
    [auditId]
  )
  return rows[0] || null
}

// findAuditUsageRaw reads only usage_data — same isolation rationale as
// findAuditCostRaw.
export async function findAuditUsageRaw(auditId: string): Promise<UsageDataRaw | null> {
  const { rows } = await pool.query(
    `SELECT usage_data FROM audits WHERE id = $1`,
    [auditId]
  )
  return rows[0]?.usage_data || null
}

// findAuditCostUsageRaw is kept for callers that still need both at once
// (e.g. runAnalysis's "cost"/"usage" scopes) — two isolated columns, still
// far cheaper than touching raw_data.
export async function findAuditCostUsageRaw(auditId: string): Promise<AuditCostUsageRaw | null> {
  const { rows } = await pool.query(
    `SELECT cost_data AS cost, usage_data AS usage, claude_analysis FROM audits WHERE id = $1`,
    [auditId]
  )
  return rows[0] || null
}

export async function findAuditResource(auditId: string, slug: string): Promise<unknown | null> {
  const { rows } = await pool.query(
    `SELECT raw_data -> $2 AS data FROM audits
     WHERE id = $1 AND raw_data IS NOT NULL`,
    [auditId, slug]
  )
  return rows[0]?.data || null
}

export async function updateClaudeAnalysis(auditId: string, analysis: object): Promise<void> {
  await pool.query(
    `UPDATE audits SET claude_analysis = $2 WHERE id = $1`,
    [auditId, JSON.stringify(analysis)]
  )
}

export async function insertAudit(
  subscriptionId: string,
  subscriptionName: string,
  triggerType: string
): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO audits (subscription_id, subscription_name, trigger_type, status)
     VALUES ($1, $2, $3, 'running') RETURNING id`,
    [subscriptionId, subscriptionName, triggerType]
  )
  return rows[0].id
}

export async function updateAudit(
  auditId: string,
  fields: { status?: string; error_message?: string; subscription_name?: string }
): Promise<boolean> {
  const sets: string[] = []
  const values: unknown[] = [auditId]
  let i = 2
  if (fields.status !== undefined) { sets.push(`status = $${i++}`); values.push(fields.status) }
  if (fields.error_message !== undefined) { sets.push(`error_message = $${i++}`); values.push(fields.error_message) }
  if (fields.subscription_name !== undefined) { sets.push(`subscription_name = $${i++}`); values.push(fields.subscription_name) }
  if (sets.length === 0) return false
  const { rowCount } = await pool.query(
    `UPDATE audits SET ${sets.join(', ')} WHERE id = $1`,
    values
  )
  return (rowCount ?? 0) > 0
}

export async function deleteAudit(auditId: string): Promise<boolean> {
  const { rowCount } = await pool.query(`DELETE FROM audits WHERE id = $1`, [auditId])
  return (rowCount ?? 0) > 0
}

export async function clearClaudeAnalysis(auditId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE audits SET claude_analysis = NULL WHERE id = $1`,
    [auditId]
  )
  return (rowCount ?? 0) > 0
}

export async function findAnalysisById(auditId: string): Promise<object | null> {
  const { rows } = await pool.query(
    `SELECT claude_analysis FROM audits WHERE id = $1`,
    [auditId]
  )
  if (!rows[0]) return null
  return rows[0].claude_analysis
}
