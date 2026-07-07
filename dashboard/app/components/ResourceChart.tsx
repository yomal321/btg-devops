'use client'

import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
} from 'recharts'
import { categoricalColor } from '../lib/palette'

function DonutTooltip({ active, payload }: { active?: boolean; payload?: { name: string; value: number; payload: { fill: string } }[] }) {
  if (!active || !payload?.length) return null
  const p = payload[0]
  return (
    <div style={{
      background: 'rgba(36, 31, 56, 0.88)', backdropFilter: 'blur(10px)',
      border: '1px solid var(--border-strong)', borderRadius: 12,
      padding: '0.5rem 0.75rem', boxShadow: '0 12px 32px -8px rgba(0,0,0,0.5)',
    }}>
      <p style={{ fontSize: '0.82rem', color: 'var(--t2)', display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: p.payload.fill, display: 'inline-block' }} />
        {p.name}: <span style={{ color: 'var(--t1)', fontWeight: 600 }}>{p.value}</span>
      </p>
    </div>
  )
}

export function ResourceChart({ counts }: { counts: Record<string, number> }) {
  const data = Object.entries(counts)
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count)

  const total = data.reduce((s, d) => s + d.count, 0)

  if (data.length === 0) {
    return <p style={{ fontSize: '0.82rem', color: 'var(--t3)', padding: '1rem 0' }}>No resources yet.</p>
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', height: 190 }}>
      <div style={{ width: 150, height: 150, flexShrink: 0, position: 'relative' }}>
        <ResponsiveContainer>
          <PieChart>
            <Pie
              data={data}
              dataKey="count"
              nameKey="type"
              innerRadius="62%"
              outerRadius="100%"
              paddingAngle={2}
              stroke="var(--card)"
              strokeWidth={2}
              isAnimationActive
              animationDuration={800}
            >
              {data.map((entry, i) => <Cell key={entry.type} fill={categoricalColor(i)} />)}
            </Pie>
            <Tooltip content={<DonutTooltip />} />
          </PieChart>
        </ResponsiveContainer>
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', pointerEvents: 'none',
        }}>
          <span style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--t1)' }}>{total}</span>
          <span style={{ fontSize: '0.74rem', color: 'var(--t3)' }}>resources</span>
        </div>
      </div>

      <div className="no-scrollbar" style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', overflowY: 'auto', height: '100%', flex: 1 }}>
        {data.map((d, i) => (
          <div key={d.type} style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.84rem' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: categoricalColor(i), flexShrink: 0 }} />
            <span style={{ color: 'var(--t2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{d.type}</span>
            <span style={{ color: 'var(--t1)', fontWeight: 600 }}>{d.count}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
