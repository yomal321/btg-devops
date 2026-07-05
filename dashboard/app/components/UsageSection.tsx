'use client'

import { useEffect, useState } from 'react'
import { Activity } from 'lucide-react'
import { UsageTable } from './UsageTable'
import { Skeleton } from './Skeleton'
import { api } from '../lib/api'
import { resourceMeta } from '../lib/resourceMeta'
import type { UsageSummary } from '../types'

interface UsageSectionProps {
  auditId: string
  usageTypes: { slug: string; count: number }[]
}

/**
 * Nothing loads until the user picks a resource type — the backend
 * aggregates utilization for one type at a time, on demand, instead of
 * computing/returning all resource types' usage up front.
 */
export function UsageSection({ auditId, usageTypes }: UsageSectionProps) {
  const [type, setType]       = useState(usageTypes[0]?.slug || '')
  const [summary, setSummary] = useState<UsageSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  useEffect(() => {
    if (!type) return
    let cancelled = false
    setLoading(true)
    setError('')
    api.getUsageSummary(auditId, type)
      .then(data => { if (!cancelled) setSummary(data) })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load usage data') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [auditId, type])

  if (usageTypes.length === 0) return null

  const selectStyle: React.CSSProperties = {
    background: 'var(--panel)', border: '1px solid var(--border-strong)',
    borderRadius: 8, color: 'var(--t1)', padding: '0.35rem 0.625rem', fontSize: '0.78rem',
    cursor: 'pointer',
  }

  return (
    <div className="glass" style={{ padding: '1.25rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <Activity size={15} color="var(--acc)" />
        <h2 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--t1)', flex: 1 }}>Resource Utilization</h2>
        <select style={selectStyle} value={type} onChange={e => setType(e.target.value)}>
          {usageTypes.map(t => (
            <option key={t.slug} value={t.slug}>
              {resourceMeta(t.slug).label} ({t.count})
            </option>
          ))}
        </select>
      </div>

      {error && <p style={{ fontSize: '0.8rem', color: '#ef4444' }}>{error}</p>}

      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {[0, 1, 2].map(i => <Skeleton key={i} height={32} />)}
        </div>
      )}

      {!loading && !error && summary && <UsageTable groups={summary.groups} />}
    </div>
  )
}
