export type Role = 'admin' | 'analyst' | 'viewer'

export interface SessionUser {
  id: string
  email: string
  role: Role
}

export interface User {
  id: string
  email: string
  role: Role
  is_active: boolean
  created_at: string
  last_login: string | null
}

export interface Audit {
  id: string
  created_at: string
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
  has_cost: boolean
  has_usage: boolean
  usage_types: { slug: string; count: number }[]
}

export interface Finding {
  id: string
  audit_id: string
  severity: 'Critical' | 'Warning' | 'Info'
  category: string | null
  resource_type: string
  resource_name: string
  issue: string
  recommendation: string
  scope: string | null
  status: 'open' | 'resolved' | 'dismissed'
  first_seen_at: string
  resolved_at: string | null
  created_at: string
}

export interface ChatMessage {
  id: string
  audit_id: string
  thread_id?: string | null
  user_id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

export interface ChatThread {
  id: string
  audit_id: string
  title: string
  created_at: string
  updated_at: string
  message_count?: number
}

export interface CostSummary {
  currency: string
  period_from: string
  period_to: string
  total_cost_rows: number
  daily_cost: { date: string; cost: number }[]
  top_services: { service: string; cost: number }[]
  total_resources_sampled: number
  usage_types: { slug: string; count: number }[]
  claude_analysis: Record<string, unknown> | null
}

export interface UsageSummary {
  type: string
  groups: {
    resource_id: string
    metrics: { metric_name: string; unit: string; avg: number | null; total: number | null }[]
  }[]
}

export interface RegionSummary {
  distribution: { region: string; count: number }[]
  mismatches: {
    region: string
    computeResources: { type: string; name: string }[]
    dataRegions: string[]
  }[]
}

export interface Subscription {
  id: string
  name: string
  subscription_id: string
  tenant_id: string
  client_id: string
  is_active: boolean
  created_at: string
  last_audit_at: string | null
}
