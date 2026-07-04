'use client'

import { useState } from 'react'
import { ChevronRight, ChevronDown, Database } from 'lucide-react'
import { api } from '../lib/api'
import { resourceMeta, ResourceIcon } from '../lib/resourceMeta'

function ResourceRow({ auditId, slug, count }: { auditId: string; slug: string; count: number }) {
  const [open, setOpen]       = useState(false)
  const [data, setData]       = useState<unknown>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  async function toggle() {
    const next = !open
    setOpen(next)
    if (next && data === null && !loading) {
      setLoading(true)
      try {
        const result = await api.getAuditResource(auditId, slug)
        setData(result.data)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load')
      } finally {
        setLoading(false)
      }
    }
  }

  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      <button
        onClick={toggle}
        className="row-hover"
        style={{
          display: 'flex', alignItems: 'center', gap: '0.625rem', width: '100%',
          padding: '0.7rem 0.5rem', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
        }}
      >
        {open ? <ChevronDown size={14} color="var(--t3)" /> : <ChevronRight size={14} color="var(--t3)" />}
        <ResourceIcon slug={slug} size={14} />
        <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.8rem', color: 'var(--t1)' }}>{slug}</span>
        <span className="hidden sm:inline" style={{ fontSize: '0.75rem', color: 'var(--t3)' }}>
          {resourceMeta(slug).label}
        </span>
        <span className="bdg bdg-muted" style={{ marginLeft: 'auto' }}>{count}</span>
      </button>

      {open && (
        <div style={{ padding: '0 0.5rem 0.875rem 2rem' }}>
          {loading && <p style={{ fontSize: '0.75rem', color: 'var(--t3)' }}>Loading…</p>}
          {error && <p style={{ fontSize: '0.75rem', color: '#ef4444' }}>{error}</p>}
          {data !== null && (
            <pre style={{
              background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 8,
              padding: '0.875rem', fontSize: '0.7rem', color: 'var(--t2)',
              fontFamily: 'ui-monospace, monospace', overflowX: 'auto', maxHeight: 360, overflowY: 'auto',
              lineHeight: 1.5,
            }}>
              {JSON.stringify(data, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

export function RawDataSection({ auditId, resourceCounts }: { auditId: string; resourceCounts: Record<string, number> }) {
  const slugs = Object.keys(resourceCounts || {}).sort()

  return (
    <div className="glass" style={{ padding: '1.25rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
        <Database size={15} color="var(--acc)" />
        <h2 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--t1)' }}>Raw Resource Data</h2>
      </div>
      {slugs.length === 0 ? (
        <p style={{ fontSize: '0.8rem', color: 'var(--t3)', padding: '0.75rem 0' }}>No resource data in this audit.</p>
      ) : (
        slugs.map(slug => (
          <ResourceRow key={slug} auditId={auditId} slug={slug} count={resourceCounts[slug]} />
        ))
      )}
    </div>
  )
}
