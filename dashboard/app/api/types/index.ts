export interface User {
  id: string
  email: string
  password_hash: string
  role: string
  is_active: boolean
  created_at: Date
  last_login: Date | null
}

export interface Audit {
  id: string
  created_at: Date
  subscription_id: string
  subscription_name: string
  trigger_type: string
  status: string
  error_message: string
  resource_counts: Record<string, number>
  has_analysis: boolean
}

export interface AuditDetail extends Audit {
  raw_data: Record<string, unknown>
  claude_analysis: Record<string, unknown> | null
}

export interface Resource {
  id: number
  slug: string
  name: string
  description: string
}

export interface Finding {
  id: string
  audit_id: string
  severity: 'Critical' | 'Warning' | 'Info'
  resource_type: string
  resource_name: string
  issue: string
  recommendation: string
  created_at: Date
}

export interface ChatMessage {
  id: string
  audit_id: string
  user_id: string
  role: 'user' | 'assistant'
  content: string
  created_at: Date
}

export interface JWTPayload {
  user_id: string
  email: string
  role: string
}

export interface Subscription {
  id: string
  name: string
  subscription_id: string
  tenant_id: string
  client_id: string
  is_active: boolean
  created_at: Date
  last_audit_at: Date | null
}
