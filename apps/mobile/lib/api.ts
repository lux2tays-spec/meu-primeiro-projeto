import { getToken } from './storage'

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000'

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = await getToken()
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
    throw new Error(err.error ?? `Erro ${res.status}`)
  }

  return res.json()
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
}

// Auth
export const authApi = {
  login: (email: string, password: string) =>
    api.post<{ token: string }>('/auth/login', { email, password }),
  register: (data: {
    name: string
    email: string
    password: string
    business_name: string
    referral_code?: string
  }) => api.post<{ token: string; tenant_id: string }>('/auth/register', data),
}

// Tenant
export const tenantApi = {
  me: () => api.get<any>('/tenant/me'),
  services: () => api.get<any[]>('/tenant/services'),
  createService: (data: any) => api.post<any>('/tenant/services', data),
  updateService: (id: string, data: any) => api.put<any>(`/tenant/services/${id}`, data),
  deleteService: (id: string) => api.delete<any>(`/tenant/services/${id}`),
  professionals: () => api.get<any[]>('/tenant/professionals'),
  addProfessional: (data: any) => api.post<any>('/tenant/professionals', data),
  removeProfessional: (id: string) => api.delete<any>(`/tenant/professionals/${id}`),
  staff: () => api.get<any[]>('/tenant/staff'),
  addStaff: (data: any) => api.post<any>('/tenant/staff', data),
  removeStaff: (id: string) => api.delete<any>(`/tenant/staff/${id}`),
  customers: (search?: string) =>
    api.get<any[]>(`/tenant/customers${search ? `?search=${encodeURIComponent(search)}` : ''}`),
}

// Appointments
export const appointmentsApi = {
  list: (date?: string) =>
    api.get<any[]>(`/appointments${date ? `?date=${date}` : ''}`),
  create: (data: any) => api.post<any>('/appointments', data),
  updateStatus: (id: string, status: string) =>
    api.patch<any>(`/appointments/${id}/status`, { status }),
}

// Agent
export const agentApi = {
  getConfig: () => api.get<any>('/agent/config'),
  updateConfig: (data: any) => api.patch<any>('/agent/config', data),
  uploadCatalog: async (uri: string, filename: string, mimeType: string): Promise<{ name: string; url: string }> => {
    const token = await getToken()
    const body = new FormData()
    body.append('file', { uri, name: filename, type: mimeType } as any)
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

// WhatsApp
export const whatsappApi = {
  connect: () => api.post<any>('/whatsapp/connect', {}),
  getQR: () => api.get<any>('/whatsapp/qr'),
  getStatus: () => api.get<any>('/whatsapp/status'),
}

// Google
export const googleApi = {
  loginWithIdToken: (idToken: string, businessName?: string, referralCode?: string) =>
    api.post<{ token: string; is_new: boolean; tenant_id?: string }>('/auth/google', {
      id_token: idToken,
      business_name: businessName,
      referral_code: referralCode,
    }),
  calendarStatus: () => api.get<{ connected: boolean; sync_enabled: boolean; calendar_id?: string }>('/google-calendar/status'),
  calendarConnect: (code: string, redirectUri: string) =>
    api.post<{ connected: boolean }>('/google-calendar/connect', { code, redirect_uri: redirectUri }),
  calendarToggle: (syncEnabled: boolean) =>
    api.patch<{ sync_enabled: boolean }>('/google-calendar/settings', { sync_enabled: syncEnabled }),
  calendarDisconnect: () => api.delete<{ disconnected: boolean }>('/google-calendar/disconnect'),
}

// Appointment slots
export const slotsApi = {
  getSlots: (professionalId: string, serviceId: string, date: string) =>
    api.get<string[]>(`/appointments/slots?professional_id=${professionalId}&service_id=${serviceId}&date=${date}`),
}

// Extended appointments API
export const appointmentsApiExt = {
  ...appointmentsApi,
  getById: (id: string) => api.get<any>(`/appointments/${id}`),
  update: (id: string, data: any) => api.patch<any>(`/appointments/${id}`, data),
  put: (id: string, data: any) => request<any>(`/appointments/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  }),
}

// Working hours
export const hoursApi = {
  get: (professionalId?: string) =>
    api.get<any[]>(`/tenant/hours${professionalId ? `?professional_id=${professionalId}` : ''}`),
  save: (rows: Array<{ day_of_week: number; start_time: string; end_time: string; enabled: boolean }>,
         professionalId?: string) =>
    api.post<any[]>('/tenant/hours', { rows, professional_id: professionalId }),
}

// Affiliate
export const affiliateApi = {
  me: () => api.get<any>('/affiliate/me'),
}

// Customers
export const customersApi = {
  list: (search?: string) =>
    api.get<any[]>(`/tenant/customers${search ? `?search=${encodeURIComponent(search)}` : ''}`),
}

// Financeiro
export const financeiroApi = {
  resumo: (month: number, year: number) =>
    api.get<any>(`/financeiro/resumo?month=${month}&year=${year}`),
  vendas: (month: number, year: number) =>
    api.get<any[]>(`/financeiro/vendas?month=${month}&year=${year}`),
  paymentLinks: () => api.get<any[]>('/financeiro/payment-links'),
  createPaymentLink: (data: { title: string; description?: string; amount: number }) =>
    api.post<any>('/financeiro/payment-links', data),
  deletePaymentLink: (id: string) => api.delete<any>(`/financeiro/payment-links/${id}`),
}

// Payment config
export const paymentConfigApi = {
  get: () => api.get<any>('/tenant/payment-config'),
  save: (data: { mp_access_token?: string; mp_public_key?: string }) =>
    request<any>('/tenant/payment-config', { method: 'PUT', body: JSON.stringify(data) }),
}
