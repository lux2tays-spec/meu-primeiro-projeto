const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000'

function getToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('root_token')
}

export function setToken(token: string) {
  localStorage.setItem('root_token', token)
}

export function clearToken() {
  localStorage.removeItem('root_token')
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getToken()
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Erro desconhecido' }))
    if (res.status === 401 && !path.includes('/auth/login')) {
      clearToken()
      window.location.href = '/login'
      throw new Error('Sessão expirada')
    }
    throw new Error(err.error ?? `Erro ${res.status}`)
  }

  return res.json()
}

// Authenticated file download (CSV exports). The regular `request` helper
// assumes JSON — here we fetch a blob and trigger a browser download using the
// filename from Content-Disposition (exposed via CORS) or a fallback name.
export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  const token = getToken()
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })

  if (!res.ok) {
    if (res.status === 401) {
      clearToken()
      window.location.href = '/login'
      throw new Error('Sessão expirada')
    }
    const err = await res.json().catch(() => ({ error: undefined as string | undefined }))
    throw new Error(err.error ?? `Erro ${res.status} ao exportar`)
  }

  const blob = await res.blob()
  const disposition = res.headers.get('Content-Disposition') ?? ''
  const match = disposition.match(/filename="?([^";]+)"?/)
  const filename = match?.[1] ?? fallbackName

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body ?? {}) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
}

