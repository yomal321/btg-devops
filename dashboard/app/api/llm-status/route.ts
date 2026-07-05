import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '../middleware/auth'
import { unauthorized } from '../utils/response'

// Reports which LLM providers have an API key configured server-side, so the
// model picker can mark unconfigured providers and auto-select a working one.
// Returns booleans only — never the key values themselves.
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth) return unauthorized()

  const configured = (v?: string) => !!v && !v.startsWith('your-')

  return NextResponse.json({
    claude: configured(process.env.ANTHROPIC_API_KEY),
    gemini: configured(process.env.GEMINI_API_KEY),
    openrouter: configured(process.env.OPENROUTER_API_KEY),
  })
}
