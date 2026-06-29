'use client'
import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { tenantApi, appointmentsApi } from '@/lib/api'

export default function NewAppointmentPage() {
  const router = useRouter()
  const [form, setForm] = useState({ customer_id: '', professional_id: '', service_id: '', date: new Date().toISOString().split('T')[0], slot: '', notes: '' })
  const [error, setError] = useState('')

  const { data: customers = [] } = useQuery({ queryKey: ['customers'], queryFn: () => tenantApi.customers() })
  const { data: professionals = [], isLoading: loadingPros } = useQuery({ queryKey: ['professionals'], queryFn: tenantApi.professionals })
  const { data: services = [] } = useQuery({ queryKey: ['services'], queryFn: tenantApi.services })
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

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.slot) { setError('Selecione um horário'); return }
    mutation.mutate({
      customer_id: form.customer_id,
      professional_id: form.professional_id,
      service_id: form.service_id,
      starts_at: form.slot,
      notes: form.notes || undefined,
    })
  }

  const selectClass = 'w-full h-11 px-4 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white'

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
              <a href="/settings/staff" className="underline font-medium">Configurações → Colaboradores</a>{' '}
              e habilite alguém para prestar serviços.
            </p>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Cliente</label>
          <select value={form.customer_id} onChange={(e) => set('customer_id', e.target.value)} className={selectClass} required>
            <option value="">Selecione o cliente</option>
            {(customers as any[]).map((c) => <option key={c.id} value={c.id}>{c.name} · {c.phone}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Profissional</label>
          {loadingPros ? (
            <p className="text-sm text-gray-400">Carregando profissionais...</p>
          ) : (professionals as any[]).length === 0 ? (
            <p className="text-sm text-gray-400 italic">Nenhum profissional disponível.</p>
          ) : (
            <select value={form.professional_id} onChange={(e) => set('professional_id', e.target.value)} className={selectClass} required>
              <option value="">Selecione o profissional</option>
              {(professionals as any[]).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Serviço</label>
          <select value={form.service_id} onChange={(e) => set('service_id', e.target.value)} className={selectClass} required>
            <option value="">Selecione o serviço</option>
            {(services as any[]).map((s) => <option key={s.id} value={s.id}>{s.name} · {s.duration_minutes} min · R$ {Number(s.price).toFixed(2)}</option>)}
          </select>
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
              <div className="grid grid-cols-4 gap-2">
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
    </div>
  )
}
