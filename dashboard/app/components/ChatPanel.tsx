'use client'

import { useCallback, useEffect, useRef, useState, KeyboardEvent } from 'react'
import { useSearchParams } from 'next/navigation'
import { MessageSquare, Lock, Send } from 'lucide-react'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import type { ChatMessage } from '../types'

const SUGGESTIONS = [
  'What is my biggest cost problem?',
  'Are there any security risks I should fix immediately?',
  'Which resources are unused or idle?',
  'What would you fix first in this subscription?',
]

/* minimal markdown: **bold** only */
function renderBold(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((p, i) =>
    p.startsWith('**') && p.endsWith('**')
      ? <strong key={i} style={{ color: 'var(--t1)' }}>{p.slice(2, -2)}</strong>
      : <span key={i}>{p}</span>
  )
}

export function ChatPanel({ auditId }: { auditId: string }) {
  const { user } = useAuth()
  const canChat = user?.role === 'admin' || user?.role === 'analyst'

  const searchParams = useSearchParams()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput]       = useState('')
  const [sending, setSending]   = useState(false)
  const [error, setError]       = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const askSent   = useRef(false)

  useEffect(() => {
    if (!canChat) return
    api.listChat(auditId).then(setMessages).catch(() => {})
  }, [auditId, canChat])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, sending])

  const send = useCallback(async (text?: string, current?: string) => {
    const content = (text ?? current ?? '').trim()
    if (!content) return
    setInput('')
    setError('')
    setSending(true)

    setMessages(m => [...m, {
      id: `tmp-${m.length}`, audit_id: auditId, user_id: user?.id || '',
      role: 'user', content, created_at: '',
    }])

    try {
      const result = await api.sendChat(auditId, content)
      setMessages(m => [...m, {
        id: `tmp-a-${m.length}`, audit_id: auditId, user_id: '',
        role: 'assistant', content: result.reply, created_at: '',
      }])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Message failed')
    } finally {
      setSending(false)
    }
  }, [auditId, user?.id])

  // prefilled question handoff (e.g. from the audit comparison page: ?ask=...)
  useEffect(() => {
    const ask = searchParams.get('ask')
    if (ask && canChat && !askSent.current) {
      askSent.current = true
      send(ask)
    }
  }, [searchParams, canChat, send])

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send(undefined, input)
    }
  }

  return (
    <div className="glass" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 420, maxHeight: 640 }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)' }}>
        <MessageSquare size={15} color="var(--acc)" style={{ alignSelf: 'center' }} />
        <h2 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--t1)' }}>Ask about this audit</h2>
        <span style={{ fontSize: '0.7rem', color: 'var(--t4)' }}>scoped to this audit</span>
      </div>

      {!canChat ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--t3)', padding: '1.5rem' }}>
          <Lock size={22} style={{ marginBottom: '0.75rem' }} />
          <p style={{ fontSize: '0.82rem', textAlign: 'center' }}>Chat is available for analysts and admins only.</p>
        </div>
      ) : (
        <>
          {/* messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {messages.length === 0 && !sending && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem' }}>
                <p style={{ fontSize: '0.75rem', color: 'var(--t4)', marginBottom: '0.25rem' }}>Try asking:</p>
                {SUGGESTIONS.map(s => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    style={{
                      textAlign: 'left', background: 'var(--input-bg)', border: '1px solid var(--border-strong)',
                      borderRadius: 8, padding: '0.55rem 0.75rem', fontSize: '0.78rem',
                      color: 'var(--t2)', cursor: 'pointer',
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            {messages.map(m => (
              <div
                key={m.id}
                style={{
                  alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                  maxWidth: '85%',
                  background: m.role === 'user' ? 'var(--acc-soft)' : 'var(--input-bg)',
                  border: `1px solid ${m.role === 'user' ? 'rgba(96,165,250,0.25)' : 'var(--border)'}`,
                  borderRadius: 10,
                  padding: '0.6rem 0.8rem',
                  fontSize: '0.8rem',
                  color: 'var(--t2)',
                  lineHeight: 1.55,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {m.role === 'assistant' ? renderBold(m.content) : m.content}
              </div>
            ))}

            {sending && (
              <div style={{
                alignSelf: 'flex-start', background: 'var(--input-bg)', border: '1px solid var(--border)',
                borderRadius: 10, padding: '0.7rem 0.9rem', display: 'flex', gap: 4,
              }}>
                {[0, 1, 2].map(i => (
                  <span key={i} style={{
                    width: 6, height: 6, borderRadius: '50%', background: 'var(--t3)',
                    animation: 'fadeIn 1s ease-in-out infinite alternate',
                    animationDelay: `${i * 0.2}s`,
                  }} />
                ))}
              </div>
            )}

            {error && <p style={{ fontSize: '0.75rem', color: '#ef4444' }}>{error}</p>}
            <div ref={bottomRef} />
          </div>

          {/* input */}
          <div style={{ display: 'flex', gap: '0.5rem', padding: '0.875rem 1.25rem', borderTop: '1px solid var(--border)' }}>
            <input
              className="field"
              placeholder="Ask a question about this audit…"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={sending}
            />
            <button
              className="btn-primary"
              style={{ display: 'flex', alignItems: 'center', padding: '0.5rem 0.875rem' }}
              onClick={() => send(undefined, input)}
              disabled={sending || !input.trim()}
            >
              <Send size={15} />
            </button>
          </div>
        </>
      )}
    </div>
  )
}
