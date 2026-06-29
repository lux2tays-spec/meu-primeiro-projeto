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

  if (res.status === 401) {
    clearToken()
    window.location.href = '/login'
    throw new Error('Sessão expirada')
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Erro desconhecido' }))
    throw new Error(err.error ?? `Erro ${res.status}`)
  }

  return res.json()
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
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

  // Plans
  plans: () => api.get<any[]>('/root/plans'),
  createPlan: (data: any) => api.post<any>('/root/plans', data),
  updatePlan: (id: string, data: any) => api.patch<any>(`/root/plans/${id}`, data),
  deletePlan: (id: string) => api.delete(`/root/plans/${id}`),

  // Revenue & Affiliates
  revenue: () => api.get<any>('/root/revenue'),
  affiliates: () => api.get<any[]>('/root/affiliates'),
  payAffiliate: (id: string) => api.post<any>(`/root/affiliates/${id}/pay`),

  // Business Type Templates
  businessTypeTemplates: () => api.get<any[]>('/root/business-type-templates'),
  createBusinessTypeTemplate: (data: any) => api.post<any>('/root/business-type-templates', data),
  updateBusinessTypeTemplate: (id: string, data: any) => api.patch<any>(`/root/business-type-templates/${id}`, data),
  deleteBusinessTypeTemplate: (id: string) => api.delete(`/root/business-type-templates/${id}`),
}
