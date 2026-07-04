'use client'

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { useTheme } from '../lib/theme'

export function ResourceChart({ counts }: { counts: Record<string, number> }) {
  const { theme } = useTheme()
  const tickColor = theme === 'dark' ? '#64748b' : '#94a3b8'

  const data = Object.entries(counts)
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count)

  return (
    <div style={{ width: '100%', height: 300 }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 24 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
          <XAxis
            dataKey="type"
            angle={-28}
            textAnchor="end"
            interval={0}
            tick={{ fontSize: 11, fill: tickColor }}
            axisLine={{ stroke: 'var(--border-strong)' }}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 11, fill: tickColor }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
          />
          <Tooltip
            cursor={{ fill: 'var(--hover)' }}
            contentStyle={{
              background: 'var(--panel)',
              border: '1px solid var(--border-strong)',
              borderRadius: 8,
              fontSize: '0.8rem',
            }}
            labelStyle={{ color: 'var(--t1)', fontWeight: 600 }}
            itemStyle={{ color: 'var(--t2)' }}
          />
          <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} maxBarSize={38} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
