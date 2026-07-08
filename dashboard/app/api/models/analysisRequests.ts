import pool from './client'

// Backs the MCP-server/Claude-Code-orchestrator flow (spec 8): the dashboard
// writes a pending row instead of calling an LLM API directly, a scheduled
// Claude Code agent claims it through the MCP server, and writes the result
// back via the existing updateClaudeAnalysis()/saveFindings() functions.

export interface AnalysisRequest {
  id: string
  audit_id: string
  scope: string
  status: 'pending' | 'done' | 'failed'
  error_message: string | null
  requested_at: Date
  completed_at: Date | null
}

const REQUEST_COLS = `id, audit_id, scope, status, error_message, requested_at, completed_at`

export async function insertAnalysisRequest(auditId: string, scope: string): Promise<AnalysisRequest> {
  const { rows } = await pool.query(
    `INSERT INTO analysis_requests (audit_id, scope) VALUES ($1, $2) RETURNING ${REQUEST_COLS}`,
    [auditId, scope]
  )
  return rows[0]
}

// The most recent request for this audit+scope — callers use this to avoid
// enqueueing a duplicate while one is already pending, and to resolve what
// the frontend should poll right after the Analyze click.
export async function findLatestAnalysisRequest(auditId: string, scope: string): Promise<AnalysisRequest | null> {
  const { rows } = await pool.query(
    `SELECT ${REQUEST_COLS} FROM analysis_requests
     WHERE audit_id = $1 AND scope = $2
     ORDER BY requested_at DESC LIMIT 1`,
    [auditId, scope]
  )
  return rows[0] || null
}

// The pending row a save_analysis() call should mark done — looked up by
// audit_id + scope rather than by id, since the MCP tool signature (per
// spec 8) is save_analysis(auditId, scope, ...), not save_analysis(requestId, ...).
export async function findPendingAnalysisRequest(auditId: string, scope: string): Promise<AnalysisRequest | null> {
  const { rows } = await pool.query(
    `SELECT ${REQUEST_COLS} FROM analysis_requests
     WHERE audit_id = $1 AND scope = $2 AND status = 'pending'
     ORDER BY requested_at DESC LIMIT 1`,
    [auditId, scope]
  )
  return rows[0] || null
}

export async function findAnalysisRequestById(id: string): Promise<AnalysisRequest | null> {
  const { rows } = await pool.query(
    `SELECT ${REQUEST_COLS} FROM analysis_requests WHERE id = $1`,
    [id]
  )
  return rows[0] || null
}

// Claimed by the MCP server's list_pending_requests() tool — oldest first,
// so a backlog drains in request order rather than last-in-first-served.
export async function listPendingAnalysisRequests(limit = 20): Promise<AnalysisRequest[]> {
  const { rows } = await pool.query(
    `SELECT ${REQUEST_COLS} FROM analysis_requests
     WHERE status = 'pending'
     ORDER BY requested_at ASC LIMIT $1`,
    [limit]
  )
  return rows
}

export async function markAnalysisRequestDone(id: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE analysis_requests SET status = 'done', completed_at = NOW() WHERE id = $1`,
    [id]
  )
  return (rowCount ?? 0) > 0
}

export async function markAnalysisRequestFailed(id: string, errorMessage: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE analysis_requests SET status = 'failed', error_message = $2, completed_at = NOW() WHERE id = $1`,
    [id, errorMessage]
  )
  return (rowCount ?? 0) > 0
}