export const rootApi = {
  login: (email: string, password: string) =>
    api.post<{ token: string }>('/auth/login', { email, password }),

  stats: () => api.get<any>('/root/stats'),

  // Tenants
  tenants: (params?: { search?: string; plan?: string; status?: string; page?: number }) => {
    const q = new URLSearchParams()
    if (params?.search) q.set('search', params.search)
    if (params?.plan)   q.set('plan', params.plan)
    if (params?.status) q.set('status', params.status)
    if (params?.page)   q.set('page', String(params.page))
    return api.get<{ data: any[]; total: number; page: number; limit: number }>(`/root/tenants?${q}`)
  },
  tenant: (id: string) => api.get<any>(`/root/tenants/${id}`),
  updateTenant: (id: string, data: any) => api.patch<any>(`/root/tenants/${id}`, data),
  extendTrial: (id: string, days?: number) => api.post<any>(`/root/tenants/${id}/extend-trial`, { days }),
  updateTenantHandoff: (id: string, data: any) => api.patch<any>(`/root/tenants/${id}/handoff`, data),
  updateTenantAgent: (id: string, data: any) => api.patch<any>(`/root/tenants/${id}/agent`, data),

  // Remote support toolkit (tenant diagnostics)
  tenantConversations: (id: string, params?: { limit?: number; offset?: number }) => {
    const q = new URLSearchParams()
    if (params?.limit != null)  q.set('limit', String(params.limit))
    if (params?.offset != null) q.set('offset', String(params.offset))
    return api.get<any[]>(`/root/tenants/${id}/conversations?${q}`)
  },
  conversationMessages: (cid: string, params?: { limit?: number; offset?: number }) => {
    const q = new URLSearchParams()
    if (params?.limit != null)  q.set('limit', String(params.limit))
    if (params?.offset != null) q.set('offset', String(params.offset))
    return api.get<any[]>(`/root/conversations/${cid}/messages?${q}`)
  },
  tenantBotErrors: (id: string, limit = 20) => api.get<any[]>(`/root/tenants/${id}/bot-errors?limit=${limit}`),
  tenantWhatsapp: (id: string) => api.get<any>(`/root/tenants/${id}/whatsapp`),
  tenantWhatsappReconnect: (id: string) => api.post<{ qrcode?: string; qr_pending?: boolean }>(`/root/tenants/${id}/whatsapp/reconnect`),
  tenantWhatsappLogout: (id: string) => api.post<{ ok: boolean }>(`/root/tenants/${id}/whatsapp/logout`),
  testTenantBot: (id: string, message: string) => api.post<{ reply: string }>(`/root/tenants/${id}/test-bot`, { message }),
  clearTenantCache: (id: string) => api.post<{ ok: boolean }>(`/root/tenants/${id}/clear-cache`),
  tenantAiUsage: (id: string) => api.get<{ month_spend: number; cap: number; plan: string }>(`/root/tenants/${id}/ai-usage`),

  // Tenant staff
  addTenantStaff: (tenantId: string, data: { user_id: string; role: string }) =>
    api.post(`/root/tenants/${tenantId}/staff`, data),
  editTenantStaff: (tenantId: string, userId: string, data: any) =>
    api.patch(`/root/tenants/${tenantId}/staff/${userId}`, data),
  removeTenantStaff: (tenantId: string, userId: string) =>
    api.delete(`/root/tenants/${tenantId}/staff/${userId}`),

  // Users
  users: (params?: { search?: string; page?: number }) => {
    const q = new URLSearchParams()
    if (params?.search) q.set('search', params.search)
    if (params?.page)   q.set('page', String(params.page))
    return api.get<any[]>(`/root/users?${q}`)
  },
  createUser: (data: any) => api.post<any>('/root/users', data),
  updateUser: (id: string, data: any) => api.patch<any>(`/root/users/${id}`, data),
  deleteUser: (id: string) => api.delete(`/root/users/${id}`),

  // Settings
  settings: () => api.get<any>('/root/settings'),
  updateSettings: (key: string, value: any) => api.patch(`/root/settings/${key}`, value),

  // Support/sales bot (platform WhatsApp)
  supportBot: () => api.get<any>('/root/support-bot'),
  updateSupportBot: (data: any) => api.patch<any>('/root/support-bot', data),
  supportBotConnect: () => api.post<{ qrcode?: string; qr_pending?: boolean }>('/root/support-bot/connect'),
  supportBotQr: () => api.get<{ qrcode?: string; qr_pending?: boolean }>('/root/support-bot/qr'),
  supportBotStatus: () => api.get<any>('/root/support-bot/status'),
  supportBotDisconnect: () => api.post<any>('/root/support-bot/disconnect'),

  // AI usage & cost
  aiUsage: (days = 30) => api.get<any>(`/root/ai-usage?days=${days}`),

  // Audit log
  auditLog: (limit = 100, offset = 0) => api.get<any>(`/root/audit-log?limit=${limit}&offset=${offset}`),

  // Infra status (read-only health)
  infraStatus: () => api.get<any>('/root/infra-status'),

  // Branding (dynamic logo/favicon/colors)
  branding: () => api.get<any>('/root/branding'),
  uploadBrandingAsset: (slot: string, data_url: string) => api.put<any>(`/root/branding/asset/${slot}`, { data_url }),
  deleteBrandingAsset: (slot: string) => api.delete(`/root/branding/asset/${slot}`),

  // Plans
  plans: () => api.get<any[]>('/root/plans'),
  createPlan: (data: any) => api.post<any>('/root/plans', data),
  updatePlan: (id: string, data: any) => api.patch<any>(`/root/plans/${id}`, data),
  deletePlan: (id: string) => api.delete(`/root/plans/${id}`),

  // Revenue & Affiliates
  revenue: () => api.get<any>('/root/revenue'),
  affiliates: () => api.get<any[]>('/root/affiliates'),
  payAffiliate: (id: string) => api.post<any>(`/root/affiliates/${id}/pay`),

  // Support tickets
  supportTickets: (status?: 'open' | 'resolved') =>
    api.get<any[]>(`/root/support/tickets${status ? `?status=${status}` : ''}`),
  supportTicket: (id: string) => api.get<any>(`/root/support/tickets/${id}`),
  replySupportTicket: (id: string, body: string) =>
    api.post<any>(`/root/support/tickets/${id}/reply`, { body }),
  updateSupportTicket: (id: string, data: { status: 'open' | 'resolved' }) =>
    api.patch<any>(`/root/support/tickets/${id}`, data),

  // Exportações (CSV para Excel)
  exportCustomers: () => downloadFile('/root/export/customers', 'clientes.csv'),
  exportTenants: () => downloadFile('/root/export/tenants', 'estabelecimentos.csv'),
  exportAppointments: () => downloadFile('/root/export/appointments', 'agendamentos.csv'),
  exportSubscriptions: () => downloadFile('/root/export/subscriptions', 'assinaturas.csv'),

  // Business Type Templates
  businessTypeTemplates: () => api.get<any[]>('/root/business-type-templates'),
  createBusinessTypeTemplate: (data: any) => api.post<any>('/root/business-type-templates', data),
  updateBusinessTypeTemplate: (id: string, data: any) => api.patch<any>(`/root/business-type-templates/${id}`, data),
  deleteBusinessTypeTemplate: (id: string) => api.delete(`/root/business-type-templates/${id}`),
}
