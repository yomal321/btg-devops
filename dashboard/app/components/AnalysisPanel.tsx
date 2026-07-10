'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Sparkles, Lock, AlertCircle, AlertTriangle, Info, TriangleAlert, EyeOff, RotateCcw, Download, Share2, FileText, FileSpreadsheet } from 'lucide-react'
import { Badge } from './Badge'
import { Modal } from './Modal'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { buildScopeGroups, scopeLabel, firstScope, UsageTypeInfo } from '../lib/scopes'
import { severityConfig, findingStatusConfig, findingAge } from '../lib/utils'
import { exportFindingsAsExcel, exportFindingsAsPDF } from '../lib/exportFindings'
import type { Finding, User } from '../types'

interface AnalysisFinding {
  severity: 'Critical' | 'Warning' | 'Info'
  category: string
  resource_type: string
  resource_name: string
  issue: string
  recommendation: string
}

// What the findings cards render. DB-backed rows carry lifecycle fields
// (id/status/age); findings read from a legacy cached-analysis JSON don't.
interface DisplayFinding extends AnalysisFinding {
  id?: string
  status?: 'open' | 'resolved' | 'dismissed'
  first_seen_at?: string
}

export interface Analysis {
  summary: string
  findings: AnalysisFinding[]
  generated_at: string
  model: string
}

export interface AnalysisStore {
  all?: Analysis
  by_resource?: Record<string, Analysis>
}

const ALL_SCOPE = 'all'
const POLL_INTERVAL_MS = 7000

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function normalizeStore(raw: unknown): AnalysisStore {
  if (!raw || typeof raw !== 'object') return {}
  const obj = raw as Record<string, unknown>
  if ('all' in obj || 'by_resource' in obj) return obj as AnalysisStore
  if ('findings' in obj) return { all: obj as unknown as Analysis } // legacy flat shape
  return {}
}

const severityIcons = {
  Critical: <AlertCircle size={15} color="#ef4444" />,
  Warning:  <AlertTriangle size={15} color="#fbbf24" />,
  Info:     <Info size={15} color="#38bdf8" />,
}

const severityTint = {
  Critical: { bg: 'rgba(239,68,68,0.08)',  border: 'rgba(239,68,68,0.35)',  color: '#ef4444' },
  Warning:  { bg: 'rgba(251,191,36,0.08)', border: 'rgba(251,191,36,0.35)', color: '#fbbf24' },
  Info:     { bg: 'rgba(56,189,248,0.1)', border: 'rgba(56,189,248,0.35)', color: '#38bdf8' },
}

interface AnalysisPanelProps {
  auditId: string
  resourceCounts: Record<string, number>
  initialStore: unknown
  hasCost?: boolean
  usageTypes?: UsageTypeInfo[]
}

