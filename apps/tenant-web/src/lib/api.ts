'use client'

export const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000'

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

/**
 * PAY-2 — erro tipado de "limite/assinatura do plano" (HTTP 402).
 * Em vez de redirecionar às cegas (ejetando o usuário do formulário), o erro é
 * propagado para a tela que fez a chamada E um evento global é disparado para o
 * layout mostrar o diálogo "Você atingiu o limite do plano → Ver planos",
 * preservando o contexto da tela.
 */
export class PlanLimitError extends Error {
  constructor(message?: string) {
    super(message || 'Você atingiu o limite do seu plano. Faça upgrade para continuar.')
    this.name = 'PlanLimitError'
  }
}

export const PLAN_LIMIT_EVENT = 'agendabot:plan-limit'

/**
 * Mensagem de erro amigável em pt-BR: usa a mensagem do backend quando ela é um
 * texto curto e legível; caso contrário (JSON de validação, stack, objeto cru),
 * cai no fallback. O usuário final nunca vê erro técnico.
 */
export function friendlyMessage(e: unknown, fallback: string): string {
  const m = (e as any)?.message
  if (typeof m === 'string' && m.trim() && m.length <= 180 && !/^[{[]/.test(m.trim())) return m
  return fallback
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
    // Only bounce to /login for expired sessions on protected calls — never on the
    // login/register/google endpoints, where 401 means "wrong credentials".
    if (res.status === 401 && !path.startsWith('/auth/')) {
      clearToken()
      window.location.href = '/login'
      throw new Error('Sessão expirada')
    }
    // 402 = plano/assinatura — propaga erro tipado e avisa o layout (sem redirect).
    if (res.status === 402) {
      const planErr = new PlanLimitError(typeof err.error === 'string' ? err.error : undefined)
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(PLAN_LIMIT_EVENT, { detail: planErr.message }))
      }
      throw planErr
    }
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

export type BrandingAssetSlot = 'logo' | 'logo_dark' | 'favicon' | 'icon' | 'logo_transparent'

export interface Branding {
  app_name: string
  tagline: string
  support_email: string
  support_whatsapp: string
  privacy_url: string
  terms_url: string
  colors: { primary: string; primary_dark: string; accent: string; sidebar: string }
  // Only present slots; URLs are relative to the backend (prepend BASE_URL)
  assets: Partial<Record<BrandingAssetSlot, string>>
}

export const brandingApi = {
  get: () => api.get<Branding>('/branding'),
}

export const authApi = {
  login: (email: string, password: string) =>
    api.post<{ token: string }>('/auth/login', { email, password }),
  register: (data: { name: string; email: string; phone: string; password: string; business_name: string; referral_code?: string }) =>
    api.post<{ needs_verification: boolean }>('/auth/register', data),
  verifyEmail: (token: string) =>
    api.get<{ token: string; verified: boolean }>(`/auth/verify-email?token=${encodeURIComponent(token)}`),
  resendVerification: (email: string) =>
    api.post<{ message: string }>('/auth/resend-verification', { email }),
  googleAuth: (data: { id_token: string; business_name?: string; phone?: string; referral_code?: string }) =>
    api.post<{ token: string; tenant_id: string; is_new: boolean }>('/auth/google', data),
  forgotPassword: (email: string) =>
    api.post<{ ok: boolean }>('/auth/forgot-password', { email }),
  resetPassword: (token: string, password: string) =>
    api.post<{ ok: boolean }>('/auth/reset-password', { token, password }),
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
  confirmEmailChange: (token: string) =>
    api.get<{ message: string }>(`/auth/confirm-email-change?token=${encodeURIComponent(token)}`),
}

export const tenantApi = {
  me: () => api.get<any>('/tenant/me'),
  /** Lista serviços ativos; `includeInactive` traz também os desativados (telas de gestão — CFG-16). */
  services: (includeInactive = false) =>
    api.get<any[]>(`/tenant/services${includeInactive ? '?include_inactive=1' : ''}`),
  createService: (data: any) => api.post<any>('/tenant/services', data),
  updateService: (id: string, data: any) => api.put<any>(`/tenant/services/${id}`, data),
  deleteService: (id: string) => api.delete(`/tenant/services/${id}`),
  professionals: () => api.get<any[]>('/tenant/professionals'),
  // CFG-7: user_id é OPCIONAL — permite criar profissional sem conta de acesso.
  addProfessional: (data: { name: string; phone?: string | null; bio?: string | null; user_id?: string }) =>
    api.post<any>('/tenant/professionals', data),
  updateProfessional: (id: string, data: { name?: string; phone?: string | null; bio?: string | null }) =>
    api.patch<any>(`/tenant/professionals/${id}`, data),
  removeProfessional: (id: string) => api.delete(`/tenant/professionals/${id}`),
  staff: () => api.get<any[]>('/tenant/staff'),
  addStaff: (data: any) => api.post<any>('/tenant/staff', data),
  editStaff: (id: string, data: { name?: string; email?: string; phone?: string | null; role?: 'owner' | 'admin' | 'staff' }) =>
    api.patch<any>(`/tenant/staff/${id}`, data),
  removeStaff: (id: string) => api.delete(`/tenant/staff/${id}`),
  updateBusiness: (data: { name: string; contact_email?: string | null; contact_phone?: string | null; responsible_name?: string | null }) =>
    api.put<any>('/tenant/business', data),
  customers: (search?: string) =>
    api.get<any[]>(`/tenant/customers${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  // Variante paginada: com page/limit o backend responde { data, total, page, limit }.
  customersPaged: (params: { search?: string; page?: number; limit?: number }) => {
    const qs = new URLSearchParams()
    if (params.search) qs.set('search', params.search)
    qs.set('page', String(params.page ?? 1))
    qs.set('limit', String(params.limit ?? 50))
    return api.get<{ data: any[]; total: number; page: number; limit: number }>(`/tenant/customers?${qs.toString()}`)
  },
  customer: (id: string) => api.get<any>(`/tenant/customers/${id}`),
  updateCustomer: (id: string, data: { name?: string; last_name?: string; email?: string; phone?: string }) =>
    api.put<any>(`/tenant/customers/${id}`, data),
  addCustomer: (data: { name: string; last_name?: string; phone: string; email?: string }) =>
    api.post<any>('/tenant/customers', data),
  deleteCustomer: (id: string) => api.delete<{ deleted: boolean }>(`/tenant/customers/${id}`),
  hours: (professionalId?: string) =>
    api.get<any[]>(`/tenant/hours${professionalId ? `?professional_id=${professionalId}` : ''}`),
  saveHours: (rows: any[], professionalId?: string) =>
    api.post<any>('/tenant/hours', { rows, professional_id: professionalId }),
  daysOff: (professionalId?: string) =>
    api.get<any[]>(`/tenant/days-off${professionalId ? `?professional_id=${professionalId}` : ''}`),
  addDayOff: (data: { professional_id?: string | null; date: string; reason?: string | null }) =>
    api.post<any>('/tenant/days-off', data),
  removeDayOff: (id: string) => api.delete(`/tenant/days-off/${id}`),
  paymentConfig: () => api.get<any>('/tenant/payment-config'),
  savePaymentConfig: (data: any) => api.put<any>('/tenant/payment-config', data),
  onboarding: () =>
    api.get<{
      completed: boolean
      steps: { key: 'negocio' | 'equipe' | 'servicos' | 'horarios' | 'agente' | 'pagamentos' | 'whatsapp'; done: boolean }[]
      progress: { done: number; total: number }
    }>('/tenant/onboarding'),
  completeOnboarding: () => api.post<{ completed: true }>('/tenant/onboarding/complete'),
  businessTypeTemplates: () =>
    api.get<{ business_type: string; display_name: string }[]>('/tenant/business-type-templates'),
  applyBusinessTemplate: (business_type: string) =>
    api.post<any>('/tenant/apply-business-template', { business_type }),
}

export interface ServiceProfessionalCommission {
  id: string
  commission_enabled: boolean
  commission_type: 'percent' | 'fixed'
  commission_value: number
}

export interface CommissionRow {
  id: string
  amount: number
  status: 'pending' | 'paid'
  service_name: string
  customer_name: string
  customer_last_name: string | null
  professional_name: string
  starts_at: string
}

export interface CommissionsResponse {
  data: CommissionRow[]
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
  // SAL-10: estorno — reverte comissões pagas para pendente (mesmos filtros do /pay).
  refund: (body: { ids?: string[]; professional_id?: string; from?: string; to?: string }) =>
    api.post<{ refunded_count: number }>('/commissions/refund', body),
}

export interface FinanceiroResumo {
  mes: number
  ano: number
  total_vendas: number
  receita_total: number
  agendamentos_abertos: number
  // SAL-8 — novos KPIs
  ticket_medio: number
  agendamentos_cancelados: number
  total_agendamentos: number
  taxa_cancelamento: number
  receita_por_profissional: { professional_id: string; professional_nome: string; vendas: number; receita: number }[]
  servicos_mais_vendidos: { service_id: string; servico_nome: string; vendas: number; receita: number }[]
  // Extensão financeira (migration 042)
  receita_outras: number
  faturamento: number
  despesas_fixas: number
  despesas_variaveis: number
  despesas_total: number
  lucro: number
  meta_lucro: number
  meta_vendas: number
  vendas_necessarias: number
  vendas_faltantes: number
  progresso_meta: number
  ticket_base: number
  pct_sobre_venda: number
  meta_inatingivel: boolean
}

export interface Despesa {
  id: string
  descricao: string
  tipo: 'Fixa' | 'Variável'
  subtipo: string
  valor: number | null
  pct: number | null
  data: string
  recorrente: boolean
  is_percent: boolean
  valor_reais: number
}

export interface ExpenseSubtype {
  tipo: 'Fixa' | 'Variável'
  nome: string
  is_percent: boolean
  color: string
  icon: string | null
  custom?: boolean
}

export interface OutraReceita {
  id: string
  descricao: string
  categoria: string
  valor: number
  data: string
}

export interface HistoricoPonto {
  mes: string
  ano: number
  receita: number
  despesa: number
  lucro: number
  meta: number
}

export interface VendasResponse {
  data: any[]
  total: number
  total_valor?: number
  page: number
  limit: number
}

export const financeiroApi = {
  resumo: (month?: number, year?: number) =>
    api.get<FinanceiroResumo>(`/financeiro/resumo${month ? `?month=${month}&year=${year}` : ''}`),
  // SAL-5: paginação real — o backend responde { data, total, page, limit }.
  vendas: (month?: number, year?: number, page = 1, limit = 20) =>
    api.get<VendasResponse>(`/financeiro/vendas?month=${month ?? ''}&year=${year ?? ''}&page=${page}&limit=${limit}`),
  paymentLinks: () => api.get<any[]>('/financeiro/payment-links'),
  createPaymentLink: (data: { title: string; description?: string; amount: number }) =>
    api.post<any>('/financeiro/payment-links', data),
  deletePaymentLink: (id: string) => api.delete(`/financeiro/payment-links/${id}`),
  // Extensão financeira (migration 042)
  despesas: (month: number, year: number) =>
    api.get<Despesa[]>(`/financeiro/despesas?month=${month}&year=${year}`),
  createDespesa: (data: Partial<Despesa> & { descricao: string; tipo: string; subtipo: string; data: string }) =>
    api.post<Despesa>('/financeiro/despesas', data),
  updateDespesa: (id: string, data: Partial<Despesa>) => api.patch<Despesa>(`/financeiro/despesas/${id}`, data),
  deleteDespesa: (id: string) => api.delete(`/financeiro/despesas/${id}`),
  overrideOcorrencia: (id: string, data: { ano: number; mes: number; valor?: number | null; pct?: number | null; skip?: boolean }) =>
    api.patch(`/financeiro/despesas/${id}/ocorrencia`, data),
  outrasReceitas: (month: number, year: number) =>
    api.get<OutraReceita[]>(`/financeiro/outras-receitas?month=${month}&year=${year}`),
  createOutraReceita: (data: { descricao: string; categoria: string; valor: number; data: string }) =>
    api.post<OutraReceita>('/financeiro/outras-receitas', data),
  deleteOutraReceita: (id: string) => api.delete(`/financeiro/outras-receitas/${id}`),
  setMetaLucro: (meta: number) => api.patch<{ ok: boolean; meta_lucro_mensal: number }>('/financeiro/meta-lucro', { meta }),
  expenseSubtypes: () => api.get<ExpenseSubtype[]>('/financeiro/expense-subtypes'),
  historico: (meses = 6) => api.get<HistoricoPonto[]>(`/financeiro/historico?meses=${meses}`),
  createVenda: (data: { customer_id: string; service_id?: string; custom_service?: string; professional_id?: string | null; valor: number; notes?: string; payment_method: string; data?: string }) =>
    api.post<any>('/financeiro/vendas', data),
  // Módulo de Vendas: lista por range de datas (from/to = YYYY-MM-DD) com total.
  vendasRange: (from: string, to: string, page = 1, limit = 50) =>
    api.get<VendasResponse>(`/financeiro/vendas?from=${from}&to=${to}&page=${page}&limit=${limit}`),
  deleteVenda: (id: string) => api.delete(`/financeiro/vendas/${id}`),
  activityLog: () => api.get<any[]>('/financeiro/activity-log'),
}

export interface AppointmentListParams {
  date?: string // YYYY-MM-DD (day view)
  from?: string // ISO instant, inclusive (week/month windows)
  to?: string // ISO instant, exclusive
  search?: string // customer name or phone
  professional_id?: string
  service_id?: string
}

export const appointmentsApi = {
  list: (params?: AppointmentListParams | string) => {
    const p: AppointmentListParams = typeof params === 'string' ? { date: params } : params ?? {}
    const qs = new URLSearchParams()
    if (p.date) qs.set('date', p.date)
    if (p.from) qs.set('from', p.from)
    if (p.to) qs.set('to', p.to)
    if (p.search) qs.set('search', p.search)
    if (p.professional_id) qs.set('professional_id', p.professional_id)
    if (p.service_id) qs.set('service_id', p.service_id)
    const q = qs.toString()
    return api.get<any[]>(`/appointments${q ? `?${q}` : ''}`)
  },
  getById: (id: string) => api.get<any>(`/appointments/${id}`),
  create: (data: any) => api.post<any>('/appointments', data),
  update: (id: string, data: any) => api.put<any>(`/appointments/${id}`, data),
  updateStatus: (id: string, status: string) =>
    api.patch<any>(`/appointments/${id}/status`, { status }),
  slots: (professionalId: string, serviceId: string, date: string) =>
    api.get<string[]>(`/appointments/slots?professional_id=${professionalId}&service_id=${serviceId}&date=${date}`),
  bulkReschedule: (data: { from: string; to: string; professional_id?: string; message?: string }) =>
    api.post<{ affected: number; notified: number }>('/appointments/bulk-reschedule', data),
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

// UI-5: Google Agenda (mesmos endpoints usados pelo app mobile)
export const googleApi = {
  calendarStatus: () =>
    api.get<{ connected: boolean; sync_enabled: boolean; calendar_id?: string }>('/google-calendar/status'),
  calendarConnect: (code: string, redirectUri: string) =>
    api.post<{ connected: boolean }>('/google-calendar/connect', { code, redirect_uri: redirectUri }),
  calendarToggle: (syncEnabled: boolean) =>
    api.patch<{ sync_enabled: boolean }>('/google-calendar/settings', { sync_enabled: syncEnabled }),
  calendarDisconnect: () => api.delete<{ disconnected: boolean }>('/google-calendar/disconnect'),
}

export const whatsappApi = {
  connect: () => api.post<any>('/whatsapp/connect'),
  getQR: () => api.get<any>('/whatsapp/qr'),
  getStatus: () => api.get<any>('/whatsapp/status'),
  disconnect: () => api.post<any>('/whatsapp/disconnect'),
}

export const affiliateApi = {
  me: () => api.get<any>('/affiliate/me'),
}

export interface SupportChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export type SupportTicketStatus = 'open' | 'resolved'

export interface SupportTicketSummary {
  id: string
  subject: string
  status: SupportTicketStatus
  priority: string
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
  priority: string
  created_at: string
  messages: SupportTicketMessage[]
}

export const supportApi = {
  ask: (message: string, history?: SupportChatMessage[]) =>
    api.post<{ reply: string; suggest_ticket: boolean }>('/support/ask', { message, history }),
  tickets: () => api.get<SupportTicketSummary[]>('/support/tickets'),
  createTicket: (data: { subject: string; message: string; priority?: 'normal' | 'alta' }) =>
    api.post<SupportTicketSummary>('/support/tickets', data),
  ticket: (id: string) => api.get<SupportTicketDetail>(`/support/tickets/${id}`),
  replyTicket: (id: string, body: string) =>
    api.post<{ ok: boolean }>(`/support/tickets/${id}/messages`, { body }),
}

export interface AppNotification {
  id: string
  tenant_id: string | null
  type: string
  title: string
  body: string
  link: string | null
  data: Record<string, unknown> | null
  read_at: string | null
  created_at: string
}

export interface NotificationPrefs {
  channel_inapp: boolean
  channel_push: boolean
  channel_email: boolean
  channel_whatsapp: boolean
  evt_appointment_reminder: boolean
  evt_new_customer: boolean
  evt_reschedule: boolean
  evt_confirmation: boolean
  evt_service_completion: boolean
  evt_broadcast: boolean
}

export const notificationsApi = {
  list: (limit = 30) => api.get<{ notifications: AppNotification[]; unread: number }>(`/notifications?limit=${limit}`),
  unreadCount: () => api.get<{ unread: number }>('/notifications/unread-count'),
  markRead: (id: string) => api.patch<{ ok: boolean }>(`/notifications/${id}/read`, {}),
  markAllRead: () => api.post<{ ok: boolean }>('/notifications/read-all', {}),
  preferences: () => api.get<NotificationPrefs>('/notifications/preferences'),
  updatePreferences: (prefs: Partial<NotificationPrefs>) => api.put<NotificationPrefs>('/notifications/preferences', prefs),
}

export const subscriptionApi = {
  plans: () => api.get<any[]>('/subscription/plans'),
  paymentInfo: () => api.get<{ available: boolean; public_key: string | null }>('/subscription/payment-info'),
  checkout: (plan: string, cardTokenId?: string) =>
    api.post<{ status?: string; init_point?: string }>('/subscription/checkout', { plan, card_token_id: cardTokenId }),
  me: () => api.get<any>('/subscription/me'),
  cancel: () => api.post<{ ok: boolean }>('/subscription/cancel'),
}
