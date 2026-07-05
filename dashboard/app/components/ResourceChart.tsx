'use client'

import {
  BarChart, Bar, Cell, XAxis, Tooltip, ResponsiveContainer,
} from 'recharts'
import { categoricalColor } from '../lib/palette'

export function ResourceChart({ counts }: { counts: Record<string, number> }) {
  const data = Object.entries(counts)
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count)

  return (
    <div style={{ width: '100%', height: 190 }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
          <XAxis
            dataKey="type"
            interval={0}
            tick={{ fontSize: 9, fill: 'var(--t4)' }}
            axisLine={false}
            tickLine={false}
            tickFormatter={t => t.length > 8 ? `${t.slice(0, 7)}…` : t}
          />
          <Tooltip
            cursor={{ fill: 'var(--hover)' }}
            contentStyle={{
              background: 'var(--panel)',
              border: '1px solid var(--border-strong)',
              borderRadius: 8,
              fontSize: '0.78rem',
            }}
            labelStyle={{ color: 'var(--t1)', fontWeight: 600 }}
            itemStyle={{ color: 'var(--t2)' }}
          />
          <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={30}>
            {data.map((entry, i) => (
              <Cell key={entry.type} fill={categoricalColor(i)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
