'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowRight, Check, Boxes, CalendarClock, Globe2, TrendingUp, LayoutGrid, Activity, MapPinned, History, PieChart } from 'lucide-react'
import { Header } from './components/Header'
import { KPICard } from './components/KPICard'
import { SectionHeader } from './components/SectionHeader'
import { ResourceChart } from './components/ResourceChart'
import { Badge } from './components/Badge'
import { KPISkeletonRow, ChartSkeleton, TableSkeleton } from './components/Skeleton'
import { TrendChart } from './components/TrendChart'
import { TopIssues } from './components/TopIssues'
import { useRegionSummary, RegionDistributionChart, CrossRegionCheck } from './components/RegionSection'
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
  const { summary: regionSummary, error: regionError } = useRegionSummary(latest?.id)

  const now = new Date()
  const auditsThisMonth = audits?.filter(a => {
    const d = new Date(a.created_at)
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
  }).length ?? 0

  const activeSubs = subs?.filter(s => s.is_active).length ?? null

  // Last 10 completed audits, oldest→newest, for the Total Resources sparkline.
  const resourceSparkline = (audits || [])
    .filter(a => a.status === 'completed')
    .slice(0, 10)
    .reverse()
    .map(totalResources)

  const hour = now.getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const firstName = user?.email ? user.email.split('@')[0] : ''

  return (
    <>
      <Header title="Dashboard" />
      <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

        {/* Hero / welcome banner */}
        <div
          className="animate-fade-in"
          style={{
            position: 'relative', overflow: 'hidden', borderRadius: 'var(--radius)',
            padding: '2rem 1.75rem', border: '1px solid var(--border-strong)',
            background: 'linear-gradient(135deg, #2d2350 0%, #241f3d 40%, var(--card) 100%)',
            boxShadow: 'var(--shadow-card)',
          }}
        >
          {/* layered color-mesh blobs — the "aurora" backdrop */}
          <div style={{
            position: 'absolute', top: '-45%', right: '-6%', width: 320, height: 320, borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(139,92,246,0.4) 0%, transparent 70%)', pointerEvents: 'none', filter: 'blur(2px)',
          }} />
          <div style={{
            position: 'absolute', bottom: '-55%', left: '18%', width: 280, height: 280, borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(56,189,248,0.28) 0%, transparent 70%)', pointerEvents: 'none',
          }} />
          <div style={{
            position: 'absolute', top: '-20%', left: '55%', width: 200, height: 200, borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(168,85,247,0.22) 0%, transparent 70%)', pointerEvents: 'none',
          }} />
          <p style={{ fontSize: '1.3rem', fontWeight: 800, color: '#f8fafc', position: 'relative', letterSpacing: '-0.01em' }}>
            {greeting}{firstName ? `, ${firstName}` : ''}
          </p>
          <p style={{ fontSize: '0.82rem', color: 'rgba(226,232,240,0.65)', marginTop: '0.375rem', position: 'relative' }}>
            {now.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            {latest && ` · Latest audit ${shortId(latest.id)} completed ${new Date(latest.created_at).toLocaleDateString()}`}
          </p>
          {latest && (
            <div style={{ display: 'flex', gap: '1.75rem', marginTop: '1.25rem', position: 'relative', flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#f8fafc', fontFamily: 'ui-monospace, monospace' }}>
                  {formatNumber(totalResources(latest))}
                </div>
                <div style={{ fontSize: '0.68rem', color: 'rgba(226,232,240,0.5)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>resources tracked</div>
              </div>
              <div>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#f8fafc', fontFamily: 'ui-monospace, monospace' }}>
                  {auditsThisMonth}
                </div>
                <div style={{ fontSize: '0.68rem', color: 'rgba(226,232,240,0.5)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>audits this month</div>
              </div>
              {activeSubs !== null && (
                <div>
                  <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#f8fafc', fontFamily: 'ui-monospace, monospace' }}>
                    {activeSubs}
                  </div>
                  <div style={{ fontSize: '0.68rem', color: 'rgba(226,232,240,0.5)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>active subscriptions</div>
                </div>
              )}
            </div>
          )}
        </div>

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
                {/* Overview */}
                <div>
                  <SectionHeader icon={LayoutGrid} title="Overview" caption="Key numbers from your latest audit" />
                  <div className="stagger grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <KPICard
                      icon={Boxes}
                      label="Total Resources"
                      value={totalResources(latest)}
                      sub="from latest audit"
                      accent="cyan"
                      sparkline={resourceSparkline}
                    />
                    <KPICard
                      icon={CalendarClock}
                      label="Last Audit"
                      value={new Date(latest.created_at).toLocaleDateString()}
                      sub={`${new Date(latest.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ${latest.subscription_name || shortId(latest.subscription_id)}`}
                      accent="emerald"
                    />
                    <KPICard
                      icon={Globe2}
                      label="Subscriptions"
                      value={activeSubs !== null ? activeSubs : '—'}
                      sub={subs ? `${subs.length} total, ${activeSubs} active` : 'admin only'}
                      accent="violet"
                    />
                    <KPICard
                      icon={TrendingUp}
                      label="Audits This Month"
                      value={auditsThisMonth}
                      trend="↑ daily"
                      trendDir="up"
                      sub="scheduled at 1:30 PM (SL time)"
                      accent="amber"
                    />
                  </div>
                </div>

                {/* Performance — trends over time */}
                <div className="cv-auto">
                  <SectionHeader icon={Activity} title="Performance" caption="How your resource footprint is trending" />
                  <TrendChart audits={audits || []} />
                </div>

                {/* Breakdown — resource type + region distribution, side by side */}
                <div className="cv-auto">
                  <SectionHeader icon={PieChart} title="Breakdown" caption="Where your resources are, by type and by region" />
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                    <div className="glass animate-fade-in" style={{ padding: '1.125rem' }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                        <h3 style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--t1)' }}>Resource Breakdown</h3>
                        <span style={{ fontSize: '0.68rem', color: 'var(--t3)', fontFamily: 'ui-monospace, monospace' }}>
                          audit {shortId(latest.id)}
                        </span>
                      </div>
                      <ResourceChart counts={latest.resource_counts || {}} />
                    </div>
                    <div className="glass animate-fade-in" style={{ padding: '1.125rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                        <MapPinned size={14} color="var(--acc)" />
                        <h3 style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--t1)' }}>Region Distribution</h3>
                      </div>
                      <RegionDistributionChart summary={regionSummary} error={regionError} />
                    </div>
                  </div>
                </div>

                {/* Regional Insights — cross-region compute/data check */}
                <div className="cv-auto">
                  <SectionHeader icon={MapPinned} title="Regional Insights" caption="Where compute is isolated from data" />
                  <CrossRegionCheck summary={regionSummary} error={regionError} />
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
            <div className="cv-auto"><TopIssues /></div>

            {/* Recent audits */}
            <div className="cv-auto">
              <SectionHeader
                icon={History}
                title="Recent Activity"
                caption="Latest audit runs across all subscriptions"
                action={
                  <Link href="/audits" style={{
                    fontSize: '0.8rem', color: 'var(--acc)', textDecoration: 'none',
                    display: 'inline-flex', alignItems: 'center', gap: '0.25rem', whiteSpace: 'nowrap',
                  }}>
                    View all <ArrowRight size={13} />
                  </Link>
                }
              />
              <div className="glass animate-fade-in" style={{ padding: '1.25rem' }}>

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
            </div>
          </>
        )}
      </div>
    </>
  )
}
