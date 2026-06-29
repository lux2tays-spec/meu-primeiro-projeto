'use client'

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000'

export function getToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('tenant_token')
}

export function setToken(token: string) {
  localStorage.setItem('tenant_token', token)
}

export function clearToken() {
  localStorage.removeItem('tenant_token')
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

const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
}

export const authApi = {
  login: (email: string, password: string) =>
    api.post<{ token: string }>('/auth/login', { email, password }),
  register: (data: { name: string; email: string; phone: string; password: string; business_name: string; referral_code?: string }) =>
    api.post<{ needs_verification: boolean }>('/auth/register', data),
  verifyEmail: (token: string) =>
    api.get<{ token: string; verified: boolean }>(`/auth/verify-email?token=${encodeURIComponent(token)}`),
  googleAuth: (data: { id_token: string; business_name?: string; phone?: string; referral_code?: string }) =>
    api.post<{ token: string; tenant_id: string; is_new: boolean }>('/auth/google', data),
}

export const tenantApi = {
  me: () => api.get<any>('/tenant/me'),
  services: () => api.get<any[]>('/tenant/services'),
  createService: (data: any) => api.post<any>('/tenant/services', data),
  updateService: (id: string, data: any) => api.put<any>(`/tenant/services/${id}`, data),
  deleteService: (id: string) => api.delete(`/tenant/services/${id}`),
  professionals: () => api.get<any[]>('/tenant/professionals'),
  addProfessional: (data: any) => api.post<any>('/tenant/professionals', data),
  removeProfessional: (id: string) => api.delete(`/tenant/professionals/${id}`),
  staff: () => api.get<any[]>('/tenant/staff'),
  addStaff: (data: any) => api.post<any>('/tenant/staff', data),
  removeStaff: (id: string) => api.delete(`/tenant/staff/${id}`),
  customers: (search?: string) =>
    api.get<any[]>(`/tenant/customers${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  customer: (id: string) => api.get<any>(`/tenant/customers/${id}`),
  updateCustomer: (id: string, data: { name?: string; email?: string }) =>
    api.put<any>(`/tenant/customers/${id}`, data),
  addCustomer: (data: any) => api.post<any>('/tenant/customers', data),
  hours: (professionalId?: string) =>
    api.get<any[]>(`/tenant/hours${professionalId ? `?professional_id=${professionalId}` : ''}`),
  saveHours: (rows: any[], professionalId?: string) =>
    api.post<any>('/tenant/hours', { rows, professional_id: professionalId }),
  paymentConfig: () => api.get<any>('/tenant/payment-config'),
  savePaymentConfig: (data: any) => api.put<any>('/tenant/payment-config', data),
}

export const financeiroApi = {
  resumo: (month?: number, year?: number) =>
    api.get<any>(`/financeiro/resumo${month ? `?month=${month}&year=${year}` : ''}`),
  vendas: (month?: number, year?: number, page = 1) =>
    api.get<any[]>(`/financeiro/vendas?month=${month ?? ''}&year=${year ?? ''}&page=${page}`),
  paymentLinks: () => api.get<any[]>('/financeiro/payment-links'),
  createPaymentLink: (data: { title: string; description?: string; amount: number }) =>
    api.post<any>('/financeiro/payment-links', data),
  deletePaymentLink: (id: string) => api.delete(`/financeiro/payment-links/${id}`),
}

export const appointmentsApi = {
  list: (date?: string) =>
    api.get<any[]>(`/appointments${date ? `?date=${date}` : ''}`),
  getById: (id: string) => api.get<any>(`/appointments/${id}`),
  create: (data: any) => api.post<any>('/appointments', data),
  update: (id: string, data: any) => api.put<any>(`/appointments/${id}`, data),
  updateStatus: (id: string, status: string) =>
    api.patch<any>(`/appointments/${id}/status`, { status }),
  slots: (professionalId: string, serviceId: string, date: string) =>
    api.get<string[]>(`/appointments/slots?professional_id=${professionalId}&service_id=${serviceId}&date=${date}`),
}

export const agentApi = {
  getConfig: () => api.get<any>('/agent/config'),
  updateConfig: (data: any) => api.patch<any>('/agent/config', data),
  uploadCatalog: async (file: File): Promise<{ name: string; url: string }> => {
    const token = getToken()
    const body = new FormData()
    body.append('file', file)
    const res = await fetch(`${BASE_URL}/agent/config/upload`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body,
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error((err as any).error ?? 'Upload falhou')
    }
    return res.json()
  },
}

export const whatsappApi = {
  connect: () => api.post<any>('/whatsapp/connect'),
  getQR: () => api.get<any>('/whatsapp/qr'),
  getStatus: () => api.get<any>('/whatsapp/status'),
}

export const affiliateApi = {
  me: () => api.get<any>('/affiliate/me'),
}
