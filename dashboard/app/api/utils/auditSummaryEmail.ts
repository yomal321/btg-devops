import { findAuditById } from '../models/audit'
import { findFindingsByAudit } from '../models/findings'

const DASHBOARD_URL = process.env.DASHBOARD_URL || 'https://dashboard-eight-rho-42.vercel.app'
const SEVERITY_COLOR: Record<string, string> = { Critical: '#ef4444', Warning: '#f59e0b', Info: '#64748b' }

// Builds the one consolidated "analysis complete" email for an audit — sent
// once, when every resource-type analysis_requests row for it has resolved
// (see the completion check in app/api/mcp/tools.ts's save_analysis tool),
// not once per resource type. A findings-per-scope email would mean up to
// ~14 emails per audit, which trains recipients to ignore them.
export async function buildAuditSummaryEmail(auditId: string): Promise<{ subject: string; html: string } | null> {
  const audit = await findAuditById(auditId)
  if (!audit) return null

  const findings = (await findFindingsByAudit(auditId)).filter(f => f.status === 'open')
  const counts = { Critical: 0, Warning: 0, Info: 0 }
  for (const f of findings) counts[f.severity as keyof typeof counts]++

  const subject = counts.Critical > 0
    ? `[Critical] Azure audit analysis complete — ${counts.Critical} critical finding(s)`
    : `Azure audit analysis complete — ${audit.subscription_name || audit.subscription_id}`

  const topFindings = findings.slice(0, 8)
  const findingsHtml = topFindings.map(f => `
    <li style="margin-bottom:0.75rem;">
      <span style="color:${SEVERITY_COLOR[f.severity]};font-weight:600;">[${f.severity}]</span>
      <strong>${escapeHtml(f.resource_type)}</strong> — ${escapeHtml(f.resource_name)}<br/>
      <span style="color:#475569;">${escapeHtml(f.issue)}</span>
    </li>
  `).join('')

  const html = `
    <div style="font-family:sans-serif;max-width:600px;">
      <h2 style="margin-bottom:0.25rem;">Analysis complete: ${escapeHtml(audit.subscription_name || audit.subscription_id)}</h2>
      <p style="color:#64748b;margin-top:0;">Audit ${audit.id} · ${new Date(audit.created_at).toLocaleString()}</p>
      <p>
        <span style="color:${SEVERITY_COLOR.Critical};font-weight:600;">${counts.Critical} Critical</span> &nbsp;
        <span style="color:${SEVERITY_COLOR.Warning};font-weight:600;">${counts.Warning} Warning</span> &nbsp;
        <span style="color:${SEVERITY_COLOR.Info};font-weight:600;">${counts.Info} Info</span>
      </p>
      ${topFindings.length > 0 ? `<ul style="padding-left:1.25rem;">${findingsHtml}</ul>` : '<p>No open findings.</p>'}
      ${findings.length > topFindings.length ? `<p style="color:#64748b;">+ ${findings.length - topFindings.length} more — see the dashboard for the full list.</p>` : ''}
      <p><a href="${DASHBOARD_URL}/audits/${audit.id}" style="color:#7c3aed;">View full results →</a></p>
    </div>
  `

  return { subject, html }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}
