'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, Check, ArrowLeftRight, Play, Loader2 } from 'lucide-react'
import { Header } from '../components/Header'
import { Badge } from '../components/Badge'
import { TableSkeleton } from '../components/Skeleton'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { shortId, statusConfig, triggerConfig } from '../lib/utils'
import type { Audit } from '../types'

// How long after clicking "Run Audit" to keep polling for the new audit row
// to appear and complete, before giving up and telling the user to check
// back later. Collection across 12 resource types + cost/usage realistically
// takes a few minutes; this is a generous upper bound, not an expected time.
const RUN_AUDIT_POLL_MS = 5000
const RUN_AUDIT_TIMEOUT_MS = 10 * 60 * 1000

const PAGE_SIZE = 10

function countsSummary(a: Audit): string {
  const entries = Object.entries(a.resource_counts || {})
    .filter(([, n]) => n > 0)
    .sort(([, x], [, y]) => y - x)
  if (entries.length === 0) return '—'
  const top = entries.slice(0, 3).map(([k, n]) => `${k}: ${n}`).join(', ')
  return entries.length > 3 ? `${top}, …` : top
}

type RunState = 'idle' | 'starting' | 'waiting' | 'analyzing' | 'done' | 'failed' | 'timeout' | 'error'

export default function AuditsPage() {
  const router = useRouter()
  const { user } = useAuth()
  const [audits, setAudits]   = useState<Audit[] | null>(null)
  const [error, setError]     = useState('')
  const [status, setStatus]   = useState('all')
  const [trigger, setTrigger] = useState('all')
  const [dateRange, setDateRange] = useState('all')
  const [page, setPage]       = useState(1)

  const [runState, setRunState] = useState<RunState>('idle')
  const [runError, setRunError] = useState('')
  const [currentStep, setCurrentStep] = useState<string | null>(null)
  const [analysisProgress, setAnalysisProgress] = useState<{ total: number; done: number; failed: number } | null>(null)
  const triggeredAtRef = useRef<string | null>(null)
  const runningAuditIdRef = useRef<string | null>(null)

  function refreshAudits() {
    return api.listAudits().then(setAudits).catch(e => setError(e instanceof Error ? e.message : 'Failed to load audits'))
  }

  useEffect(() => { refreshAudits() }, [])

  // Poll for the new manual audit to appear (by created_at after the click)
  // and finish, since GitHub's workflow_dispatch API doesn't hand back the
  // resulting audit's ID directly — we just watch our own audits table.
  // Shows current_step (e.g. "extracting acr (3/12)") live while it runs.
  useEffect(() => {
    if (runState !== 'waiting' || !triggeredAtRef.current) return
    const startedAt = Date.now()
    const triggeredAt = new Date(triggeredAtRef.current).getTime()

    const interval = setInterval(async () => {
      if (Date.now() - startedAt > RUN_AUDIT_TIMEOUT_MS) {
        setRunState('timeout')
        clearInterval(interval)
        return
      }
      const list = await api.listAudits().catch(() => null)
      if (!list) return
      setAudits(list)
      const started = list.find(a => a.trigger_type === 'manual' && new Date(a.created_at).getTime() >= triggeredAt)
      if (!started) return
      setCurrentStep(started.current_step)
      if (started.status !== 'running') {
        if (started.status === 'completed') {
          runningAuditIdRef.current = started.id
          setRunState('analyzing')
        } else {
          setRunState('failed')
        }
        clearInterval(interval)
      }
    }, RUN_AUDIT_POLL_MS)

    return () => clearInterval(interval)
  }, [runState])

  // Once collection finishes, switch to polling analysis_requests progress
  // for that specific audit — collect.go auto-queues one request per
  // resource type, so this reflects real per-scope completion, not a guess.
  useEffect(() => {
    if (runState !== 'analyzing' || !runningAuditIdRef.current) return
    const auditId = runningAuditIdRef.current
    const enteredAt = Date.now()

    const interval = setInterval(async () => {
      const progress = await api.getAnalysisProgress(auditId).catch(() => null)
      if (!progress) return
      setAnalysisProgress(progress)
      // collect.go queues these rows right after marking the audit
      // completed, so total can briefly read 0 before that write lands —
      // only trust a zero total once we've waited long enough for it to be
      // real (no resource types had data) rather than a race.
      const zeroIsReal = progress.total === 0 && Date.now() - enteredAt > 15000
      if (zeroIsReal || (progress.total > 0 && progress.done + progress.failed >= progress.total)) {
        setRunState('done')
        refreshAudits()
        clearInterval(interval)
      }
    }, RUN_AUDIT_POLL_MS)

    return () => clearInterval(interval)
  }, [runState])

  async function handleRunAudit() {
    setRunState('starting')
    setRunError('')
    setCurrentStep(null)
    setAnalysisProgress(null)
    try {
      const result = await api.triggerAudit()
      triggeredAtRef.current = result.triggered_at
      setRunState('waiting')
    } catch (e) {
      setRunError(e instanceof Error ? e.message : 'Failed to trigger audit')
      setRunState('error')
    }
  }

  const filtered = useMemo(() => {
    if (!audits) return []
    const now = new Date()
    return audits.filter(a => {
      if (status !== 'all' && a.status !== status) return false
      if (trigger !== 'all' && a.trigger_type !== trigger) return false
      if (dateRange !== 'all') {
        const d = new Date(a.created_at)
        const thisMonth = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
        const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1)
        const prevMonth = d.getFullYear() === prev.getFullYear() && d.getMonth() === prev.getMonth()
        if (dateRange === 'this-month' && !thisMonth) return false
        if (dateRange === 'prev-month' && !prevMonth) return false
      }
      return true
    })
  }, [audits, status, trigger, dateRange])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageItems  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  function setFilter(setter: (v: string) => void) {
    return (v: string) => { setter(v); setPage(1) }
  }

  const selectStyle: React.CSSProperties = {
    background: 'var(--panel)', border: '1px solid var(--border-strong)',
    borderRadius: 8, color: 'var(--t1)', padding: '0.45rem 0.75rem', fontSize: '0.82rem',
    cursor: 'pointer',
  }

  return (
    <>
      <Header title="Audit History" />
      <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>

        {/* filter bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', flexWrap: 'wrap' }}>
          <select style={selectStyle} value={status} onChange={e => setFilter(setStatus)(e.target.value)}>
            <option value="all">All statuses</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
            <option value="running">Running</option>
          </select>
          <select style={selectStyle} value={trigger} onChange={e => setFilter(setTrigger)(e.target.value)}>
            <option value="all">All triggers</option>
            <option value="scheduled">Scheduled</option>
            <option value="manual">Manual</option>
          </select>
          <select style={selectStyle} value={dateRange} onChange={e => setFilter(setDateRange)(e.target.value)}>
            <option value="all">All dates</option>
            <option value="this-month">This month</option>
            <option value="prev-month">Previous month</option>
          </select>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.875rem' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--t3)' }}>
              {filtered.length} audit{filtered.length === 1 ? '' : 's'}
            </span>
            <button
              className="btn-ghost"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', padding: '0.45rem 0.875rem', fontSize: '0.8rem' }}
              onClick={() => router.push('/audits/compare')}
            >
              <ArrowLeftRight size={14} /> Compare
            </button>
            {user?.role === 'admin' && (
              <button
                className="btn-ghost"
                disabled={runState === 'starting' || runState === 'waiting' || runState === 'analyzing'}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', padding: '0.45rem 0.875rem', fontSize: '0.8rem' }}
                onClick={handleRunAudit}
              >
                {runState === 'starting' || runState === 'waiting' || runState === 'analyzing'
                  ? <Loader2 size={14} style={{ animation: "spin 0.8s linear infinite" }} />
                  : <Play size={14} />}
                Run Audit
              </button>
            )}
          </div>
        </div>

        {runState !== 'idle' && (
          <div className="glass" style={{
            padding: '0.75rem 1.25rem', display: 'flex', alignItems: 'center', gap: '0.625rem',
            fontSize: '0.82rem',
            color: runState === 'failed' || runState === 'error' ? '#ef4444' : runState === 'done' ? '#22c55e' : 'var(--t2)',
          }}>
            {(runState === 'starting' || runState === 'waiting' || runState === 'analyzing') &&
              <Loader2 size={14} style={{ animation: "spin 0.8s linear infinite" }} />}
            {runState === 'starting' && 'Starting audit…'}
            {runState === 'waiting' && (currentStep ? `Running — ${currentStep}…` : 'Audit starting…')}
            {runState === 'analyzing' && (
              analysisProgress
                ? `Audit complete — analyzing: ${analysisProgress.done + analysisProgress.failed} of ${analysisProgress.total} resource types done…`
                : 'Audit complete — queuing analysis…'
            )}
            {runState === 'done' && (
              analysisProgress && analysisProgress.total > 0
                ? `Done — ${analysisProgress.done} of ${analysisProgress.total} resource types analyzed${analysisProgress.failed ? `, ${analysisProgress.failed} failed` : ''}. Findings are ready below.`
                : 'Audit complete — no resource types had data to analyze.'
            )}
            {runState === 'failed' && 'Audit failed — check the row below for details.'}
            {runState === 'timeout' && 'Still running after 10 minutes — check back later; this page stopped polling but the audit may still finish.'}
            {runState === 'error' && `Could not start audit: ${runError}`}
            {(runState === 'done' || runState === 'failed' || runState === 'timeout' || runState === 'error') && (
              <button
                className="btn-ghost"
                style={{ marginLeft: 'auto', padding: '0.25rem 0.625rem', fontSize: '0.75rem' }}
                onClick={() => setRunState('idle')}
              >
                Dismiss
              </button>
            )}
          </div>
        )}

        {error && (
          <div className="glass" style={{ padding: '1.5rem', textAlign: 'center', color: '#ef4444', fontSize: '0.875rem' }}>
            {error}
          </div>
        )}

        {!audits && !error && <TableSkeleton rows={8} cols={8} />}

        {audits && filtered.length === 0 && (
          <div className="glass" style={{ padding: '3rem 2rem', textAlign: 'center' }}>
            <p style={{ color: 'var(--t2)', fontSize: '0.875rem' }}>No audits match these filters.</p>
            <p style={{ color: 'var(--t3)', fontSize: '0.78rem', marginTop: '0.375rem' }}>
              Audits run daily at 1:30 PM Sri Lanka time.
            </p>
          </div>
        )}

        {audits && filtered.length > 0 && (
          <div className="glass" style={{ padding: '0.5rem 1.25rem 1rem' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {['Audit ID', 'Subscription', 'Date & Time', 'Trigger', 'Status', 'Resource Counts', 'Analysis', ''].map(h => (
                      <th key={h} style={{
                        textAlign: 'left', padding: '0.625rem 0.75rem',
                        fontSize: '0.66rem', fontWeight: 600, letterSpacing: '0.06em',
                        textTransform: 'uppercase', color: 'var(--t3)',
                      }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map(a => {
                    const sc = statusConfig[a.status]   || { label: a.status, color: 'muted' }
                    const tc = triggerConfig[a.trigger_type] || { label: a.trigger_type, color: 'muted' }
                    return (
                      <tr
                        key={a.id}
                        className="row-hover"
                        style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                        onClick={() => router.push(`/audits/${a.id}`)}
                      >
                        <td style={{ padding: '0.625rem 0.75rem', fontFamily: 'ui-monospace, monospace', color: 'var(--acc)' }}>
                          {shortId(a.id)}
                        </td>
                        <td style={{ padding: '0.625rem 0.75rem', color: 'var(--t2)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {a.subscription_name || shortId(a.subscription_id)}
                        </td>
                        <td style={{ padding: '0.625rem 0.75rem', color: 'var(--t2)', whiteSpace: 'nowrap' }}>
                          {new Date(a.created_at).toLocaleString()}
                        </td>
                        <td style={{ padding: '0.625rem 0.75rem' }}><Badge color={tc.color} label={tc.label} /></td>
                        <td style={{ padding: '0.625rem 0.75rem' }}><Badge color={sc.color} label={sc.label} /></td>
                        <td style={{ padding: '0.625rem 0.75rem', maxWidth: 260 }}>
                          {a.status === 'failed' ? (
                            <span style={{ color: '#ef4444', fontSize: '0.75rem', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {a.error_message || 'failed'}
                            </span>
                          ) : (
                            <span style={{ color: 'var(--t3)', fontSize: '0.75rem' }}>{countsSummary(a)}</span>
                          )}
                        </td>
                        <td style={{ padding: '0.625rem 0.75rem' }}>
                          {a.has_analysis ? (
                            <span style={{ color: '#22c55e', fontSize: '0.78rem', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                              <Check size={13} /> Yes
                            </span>
                          ) : (
                            <span style={{ color: 'var(--t4)', fontSize: '0.78rem' }}>No</span>
                          )}
                        </td>
                        <td style={{ padding: '0.625rem 0.75rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <span style={{ color: 'var(--acc)', fontSize: '0.78rem' }}>View Details</span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* pagination */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.75rem', paddingTop: '0.875rem' }}>
              <span style={{ fontSize: '0.78rem', color: 'var(--t3)' }}>Page {page} of {totalPages}</span>
              <button
                className="btn-ghost"
                style={{ padding: '0.3rem 0.5rem', display: 'flex' }}
                disabled={page <= 1}
                onClick={() => setPage(p => p - 1)}
              >
                <ChevronLeft size={15} />
              </button>
              <button
                className="btn-ghost"
                style={{ padding: '0.3rem 0.5rem', display: 'flex' }}
                disabled={page >= totalPages}
                onClick={() => setPage(p => p + 1)}
              >
                <ChevronRight size={15} />
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
