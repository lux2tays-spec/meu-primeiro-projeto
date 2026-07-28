'use client'
import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { tenantApi, getToken, friendlyMessage } from '@/lib/api'
import { getTokenPayload } from '@/lib/auth'
import Loading from '@/components/ui/Loading'

type ProCommission = {
  commission_enabled: boolean
  commission_type: 'percent' | 'fixed'
  commission_value: number
}

// CFG-6: duração/preço aceitam '' enquanto o usuário edita — nunca viram 0
// silenciosamente ao limpar o campo; a validação exige valor antes de salvar.
type FormState = {
  name: string
  description: string
  duration_minutes: number | ''
  price: number | ''
  reminder_days: number | null
  professional_ids: string[]
  commissions: Record<string, ProCommission>
}

const BLANK_COMMISSION: ProCommission = { commission_enabled: false, commission_type: 'percent', commission_value: 0 }

const BLANK: FormState = { name: '', description: '', duration_minutes: 60, price: 0, reminder_days: null, professional_ids: [], commissions: {} }

// Payload for POST/PUT /tenant/services: rich `professionals` array (with commission)
// instead of the legacy `professional_ids`.
function buildPayload(form: FormState) {
  const { professional_ids, commissions, ...rest } = form
  return {
    ...rest,
    duration_minutes: Number(form.duration_minutes),
    price: Number(form.price),
    professionals: professional_ids.map((id) => ({
      id,
      ...(commissions[id] ?? BLANK_COMMISSION),
    })),
  }
}

// CFG-6: valida campos obrigatórios antes de gravar (retorna mensagem ou null).
function validateForm(form: FormState): string | null {
  if (!form.name.trim()) return 'Informe o nome do serviço.'
  if (form.duration_minutes === '' || Number(form.duration_minutes) <= 0) return 'Informe a duração do serviço (em minutos).'
  if (form.price === '' || Number(form.price) < 0) return 'Informe o preço do serviço.'
  return null
}

const inputCls = 'w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary'

