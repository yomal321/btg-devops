'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowRight, Check } from 'lucide-react'
import { Header } from './components/Header'
import { KPICard } from './components/KPICard'
import { ResourceChart } from './components/ResourceChart'
import { Badge } from './components/Badge'
import { KPISkeletonRow, ChartSkeleton, TableSkeleton } from './components/Skeleton'
import { TrendChart } from './components/TrendChart'
import { TopIssues } from './components/TopIssues'
import { api } from './lib/api'
import { useAuth } from './lib/auth'
import { formatNumber, shortId, statusConfig, triggerConfig } from './lib/utils'
import type { Audit, Subscription } from './types'

function totalResources(a: Audit): number {
  return Object.values(a.resource_counts || {}).reduce((s, n) => s + n, 0)
}

export default function DashboardPage() {
  const { user } = useAuth()
  const router   = useRouter()
  const [audits, setAudits]       = useState<Audit[] | null>(null)
  const [subs, setSubs]           = useState<Subscription[] | null>(null)
  const [error, setError]         = useState('')
  const [loading, setLoading]     = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const auditList = await api.listAudits()
      setAudits(auditList)
      if (user?.role === 'admin') {
        try { setSubs(await api.listSubscriptions()) } catch { setSubs(null) }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load dashboard data')
    } finally {
      setLoading(false)
    }
  }, [user?.role])

  useEffect(() => { load() }, [load])

  const latest = audits?.find(a => a.status === 'completed') || null
  const recent = audits?.slice(0, 5) || []

  const now = new Date()
  const auditsThisMonth = audits?.filter(a => {
    const d = new Date(a.created_at)
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
  }).length ?? 0

  const activeSubs = subs?.filter(s => s.is_active).length ?? null

  return (
    <>
      <Header title="Dashboard" />
      <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

        {loading && (
          <>
            <KPISkeletonRow />
            <ChartSkeleton />
            <TableSkeleton rows={5} cols={7} />
          </>
        )}

        {!loading && error && (
          <div className="glass" style={{ padding: '2rem', textAlign: 'center' }}>
            <p style={{ color: '#ef4444', fontSize: '0.875rem', marginBottom: '1rem' }}>{error}</p>
            <button className="btn-ghost" onClick={load}>Retry</button>
          </div>
        )}

        {!loading && !error && (
          <>
            {latest ? (
              <>
                {/* KPI tiles */}
                <div className="stagger grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <KPICard
                    label="Total Resources"
                    value={totalResources(latest)}
                    sub="from latest audit"
                    accent="cyan"
                  />
                  <KPICard
                    label="Last Audit"
                    value={new Date(latest.created_at).toLocaleDateString()}
                    sub={`${new Date(latest.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ${latest.subscription_name || shortId(latest.subscription_id)}`}
                    accent="emerald"
                  />
                  <KPICard
                    label="Subscriptions"
                    value={activeSubs !== null ? activeSubs : '—'}
                    sub={subs ? `${subs.length} total, ${activeSubs} active` : 'admin only'}
                    accent="violet"
                  />
                  <KPICard
                    label="Audits This Month"
                    value={auditsThisMonth}
                    trend="↑ daily"
                    trendDir="up"
                    sub="scheduled at 1:30 PM (SL time)"
                    accent="amber"
                  />
                </div>

                {/* Charts — trends + resource breakdown */}
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                  <TrendChart audits={audits || []} />
                  <div className="glass animate-fade-in" style={{ padding: '1.25rem' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '1rem' }}>
                      <h2 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--t1)' }}>Resource Breakdown</h2>
                      <span style={{ fontSize: '0.72rem', color: 'var(--t3)', fontFamily: 'ui-monospace, monospace' }}>
                        audit {shortId(latest.id)}
                      </span>
                    </div>
                    <ResourceChart counts={latest.resource_counts || {}} />
                  </div>
                </div>
              </>
            ) : (
              <div className="glass" style={{ padding: '3rem 2rem', textAlign: 'center' }}>
                <p style={{ color: 'var(--t2)', fontSize: '0.9rem', marginBottom: '0.375rem' }}>
                  No completed audits yet
                </p>
                <p style={{ color: 'var(--t3)', fontSize: '0.8rem' }}>
                  Audits will appear here once the first scheduled run finishes (daily at 1:30 PM Sri Lanka time).
                </p>
              </div>
            )}

            {/* Top issues digest */}
            <TopIssues />

            {/* Recent audits */}
            <div className="glass animate-fade-in" style={{ padding: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                <h2 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--t1)' }}>Recent Audits</h2>
                <Link href="/audits" style={{
                  fontSize: '0.8rem', color: 'var(--acc)', textDecoration: 'none',
                  display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                }}>
                  View all <ArrowRight size={13} />
                </Link>
              </div>

              {recent.length === 0 ? (
                <p style={{ color: 'var(--t3)', fontSize: '0.8rem', padding: '1rem 0' }}>No audits yet.</p>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border)' }}>
                        {['Audit ID', 'Date & Time', 'Trigger', 'Status', 'Resources', 'Analysis', ''].map(h => (
                          <th key={h} style={{
                            textAlign: 'left', padding: '0.5rem 0.75rem',
                            fontSize: '0.66rem', fontWeight: 600, letterSpacing: '0.06em',
                            textTransform: 'uppercase', color: 'var(--t3)',
                          }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {recent.map(a => {
                        const sc = statusConfig[a.status]  || { label: a.status, color: 'muted' }
                        const tc = triggerConfig[a.trigger_type] || { label: a.trigger_type, color: 'muted' }
                        return (
                          <tr
                            key={a.id}
                            className="row-hover"
                            style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                            onClick={() => router.push(`/audits/${a.id}`)}
                          >
                            <td style={{ padding: '0.625rem 0.75rem', fontFamily: 'ui-monospace, monospace', color: 'var(--acc)' }}>
                              {shortId(a.id)}
                            </td>
                            <td style={{ padding: '0.625rem 0.75rem', color: 'var(--t2)' }}>
                              {new Date(a.created_at).toLocaleString()}
                            </td>
                            <td style={{ padding: '0.625rem 0.75rem' }}>
                              <Badge color={tc.color} label={tc.label} />
                            </td>
                            <td style={{ padding: '0.625rem 0.75rem' }}>
                              <Badge color={sc.color} label={sc.label} />
                            </td>
                            <td style={{ padding: '0.625rem 0.75rem', color: 'var(--t2)' }}>
                              {a.status === 'failed' ? '—' : formatNumber(totalResources(a))}
                            </td>
                            <td style={{ padding: '0.625rem 0.75rem' }}>
                              {a.has_analysis ? (
                                <span style={{ color: '#22c55e', fontSize: '0.78rem', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                                  <Check size={13} /> Cached
                                </span>
                              ) : (
                                <span style={{ color: 'var(--t4)', fontSize: '0.78rem' }}>Not yet</span>
                              )}
                            </td>
                            <td style={{ padding: '0.625rem 0.75rem', textAlign: 'right' }}>
                              <span style={{ color: 'var(--acc)', fontSize: '0.78rem' }}>View</span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </>
  )
}
