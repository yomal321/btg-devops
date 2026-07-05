'use client'

import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { api } from './api'

export type LLMProvider = 'claude' | 'gemini' | 'openrouter'

export interface ModelChoice {
  provider: LLMProvider
  model: string
}

interface CatalogEntry extends ModelChoice {
  label: string
}

// Editable catalog of selectable models. Free providers (Gemini, OpenRouter)
// are listed for testing before an Anthropic key is available; Claude is the
// production target. Model IDs can be adjusted as providers change theirs.
// OpenRouter's free-tier lineup changes over time — verified live against
// https://openrouter.ai/api/v1/models (filter: pricing.prompt === "0") on
// 2026-07-04. If a free model here starts 404ing as "moved to paid", re-check
// that endpoint rather than guessing a replacement slug.
export const MODEL_CATALOG: CatalogEntry[] = [
  { provider: 'gemini',     model: 'gemini-2.0-flash',                          label: 'Gemini 2.0 Flash (free)' },
  { provider: 'gemini',     model: 'gemini-1.5-flash',                          label: 'Gemini 1.5 Flash (free)' },
  // OpenRouter free models below are deliberately spread across different
  // model vendors — each is typically served by a different upstream
  // inference backend, so if one backend is congested (429 "rate-limited
  // upstream"), a different entry in this list is likely still available.
  { provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct:free',              label: 'Llama 3.3 70B (OpenRouter, free)' },
  { provider: 'openrouter', model: 'meta-llama/llama-3.2-3b-instruct:free',               label: 'Llama 3.2 3B (OpenRouter, free)' },
  { provider: 'openrouter', model: 'openai/gpt-oss-120b:free',                            label: 'GPT-OSS 120B (OpenRouter, free)' },
  { provider: 'openrouter', model: 'openai/gpt-oss-20b:free',                             label: 'GPT-OSS 20B (OpenRouter, free)' },
  { provider: 'openrouter', model: 'qwen/qwen3-coder:free',                               label: 'Qwen3 Coder 480B (OpenRouter, free)' },
  { provider: 'openrouter', model: 'qwen/qwen3-next-80b-a3b-instruct:free',               label: 'Qwen3 Next 80B (OpenRouter, free)' },
  { provider: 'openrouter', model: 'nvidia/nemotron-3-super-120b-a12b:free',              label: 'Nemotron 3 Super 120B (OpenRouter, free)' },
  { provider: 'openrouter', model: 'cognitivecomputations/dolphin-mistral-24b-venice-edition:free', label: 'Dolphin Mistral 24B (OpenRouter, free)' },
  { provider: 'claude',     model: 'claude-sonnet-4-6',                         label: 'Claude Sonnet 4.6' },
]

const DEFAULT_CHOICE: ModelChoice = { provider: MODEL_CATALOG[0].provider, model: MODEL_CATALOG[0].model }
const STORAGE_KEY = 'btg_model'

type Availability = Record<LLMProvider, boolean>

interface ModelCtx {
  choice: ModelChoice
  setChoice: (c: ModelChoice) => void
  available: Availability
}

const ModelContext = createContext<ModelCtx>({
  choice: DEFAULT_CHOICE,
  setChoice: () => {},
  available: { claude: false, gemini: false, openrouter: false },
})

export function ModelProvider({ children }: { children: ReactNode }) {
  const [choice, setChoiceState] = useState<ModelChoice>(DEFAULT_CHOICE)
  const [available, setAvailable] = useState<Availability>({ claude: false, gemini: false, openrouter: false })

  useEffect(() => {
    let saved: ModelChoice | null = null
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) saved = JSON.parse(raw)
    } catch { /* ignore malformed */ }
    if (saved) setChoiceState(saved)

    // Discover which providers actually have a key, then auto-switch to a
    // configured one if the current/saved choice's provider has no key —
    // so the user isn't stuck on a provider that will always error.
    api.llmStatus()
      .then(status => {
        setAvailable(status)
        const current = saved || DEFAULT_CHOICE
        if (!status[current.provider]) {
          const firstAvailable = MODEL_CATALOG.find(m => status[m.provider])
          if (firstAvailable) {
            const next = { provider: firstAvailable.provider, model: firstAvailable.model }
            setChoiceState(next)
            localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
          }
        }
      })
      .catch(() => { /* not logged in yet, or endpoint unavailable — leave defaults */ })
  }, [])

  function setChoice(c: ModelChoice) {
    setChoiceState(c)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(c))
  }

  return <ModelContext.Provider value={{ choice, setChoice, available }}>{children}</ModelContext.Provider>
}

export function useModel() {
  return useContext(ModelContext)
}

export function ModelPicker() {
  const { choice, setChoice, available } = useModel()
  const value = `${choice.provider}::${choice.model}`
  const anyConfigured = Object.values(available).some(Boolean)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', alignItems: 'flex-end' }}>
      <select
        value={value}
        onChange={e => {
          const entry = MODEL_CATALOG.find(m => `${m.provider}::${m.model}` === e.target.value)
          if (entry) setChoice({ provider: entry.provider, model: entry.model })
        }}
        title="AI model used for Analyze and Chat"
        style={{
          background: 'var(--input-bg)', border: '1px solid var(--border-strong)',
          borderRadius: 8, color: 'var(--t2)', padding: '0.35rem 0.5rem',
          fontSize: '0.75rem', cursor: 'pointer', maxWidth: 240,
        }}
      >
        {MODEL_CATALOG.map(m => (
          <option key={`${m.provider}::${m.model}`} value={`${m.provider}::${m.model}`}>
            {m.label}{available[m.provider] ? '' : ' — no key'}
          </option>
        ))}
      </select>
      {!anyConfigured && (
        <span style={{ fontSize: '0.62rem', color: '#fbbf24' }}>
          No API key set — add GEMINI_API_KEY to .env.local
        </span>
      )}
    </div>
  )
}