// NOTE: must live at module scope. If defined inside ServicesPage, a new component
// type is created on every render, so React remounts the fields on each keystroke
// and the input loses focus.
function FormFields({ form, setForm, professionals }: {
  form: FormState
  setForm: React.Dispatch<React.SetStateAction<FormState>>
  professionals: any[]
}) {
  function togglePro(id: string) {
    setForm((f) => ({
      ...f,
      professional_ids: f.professional_ids.includes(id)
        ? f.professional_ids.filter((x) => x !== id)
        : [...f.professional_ids, id],
      commissions: f.commissions[id] ? f.commissions : { ...f.commissions, [id]: BLANK_COMMISSION },
    }))
  }

  function setCommission(id: string, patch: Partial<ProCommission>) {
    setForm((f) => ({
      ...f,
      commissions: { ...f.commissions, [id]: { ...(f.commissions[id] ?? BLANK_COMMISSION), ...patch } },
    }))
  }

  return (
    <div className="space-y-4 mt-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-600 mb-1">Nome do serviço *</label>
          <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className={inputCls} placeholder="Limpeza de pele" required />
        </div>
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-600 mb-1">Descrição (opcional)</label>
          <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            className={inputCls} placeholder="Descrição do serviço" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Duração (min) *</label>
          <input type="number" value={form.duration_minutes}
            onChange={(e) => setForm((f) => ({ ...f, duration_minutes: e.target.value === '' ? '' : Number(e.target.value) }))}
            className={inputCls} min={15} step={15} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Preço (R$) *</label>
          <input type="number" value={form.price}
            onChange={(e) => setForm((f) => ({ ...f, price: e.target.value === '' ? '' : Number(e.target.value) }))}
            className={inputCls} min={0} step={0.01} />
        </div>
      </div>

      {/* Período de lembrete */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Período para lembrar os clientes (dias)</label>
        <p className="text-xs text-gray-400 mb-2">
          O cliente receberá uma mensagem via WhatsApp após esse período sugerindo agendar novamente.
          Deixe vazio ou 0 para desativar.
        </p>
        <div className="flex items-center gap-3">
          <input
            type="number"
            min={0}
            step={1}
            value={form.reminder_days ?? ''}
            onChange={(e) => setForm((f) => ({
              ...f,
              reminder_days: e.target.value === '' ? null : Math.max(0, Math.floor(Number(e.target.value) || 0)),
            }))}
            className="w-28 h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary text-center"
            placeholder="Ex.: 30"
          />
          <span className="text-xs text-gray-500">dias</span>
        </div>
      </div>

      {/* Profissionais */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-2">Profissionais que realizam este serviço</label>
        {professionals.length === 0 ? (
          <p className="text-xs text-gray-400 italic">
            Nenhum profissional cadastrado ainda. Vá em{' '}
            <a href="/settings/staff" className="text-primary underline">Colaboradores</a> e habilite alguém para prestar serviços.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {professionals.map((p) => {
                const sel = form.professional_ids.includes(p.id)
                return (
                  <button key={p.id} type="button" onClick={() => togglePro(p.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                      sel
                        ? 'bg-primary text-white border-primary'
                        : 'bg-white text-gray-600 border-gray-200 hover:border-primary hover:text-primary'
                    }`}>
                    {p.name}
                  </button>
                )
              })}
            </div>

            {/* Comissão por profissional selecionado */}
            {form.professional_ids.length > 0 && (
              <div className="mt-3 space-y-2">
                <p className="text-xs text-gray-400">
                  Comissão paga ao profissional por este serviço (percentual do valor ou valor fixo).
                </p>
                {form.professional_ids.map((id) => {
                  const p = professionals.find((x) => x.id === id)
                  if (!p) return null
                  const c = form.commissions[id] ?? BLANK_COMMISSION
                  return (
                    <div key={id} className="rounded-xl border border-gray-100 bg-gray-50/60 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-xs font-semibold text-gray-700 truncate">{p.name}</p>
                        <label className="flex items-center gap-2 cursor-pointer select-none shrink-0">
                          <span className="text-xs text-gray-500">Comissão</span>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={c.commission_enabled}
                            onClick={() => setCommission(id, { commission_enabled: !c.commission_enabled })}
                            className={`relative w-9 h-5 rounded-full transition-colors ${
                              c.commission_enabled ? 'bg-primary' : 'bg-gray-300'
                            }`}
                          >
                            <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                              c.commission_enabled ? 'translate-x-4' : ''
                            }`} />
                          </button>
                        </label>
                      </div>
                      {c.commission_enabled && (
                        <div className="flex items-center gap-2 mt-2">
                          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                            {(['percent', 'fixed'] as const).map((t) => (
                              <button key={t} type="button" onClick={() => setCommission(id, { commission_type: t })}
                                className={`px-3 h-8 text-xs font-medium transition-colors ${
                                  c.commission_type === t ? 'bg-primary text-white' : 'bg-white text-gray-500 hover:text-primary'
                                }`}>
                                {t === 'percent' ? '%' : 'R$'}
                              </button>
                            ))}
                          </div>
                          <input
                            type="number"
                            min={0}
                            step={c.commission_type === 'percent' ? 1 : 0.01}
                            max={c.commission_type === 'percent' ? 100 : undefined}
                            value={c.commission_value}
                            onChange={(e) => setCommission(id, { commission_value: Math.max(0, Number(e.target.value) || 0) })}
                            className="w-28 h-8 px-3 rounded-lg border border-gray-200 text-xs focus:outline-none focus:ring-2 focus:ring-primary"
                            placeholder={c.commission_type === 'percent' ? 'Ex.: 20' : 'Ex.: 15,00'}
                          />
                          <span className="text-xs text-gray-400">
                            {c.commission_type === 'percent' ? '% do valor do serviço' : 'valor fixo por atendimento'}
                          </span>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default function ServicesPage() {
  const qc = useQueryClient()
  // CFG-16: a tela de gestão lista TAMBÉM os serviços desativados (include_inactive).
  // Chave própria para não poluir o cache de ['services'] (que é só dos ativos).
  const { data: services = [], isLoading } = useQuery({ queryKey: ['services', 'manage'], queryFn: () => tenantApi.services(true) })
  const { data: professionals = [] } = useQuery({ queryKey: ['professionals'], queryFn: tenantApi.professionals })

  // CFG-10: papel "staff" só visualiza os serviços — sem criar/editar/excluir.
  // (JWT só é legível no cliente — mesmo padrão da Agenda/Comissões.)
  const [role, setRole] = useState<string | null>(null)
  useEffect(() => { setRole(getTokenPayload(getToken())?.role ?? null) }, [])
  const isManager = role === 'owner' || role === 'admin' || role === 'root'

  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<any>(null)
  const [form, setForm] = useState<FormState>(BLANK)
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  function showSuccess(msg: string) {
    setSuccessMsg(msg)
    setTimeout(() => setSuccessMsg(''), 3000)
  }

  const createMutation = useMutation({
    mutationFn: tenantApi.createService,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['services'] })
      setShowForm(false)
      setForm(BLANK)
      setError('')
      showSuccess('Serviço adicionado com sucesso!')
    },
    onError: (e: any) => setError(e.message),
  })
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: any) => tenantApi.updateService(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['services'] })
      setEditing(null)
      setError('')
      showSuccess('Serviço atualizado!')
    },
    onError: (e: any) => setError(e.message),
  })
  const [deleteError, setDeleteError] = useState('')
  const deleteMutation = useMutation({
    mutationFn: tenantApi.deleteService,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['services'] })
      setDeleteError('')
      showSuccess('Serviço excluído.')
    },
    // CFG-6: falha ao excluir mostra mensagem amigável (nunca erro técnico).
    onError: (e: any) => setDeleteError(friendlyMessage(e, 'Não foi possível excluir o serviço. Tente novamente em instantes.')),
  })

  // CFG-16: ativar/desativar sem excluir — o bot e a agenda só oferecem os ativos.
  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => tenantApi.updateService(id, { active }),
    onSuccess: (_data, { active }) => {
      qc.invalidateQueries({ queryKey: ['services'] })
      setDeleteError('')
      showSuccess(active ? 'Serviço ativado!' : 'Serviço desativado. Ele não será mais oferecido pelo bot nem na agenda.')
    },
    onError: (e: any) => setDeleteError(friendlyMessage(e, 'Não foi possível alterar o status do serviço. Tente novamente.')),
  })

  // CFG-6: valida antes de gravar — impede salvar 0/vazio por engano.
  function submitCreate() {
    const msg = validateForm(form)
    if (msg) { setError(msg); return }
    createMutation.mutate(buildPayload(form))
  }
  function submitUpdate(id: string) {
    const msg = validateForm(form)
    if (msg) { setError(msg); return }
    updateMutation.mutate({ id, data: buildPayload(form) })
  }

  function openEdit(s: any) {
    setEditing(s)
    setError('')
    setForm({
      name: s.name,
      description: s.description ?? '',
      duration_minutes: s.duration_minutes,
      price: Number(s.price),
      reminder_days: s.reminder_days ?? null,
      professional_ids: (s.professionals ?? []).map((p: any) => p.id),
      commissions: Object.fromEntries(
        (s.professionals ?? []).map((p: any) => [p.id, {
          commission_enabled: !!p.commission_enabled,
          commission_type: p.commission_type === 'fixed' ? 'fixed' : 'percent',
          commission_value: Number(p.commission_value ?? 0),
        } satisfies ProCommission]),
      ),
    })
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Serviços</h1>
        {isManager && (
          <button onClick={() => { setShowForm(true); setEditing(null); setForm(BLANK); setError('') }}
            className="bg-primary hover:bg-primary-dark text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors">
            + Novo serviço
          </button>
        )}
      </div>

      {/* Success toast */}
      {successMsg && (
        <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex items-center gap-2 text-green-700 text-sm font-medium">
          <span>✅</span> {successMsg}
        </div>
      )}

      {deleteError && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-600 text-sm">{deleteError}</div>
      )}

      {/* New form */}
      {showForm && !editing && (
        <div className="bg-white rounded-2xl p-5 border border-primary/30 shadow-sm">
          <p className="font-semibold text-gray-900 text-sm">Novo serviço</p>
          <FormFields form={form} setForm={setForm} professionals={professionals as any[]} />
          {error && <p className="text-red-500 text-xs mt-2">{error}</p>}
          <div className="flex gap-2 mt-4">
            <button onClick={submitCreate} disabled={createMutation.isPending}
              className="flex-1 h-10 bg-primary text-white text-sm font-semibold rounded-xl disabled:opacity-50">
              {createMutation.isPending ? 'Salvando...' : 'Salvar'}
            </button>
            <button onClick={() => setShowForm(false)}
              className="flex-1 h-10 border border-gray-200 text-gray-600 text-sm rounded-xl hover:bg-gray-50">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <Loading card />
      ) : (services as any[]).length === 0 ? (
        <div className="bg-white rounded-2xl p-8 text-center border border-gray-100">
          <p className="text-gray-400 text-sm">Nenhum serviço cadastrado</p>
        </div>
      ) : (
        <div className="space-y-3">
          {(services as any[]).map((s) => (
            <div key={s.id} className={`bg-white rounded-2xl p-4 border border-gray-100 shadow-sm ${s.active === false ? 'opacity-70 bg-gray-50' : ''}`}>
              {editing?.id === s.id ? (
                <>
                  <p className="font-semibold text-gray-900 text-sm mb-1">Editando: {s.name}</p>
                  <FormFields form={form} setForm={setForm} professionals={professionals as any[]} />
                  {error && <p className="text-red-500 text-xs mt-2">{error}</p>}
                  <div className="flex gap-2 mt-4">
                    <button onClick={() => submitUpdate(s.id)} disabled={updateMutation.isPending}
                      className="flex-1 h-10 bg-primary text-white text-sm font-semibold rounded-xl disabled:opacity-50">
                      {updateMutation.isPending ? 'Salvando...' : 'Salvar alterações'}
                    </button>
                    <button onClick={() => { setEditing(null); setError('') }}
                      className="flex-1 h-10 border border-gray-200 text-gray-600 text-sm rounded-xl hover:bg-gray-50">
                      Cancelar
                    </button>
                  </div>
                </>
              ) : (
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className={`font-semibold ${s.active === false ? 'text-gray-500' : 'text-gray-900'}`}>{s.name}</p>
                      {s.active === false && (
                        <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-gray-200 text-gray-600">Inativo</span>
                      )}
                    </div>
                    {s.description && <p className="text-gray-400 text-xs mt-0.5">{s.description}</p>}
                    <p className="text-gray-500 text-sm mt-1">
                      {s.duration_minutes} min · R$ {Number(s.price).toFixed(2)}
                    </p>
                    {s.reminder_days > 0 && (
                      <p className="text-amber-600 text-xs mt-1 flex items-center gap-1">
                        🔔 Lembrete em {s.reminder_days} dias
                      </p>
                    )}
                    {s.professionals?.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {s.professionals.map((p: any) => (
                          <span key={p.id} className="text-xs bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full font-medium">
                            {p.name}
                            {p.commission_enabled && (
                              <span className="text-indigo-400">
                                {' · '}
                                {p.commission_type === 'fixed'
                                  ? Number(p.commission_value ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
                                  : `${Number(p.commission_value ?? 0)}%`}
                              </span>
                            )}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  {/* CFG-10: staff não vê ações de gestão */}
                  {isManager && (
                    <div className="flex items-center gap-1 shrink-0">
                      {/* CFG-16: toggle ativo/inativo */}
                      <button
                        type="button"
                        role="switch"
                        aria-checked={s.active !== false}
                        aria-label={s.active !== false ? `Desativar ${s.name}` : `Ativar ${s.name}`}
                        title={s.active !== false ? 'Desativar serviço' : 'Ativar serviço'}
                        disabled={toggleActiveMutation.isPending}
                        onClick={() => toggleActiveMutation.mutate({ id: s.id, active: s.active === false })}
                        className={`relative w-10 h-6 rounded-full transition-colors shrink-0 disabled:opacity-50 ${
                          s.active !== false ? 'bg-primary' : 'bg-gray-300'
                        }`}
                      >
                        <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                          s.active !== false ? 'translate-x-4' : ''
                        }`} />
                      </button>
                      <button onClick={() => openEdit(s)}
                        className="text-gray-400 hover:text-primary text-sm px-3 py-1.5 rounded-lg hover:bg-primary/5 transition-colors font-medium">
                        Editar
                      </button>
                      <button onClick={() => { if (confirm('Excluir este serviço?')) deleteMutation.mutate(s.id) }}
                        className="text-gray-400 hover:text-red-500 text-sm px-3 py-1.5 rounded-lg hover:bg-red-50 transition-colors">
                        Excluir
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
