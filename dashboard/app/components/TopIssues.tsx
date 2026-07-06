'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertCircle, AlertTriangle, Info, Flame, ArrowRight } from 'lucide-react'
import { Badge } from './Badge'
import { Skeleton } from './Skeleton'
import { api } from '../lib/api'
import { shortId, severityConfig, findingAge } from '../lib/utils'
import type { Finding } from '../types'

const severityIcons = {
  Critical: <AlertCircle size={14} color="#ef4444" />,
  Warning:  <AlertTriangle size={14} color="#fbbf24" />,
  Info:     <Info size={14} color="#60a5fa" />,
}

export function TopIssues() {
  const [findings, setFindings] = useState<Finding[] | null>(null)
  const [error, setError]       = useState('')

  useEffect(() => {
    api.topFindings(8)
      .then(setFindings)
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load findings'))
  }, [])

  return (
    <div className="glass animate-fade-in" style={{ padding: '1.25rem' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', marginBottom: '0.875rem' }}>
        <Flame size={15} color="var(--acc)" style={{ alignSelf: 'center' }} />
        <h2 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--t1)' }}>Top Issues</h2>
        <span style={{ fontSize: '0.72rem', color: 'var(--t4)' }}>most severe findings across recent audits</span>
      </div>

      {error && <p style={{ fontSize: '0.8rem', color: '#ef4444' }}>{error}</p>}

      {!findings && !error && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {[0, 1, 2, 3].map(i => <Skeleton key={i} height={20} />)}
        </div>
      )}

      {findings && findings.length === 0 && (
        <p style={{ fontSize: '0.8rem', color: 'var(--t3)', padding: '1rem 0' }}>
          No findings yet — run an analysis on an audit to populate this.
        </p>
      )}

      {findings && findings.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {findings.map(f => {
            const sc = severityConfig[f.severity] || { label: f.severity, color: 'muted' }
            const age = f.first_seen_at ? findingAge(f.first_seen_at) : null
            return (
              <Link
                key={f.id}
                href={`/audits/${f.audit_id}`}
                className="row-hover"
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.625rem',
                  padding: '0.6rem 0.5rem', borderBottom: '1px solid var(--border)',
                  textDecoration: 'none',
                }}
              >
                {severityIcons[f.severity] || severityIcons.Info}
                <Badge color={sc.color} label={sc.label} />
                {age && <Badge color={age.color} label={age.label} />}
                <span style={{
                  flex: 1, fontSize: '0.8rem', color: 'var(--t1)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {f.issue}
                </span>
                <span className="hidden md:inline" style={{
                  fontSize: '0.68rem', color: 'var(--t4)', fontFamily: 'ui-monospace, monospace',
                  whiteSpace: 'nowrap',
                }}>
                  {f.resource_type}{f.resource_name ? ` · ${f.resource_name}` : ''}
                </span>
                <span style={{
                  fontSize: '0.68rem', color: 'var(--acc)', fontFamily: 'ui-monospace, monospace',
                  whiteSpace: 'nowrap',
                }}>
                  {shortId(f.audit_id)}
                </span>
              </Link>
            )
          })}
          <Link href="/audits" style={{
            display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
            fontSize: '0.78rem', color: 'var(--acc)', textDecoration: 'none',
            paddingTop: '0.75rem', alignSelf: 'flex-end',
          }}>
            View all audits <ArrowRight size={13} />
          </Link>
        </div>
      )}
    </div>
  )
}
