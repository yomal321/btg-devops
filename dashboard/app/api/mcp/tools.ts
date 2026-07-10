import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  listPendingAnalysisRequests,
  findPendingAnalysisRequest,
  markAnalysisRequestDone,
  markAnalysisRequestFailed,
  hasNoPendingForAudit,
} from '../models/analysisRequests'
import { getScopedAuditData, saveAnalysisResult, type ClaudeAnalysis } from '../utils/claude'
import { buildAuditSummaryEmail } from '../utils/auditSummaryEmail'
import { sendMail, resolveNotificationRecipients } from '../utils/mailer'

// Thin MCP wrappers over the dashboard's existing model/util functions
// (spec 8) — no business logic lives here. The scheduled Claude Code agent
// is the thing that actually reasons about the data; these three tools are
// just its window into the dashboard's Postgres data.

const findingSchema = z.object({
  severity: z.enum(['Critical', 'Warning', 'Info']),
  category: z.string(),
  resource_type: z.string(),
  resource_name: z.string(),
  issue: z.string(),
  recommendation: z.string(),
})

export function registerTools(server: McpServer) {
  server.registerTool(
    'list_pending_requests',
    {
      description: 'List analysis requests waiting to be processed (status=pending), oldest first.',
      inputSchema: {
        limit: z.number().int().min(1).max(100).default(20).describe('Max rows to return'),
      },
    },
    async ({ limit }) => {
      const rows = await listPendingAnalysisRequests(limit)
      return { content: [{ type: 'text', text: JSON.stringify(rows) }] }
    }
  )

  server.registerTool(
    'get_audit_data',
    {
      description: 'Fetch the Azure resource data and analysis instruction for one audit + scope (a resource type, "cost", "usage:<type>", or "all"). Use this to get the data to reason over for a pending analysis request.',
      inputSchema: {
        auditId: z.string().describe('The audit UUID (analysis_requests.audit_id)'),
        scope: z.string().describe('The scope (analysis_requests.scope) — a resource type, "cost", "usage:<type>", or "all"'),
      },
    },
    async ({ auditId, scope }) => {
      const result = await getScopedAuditData(auditId, scope)
      if ('error' in result) {
        return { content: [{ type: 'text', text: JSON.stringify(result) }], isError: true }
      }
      return { content: [{ type: 'text', text: JSON.stringify(result) }] }
    }
  )

  server.registerTool(
    'save_analysis',
    {
      description: 'Save a finished analysis for one audit + scope: persists the summary/findings (with full findings lifecycle — dedup, age carry-forward, auto-resolve) and marks the matching pending request done.',
      inputSchema: {
        auditId: z.string().describe('The audit UUID'),
        scope: z.string().describe('The scope this analysis covers — must match the pending request\'s scope'),
        summary: z.string().describe('2-3 sentence overall assessment'),
        findings: z.array(findingSchema),
        model: z.string().default('claude-code-orchestrator').describe('Identifier for the model/agent that produced this analysis'),
      },
    },
    async ({ auditId, scope, summary, findings, model }) => {
      const analysis: ClaudeAnalysis = {
        summary,
        findings,
        generated_at: new Date().toISOString(),
        model,
      }
      try {
        await saveAnalysisResult(auditId, scope, analysis)
      } catch (e) {
        const message = e instanceof Error ? e.message : 'failed to save analysis'
        const pending = await findPendingAnalysisRequest(auditId, scope)
        if (pending) await markAnalysisRequestFailed(pending.id, message)
        await sendSummaryEmailIfAuditComplete(auditId)
        return { content: [{ type: 'text', text: JSON.stringify({ error: message }) }], isError: true }
      }

      const pending = await findPendingAnalysisRequest(auditId, scope)
      if (pending) await markAnalysisRequestDone(pending.id)
      await sendSummaryEmailIfAuditComplete(auditId)

      return { content: [{ type: 'text', text: JSON.stringify({ saved: true, requestId: pending?.id ?? null }) }] }
    }
  )
}

// One consolidated email per audit, not one per resource type — checked
// after every save_analysis call, fires only once (when the last pending
// request for this audit resolves). Best-effort: a notification failure
// must never surface as an MCP tool error to the analyzer.
async function sendSummaryEmailIfAuditComplete(auditId: string): Promise<void> {
  try {
    if (!(await hasNoPendingForAudit(auditId))) return
    const email = await buildAuditSummaryEmail(auditId)
    if (!email) return
    const recipients = await resolveNotificationRecipients()
    await sendMail(email.subject, email.html, recipients)
  } catch (e) {
    console.warn('[mailer] audit-complete summary email failed:', e instanceof Error ? e.message : e)
  }
}
