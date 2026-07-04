'use client'

import { ReactNode } from 'react'
import { useCountUp } from '../lib/useCountUp'
import { formatNumber } from '../lib/utils'

const accents: Record<string, { border: string; glow: string }> = {
  cyan:    { border: '#22d3ee', glow: 'rgba(34, 211, 238, 0.08)' },
  emerald: { border: '#34d399', glow: 'rgba(52, 211, 153, 0.08)' },
  violet:  { border: '#a78bfa', glow: 'rgba(167, 139, 250, 0.08)' },
  amber:   { border: '#fbbf24', glow: 'rgba(251, 191, 36, 0.08)' },
}

interface KPICardProps {
  label: string
  /** Pass a number to get the count-up animation; strings render as-is. */
  value: number | string | ReactNode
  trend?: string
  trendDir?: 'up' | 'down'
  sub?: string
  accent?: 'cyan' | 'emerald' | 'violet' | 'amber'
}

function CountUpValue({ target }: { target: number }) {
  const value = useCountUp(target)
  return <>{formatNumber(value)}</>
}

export function KPICard({ label, value, trend, trendDir, sub, accent }: KPICardProps) {
  const a = accent ? accents[accent] : null

  return (
    <div
      className="glass glass-hover"
      style={{
        padding: '1.125rem 1.25rem',
        borderTop: a ? `2px solid ${a.border}` : undefined,
        boxShadow: a ? `0 0 24px ${a.glow}` : undefined,
      }}
    >
      <div style={{
        fontSize: '0.66rem', fontWeight: 600, letterSpacing: '0.08em',
        textTransform: 'uppercase', color: 'var(--t3)', marginBottom: '0.5rem',
      }}>
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
        <div style={{
          fontSize: '1.5rem', fontWeight: 700, color: 'var(--t1)',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        }}>
          {typeof value === 'number' ? <CountUpValue target={value} /> : value}
        </div>
        {trend && (
          <span className={`bdg ${trendDir === 'down' ? 'bdg-error' : 'bdg-success'}`}>
            {trend}
          </span>
        )}
      </div>
      {sub && (
        <div style={{ fontSize: '0.72rem', color: 'var(--t3)', marginTop: '0.375rem' }}>
          {sub}
        </div>
      )}
    </div>
  )
}
