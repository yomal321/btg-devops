const TOKEN_KEY = 'btg_token'

function getToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(TOKEN_KEY)
}

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(path, { ...options, headers })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as { error?: string }).error || `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

export const api = {
  listAudits: () =>
    apiFetch<import('../types').Audit[]>('/api/audits'),

  getAudit: (id: string) =>
    apiFetch<import('../types').AuditDetail>(`/api/audits/${id}`),

  getCostUsageSummary: (id: string) =>
    apiFetch<import('../types').CostUsageSummary>(`/api/audits/${id}/cost-summary`),

  analyzeAudit: (id: string, resource?: string) =>
    apiFetch<{ audit_id: string; resource: string | null; cached: boolean; analysis: Record<string, unknown> }>(
      `/api/audits/${id}/analysis${resource ? `?resource=${encodeURIComponent(resource)}` : ''}`,
      { method: 'POST' }
    ),

  listFindings: (auditId: string) =>
    apiFetch<import('../types').Finding[]>(`/api/audits/${auditId}/findings`),

  topFindings: (limit = 8) =>
    apiFetch<import('../types').Finding[]>(`/api/findings/top?limit=${limit}`),

  listChat: (auditId: string) =>
    apiFetch<import('../types').ChatMessage[]>(`/api/audits/${auditId}/chat`),

  sendChat: (auditId: string, content: string) =>
    apiFetch<{ reply: string }>(`/api/audits/${auditId}/chat`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    }),

  getAuditResource: (auditId: string, slug: string) =>
    apiFetch<{ audit_id: string; resource: unknown; data: unknown }>(`/api/audits/${auditId}/resources/${slug}`),

  listSubscriptions: () =>
    apiFetch<import('../types').Subscription[]>('/api/subscriptions'),

  createSubscription: (data: unknown) =>
    apiFetch('/api/subscriptions', { method: 'POST', body: JSON.stringify(data) }),

  updateSubscription: (id: string, data: unknown) =>
    apiFetch(`/api/subscriptions/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  deleteSubscription: (id: string) =>
    apiFetch(`/api/subscriptions/${id}`, { method: 'DELETE' }),

  listUsers: () =>
    apiFetch<import('../types').User[]>('/api/users'),

  createUser: (data: unknown) =>
    apiFetch('/api/users', { method: 'POST', body: JSON.stringify(data) }),

  updateUser: (id: string, data: unknown) =>
    apiFetch(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  deleteUser: (id: string) =>
    apiFetch(`/api/users/${id}`, { method: 'DELETE' }),
}
