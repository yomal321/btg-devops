'use client'

import { useEffect, useState } from 'react'
import {
  BarChart, Bar, Cell, XAxis, Tooltip, ResponsiveContainer,
} from 'recharts'
import { Globe, TriangleAlert } from 'lucide-react'
import { api } from '../lib/api'
import { resourceMeta } from '../lib/resourceMeta'
import { categoricalColor } from '../lib/palette'
import { Skeleton } from './Skeleton'
import type { RegionSummary } from '../types'

export function RegionSection({ auditId }: { auditId: string }) {
  const [summary, setSummary] = useState<RegionSummary | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    api.getRegionSummary(auditId)
      .then(s => { if (!cancelled) setSummary(s) })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load region data') })
    return () => { cancelled = true }
  }, [auditId])

  if (error) return null // non-critical section — fail quietly rather than break the dashboard
  if (!summary) {
    return (
      <div className="glass" style={{ padding: '1.25rem' }}>
        <Skeleton width={160} height={16} style={{ marginBottom: '1rem' }} />
        <Skeleton height={200} radius={8} />
      </div>
    )
  }
  if (summary.distribution.length === 0) return null // audit has no location-bearing resources yet

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      {/* Region Distribution */}
      <div className="glass animate-fade-in" style={{ padding: '1.125rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
          <Globe size={14} color="var(--acc)" />
          <h2 style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--t1)' }}>Region Distribution</h2>
        </div>
        <div style={{ width: '100%', height: 190 }}>
          <ResponsiveContainer>
            <BarChart data={summary.distribution.map(d => ({ region: d.region, count: d.count }))} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
              <XAxis
                dataKey="region"
                interval={0}
                tick={{ fontSize: 9, fill: 'var(--t4)' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={t => t.length > 8 ? `${t.slice(0, 7)}…` : t}
              />
              <Tooltip
                cursor={{ fill: 'var(--hover)' }}
                contentStyle={{ background: 'var(--panel)', border: '1px solid var(--border-strong)', borderRadius: 8, fontSize: '0.78rem' }}
                labelStyle={{ color: 'var(--t1)', fontWeight: 600 }}
                itemStyle={{ color: 'var(--t2)' }}
              />
              <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={30}>
                {summary.distribution.map((entry, i) => (
                  <Cell key={entry.region} fill={categoricalColor(i)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Cross-Region Check */}
      <div className="glass animate-fade-in" style={{ padding: '1.125rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.375rem' }}>
          <TriangleAlert size={14} color={summary.mismatches.length > 0 ? '#fbbf24' : 'var(--acc)'} />
          <h2 style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--t1)' }}>Cross-Region Check</h2>
        </div>
        <p style={{ fontSize: '0.68rem', color: 'var(--t4)', marginBottom: '0.625rem' }}>
          Regions with compute resources but no local database/storage — a hint worth checking, not a confirmed problem.
        </p>

        {summary.mismatches.length === 0 ? (
          <div style={{ padding: '1.5rem 1rem', textAlign: 'center' }}>
            <p style={{ fontSize: '0.8rem', color: 'var(--t2)' }}>No cross-region gaps detected.</p>
            <p style={{ fontSize: '0.7rem', color: 'var(--t4)', marginTop: '0.25rem' }}>
              Every region with compute resources also has a database/storage resource in the same region.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem', maxHeight: 190, overflowY: 'auto' }}>
            {summary.mismatches.map(m => (
              <div key={m.region} style={{
                border: '1px solid rgba(251,191,36,0.25)', background: 'rgba(251,191,36,0.06)',
                borderRadius: 8, padding: '0.7rem 0.85rem',
              }}>
                <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--t1)', marginBottom: '0.375rem' }}>
                  {m.region} <span style={{ fontWeight: 400, color: 'var(--t3)' }}>— no local data resource</span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
                  {m.computeResources.map((c, i) => (
                    <span key={i} style={{
                      fontSize: '0.7rem', color: 'var(--t2)', fontFamily: 'ui-monospace, monospace',
                      background: 'var(--input-bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '0.15rem 0.45rem',
                    }}>
                      {resourceMeta(c.type).label}: {c.name}
                    </span>
                  ))}
                </div>
                <p style={{ fontSize: '0.7rem', color: 'var(--t4)', marginTop: '0.4rem' }}>
                  Data resources exist in: {m.dataRegions.join(', ')}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
