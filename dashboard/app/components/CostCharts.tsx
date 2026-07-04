'use client'

import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'
import { useTheme } from '../lib/theme'

const BAR_COLORS = ['#3b82f6', '#22d3ee', '#a78bfa', '#34d399', '#fbbf24', '#f472b6', '#f87171', '#94a3b8']

function formatCurrency(n: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(n)
  } catch {
    return `${n.toFixed(2)} ${currency}`
  }
}

function shortDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : `${d.getMonth() + 1}/${d.getDate()}`
}

export function CostTrendChart({ dailyCost, currency }: { dailyCost: { date: string; cost: number }[]; currency: string }) {
  const { theme } = useTheme()
  const tickColor = theme === 'dark' ? '#64748b' : '#94a3b8'
  const data = dailyCost.map(d => ({ date: shortDate(d.date), cost: d.cost }))

  if (data.length === 0) {
    return <p style={{ fontSize: '0.82rem', color: 'var(--t3)', padding: '1rem 0' }}>No daily cost data available.</p>
  }

  return (
    <div style={{ width: '100%', height: 240 }}>
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <defs>
            <linearGradient id="costFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#34d399" stopOpacity={0.28} />
              <stop offset="100%" stopColor="#34d399" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: tickColor }} axisLine={{ stroke: 'var(--border-strong)' }} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: tickColor }} axisLine={false} tickLine={false} />
          <Tooltip
            cursor={{ stroke: 'var(--border-strong)' }}
            contentStyle={{ background: 'var(--panel)', border: '1px solid var(--border-strong)', borderRadius: 8, fontSize: '0.8rem' }}
            labelStyle={{ color: 'var(--t1)', fontWeight: 600 }}
            itemStyle={{ color: 'var(--t2)' }}
            formatter={(value) => [formatCurrency(Number(value) || 0, currency), 'Cost']}
          />
          <Area type="monotone" dataKey="cost" stroke="#34d399" strokeWidth={2} fill="url(#costFill)" dot={{ r: 3, fill: '#34d399', strokeWidth: 0 }} activeDot={{ r: 4 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

export function TopServicesChart({ topServices, currency }: { topServices: { service: string; cost: number }[]; currency: string }) {
  const { theme } = useTheme()
  const tickColor = theme === 'dark' ? '#64748b' : '#94a3b8'

  if (topServices.length === 0) {
    return <p style={{ fontSize: '0.82rem', color: 'var(--t3)', padding: '1rem 0' }}>No service cost data available.</p>
  }

  return (
    <div style={{ width: '100%', height: Math.max(200, topServices.length * 34) }}>
      <ResponsiveContainer>
        <BarChart data={topServices} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 11, fill: tickColor }} axisLine={false} tickLine={false} />
          <YAxis
            type="category"
            dataKey="service"
            width={140}
            tick={{ fontSize: 11, fill: tickColor }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            cursor={{ fill: 'var(--hover)' }}
            contentStyle={{ background: 'var(--panel)', border: '1px solid var(--border-strong)', borderRadius: 8, fontSize: '0.8rem' }}
            labelStyle={{ color: 'var(--t1)', fontWeight: 600 }}
            itemStyle={{ color: 'var(--t2)' }}
            formatter={(value) => [formatCurrency(Number(value) || 0, currency), 'Cost']}
          />
          <Bar dataKey="cost" radius={[0, 4, 4, 0]} maxBarSize={22}>
            {topServices.map((_, i) => <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export { formatCurrency }
