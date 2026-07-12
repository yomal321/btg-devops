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
  has_cost: boolean
  has_usage: boolean
  usage_types: { slug: string; count: number }[]
}

export interface Resource {
  id: number
  slug: string
  name: string
  description: string
}

// One currently-unresolved data gap: the LATEST analysis for one
// subscription+scope combination still reports at least one entry in its
// data_gaps array (spec 10 §5.4/§6, spec 13 dashboard visibility). Once a
// later run stops reporting a gap, it drops out of this list automatically —
// this is never a historical log, only "what's still open right now".
export interface DataGapEntry {
  subscription_id: string
  subscription_name: string
  scope: string
  gaps: string[]
  audit_id: string
  generated_at: string
  // How many of the most recent consecutive runs for this subscription+scope
  // reported at least one gap — distinguishes "just started" from "been open
  // for weeks", since a run with zero gaps breaks the streak.
  consecutive_runs: number
  // 'open': never marked fixed. 'pending_verification': marked fixed, but no
  // analysis has run since — outcome not yet known. 'reopened': marked
  // fixed, but a LATER analysis still reports a gap — the fix didn't hold.
  verification_status: 'open' | 'pending_verification' | 'reopened'
  mark?: { marked_at: string; marked_by_email: string | null; note: string | null }
}

// A gap that was marked fixed and has since been confirmed resolved — the
// scope's latest analysis no longer reports any gaps.
export interface ResolvedGapEntry {
  subscription_id: string
  subscription_name: string
  scope: string
  marked_at: string
  marked_by_email: string | null
  note: string | null
  resolved_at: string // the confirming analysis's generated_at
}

export interface Finding {
  id: string
  audit_id: string
  severity: 'Critical' | 'Warning' | 'Info'
  category: string | null
  resource_type: string
  resource_name: string
  resource_group: string | null
  child_resource_name: string | null
  affected_resources: string[] | null
  cost_impact_usd: number | null
  cost_impact_note: string | null
  recommendation_steps: string[] | null
  fix_effort: 'quick' | 'moderate' | 'complex' | null
  finding_type: 'chain' | 'standard' | null
  issue: string
  recommendation: string
  scope: string | null
  status: 'open' | 'resolved' | 'dismissed'
  first_seen_at: Date
  resolved_at: Date | null
  created_at: Date
}

export interface ChatMessage {
  id: string
  audit_id: string
  thread_id: string | null
  user_id: string
  role: 'user' | 'assistant'
  content: string
  created_at: Date
}

export interface ChatThread {
  id: string
  audit_id: string
  title: string
  created_by: string | null
  created_at: Date
  updated_at: Date
  message_count?: number
}

export interface JWTPayload {
  user_id: string
  email: string
  role: string
}

export interface CostRow {
  Cost: number
  Currency: string
  UsageDate: number // YYYYMMDD
  ResourceId: string
  ServiceName: string
}

export interface CostDataRaw {
  total_rows: number
  period_from: string
  period_to: string
  actual_cost_rows: CostRow[]
  amortized_cost_rows: CostRow[]
}

export interface UsageDataPoint {
  timestamp: string
  average?: number
  total?: number
  count?: number
  minimum?: number
  maximum?: number
}

export interface UsageMetricRaw {
  resource_id: string
  metric_name: string
  unit: string
  /** Pre-computed by the CLI at collection time — see extractors/usage.go.
   *  Absent on audits collected before this field existed. */
  summary?: { avg: number | null; total: number | null }
  data_points: UsageDataPoint[]
}

export interface UsageDataRaw {
  total_resources_sampled: number
  period_from: string
  period_to: string
  metrics: UsageMetricRaw[]
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
  created_at: Date
  last_audit_at: Date | null
}
