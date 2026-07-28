import { getToken } from './storage'

export const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000'

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = await getToken()
  let res: Response
  // Abort hung requests so the UI never freezes. AbortSignal.timeout() is NOT
  // available in the Hermes runtime, so we use a manual AbortController + timer
  // (using AbortSignal.timeout here throws on every request → "falha de conexão").
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options?.headers,
      },
      signal: controller.signal,
    })
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      throw new Error('Tempo de conexão esgotado. Verifique sua internet e tente novamente.')
    }
    throw new Error('Falha de conexão. Verifique sua internet.')
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Erro desconhecido' }))
    const e = new Error(err.error ?? `Erro ${res.status}`) as Error & { status?: number }
    // Preserva o HTTP status para as telas decidirem a mensagem/CTA (ex.: 402 = limite de plano).
    e.status = res.status
    throw e
  }

  return res.json()
}

/**
 * True quando o backend recusou a ação por limite do plano (HTTP 402 ou
 * mensagem de limite). As telas usam isso para mostrar o CTA "Ver planos".
 */
export function isPlanLimitError(err: unknown): boolean {
  if ((err as any)?.status === 402) return true
  return /limite/i.test(String((err as any)?.message ?? ''))
}

/** Envelope de paginação padrão do backend. */
export interface Paginated<T> {
  data: T[]
  total: number
  page: number
  limit: number
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

// Branding (public — white-label name/logo/colors with bundled fallback)
export interface BrandingResponse {
  app_name: string
  tagline?: string | null
  support_email?: string | null
  support_whatsapp?: string | null
  privacy_url?: string | null
  terms_url?: string | null
  colors?: {
    primary?: string
    primary_dark?: string
    accent?: string
    sidebar?: string
  }
  assets?: {
    logo?: string | null
    logo_dark?: string | null
    favicon?: string | null
    icon?: string | null
  }
}

export const brandingApi = {
  get: () => api.get<BrandingResponse>('/branding'),
}

// Auth
export const authApi = {
  login: (email: string, password: string) =>
    api.post<{ token: string }>('/auth/login', { email, password }),
  register: (data: {
    name: string
    email: string
    password: string
    phone: string
    business_name: string
    referral_code?: string
  }) =>
    // Backend returns 201 { needs_verification: true } WITHOUT token when the
    // e-mail still needs confirmation; `token` only comes on auto-login flows.
    api.post<{ needs_verification?: boolean; token?: string; tenant_id?: string }>('/auth/register', data),
  forgotPassword: (email: string) =>
    api.post<{ ok: boolean }>('/auth/forgot-password', { email }),
  resendVerification: (email: string) =>
    api.post<{ message: string }>('/auth/resend-verification', { email }),
  deleteAccount: () => api.delete<{ deleted: boolean }>('/auth/account'),
  me: () =>
    api.get<{
      id: string
      name: string
      email: string
      phone: string | null
      role: string
      email_verified: boolean
      business_name: string | null
    }>('/auth/me'),
  updateMe: (data: { name?: string; phone?: string }) =>
    api.patch<{ id: string; name: string; email: string; phone: string | null }>('/auth/me', data),
  changePassword: (current_password: string, new_password: string) =>
    api.post<{ message: string }>('/auth/change-password', { current_password, new_password }),
  changeEmail: (new_email: string, password: string) =>
    api.post<{ sent: boolean; message: string }>('/auth/change-email', { new_email, password }),
}

// Tenant
export const tenantApi = {
  me: () => api.get<any>('/tenant/me'),
  updateBusiness: (data: {
    name: string
    contact_email?: string | null
    contact_phone?: string | null
    responsible_name?: string | null
  }) => api.put<any>('/tenant/business', data),
  /** Lista serviços ativos; `includeInactive` traz também os desativados (telas de gestão). */
  services: (includeInactive = false) =>
    api.get<any[]>(`/tenant/services${includeInactive ? '?include_inactive=1' : ''}`),
  createService: (data: any) => api.post<any>('/tenant/services', data),
  updateService: (id: string, data: any) => api.put<any>(`/tenant/services/${id}`, data),
  deleteService: (id: string) => api.delete<any>(`/tenant/services/${id}`),
  professionals: () => api.get<any[]>('/tenant/professionals'),
  addProfessional: (data: any) => api.post<any>('/tenant/professionals', data),
  removeProfessional: (id: string) => api.delete<any>(`/tenant/professionals/${id}`),
  staff: () => api.get<any[]>('/tenant/staff'),
  addStaff: (data: any) => api.post<any>('/tenant/staff', data),
  editStaff: (id: string, data: { name?: string; email?: string; phone?: string | null; role?: string }) =>
    api.patch<any>(`/tenant/staff/${id}`, data),
  removeStaff: (id: string) => api.delete<any>(`/tenant/staff/${id}`),
  daysOff: () => api.get<any[]>('/tenant/days-off'),
  addDayOff: (data: { date: string; professional_id?: string | null; reason?: string | null }) =>
    api.post<any>('/tenant/days-off', data),
  removeDayOff: (id: string) => api.delete<any>(`/tenant/days-off/${id}`),
  customers: (search?: string) =>
    api.get<any[]>(`/tenant/customers${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  customer: (id: string) => api.get<any>(`/tenant/customers/${id}`),
  addCustomer: (data: { name: string; last_name?: string; phone: string; email?: string }) =>
    api.post<any>('/tenant/customers', data),
  updateCustomer: (id: string, data: { name?: string; last_name?: string; email?: string; phone?: string }) =>
    api.put<any>(`/tenant/customers/${id}`, data),
  onboarding: () =>
    api.get<{
      completed: boolean
      steps: { key: string; done: boolean }[]
      progress: { done: number; total: number }
    }>('/tenant/onboarding'),
  completeOnboarding: () =>
    api.post<{ completed: true }>('/tenant/onboarding/complete', {}),
  businessTypeTemplates: () =>
    api.get<{ business_type: string; display_name: string }[]>('/tenant/business-type-templates'),
  applyBusinessTemplate: (business_type: string) =>
    api.post<any>('/tenant/apply-business-template', { business_type }),
}

// Appointments
export const appointmentsApi = {
  list: (date?: string) =>
    api.get<any[]>(`/appointments${date ? `?date=${date}` : ''}`),
  search: (params: {
    date?: string
    from?: string
    to?: string
    search?: string
    professional_id?: string
    service_id?: string
  }) => {
    const qs = new URLSearchParams()
    if (params.date) qs.set('date', params.date)
    if (params.from) qs.set('from', params.from)
    if (params.to) qs.set('to', params.to)
    if (params.search) qs.set('search', params.search)
    if (params.professional_id) qs.set('professional_id', params.professional_id)
    if (params.service_id) qs.set('service_id', params.service_id)
    const q = qs.toString()
    return api.get<any[]>(`/appointments${q ? `?${q}` : ''}`)
  },
  create: (data: any) => api.post<any>('/appointments', data),
  updateStatus: (id: string, status: string) =>
    api.patch<any>(`/appointments/${id}/status`, { status }),
  bulkReschedule: (data: { from: string; to: string; professional_id?: string; message?: string }) =>
    api.post<{ affected: number; notified: number }>('/appointments/bulk-reschedule', data),
}

// Agent
export const agentApi = {
  getConfig: () => api.get<any>('/agent/config'),
  updateConfig: (data: any) => api.patch<any>('/agent/config', data),
  uploadCatalog: async (uri: string, filename: string, mimeType: string): Promise<{ name: string; url: string }> => {
    const token = await getToken()
    const body = new FormData()
    body.append('file', { uri, name: filename, type: mimeType } as any)
    let res: Response
    // Uploads são mais lentos — timeout de 60s via AbortController (AbortSignal.timeout
    // não existe no Hermes e lançaria erro em todo envio).
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 60000)
    try {
      res = await fetch(`${BASE_URL}/agent/config/upload`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body,
        signal: controller.signal,
      })
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        throw new Error('Tempo de envio esgotado. Verifique sua internet e tente novamente.')
      }
      throw new Error('Falha de conexão. Verifique sua internet.')
    } finally {
      clearTimeout(timer)
    }
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
  disconnect: () => api.post<any>('/whatsapp/disconnect', {}),
}

// Google
export const googleApi = {
  loginWithIdToken: (idToken: string, businessName?: string, phone?: string, referralCode?: string) =>
    api.post<{ token: string; is_new: boolean; tenant_id?: string }>('/auth/google', {
      id_token: idToken,
      business_name: businessName,
      phone,
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
  get: (id: string) => api.get<any>(`/tenant/customers/${id}`),
  create: (data: { name: string; last_name?: string; phone: string; email?: string }) =>
    api.post<any>('/tenant/customers', data),
  update: (id: string, data: { name?: string; last_name?: string; email?: string; phone?: string }) =>
    api.put<any>(`/tenant/customers/${id}`, data),
  remove: (id: string) => api.delete<any>(`/tenant/customers/${id}`),
}

// Profissionais (edição direta + criação sem acesso ao app)
export const professionalsApi = {
  /** Cria um profissional; sem `user_id` ele não tem acesso ao app (apenas agenda/comissões). */
  create: (data: { name: string; phone?: string; bio?: string; user_id?: string }) =>
    api.post<any>('/professionals', data),
  update: (id: string, data: { name: string; phone?: string | null; bio?: string | null }) =>
    api.patch<any>(`/professionals/${id}`, data),
}

/** Full display name for a customer: `name` + optional `last_name`. */
export function customerFullName(c: { name?: string | null; last_name?: string | null } | null | undefined): string {
  if (!c) return ''
  return [c.name, c.last_name].map((s) => (s ?? '').trim()).filter(Boolean).join(' ')
}

// Financeiro
export const financeiroApi = {
  resumo: (month: number, year: number) =>
    api.get<any>(`/financeiro/resumo?month=${month}&year=${year}`),
  vendas: (month: number, year: number) =>
    api.get<any[]>(`/financeiro/vendas?month=${month}&year=${year}`),
  /** Lista paginada de vendas — com page/limit o backend responde { data, total, page, limit }. */
  vendasPaged: (month: number, year: number, page: number, limit = 20) =>
    api.get<Paginated<any>>(`/financeiro/vendas?month=${month}&year=${year}&page=${page}&limit=${limit}`),
  paymentLinks: () => api.get<any[]>('/financeiro/payment-links'),
  createPaymentLink: (data: { title: string; description?: string; amount: number }) =>
    api.post<any>('/financeiro/payment-links', data),
  deletePaymentLink: (id: string) => api.delete<any>(`/financeiro/payment-links/${id}`),
}

// Comissões
export interface CommissionItem {
  id: string
  amount: number
  status: 'pending' | 'paid'
  service_name: string
  customer_name: string
  customer_last_name?: string | null
  professional_name: string
  starts_at: string
}
export interface CommissionsResponse {
  data: CommissionItem[]
  totals: { pending_amount: number; paid_amount: number; count: number }
}
export const commissionsApi = {
  list: (params?: { professional_id?: string; status?: 'pending' | 'paid'; from?: string; to?: string }) => {
    const qs = new URLSearchParams()
    if (params?.professional_id) qs.set('professional_id', params.professional_id)
    if (params?.status) qs.set('status', params.status)
    if (params?.from) qs.set('from', params.from)
    if (params?.to) qs.set('to', params.to)
    const q = qs.toString()
    return api.get<CommissionsResponse>(`/commissions${q ? `?${q}` : ''}`)
  },
  pay: (body: { ids?: string[]; professional_id?: string; from?: string; to?: string }) =>
    api.post<{ paid_count: number }>('/commissions/pay', body),
  /** Estorno: reverte comissões pagas para pendente (owner/admin). */
  refund: (body: { ids?: string[]; professional_id?: string; from?: string; to?: string }) =>
    api.post<{ refunded_count?: number }>('/commissions/refund', body),
}

// Subscription (platform plans + transparent checkout)
export const subscriptionApi = {
  plans: () =>
    api.get<Array<{
      slug: string
      name: string
      description?: string | null
      price_cents: number
      max_agendas: number
      max_users: number
    }>>('/subscription/plans'),
  paymentInfo: () =>
    api.get<{ available: boolean; public_key: string | null }>('/subscription/payment-info'),
  checkout: (plan: string, cardTokenId: string) =>
    api.post<{ status?: string }>('/subscription/checkout', { plan, card_token_id: cardTokenId }),
  me: () => api.get<any>('/subscription/me'),
  cancel: () => api.post<{ ok: boolean }>('/subscription/cancel', {}),
}

// Mercado Pago card tokenization (transparent checkout).
// The card data goes DIRECTLY to Mercado Pago over TLS using the platform's
// PUBLIC key — it never touches our backend and must never be logged.
// Deliberately a plain fetch (no `api` helper): MP's public endpoint must not
// receive our JWT.
export interface CardTokenInput {
  cardNumber: string // digits only
  cardholderName: string
  expirationMonth: number
  expirationYear: number // 4-digit
  securityCode: string
  cpf: string // digits only
}

export async function createCardToken(publicKey: string, card: CardTokenInput): Promise<string> {
  let res: Response
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  try {
    res = await fetch(
      `https://api.mercadopago.com/v1/card_tokens?public_key=${encodeURIComponent(publicKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          card_number: card.cardNumber,
          security_code: card.securityCode,
          expiration_month: card.expirationMonth,
          expiration_year: card.expirationYear,
          cardholder: {
            name: card.cardholderName,
            identification: { type: 'CPF', number: card.cpf },
          },
        }),
        signal: controller.signal,
      }
    )
  } catch {
    throw new Error('Falha de conexão. Verifique sua internet e tente novamente.')
  } finally {
    clearTimeout(timer)
  }

  const data: any = await res.json().catch(() => null)
  if (!res.ok || !data?.id) {
    // Never surface Mercado Pago's raw error payload to the user.
    throw new Error('Não foi possível validar o cartão. Confira os dados e tente novamente.')
  }
  return String(data.id)
}

