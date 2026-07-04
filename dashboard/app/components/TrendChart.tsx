'use client'

import { useMemo, useState } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { TrendingUp } from 'lucide-react'
import { useTheme } from '../lib/theme'
import type { Audit } from '../types'

const TOTAL = '__total__'

export function TrendChart({ audits }: { audits: Audit[] }) {
  const { theme } = useTheme()
  const tickColor = theme === 'dark' ? '#64748b' : '#94a3b8'
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
    borderRadius: 8, color: 'var(--t1)', padding: '0.35rem 0.625rem', fontSize: '0.75rem',
    cursor: 'pointer',
  }

  return (
    <div className="glass animate-fade-in" style={{ padding: '1.25rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <TrendingUp size={15} color="var(--acc)" />
        <h2 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--t1)', flex: 1 }}>Trends Over Time</h2>
        <select style={selectStyle} value={metric} onChange={e => setMetric(e.target.value)}>
          <option value={TOTAL}>Total resources</option>
          {resourceTypes.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {completed.length < 2 ? (
        <div style={{ textAlign: 'center', padding: '3rem 1rem' }}>
          <p style={{ fontSize: '0.85rem', color: 'var(--t2)' }}>Not enough data yet</p>
          <p style={{ fontSize: '0.75rem', color: 'var(--t3)', marginTop: '0.25rem' }}>
            Trends appear once you have at least two completed audits.
          </p>
        </div>
      ) : (
        <div style={{ width: '100%', height: 260 }}>
          <ResponsiveContainer>
            <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <defs>
                <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: tickColor }}
                axisLine={{ stroke: 'var(--border-strong)' }}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: tickColor }}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
                domain={['auto', 'auto']}
              />
              <Tooltip
                cursor={{ stroke: 'var(--border-strong)' }}
                contentStyle={{
                  background: 'var(--panel)',
                  border: '1px solid var(--border-strong)',
                  borderRadius: 8,
                  fontSize: '0.8rem',
                }}
                labelStyle={{ color: 'var(--t1)', fontWeight: 600 }}
                itemStyle={{ color: 'var(--t2)' }}
                formatter={(value) => [value ?? 0, metric === TOTAL ? 'Total resources' : metric]}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke="#3b82f6"
                strokeWidth={2}
                fill="url(#trendFill)"
                dot={{ r: 3, fill: '#3b82f6', strokeWidth: 0 }}
                activeDot={{ r: 4 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
