'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Clock } from 'lucide-react'
import { Header } from '../components/Header'
import { Badge } from '../components/Badge'
import { AccessDenied } from '../components/Modal'
import { TableSkeleton } from '../components/Skeleton'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import type { DataGapEntry } from '../types'

// Age/severity color scale for how long a gap has been open (consecutive
// runs), reusing the same red/amber/blue convention as findingAge in
// lib/utils.ts — a gap open 5+ runs reads the same as a long-standing finding.
function streakBadge(n: number): { color: string; label: string } {
  if (n >= 5) return { color: 'error', label: `open ${n} runs` }
  if (n >= 2) return { color: 'warning', label: `open ${n} runs` }
  return { color: 'muted', label: 'new' }
}

export default function DataGapsPage() {
  const { user } = useAuth()
  const [gaps, setGaps]   = useState<DataGapEntry[] | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    api.listOpenDataGaps()
      .then(setGaps)
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load data gaps'))
  }, [])

  useEffect(() => {
    if (user?.role === 'admin' || user?.role === 'analyst') load()
  }, [user?.role, load])

  if (user && user.role !== 'admin' && user.role !== 'analyst') {
    return (
      <>
        <Header title="Data Gaps" />
        <AccessDenied message="Only admins and analysts can view data gaps." />
      </>
    )
  }

  return (
    <>
      <Header title="Data Gaps" />
      <div style={{ padding: '1.5rem', maxWidth: 960, margin: '0 auto' }}>
        <p style={{ fontSize: '0.85rem', color: 'var(--t3)', marginBottom: '1.25rem', lineHeight: 1.6 }}>
          Data the deep-research agent needed but couldn&apos;t verify in its most recent analysis,
          per subscription and resource scope. A gap disappears from this list automatically once a
          later run stops reporting it — this is not a history log, only what&apos;s still open now.
        </p>

        {error && (
          <p style={{ color: '#ef4444', fontSize: '0.85rem', marginBottom: '1rem' }}>{error}</p>
        )}

        {!gaps ? (
          <TableSkeleton rows={4} />
        ) : gaps.length === 0 ? (
          <div className="glass" style={{ padding: '2.5rem', textAlign: 'center' }}>
            <p style={{ fontSize: '0.9rem', color: 'var(--t2)' }}>No open data gaps.</p>
            <p style={{ fontSize: '0.78rem', color: 'var(--t4)', marginTop: '0.25rem' }}>
              Every scope&apos;s most recent analysis had everything it needed.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {gaps.map(g => {
              const streak = streakBadge(g.consecutive_runs)
              return (
                <div
                  key={`${g.subscription_id}:${g.scope}`}
                  className="glass"
                  style={{ padding: '1rem 1.125rem' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.625rem', flexWrap: 'wrap' }}>
                    <AlertTriangle size={15} color="#fbbf24" />
                    <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.82rem', fontWeight: 600, color: 'var(--t1)' }}>
                      {g.scope}
                    </span>
                    <span style={{ fontSize: '0.78rem', color: 'var(--t3)' }}>
                      {g.subscription_name || g.subscription_id}
                    </span>
                    <Badge color={streak.color} label={streak.label} />
                    <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.72rem', color: 'var(--t4)' }}>
                      <Clock size={11} />
                      last seen {new Date(g.generated_at).toLocaleDateString()}
                    </span>
                  </div>
                  <ul style={{ margin: 0, paddingLeft: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                    {g.gaps.map((text, i) => (
                      <li key={i} style={{ fontSize: '0.8rem', color: 'var(--t2)', lineHeight: 1.55 }}>
                        {text}
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}
