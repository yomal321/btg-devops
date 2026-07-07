'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { Header } from '../components/Header'
import { KPICard } from '../components/KPICard'
import { AnalysisPanel } from '../components/AnalysisPanel'
import { ChatDock } from '../components/ChatDock'
import { CostTrendChart, TopServicesChart, formatCurrency } from '../components/CostCharts'
import { UsageSection } from '../components/UsageSection'
import { KPISkeletonRow, ChartSkeleton } from '../components/Skeleton'
import { api } from '../lib/api'
import { shortId } from '../lib/utils'
import type { Audit, CostSummary } from '../types'

export default function CostUsagePage() {
  const [audit, setAudit]     = useState<Audit | null>(null)
  const [summary, setSummary] = useState<CostSummary | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [error, setError]     = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const audits = await api.listAudits()
        const latest = audits
          .filter(a => a.status === 'completed')
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0]
        if (!latest) {
          if (!cancelled) setNotFound(true)
          return
        }
        const summaryData = await api.getCostSummary(latest.id)
        if (!cancelled) {
          setAudit(latest)
          setSummary(summaryData)
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load cost & usage data')
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  if (error) {
    return (
      <>
        <Header title="Cost & Usage" />
        <div style={{ padding: '3rem 1.5rem', textAlign: 'center', color: '#ef4444', fontSize: '0.875rem' }}>{error}</div>
      </>
    )
  }

  if (notFound) {
    return (
      <>
        <Header title="Cost & Usage" />
        <div className="glass" style={{ margin: '1.5rem', padding: '3rem 2rem', textAlign: 'center' }}>
          <p style={{ color: 'var(--t2)', fontSize: '0.9rem' }}>No completed audits yet.</p>
          <p style={{ color: 'var(--t3)', fontSize: '0.8rem', marginTop: '0.375rem' }}>
            Cost and usage data appears here once the first audit completes.
          </p>
        </div>
      </>
    )
  }

  if (!audit || !summary) {
    return (
      <>
        <Header title="Cost & Usage" />
        <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <KPISkeletonRow />
          <ChartSkeleton />
        </div>
      </>
    )
  }

  const hasCost = summary.daily_cost.length > 0
  const hasUsage = summary.usage_types.length > 0

  const totalCost = summary.daily_cost.reduce((s, d) => s + d.cost, 0)
  const daySpan = (new Date(summary.period_to).getTime() - new Date(summary.period_from).getTime()) / 86400000 || 1
  const avgDaily = totalCost / daySpan

  return (
    <>
      <Header
        title="Cost & Usage"
        actions={
          <Link href={`/audits/${audit.id}`} style={{
            fontSize: '0.78rem', color: 'var(--acc)', textDecoration: 'none',
            display: 'inline-flex', alignItems: 'center', gap: '0.3rem', marginRight: '0.5rem',
          }}>
            View source audit ({shortId(audit.id)}) <ArrowRight size={12} />
          </Link>
        }
      />
      <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        <p style={{ fontSize: '0.78rem', color: 'var(--t3)' }}>
          Showing the latest completed audit's snapshot ({new Date(audit.created_at).toLocaleString()}, {audit.subscription_name || shortId(audit.subscription_id)})
          {summary.period_from && ` · period ${summary.period_from} to ${summary.period_to}`}
        </p>

        {!hasCost && !hasUsage ? (
          <div className="glass" style={{ padding: '3rem 2rem', textAlign: 'center' }}>
            <p style={{ color: 'var(--t2)', fontSize: '0.9rem' }}>No cost or usage data in this audit yet.</p>
            <p style={{ color: 'var(--t3)', fontSize: '0.8rem', marginTop: '0.375rem' }}>
              Run <code>btg-devops collect</code> with the updated extractors to populate this page.
            </p>
          </div>
        ) : (
          <>
            {/* KPI tiles */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <KPICard
                label="Total Spend"
                value={hasCost ? formatCurrency(totalCost, summary.currency) : '—'}
                sub={hasCost ? `${summary.period_from} to ${summary.period_to}` : 'no cost data'}
                accent="emerald"
              />
              <KPICard
                label="Avg Daily Spend"
                value={hasCost ? formatCurrency(avgDaily, summary.currency) : '—'}
                sub="based on actual cost"
                accent="cyan"
              />
              <KPICard
                label="Resources Sampled"
                value={summary.total_resources_sampled}
                sub="for usage metrics"
                accent="violet"
              />
            </div>

            {/* Cost charts */}
            {hasCost && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <div className="glass" style={{ padding: '1.25rem' }}>
                  <CostTrendChart dailyCost={summary.daily_cost} currency={summary.currency} />
                </div>
                <div className="glass" style={{ padding: '1.25rem' }}>
                  <TopServicesChart topServices={summary.top_services} currency={summary.currency} />
                </div>
              </div>
            )}

            {/* AI Analysis — full width; chat lives in the floating ChatDock */}
            <AnalysisPanel
              auditId={audit.id}
              resourceCounts={{}}
              initialStore={summary.claude_analysis}
              hasCost={hasCost}
              usageTypes={summary.usage_types}
            />

            {/* Resource Utilization — nothing loads until a type is picked */}
            {hasUsage && <UsageSection auditId={audit.id} usageTypes={summary.usage_types} />}
          </>
        )}
      </div>

      {(hasCost || hasUsage) && (
        <ChatDock
          auditId={audit.id}
          hasCost={hasCost}
          usageTypes={summary.usage_types}
        />
      )}
    </>
  )
}