export function AnalysisPanel({ auditId, resourceCounts, initialStore, hasCost = false, usageTypes = [] }: AnalysisPanelProps) {
  const { user } = useAuth()
  const canAnalyze = user?.role === 'admin' || user?.role === 'analyst'

  const resourceTypes = useMemo(() => Object.keys(resourceCounts || {}).sort(), [resourceCounts])
  const scopeGroups = useMemo(
    () => buildScopeGroups(resourceCounts, hasCost, usageTypes),
    [resourceCounts, hasCost, usageTypes]
  )

  const [store, setStore] = useState<AnalysisStore>(() => normalizeStore(initialStore))
  const [scope, setScope] = useState<string>(() => firstScope(scopeGroups) || ALL_SCOPE)
  const [running, setRunning]   = useState(false)
  const [error, setError]       = useState('')
  const [showAllConfirm, setShowAllConfirm] = useState(false)
  const [sevFilter, setSevFilter]   = useState<string>('all')
  const [typeFilter, setTypeFilter] = useState<string>('all')

  const [showExportMenu, setShowExportMenu] = useState(false)
  const [showShareModal, setShowShareModal] = useState(false)
  const [shareRoles, setShareRoles]     = useState<string[]>([])
  const [shareUserIds, setShareUserIds] = useState<string[]>([])
  const [shareUsers, setShareUsers]     = useState<User[] | null>(null)
  const [shareSending, setShareSending] = useState(false)
  const [shareError, setShareError]     = useState('')
  const [shareDone, setShareDone]       = useState<number | null>(null)

  const currentAnalysis = scope === ALL_SCOPE ? store.all : store.by_resource?.[scope]

  // DB-backed findings for the current scope — these carry lifecycle fields
  // (status, first_seen_at) the cached-analysis JSON doesn't have. Tagged
  // with the scope they were fetched for so a stale response can't render
  // under a different scope.
  const [dbFindings, setDbFindings] = useState<{ scope: string; rows: Finding[] } | null>(null)
  const pollCancelRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!currentAnalysis) return
    let cancelled = false
    api.listFindings(auditId, scope)
      .then(rows => { if (!cancelled) setDbFindings({ scope, rows }) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [auditId, scope, currentAnalysis])

  // Stops an in-flight poll loop if the panel unmounts (e.g. navigating away
  // mid-analysis) so it doesn't keep calling setState after the fact.
  useEffect(() => () => pollCancelRef.current?.(), [])

  // Analyze now queues a request for the scheduled Claude Code agent (spec 8)
  // instead of calling an LLM directly from this request, and polls until
  // the agent (via the MCP server) writes a result back. cancelledRef lets
  // an in-flight poll loop stop itself if the component unmounts mid-poll.
  async function analyzeScope(slug: string) {
    setRunning(true)
    setError('')
    let cancelled = false
    const stop = () => { cancelled = true }
    pollCancelRef.current = stop
    try {
      const { requestId, status } = await api.requestAnalysis(auditId, slug)
      let current = status
      while (current === 'pending' && !cancelled) {
        await sleep(POLL_INTERVAL_MS)
        if (cancelled) break
        const poll = await api.getAnalysisRequest(auditId, requestId)
        current = poll.status
        if (current === 'done' && poll.analysis) {
          const analysis = poll.analysis as unknown as Analysis
          setStore(s =>
            slug === ALL_SCOPE
              ? { ...s, all: analysis }
              : { ...s, by_resource: { ...(s.by_resource || {}), [slug]: analysis } }
          )
          api.listFindings(auditId, slug).then(rows => setDbFindings({ scope: slug, rows })).catch(() => {})
        } else if (current === 'failed') {
          setError(poll.error_message || 'Analysis failed')
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Analysis failed')
    } finally {
      if (!cancelled) setRunning(false)
    }
  }

  function handleAnalyzeClick() {
    if (scope === ALL_SCOPE) setShowAllConfirm(true)
    else analyzeScope(scope)
  }

  async function setFindingStatus(id: string, status: 'open' | 'dismissed') {
    try {
      await api.updateFinding(auditId, id, { status })
      setDbFindings(d => d && { ...d, rows: d.rows.map(r => (r.id === id ? { ...r, status } : r)) })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Status update failed')
    }
  }

  const currentScopeLabel = scope === ALL_SCOPE ? 'All Resources' : scopeLabel(scope, scopeGroups)

  function handleExport(format: 'pdf' | 'excel') {
    setShowExportMenu(false)
    if (!currentAnalysis) return
    const meta = {
      auditId,
      scopeLabel: currentScopeLabel,
      summary: currentAnalysis.summary || '',
      generatedAt: currentAnalysis.generated_at,
    }
    if (format === 'excel') exportFindingsAsExcel(findings, meta)
    else exportFindingsAsPDF(findings, meta)
  }

  function openShareModal() {
    setShowShareModal(true)
    setShareError('')
    setShareDone(null)
    if (user?.role === 'admin' && !shareUsers) {
      api.listUsers().then(setShareUsers).catch(() => setShareUsers([]))
    }
  }

  function toggleShareRole(role: string) {
    setShareRoles(r => r.includes(role) ? r.filter(x => x !== role) : [...r, role])
  }

  function toggleShareUser(id: string) {
    setShareUserIds(u => u.includes(id) ? u.filter(x => x !== id) : [...u, id])
  }

  async function sendShare() {
    setShareSending(true)
    setShareError('')
    try {
      const result = await api.shareAnalysis(auditId, scope, shareRoles, shareUserIds)
      setShareDone(result.recipientCount)
      setShareRoles([])
      setShareUserIds([])
    } catch (e) {
      setShareError(e instanceof Error ? e.message : 'Failed to share')
    } finally {
      setShareSending(false)
    }
  }

  const findings: DisplayFinding[] = useMemo(() => {
    if (dbFindings && dbFindings.scope === scope && dbFindings.rows.length > 0) {
      return dbFindings.rows.map(r => ({
        id: r.id,
        severity: r.severity,
        category: r.category || '',
        resource_type: r.resource_type,
        resource_name: r.resource_name,
        issue: r.issue,
        recommendation: r.recommendation,
        status: r.status,
        first_seen_at: r.first_seen_at,
      }))
    }
    return currentAnalysis?.findings || []
  }, [dbFindings, scope, currentAnalysis])
  const counts = {
    Critical: findings.filter(f => f.severity === 'Critical').length,
    Warning:  findings.filter(f => f.severity === 'Warning').length,
    Info:     findings.filter(f => f.severity === 'Info').length,
  }
  const findingResourceTypes = useMemo(
    () => Array.from(new Set(findings.map(f => f.resource_type).filter(Boolean))).sort(),
    [findings]
  )
  const filtered = findings.filter(f =>
    (sevFilter === 'all' || f.severity === sevFilter) &&
    (typeFilter === 'all' || f.resource_type === typeFilter)
  )
  const hasActiveFilter = sevFilter !== 'all' || typeFilter !== 'all'

  const selectStyle: React.CSSProperties = {
    background: 'var(--panel)', border: '1px solid var(--border-strong)',
    borderRadius: 8, color: 'var(--t1)', padding: '0.4rem 0.625rem', fontSize: '0.78rem',
    cursor: 'pointer', maxWidth: '100%',
  }

  return (
    <div className="glass" style={{ padding: '1.25rem' }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.875rem', flexWrap: 'wrap' }}>
        <Sparkles size={16} color="var(--acc)" />
        <h2 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--t1)' }}>AI Analysis</h2>
        {currentAnalysis && (
          <Badge color="success" label={`Cached · ${currentScopeLabel} · ${new Date(currentAnalysis.generated_at).toLocaleDateString()}`} />
        )}
        {currentAnalysis && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem', position: 'relative' }}>
            <div style={{ position: 'relative' }}>
              <button
                className="btn-ghost"
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', padding: '0.4rem 0.75rem', fontSize: '0.78rem' }}
                onClick={() => setShowExportMenu(v => !v)}
              >
                <Download size={13} /> Export
              </button>
              {showExportMenu && (
                <>
                  <div style={{ position: 'fixed', inset: 0, zIndex: 9 }} onClick={() => setShowExportMenu(false)} />
                  <div style={{
                    position: 'absolute', top: '110%', right: 0, zIndex: 10,
                    background: 'var(--panel)', border: '1px solid var(--border-strong)', borderRadius: 8,
                    boxShadow: '0 8px 24px rgba(0,0,0,0.25)', minWidth: 140, overflow: 'hidden',
                  }}>
                    <button
                      onClick={() => handleExport('pdf')}
                      style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%', padding: '0.55rem 0.75rem', background: 'none', border: 'none', color: 'var(--t1)', fontSize: '0.8rem', cursor: 'pointer', textAlign: 'left' }}
                    >
                      <FileText size={14} /> PDF
                    </button>
                    <button
                      onClick={() => handleExport('excel')}
                      style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%', padding: '0.55rem 0.75rem', background: 'none', border: 'none', color: 'var(--t1)', fontSize: '0.8rem', cursor: 'pointer', textAlign: 'left' }}
                    >
                      <FileSpreadsheet size={14} /> Excel
                    </button>
                  </div>
                </>
              )}
            </div>
            <button
              className="btn-ghost"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', padding: '0.4rem 0.75rem', fontSize: '0.78rem' }}
              onClick={openShareModal}
            >
              <Share2 size={13} /> Share
            </button>
          </div>
        )}
      </div>

      {/* scope selector — always visible so viewers can browse cached results too */}
      {scopeGroups.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
          <label style={{ fontSize: '0.78rem', color: 'var(--t3)' }}>Analyze:</label>
          <select
            style={selectStyle}
            value={scope}
            onChange={e => setScope(e.target.value)}
            disabled={running}
          >
            {scopeGroups.map(g => (
              <optgroup key={g.label} label={g.label}>
                {g.options.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </optgroup>
            ))}
            {resourceTypes.length > 0 && (
              <option value={ALL_SCOPE}>— All Resources (all {resourceTypes.length} types) —</option>
            )}
          </select>
        </div>
      )}

      {/* state: viewer locked, no analysis for this scope */}
      {!currentAnalysis && !canAnalyze && (
        <div style={{ textAlign: 'center', padding: '2.5rem 1rem', color: 'var(--t3)' }}>
          <Lock size={22} style={{ margin: '0 auto 0.75rem', display: 'block' }} />
          <p style={{ fontSize: '0.85rem' }}>Analysis has not been run yet for this selection.</p>
          <p style={{ fontSize: '0.78rem', marginTop: '0.25rem' }}>Ask an analyst or admin to run it.</p>
        </div>
      )}

      {/* state: can run, not yet run for this scope */}
      {!currentAnalysis && canAnalyze && !running && (
        <div style={{ textAlign: 'center', padding: '2.5rem 1rem' }}>
          <p style={{ fontSize: '0.85rem', color: 'var(--t2)', marginBottom: '1rem' }}>
            {scope === ALL_SCOPE
              ? 'Queue the full audit (all resource types) for analysis in one request.'
              : resourceTypes.includes(scope)
              ? `Queue only the "${scope}" resources for a focused analysis.`
              : `Queue the ${scopeLabel(scope, scopeGroups)} for a focused analysis.`}
          </p>
          {error && <p style={{ color: '#ef4444', fontSize: '0.8rem', marginBottom: '0.75rem' }}>{error}</p>}
          <button className="btn-primary" onClick={handleAnalyzeClick}>Analyze</button>
        </div>
      )}

      {/* state: running */}
      {running && (
        <div style={{ textAlign: 'center', padding: '2.5rem 1rem' }}>
          <div style={{
            width: 26, height: 26, margin: '0 auto 0.875rem',
            border: '2px solid var(--border-strong)', borderTopColor: 'var(--acc)',
            borderRadius: '50%', animation: 'spin 0.8s linear infinite',
          }} />
          <p style={{ fontSize: '0.82rem', color: 'var(--t2)' }}>
            {scope === ALL_SCOPE ? 'Full audit queued for analysis…' : `${scopeLabel(scope, scopeGroups)} queued for analysis…`}
          </p>
          <p style={{ fontSize: '0.72rem', color: 'var(--t4)', marginTop: '0.25rem' }}>
            A scheduled agent picks this up shortly — usually ready within a few minutes.
          </p>
        </div>
      )}

      {/* state: results */}
      {currentAnalysis && !running && (
        <div className="animate-fade-in">
          {currentAnalysis.summary && (
            <p style={{ fontSize: '0.83rem', color: 'var(--t2)', lineHeight: 1.6, marginBottom: '1rem' }}>
              {currentAnalysis.summary}
            </p>
          )}

          {/* severity tiles */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.625rem', marginBottom: '1rem' }}>
            {(['Critical', 'Warning', 'Info'] as const).map(sev => {
              const t = severityTint[sev]
              const active = sevFilter === sev
              return (
                <button
                  key={sev}
                  onClick={() => setSevFilter(active ? 'all' : sev)}
                  style={{
                    background: t.bg,
                    border: `1px solid ${active ? t.color : t.border}`,
                    borderRadius: 8, padding: '0.75rem', cursor: 'pointer', textAlign: 'center',
                    outline: active ? `1px solid ${t.color}` : 'none',
                  }}
                >
                  <div style={{ fontSize: '1.25rem', fontWeight: 700, color: t.color, fontFamily: 'ui-monospace, monospace' }}>
                    {counts[sev]}
                  </div>
                  <div style={{ fontSize: '0.68rem', color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    {sev}
                  </div>
                </button>
              )
            })}
          </div>

          {/* filter bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.875rem', flexWrap: 'wrap' }}>
            <select style={selectStyle} value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
              <option value="all">All resource types</option>
              {findingResourceTypes.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <select style={selectStyle} value={sevFilter} onChange={e => setSevFilter(e.target.value)}>
              <option value="all">All priorities</option>
              <option value="Critical">Critical</option>
              <option value="Warning">Warning</option>
              <option value="Info">Info</option>
            </select>
            {hasActiveFilter && (
              <button
                onClick={() => { setSevFilter('all'); setTypeFilter('all') }}
                style={{ background: 'none', border: 'none', color: 'var(--acc)', fontSize: '0.78rem', cursor: 'pointer' }}
              >
                Clear filters
              </button>
            )}
            <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: 'var(--t3)' }}>
              {filtered.length} of {findings.length} findings
            </span>
          </div>

          {/* findings cards */}
          {filtered.length === 0 ? (
            <p style={{ textAlign: 'center', color: 'var(--t3)', fontSize: '0.82rem', padding: '1.5rem 0' }}>
              No findings match the selected filters.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {filtered.map((f, i) => {
                const sc = severityConfig[f.severity] || { label: f.severity, color: 'muted' }
                const age = f.first_seen_at ? findingAge(f.first_seen_at) : null
                const st = f.status && f.status !== 'open' ? findingStatusConfig[f.status] : null
                return (
                  <div key={f.id || i} style={{
                    border: '1px solid var(--border)', borderRadius: 8, padding: '0.875rem 1rem',
                    background: 'var(--input-bg)',
                    opacity: f.status === 'dismissed' ? 0.55 : 1,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                      {severityIcons[f.severity]}
                      <Badge color={sc.color} label={sc.label} />
                      {f.category && <Badge color="muted" label={f.category} />}
                      {age && <Badge color={age.color} label={age.label} />}
                      {st && <Badge color={st.color} label={st.label} />}
                      <span style={{
                        marginLeft: 'auto', fontSize: '0.7rem', color: 'var(--t4)',
                        fontFamily: 'ui-monospace, monospace',
                      }}>
                        {f.resource_type}{f.resource_name ? ` · ${f.resource_name}` : ''}
                      </span>
                      {canAnalyze && f.id && f.status !== 'resolved' && (
                        <button
                          onClick={() => setFindingStatus(f.id!, f.status === 'dismissed' ? 'open' : 'dismissed')}
                          title={f.status === 'dismissed' ? 'Reopen this finding' : "Dismiss (won't fix / accepted risk)"}
                          style={{
                            background: 'none', border: '1px solid var(--border-strong)', borderRadius: 6,
                            color: 'var(--t3)', padding: '0.2rem 0.35rem', cursor: 'pointer', display: 'flex',
                          }}
                        >
                          {f.status === 'dismissed' ? <RotateCcw size={12} /> : <EyeOff size={12} />}
                        </button>
                      )}
                    </div>
                    <p style={{ fontSize: '0.82rem', color: 'var(--t1)', lineHeight: 1.55 }}>{f.issue}</p>
                    {f.recommendation && (
                      <div style={{
                        marginTop: '0.625rem', padding: '0.55rem 0.75rem', borderRadius: 6,
                        background: 'rgba(34,197,94,0.07)', border: '1px solid rgba(34,197,94,0.2)',
                        fontSize: '0.78rem', color: 'var(--t2)', lineHeight: 1.5,
                      }}>
                        <span style={{ color: '#22c55e', fontWeight: 600 }}>Fix: </span>
                        {f.recommendation}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* "Analyze All" confirmation dialog */}
      {showAllConfirm && (
        <Modal title="Analyze All Resources?" onClose={() => setShowAllConfirm(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{
              display: 'flex', gap: '0.625rem', padding: '0.75rem 0.875rem',
              background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.3)', borderRadius: 8,
            }}>
              <TriangleAlert size={17} color="#fbbf24" style={{ flexShrink: 0, marginTop: 1 }} />
              <p style={{ fontSize: '0.82rem', color: 'var(--t2)', lineHeight: 1.55 }}>
                This queues the complete audit dataset — all {resourceTypes.length} resource types — as a single analysis request.
                It takes longer for the agent to work through than analyzing one resource type at a time.
              </p>
            </div>
            {error && <p style={{ color: '#ef4444', fontSize: '0.8rem' }}>{error}</p>}
            <div style={{ display: 'flex', gap: '0.625rem', justifyContent: 'flex-end' }}>
              <button className="btn-ghost" onClick={() => setShowAllConfirm(false)}>Cancel</button>
              <button
                className="btn-primary"
                onClick={() => { setShowAllConfirm(false); analyzeScope(ALL_SCOPE) }}
              >
                Yes, Analyze All
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Share dialog */}
      {showShareModal && (
        <Modal title={`Share "${currentScopeLabel}" Analysis`} onClose={() => setShowShareModal(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {shareDone !== null ? (
              <p style={{ fontSize: '0.85rem', color: '#22c55e' }}>
                Sent to {shareDone} recipient{shareDone === 1 ? '' : 's'}.
              </p>
            ) : (
              <>
                <div>
                  <p style={{ fontSize: '0.78rem', color: 'var(--t3)', marginBottom: '0.5rem' }}>Share with role:</p>
                  <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                    {['admin', 'analyst', 'viewer'].map(role => (
                      <label key={role} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.82rem', color: 'var(--t2)', cursor: 'pointer' }}>
                        <input type="checkbox" checked={shareRoles.includes(role)} onChange={() => toggleShareRole(role)} />
                        {role}
                      </label>
                    ))}
                  </div>
                </div>

                {user?.role === 'admin' && (
                  <div>
                    <p style={{ fontSize: '0.78rem', color: 'var(--t3)', marginBottom: '0.5rem' }}>Or specific users:</p>
                    {!shareUsers ? (
                      <p style={{ fontSize: '0.78rem', color: 'var(--t4)' }}>Loading users…</p>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem', maxHeight: 160, overflowY: 'auto' }}>
                        {shareUsers.map(u => (
                          <label key={u.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', color: 'var(--t2)', cursor: 'pointer' }}>
                            <input type="checkbox" checked={shareUserIds.includes(u.id)} onChange={() => toggleShareUser(u.id)} />
                            {u.email} <span style={{ color: 'var(--t4)', fontSize: '0.72rem' }}>({u.role})</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {shareError && <p style={{ color: '#ef4444', fontSize: '0.8rem' }}>{shareError}</p>}

                <div style={{ display: 'flex', gap: '0.625rem', justifyContent: 'flex-end' }}>
                  <button className="btn-ghost" onClick={() => setShowShareModal(false)}>Cancel</button>
                  <button
                    className="btn-primary"
                    disabled={shareSending || (shareRoles.length === 0 && shareUserIds.length === 0)}
                    onClick={sendShare}
                  >
                    {shareSending ? 'Sending…' : 'Send'}
                  </button>
                </div>
              </>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}
