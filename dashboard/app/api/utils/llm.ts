import Anthropic from '@anthropic-ai/sdk'

// Provider-neutral LLM layer. Analysis/chat build the same message list
// regardless of provider; callLLM dispatches to the selected backend and
// returns the raw text. This keeps the Claude path intact while letting the
// dashboard run against free providers (Gemini, OpenRouter) for testing
// before an Anthropic key is available.

export type LLMProvider = 'claude' | 'gemini' | 'openrouter'

export interface LLMMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface LLMCall {
  provider: LLMProvider
  model: string
  messages: LLMMessage[]
  maxTokens: number
}

let anthropic: Anthropic | null = null
function claudeClient(): Anthropic {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key || key.startsWith('your-')) {
    throw new Error('ANTHROPIC_API_KEY is not configured')
  }
  anthropic ??= new Anthropic({ apiKey: key })
  return anthropic
}

async function callClaude(model: string, messages: LLMMessage[], maxTokens: number): Promise<string> {
  const response = await claudeClient().messages.create({ model, max_tokens: maxTokens, messages })
  const block = response.content.find(b => b.type === 'text')
  return block && block.type === 'text' ? block.text : ''
}

async function callGemini(model: string, messages: LLMMessage[], maxTokens: number): Promise<string> {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error('GEMINI_API_KEY is not configured')

  // Gemini uses "model" instead of "assistant" and nests text under parts[].
  const contents = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }))

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents, generationConfig: { maxOutputTokens: maxTokens } }),
    }
  )
  if (!res.ok) {
    throw new Error(`Gemini API error ${res.status}: ${(await res.text()).slice(0, 300)}`)
  }
  const data = await res.json()
  const parts = data?.candidates?.[0]?.content?.parts
  return Array.isArray(parts) ? parts.map((p: { text?: string }) => p.text || '').join('') : ''
}

async function callOpenRouter(model: string, messages: LLMMessage[], maxTokens: number): Promise<string> {
  const key = process.env.OPENROUTER_API_KEY
  if (!key) throw new Error('OPENROUTER_API_KEY is not configured')

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
      // Optional attribution headers OpenRouter recommends; harmless if unused.
      'X-Title': 'BTG DevOps Dashboard',
    },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens }),
  })
  if (!res.ok) {
    throw new Error(`OpenRouter API error ${res.status}: ${(await res.text()).slice(0, 300)}`)
  }
  const data = await res.json()
  return data?.choices?.[0]?.message?.content || ''
}

export async function callLLM({ provider, model, messages, maxTokens }: LLMCall): Promise<string> {
  switch (provider) {
    case 'gemini':     return callGemini(model, messages, maxTokens)
    case 'openrouter': return callOpenRouter(model, messages, maxTokens)
    case 'claude':
    default:           return callClaude(model, messages, maxTokens)
  }
}
