'use client'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter, useSearchParams } from 'next/navigation'
import { tenantApi, appointmentsApi } from '@/lib/api'

// Local date (not UTC) so the default day doesn't jump ahead in the evening (BRT).
function localToday() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Full display name: "Nome Sobrenome" (last_name is optional).
function fullName(c: { name?: string | null; last_name?: string | null }) {
  return [c?.name, c?.last_name].filter(Boolean).join(' ')
}

const inputClass = 'w-full h-11 px-4 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white'

type SelectedCustomer = { id: string; name: string; last_name?: string | null; phone: string }

/**
 * Client step (#5b): search existing customers by nome/telefone, or create a
 * new one inline ("+ Novo cliente") — the typed search text carries into the
 * Nome field (#7). On pick/create, booking continues with that customer.
 */
function CustomerStep({ selected, onSelect }: { selected: SelectedCustomer | null; onSelect: (c: SelectedCustomer | null) => void }) {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [newForm, setNewForm] = useState({ name: '', last_name: '', phone: '', email: '' })
  const [newError, setNewError] = useState('')

  const { data: customers = [], isLoading, isError } = useQuery({
    queryKey: ['customers', search],
    queryFn: () => tenantApi.customers(search || undefined),
    enabled: !selected && !showNew,
  })

  const createMutation = useMutation({
    mutationFn: () =>
      tenantApi.addCustomer({
        name: newForm.name.trim(),
        last_name: newForm.last_name.trim() || undefined,
        phone: newForm.phone.trim(),
        email: newForm.email.trim() || undefined,
      }),
    onSuccess: (created: any) => {
      qc.invalidateQueries({ queryKey: ['customers'] })
      setShowNew(false)
      setNewForm({ name: '', last_name: '', phone: '', email: '' })
      // Select the freshly created customer and continue booking.
      onSelect({ id: created.id, name: created.name ?? newForm.name.trim(), last_name: created.last_name ?? (newForm.last_name.trim() || null), phone: created.phone ?? newForm.phone.trim() })
    },
    onError: (e: any) => setNewError(e?.message || 'Não foi possível criar o cliente. Tente novamente.'),
  })

  function openNew() {
    // #7 — carry the typed search text into the Nome field.
    setNewForm({ name: search.trim(), last_name: '', phone: '', email: '' })
    setNewError('')
    setShowNew(true)
  }

  function submitNew() {
    setNewError('')
    if (!newForm.name.trim()) return setNewError('Informe o nome do cliente')
    if (!newForm.phone.trim()) return setNewError('Informe o telefone (WhatsApp)')
    createMutation.mutate()
  }

  if (selected) {
    return (
      <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-gray-400 mb-0.5">Cliente</p>
          <p className="text-sm font-semibold text-gray-900 truncate">{fullName(selected) || selected.phone}</p>
          <p className="text-xs text-gray-500">{selected.phone}</p>
        </div>
        <button
          type="button"
          onClick={() => onSelect(null)}
          className="text-primary text-sm font-medium hover:underline shrink-0"
        >
          Trocar
        </button>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900">Cliente</h2>
        {!showNew && (
          <button type="button" onClick={openNew} className="text-primary text-sm font-semibold hover:underline">
            + Novo cliente
          </button>
        )}
      </div>

      {showNew ? (
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Nome *</label>
            <input
              value={newForm.name}
              onChange={e => setNewForm(f => ({ ...f, name: e.target.value }))}
              className={inputClass}
              placeholder="Nome do cliente"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Sobrenome</label>
            <input
              value={newForm.last_name}
              onChange={e => setNewForm(f => ({ ...f, last_name: e.target.value }))}
              className={inputClass}
              placeholder="Sobrenome do cliente"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Telefone (WhatsApp) *</label>
            <input
              type="tel"
              value={newForm.phone}
              onChange={e => setNewForm(f => ({ ...f, phone: e.target.value }))}
              className={inputClass}
              placeholder="5511999999999"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">E-mail (opcional)</label>
            <input
              type="email"
              value={newForm.email}
              onChange={e => setNewForm(f => ({ ...f, email: e.target.value }))}
              className={inputClass}
              placeholder="email@exemplo.com"
            />
          </div>

          {newError && <p className="text-red-500 text-xs">{newError}</p>}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={submitNew}
              disabled={createMutation.isPending}
              className="flex-1 h-10 bg-primary text-white text-sm font-semibold rounded-xl disabled:opacity-50"
            >
              {createMutation.isPending ? 'Salvando...' : 'Adicionar e continuar'}
            </button>
            <button
              type="button"
              onClick={() => setShowNew(false)}
              className="flex-1 h-10 border border-gray-200 text-gray-600 text-sm rounded-xl hover:bg-gray-50"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            className={inputClass}
            placeholder="Buscar por nome ou telefone..."
          />

          {isLoading ? (
            <p className="text-gray-400 text-sm">Buscando clientes...</p>
          ) : isError ? (
            <p className="text-red-500 text-sm">Não foi possível carregar os clientes. Tente novamente.</p>
          ) : (customers as any[]).length === 0 ? (
            <div className="text-center py-3">
              <p className="text-gray-400 text-sm">Nenhum cliente encontrado</p>
              <button type="button" onClick={openNew} className="text-primary text-sm font-semibold hover:underline mt-1">
                + Cadastrar {search.trim() ? `“${search.trim()}”` : 'novo cliente'}
              </button>
            </div>
          ) : (
            <div className="divide-y divide-gray-50 border border-gray-100 rounded-xl overflow-hidden">
              {(customers as any[]).slice(0, 8).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onSelect({ id: c.id, name: c.name, last_name: c.last_name, phone: c.phone })}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {c.name === c.phone ? <span className="text-gray-400 italic">Nome não informado</span> : fullName(c)}
                    </p>
                    <p className="text-xs text-gray-500">{c.phone}</p>
                  </div>
                  <span className="text-primary text-xs font-semibold shrink-0">Selecionar</span>
                </button>
              ))}
              {(customers as any[]).length > 8 && (
                <p className="px-4 py-2 text-xs text-gray-400">Refine a busca para ver mais resultados...</p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// SAL-17: serviço só é oferecido se o profissional escolhido o executa (ou se o
// serviço não tem profissionais vinculados — nesse caso não gera comissão mesmo).
function serviceAllowedFor(s: any, proId: string) {
  if (!proId) return true
  if (!s.professionals?.length) return true
  return (s.professionals as any[]).some((p) => p.id === proId)
}

function NewAppointmentContent() {
  const router = useRouter()
  const [customer, setCustomer] = useState<SelectedCustomer | null>(null)
  const [form, setForm] = useState({ professional_id: '', service_id: '', date: localToday(), slot: '', notes: '' })
  const [error, setError] = useState('')

  // SAL-22: chegando de Clientes → "Novo agendamento", o cliente já vem selecionado.
  const params = useSearchParams()
  const preselectId = params.get('customer_id')
  const { data: preCustomer } = useQuery({
    queryKey: ['customer', preselectId],
    queryFn: () => tenantApi.customer(preselectId!),
    enabled: !!preselectId,
  })
  const preselectApplied = useRef(false)
  useEffect(() => {
    if (preselectApplied.current || !preCustomer) return
    preselectApplied.current = true
    setCustomer({
      id: preCustomer.id,
      name: preCustomer.name,
      last_name: preCustomer.last_name ?? null,
      phone: preCustomer.phone,
    })
  }, [preCustomer])

  const { data: professionals = [], isLoading: loadingPros } = useQuery({ queryKey: ['professionals'], queryFn: tenantApi.professionals })
  const { data: services = [] } = useQuery({ queryKey: ['services'], queryFn: () => tenantApi.services() })
  const { data: slots = [] } = useQuery({
    queryKey: ['slots', form.professional_id, form.service_id, form.date],
    queryFn: () => appointmentsApi.slots(form.professional_id, form.service_id, form.date),
    enabled: !!(form.professional_id && form.service_id && form.date),
  })

  const mutation = useMutation({
    mutationFn: (data: any) => appointmentsApi.create(data),
    onSuccess: () => router.push('/calendar'),
    onError: (err: any) => setError(err.message),
  })

  function set(k: string, v: string) { setForm((f) => ({ ...f, [k]: v })) }

  // SAL-17: lista de serviços filtrada pelo profissional escolhido.
  const availableServices = useMemo(
    () => (services as any[]).filter((s) => serviceAllowedFor(s, form.professional_id)),
    [services, form.professional_id],
  )
  const selectedProName = (professionals as any[]).find((p) => p.id === form.professional_id)?.name

  function setProfessional(proId: string) {
    setForm((f) => {
      const current = (services as any[]).find((s) => s.id === f.service_id)
      const keepService = !!current && serviceAllowedFor(current, proId)
      // Trocar de profissional sempre zera o horário (os slots mudam).
      return { ...f, professional_id: proId, service_id: keepService ? f.service_id : '', slot: '' }
    })
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!customer) { setError('Selecione o cliente'); return }
    if (!form.slot) { setError('Selecione um horário'); return }
    mutation.mutate({
      customer_id: customer.id,
      professional_id: form.professional_id,
      service_id: form.service_id,
      starts_at: form.slot,
      notes: form.notes || undefined,
    })
  }

  const selectClass = inputClass

  return (
    <div className="max-w-lg space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} className="text-gray-400 hover:text-gray-600 text-xl">←</button>
        <h1 className="text-2xl font-bold text-gray-900">Novo agendamento</h1>
      </div>

      {!loadingPros && (professionals as any[]).length === 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3">
          <span className="text-amber-500 text-lg">⚠️</span>
          <div>
            <p className="text-sm font-semibold text-amber-800">Nenhum profissional cadastrado</p>
            <p className="text-xs text-amber-700 mt-0.5">
              Vá em{' '}
              <a href="/settings/staff" className="underline font-medium">Configurações → Equipe</a>{' '}
              e adicione um membro à equipe.
            </p>
          </div>
        </div>
      )}

      {/* Step 1 — client (search or create) */}
      <CustomerStep selected={customer} onSelect={(c) => { setCustomer(c); setError('') }} />

      {/* Step 2 — booking (service, professional, date/time) */}
      {customer && (
        <form onSubmit={handleSubmit} className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Profissional</label>
            {loadingPros ? (
              <p className="text-sm text-gray-400">Carregando profissionais...</p>
            ) : (professionals as any[]).length === 0 ? (
              <p className="text-sm text-gray-400 italic">Nenhum profissional disponível.</p>
            ) : (
              <select value={form.professional_id} onChange={(e) => setProfessional(e.target.value)} className={selectClass} required>
                <option value="">Selecione o profissional</option>
                {(professionals as any[]).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Serviço</label>
            {/* SAL-17: profissional escolhido não executa nenhum serviço → aviso claro */}
            {form.professional_id && availableServices.length === 0 ? (
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                <p className="text-sm font-semibold text-amber-800">
                  {selectedProName ?? 'Este profissional'} não realiza nenhum serviço cadastrado
                </p>
                <p className="text-xs text-amber-700 mt-0.5">
                  Vincule os serviços em{' '}
                  <a href="/settings/services" className="underline font-medium">Configurações → Serviços</a>{' '}
                  ou escolha outro profissional. Agendar sem vínculo não gera comissão.
                </p>
              </div>
            ) : (
              <>
                <select value={form.service_id} onChange={(e) => set('service_id', e.target.value)} className={selectClass} required>
                  <option value="">Selecione o serviço</option>
                  {availableServices.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.duration_minutes} min · R$ {Number(s.price).toFixed(2)}</option>)}
                </select>
                {form.professional_id && availableServices.length < (services as any[]).length && (
                  <p className="text-xs text-gray-400 mt-1">
                    Mostrando apenas os serviços que {selectedProName ?? 'este profissional'} realiza.
                  </p>
                )}
              </>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Data</label>
            <input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} className={selectClass} required />
          </div>

          {form.professional_id && form.service_id && form.date && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Horário</label>
              {slots.length === 0 ? (
                <p className="text-gray-400 text-sm">Nenhum horário disponível nesta data</p>
              ) : (
                // UI-9: responsivo — 3 colunas no mobile, 4 em telas maiores
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {(slots as string[]).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => set('slot', s)}
                      className={`py-2 rounded-xl text-sm font-medium transition-colors ${
                        form.slot === s ? 'bg-primary text-white' : 'bg-gray-100 text-gray-700 hover:bg-primary-light hover:text-primary'
                      }`}
                    >
                      {new Date(s).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Observações (opcional)</label>
            <textarea
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              rows={3}
              className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none"
              placeholder="Ex: cliente prefere horário no início da tarde..."
            />
          </div>

          {error && <div className="bg-red-50 text-red-600 text-sm rounded-xl px-4 py-3">{error}</div>}

          <button
            type="submit"
            disabled={mutation.isPending}
            className="w-full h-11 bg-primary hover:bg-primary-dark text-white font-semibold rounded-xl transition-colors disabled:opacity-50"
          >
            {mutation.isPending ? 'Agendando...' : 'Confirmar agendamento'}
          </button>
        </form>
      )}
    </div>
  )
}

export default function NewAppointmentPage() {
  // useSearchParams (pré-seleção de cliente, SAL-22) exige Suspense no App Router.
  return (
    <Suspense>
      <NewAppointmentContent />
    </Suspense>
  )
}
