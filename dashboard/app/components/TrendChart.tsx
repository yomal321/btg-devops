'use client'

import { useMemo, useState } from 'react'
import {
  AreaChart, Area, XAxis, Tooltip, ResponsiveContainer,
} from 'recharts'
import { TrendingUp } from 'lucide-react'
import type { Audit } from '../types'

const TOTAL = '__total__'

export function TrendChart({ audits }: { audits: Audit[] }) {
  const [metric, setMetric] = useState<string>(TOTAL)

  const completed = useMemo(
    () => audits
      .filter(a => a.status === 'completed')
      .sort((x, y) => new Date(x.created_at).getTime() - new Date(y.created_at).getTime()),
    [audits]
  )

  const resourceTypes = useMemo(() => {
    const set = new Set<string>()
    completed.forEach(a => Object.keys(a.resource_counts || {}).forEach(k => set.add(k)))
    return Array.from(set).sort()
  }, [completed])

  const data = useMemo(() => completed.map(a => {
    const counts = a.resource_counts || {}
    const value = metric === TOTAL
      ? Object.values(counts).reduce((s, n) => s + n, 0)
      : counts[metric] || 0
    const d = new Date(a.created_at)
    return {
      date: `${d.getMonth() + 1}/${d.getDate()}`,
      value,
    }
  }), [completed, metric])

  const selectStyle: React.CSSProperties = {
    background: 'var(--panel)', border: '1px solid var(--border-strong)',
    borderRadius: 8, color: 'var(--t1)', padding: '0.3rem 0.55rem', fontSize: '0.72rem',
    cursor: 'pointer',
  }

  return (
    <div className="glass animate-fade-in" style={{ padding: '1.125rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
        <TrendingUp size={14} color="var(--acc)" />
        <h2 style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--t1)', flex: 1 }}>Trends Over Time</h2>
        <select style={selectStyle} value={metric} onChange={e => setMetric(e.target.value)}>
          <option value={TOTAL}>Total resources</option>
          {resourceTypes.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {completed.length < 2 ? (
        <div style={{ textAlign: 'center', padding: '2.25rem 1rem' }}>
          <p style={{ fontSize: '0.82rem', color: 'var(--t2)' }}>Not enough data yet</p>
          <p style={{ fontSize: '0.72rem', color: 'var(--t3)', marginTop: '0.25rem' }}>
            Trends appear once you have at least two completed audits.
          </p>
        </div>
      ) : (
        <div style={{ width: '100%', height: 190 }}>
          <ResponsiveContainer>
            <AreaChart data={data} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
              <defs>
                <linearGradient id="trendStroke" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#9085e9" />
                  <stop offset="100%" stopColor="#3987e5" />
                </linearGradient>
                <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3987e5" stopOpacity={0.32} />
                  <stop offset="100%" stopColor="#3987e5" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: 'var(--t4)' }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                cursor={{ stroke: 'var(--border-strong)' }}
                contentStyle={{
                  background: 'var(--panel)',
                  border: '1px solid var(--border-strong)',
                  borderRadius: 8,
                  fontSize: '0.78rem',
                }}
                labelStyle={{ color: 'var(--t1)', fontWeight: 600 }}
                itemStyle={{ color: 'var(--t2)' }}
                formatter={(value) => [value ?? 0, metric === TOTAL ? 'Total resources' : metric]}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke="url(#trendStroke)"
                strokeWidth={2.5}
                fill="url(#trendFill)"
                dot={false}
                activeDot={{ r: 4, fill: '#9085e9', strokeWidth: 0 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
