'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { tenantApi } from '@/lib/api'

type FormState = {
  name: string
  description: string
  duration_minutes: number
  price: number
  reminder_days: number | null
  professional_ids: string[]
}

const BLANK: FormState = { name: '', description: '', duration_minutes: 60, price: 0, reminder_days: null, professional_ids: [] }

const REMINDER_OPTIONS = [
  { label: 'Sem lembrete', value: null },
  { label: '7 dias', value: 7 },
  { label: '14 dias', value: 14 },
  { label: '21 dias', value: 21 },
  { label: '30 dias', value: 30 },
  { label: '60 dias', value: 60 },
  { label: '90 dias', value: 90 },
]

export default function ServicesPage() {
  const qc = useQueryClient()
  const { data: services = [], isLoading } = useQuery({ queryKey: ['services'], queryFn: tenantApi.services })
  const { data: professionals = [] } = useQuery({ queryKey: ['professionals'], queryFn: tenantApi.professionals })

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
  const deleteMutation = useMutation({
    mutationFn: tenantApi.deleteService,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['services'] })
      showSuccess('Serviço excluído.')
    },
  })

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
    })
  }

  function togglePro(id: string) {
    setForm((f) => ({
      ...f,
      professional_ids: f.professional_ids.includes(id)
        ? f.professional_ids.filter((x) => x !== id)
        : [...f.professional_ids, id],
    }))
  }

  const inputCls = 'w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary'

  const FormFields = () => (
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
            onChange={(e) => setForm((f) => ({ ...f, duration_minutes: Number(e.target.value) }))}
            className={inputCls} min={15} step={15} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Preço (R$) *</label>
          <input type="number" value={form.price}
            onChange={(e) => setForm((f) => ({ ...f, price: Number(e.target.value) }))}
            className={inputCls} min={0} step={0.01} />
        </div>
      </div>

      {/* Período de lembrete */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Período para lembrar os clientes</label>
        <p className="text-xs text-gray-400 mb-2">
          O cliente receberá uma mensagem via WhatsApp após esse período sugerindo agendar novamente.
        </p>
        <div className="flex flex-wrap gap-2">
          {REMINDER_OPTIONS.map((opt) => {
            const sel = form.reminder_days === opt.value
            return (
              <button key={String(opt.value)} type="button"
                onClick={() => setForm((f) => ({ ...f, reminder_days: opt.value }))}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  sel
                    ? 'bg-amber-500 text-white border-amber-500'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-amber-400 hover:text-amber-600'
                }`}>
                {opt.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Profissionais */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-2">Profissionais que realizam este serviço</label>
        {(professionals as any[]).length === 0 ? (
          <p className="text-xs text-gray-400 italic">
            Nenhum profissional cadastrado ainda. Vá em{' '}
            <a href="/settings/staff" className="text-primary underline">Colaboradores</a> e habilite alguém para prestar serviços.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {(professionals as any[]).map((p) => {
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
        )}
      </div>
    </div>
  )

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Serviços</h1>
        <button onClick={() => { setShowForm(true); setEditing(null); setForm(BLANK); setError('') }}
          className="bg-primary hover:bg-primary-dark text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors">
          + Novo serviço
        </button>
      </div>

      {/* Success toast */}
      {successMsg && (
        <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex items-center gap-2 text-green-700 text-sm font-medium">
          <span>✅</span> {successMsg}
        </div>
      )}

      {/* New form */}
      {showForm && !editing && (
        <div className="bg-white rounded-2xl p-5 border border-primary/30 shadow-sm">
          <p className="font-semibold text-gray-900 text-sm">Novo serviço</p>
          <FormFields />
          {error && <p className="text-red-500 text-xs mt-2">{error}</p>}
          <div className="flex gap-2 mt-4">
            <button onClick={() => createMutation.mutate(form)} disabled={createMutation.isPending}
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
        <p className="text-gray-400 text-sm">Carregando...</p>
      ) : (services as any[]).length === 0 ? (
        <div className="bg-white rounded-2xl p-8 text-center border border-gray-100">
          <p className="text-gray-400 text-sm">Nenhum serviço cadastrado</p>
        </div>
      ) : (
        <div className="space-y-3">
          {(services as any[]).map((s) => (
            <div key={s.id} className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
              {editing?.id === s.id ? (
                <>
                  <p className="font-semibold text-gray-900 text-sm mb-1">Editando: {s.name}</p>
                  <FormFields />
                  {error && <p className="text-red-500 text-xs mt-2">{error}</p>}
                  <div className="flex gap-2 mt-4">
                    <button onClick={() => updateMutation.mutate({ id: s.id, data: form })} disabled={updateMutation.isPending}
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
                    <p className="font-semibold text-gray-900">{s.name}</p>
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
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => openEdit(s)}
                      className="text-gray-400 hover:text-primary text-sm px-3 py-1.5 rounded-lg hover:bg-primary/5 transition-colors font-medium">
                      Editar
                    </button>
                    <button onClick={() => { if (confirm('Excluir este serviço?')) deleteMutation.mutate(s.id) }}
                      className="text-gray-400 hover:text-red-500 text-sm px-3 py-1.5 rounded-lg hover:bg-red-50 transition-colors">
                      Excluir
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
