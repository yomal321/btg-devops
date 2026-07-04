'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Header } from '../../components/Header'
import { Badge } from '../../components/Badge'
import { AnalysisPanel } from '../../components/AnalysisPanel'
import { ChatPanel } from '../../components/ChatPanel'
import { RawDataSection } from '../../components/RawDataSection'
import { DetailSkeleton } from '../../components/Skeleton'
import { api } from '../../lib/api'
import { ResourceIcon } from '../../lib/resourceMeta'
import { formatNumber, shortId, statusConfig, triggerConfig } from '../../lib/utils'
import type { AuditDetail } from '../../types'

export default function AuditDetailPage() {
  const params = useParams<{ id: string }>()
  const id = params.id

  const [audit, setAudit]     = useState<AuditDetail | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [error, setError]     = useState('')

  useEffect(() => {
    api.getAudit(id)
      .then(setAudit)
      .catch(e => {
        const msg = e instanceof Error ? e.message : ''
        if (msg.includes('not found') || msg.includes('404')) setNotFound(true)
        else setError(msg || 'Failed to load audit')
      })
  }, [id])

  const breadcrumbs = [
    { label: 'Audits', href: '/audits' },
    { label: shortId(id) },
  ]

  if (notFound) {
    return (
      <>
        <Header breadcrumbs={breadcrumbs} />
        <div style={{ padding: '3rem 1.5rem', textAlign: 'center', color: 'var(--t2)', fontSize: '0.9rem' }}>
          Audit not found.
        </div>
      </>
    )
  }

  if (error) {
    return (
      <>
        <Header breadcrumbs={breadcrumbs} />
        <div style={{ padding: '3rem 1.5rem', textAlign: 'center', color: '#ef4444', fontSize: '0.875rem' }}>
          {error}
        </div>
      </>
    )
  }

  if (!audit) {
    return (
      <>
        <Header breadcrumbs={breadcrumbs} />
        <DetailSkeleton />
      </>
    )
  }

  const sc = statusConfig[audit.status]        || { label: audit.status, color: 'muted' }
  const tc = triggerConfig[audit.trigger_type] || { label: audit.trigger_type, color: 'muted' }
  const counts = audit.resource_counts || {}
  const total  = Object.values(counts).reduce((s, n) => s + n, 0)
  const failed = audit.status === 'failed'

  return (
    <>
      <Header breadcrumbs={breadcrumbs} />
      <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

        {/* Section A — summary */}
        <div className="glass animate-fade-in" style={{ padding: '1.25rem' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.25rem', alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 260 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '1rem', fontWeight: 700, color: 'var(--t1)' }}>
                  {shortId(audit.id)}
                </span>
                <Badge color={sc.color} label={sc.label} />
                <Badge color={tc.color} label={tc.label} />
              </div>
              <p style={{ fontSize: '0.8rem', color: 'var(--t3)' }}>
                {new Date(audit.created_at).toLocaleString()} · {audit.subscription_name || 'subscription'} · {shortId(audit.subscription_id)}…
              </p>
            </div>

            {!failed && (
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--t1)', fontFamily: 'ui-monospace, monospace' }}>
                  {formatNumber(total)}
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  total resources
                </div>
              </div>
            )}
          </div>

          {failed ? (
            <pre style={{
              marginTop: '1rem', background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.25)',
              borderRadius: 8, padding: '0.875rem 1rem', fontSize: '0.78rem', color: '#ef4444',
              fontFamily: 'ui-monospace, monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}>
              {audit.error_message || 'Audit failed with no error message.'}
            </pre>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2" style={{ marginTop: '1rem' }}>
              {Object.keys(counts).sort().map(slug => (
                <div key={slug} className="glass-hover" style={{
                  background: 'var(--input-bg)', border: '1px solid var(--border)',
                  borderRadius: 8, padding: '0.55rem 0.7rem',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', overflow: 'hidden' }}>
                    <ResourceIcon slug={slug} size={12} color="var(--t4)" />
                    <span style={{ fontSize: '0.62rem', color: 'var(--t4)', textTransform: 'uppercase', letterSpacing: '0.05em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {slug}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--t1)', fontFamily: 'ui-monospace, monospace' }}>
                    {counts[slug]}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Sections B + C + D — only for non-failed audits */}
        {!failed && (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-5 items-start">
            {/* left column — analysis + raw data */}
            <div className="lg:col-span-3 flex flex-col gap-5">
              <AnalysisPanel
                auditId={audit.id}
                resourceCounts={counts}
                initialStore={audit.claude_analysis}
                extraScopes={['cost', 'usage'].filter(k => audit.raw_data?.[k])}
              />
              <RawDataSection auditId={audit.id} resourceCounts={counts} />
            </div>

            {/* right column — chat (sticky on desktop) */}
            <div className="lg:col-span-2 lg:sticky lg:top-4">
              <ChatPanel auditId={audit.id} />
            </div>
          </div>
        )}
      </div>
    </>
  )
}