// Suporte (assistente IA + chamados)
export interface SupportChatTurn {
  role: 'user' | 'assistant'
  content: string
}
export interface SupportAskResponse {
  reply: string
  suggest_ticket: boolean
}
export type SupportTicketStatus = 'open' | 'resolved'
export type SupportTicketPriority = 'normal' | 'high'
export interface SupportTicketSummary {
  id: string
  subject: string
  status: SupportTicketStatus
  priority: SupportTicketPriority
  created_at: string
  updated_at: string
  last_message: string
}
export interface SupportTicketMessage {
  id: string
  sender: 'user' | 'admin'
  body: string
  created_at: string
}
export interface SupportTicketDetail {
  id: string
  subject: string
  status: SupportTicketStatus
  priority: SupportTicketPriority
  created_at: string
  messages: SupportTicketMessage[]
}
export const supportApi = {
  ask: (message: string, history?: SupportChatTurn[]) =>
    api.post<SupportAskResponse>('/support/ask', { message, history }),
  tickets: () => api.get<SupportTicketSummary[]>('/support/tickets'),
  createTicket: (data: { subject: string; message: string; priority?: SupportTicketPriority }) =>
    api.post<SupportTicketSummary>('/support/tickets', data),
  ticket: (id: string) => api.get<SupportTicketDetail>(`/support/tickets/${id}`),
  replyTicket: (id: string, body: string) =>
    api.post<{ ok: boolean }>(`/support/tickets/${id}/messages`, { body }),
}

// Payment config
export const paymentConfigApi = {
  get: () => api.get<any>('/tenant/payment-config'),
  save: (data: { mp_access_token?: string; mp_public_key?: string }) =>
    request<any>('/tenant/payment-config', { method: 'PUT', body: JSON.stringify(data) }),
}
