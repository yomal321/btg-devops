import pool from './client'
import { DataGapEntry } from '../types'

interface ScopeRun {
  auditId: string
  generatedAt: string
  gaps: string[]
}

// findOpenDataGaps aggregates every audit's cached claude_analysis into one
// row per (subscription, scope) — the LATEST analysis run for that
// combination — and returns only the ones whose latest run still reports a
// data_gaps entry. This is a pure read over the existing claude_analysis
// JSONB column; no schema change, since data_gaps has been saved there since
// spec 10.
//
// "Latest per scope" (not "every gap ever reported") is deliberate: if a
// later run stops reporting a gap, it must disappear from this view — this
// page reflects what's still open today, not a history log.
export async function findOpenDataGaps(): Promise<DataGapEntry[]> {
  const { rows } = await pool.query(
    `SELECT id, subscription_id, COALESCE(subscription_name, '') AS subscription_name,
            created_at, claude_analysis
     FROM audits
     WHERE claude_analysis IS NOT NULL
     ORDER BY subscription_id, created_at DESC`
  )

  // subscription_id -> scope -> run history, newest first (guaranteed by the
  // ORDER BY above: rows for one subscription are contiguous and DESC by date).
  const bySubscription = new Map<string, Map<string, ScopeRun[]>>()
  const subscriptionNames = new Map<string, string>()

  for (const row of rows) {
    subscriptionNames.set(row.subscription_id, row.subscription_name)

    const store = (row.claude_analysis || {}) as {
      all?: { generated_at?: string; data_gaps?: string[] }
      by_resource?: Record<string, { generated_at?: string; data_gaps?: string[] }>
      // Legacy flat shape (pre-scope-store analyses) has data_gaps at the top level.
      data_gaps?: string[]
      generated_at?: string
    }

    const scopeEntries: [string, { generated_at?: string; data_gaps?: string[] }][] = []
    if (store.all) scopeEntries.push(['all', store.all])
    else if (store.data_gaps || store.generated_at) scopeEntries.push(['all', store])
    for (const [scope, analysis] of Object.entries(store.by_resource || {})) {
      // 'deep' is a legacy alias of 'all' (claude.ts's getScopedAuditData
      // treats them identically) — normalize here too, otherwise a stale
      // pre-rename 'deep' analysis would look permanently "open" since no
      // future run ever writes back to that exact key again.
      scopeEntries.push([scope === 'deep' ? 'all' : scope, analysis])
    }

    let scopeMap = bySubscription.get(row.subscription_id)
    if (!scopeMap) {
      scopeMap = new Map()
      bySubscription.set(row.subscription_id, scopeMap)
    }

    for (const [scope, analysis] of scopeEntries) {
      let history = scopeMap.get(scope)
      if (!history) {
        history = []
        scopeMap.set(scope, history)
      }
      history.push({
        auditId: row.id,
        generatedAt: analysis.generated_at || row.created_at,
        gaps: Array.isArray(analysis.data_gaps) ? analysis.data_gaps : [],
      })
    }
  }

  const out: DataGapEntry[] = []
  for (const [subscriptionId, scopeMap] of bySubscription.entries()) {
    for (const [scope, history] of scopeMap.entries()) {
      const latest = history[0]
      if (!latest || latest.gaps.length === 0) continue // resolved — nothing to show

      let consecutiveRuns = 0
      for (const run of history) {
        if (run.gaps.length === 0) break
        consecutiveRuns++
      }

      out.push({
        subscription_id: subscriptionId,
        subscription_name: subscriptionNames.get(subscriptionId) || '',
        scope,
        gaps: latest.gaps,
        audit_id: latest.auditId,
        generated_at: latest.generatedAt,
        consecutive_runs: consecutiveRuns,
      })
    }
  }

  // Longest-open gaps first (most likely to need attention), then most
  // recently seen.
  out.sort((a, b) => b.consecutive_runs - a.consecutive_runs || (a.generated_at < b.generated_at ? 1 : -1))
  return out
}
