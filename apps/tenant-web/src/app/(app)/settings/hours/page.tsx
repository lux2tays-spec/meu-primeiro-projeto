'use client'
import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { tenantApi } from '@/lib/api'

const DAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']

type Row = { day_of_week: number; start_time: string; end_time: string; enabled: boolean }

const DEFAULT_ROWS: Row[] = DAYS.map((_, i) => ({
  day_of_week: i,
  start_time: '09:00',
  end_time: '18:00',
  enabled: i > 0 && i < 6,
}))

export default function HoursPage() {
  const qc = useQueryClient()
  const { data: saved, isLoading } = useQuery({ queryKey: ['hours'], queryFn: () => tenantApi.hours() })
  const [rows, setRows] = useState<Row[]>(DEFAULT_ROWS)
  const [ok, setOk] = useState(false)

  useEffect(() => {
    if (!saved) return
    setRows(DEFAULT_ROWS.map((def) => {
      const match = (saved as any[]).find((r) => r.day_of_week === def.day_of_week)
      return match ? { ...def, start_time: match.start_time.slice(0, 5), end_time: match.end_time.slice(0, 5), enabled: true } : { ...def, enabled: false }
    }))
  }, [saved])

  const mutation = useMutation({
    mutationFn: (data: Row[]) => tenantApi.saveHours(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['hours'] }); setOk(true); setTimeout(() => setOk(false), 2500) },
  })

  function toggle(i: number) { setRows((rs) => rs.map((r, idx) => idx === i ? { ...r, enabled: !r.enabled } : r)) }
  function setTime(i: number, field: 'start_time' | 'end_time', v: string) {
    setRows((rs) => rs.map((r, idx) => idx === i ? { ...r, [field]: v } : r))
  }

  if (isLoading) return <div className="text-gray-400 text-sm">Carregando...</div>

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Horários de funcionamento</h1>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {rows.map((row, i) => (
          <div key={i} className={`flex items-center gap-4 p-4 ${i < rows.length - 1 ? 'border-b border-gray-100' : ''}`}>
            <button
              onClick={() => toggle(i)}
              className={`w-11 h-6 rounded-full transition-colors relative ${row.enabled ? 'bg-primary' : 'bg-gray-200'}`}
            >
              <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${row.enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </button>
            <span className={`w-20 text-sm font-medium ${row.enabled ? 'text-gray-900' : 'text-gray-400'}`}>{DAYS[i]}</span>
            {row.enabled ? (
              <div className="flex items-center gap-2 text-sm">
                <input
                  type="time"
                  value={row.start_time}
                  onChange={(e) => setTime(i, 'start_time', e.target.value)}
                  className="h-9 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <span className="text-gray-400">até</span>
                <input
                  type="time"
                  value={row.end_time}
                  onChange={(e) => setTime(i, 'end_time', e.target.value)}
                  className="h-9 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            ) : (
              <span className="text-gray-400 text-sm">Fechado</span>
            )}
          </div>
        ))}
      </div>

      <button
        onClick={() => mutation.mutate(rows)}
        disabled={mutation.isPending}
        className="w-full h-11 bg-primary hover:bg-primary-dark text-white font-semibold rounded-xl transition-colors disabled:opacity-50"
      >
        {mutation.isPending ? 'Salvando...' : ok ? '✓ Salvo!' : 'Salvar horários'}
      </button>

      <DaysOffSection />
    </div>
  )
}

function DaysOffSection() {
  const qc = useQueryClient()
  const { data: daysOff = [], isLoading } = useQuery({ queryKey: ['days-off'], queryFn: () => tenantApi.daysOff() })
  const { data: professionals = [] } = useQuery({ queryKey: ['professionals'], queryFn: () => tenantApi.professionals() })
  const [form, setForm] = useState({ date: '', professional_id: '', reason: '' })
  const [error, setError] = useState('')

  const addMutation = useMutation({
    mutationFn: () => tenantApi.addDayOff({
      date: form.date,
      professional_id: form.professional_id || null,
      reason: form.reason.trim() || null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['days-off'] })
      setForm({ date: '', professional_id: '', reason: '' })
      setError('')
    },
    onError: (err: any) => setError(err.message),
  })

  const removeMutation = useMutation({
    mutationFn: (id: string) => tenantApi.removeDayOff(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['days-off'] }),
  })

  const inputClass = 'h-9 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white'

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-lg font-bold text-gray-900">Folgas e bloqueios</h2>
        <p className="text-sm text-gray-400">Datas em que não haverá atendimento (feriados, folgas de um profissional...). O bot e a agenda não oferecem horários nessas datas.</p>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {isLoading ? (
          <p className="p-4 text-gray-400 text-sm">Carregando...</p>
        ) : (daysOff as any[]).length === 0 ? (
          <p className="p-4 text-gray-400 text-sm">Nenhuma folga ou bloqueio cadastrado.</p>
        ) : (
          (daysOff as any[]).map((d, i) => (
            <div key={d.id} className={`flex items-center gap-4 p-4 ${i < (daysOff as any[]).length - 1 ? 'border-b border-gray-100' : ''}`}>
              <span className="text-sm font-medium text-gray-900 w-24">
                {new Date(`${d.date}T12:00:00`).toLocaleDateString('pt-BR')}
              </span>
              <span className="text-sm text-gray-700 flex-1">
                {d.professional_name ?? 'Todos os profissionais'}
                {d.reason ? <span className="text-gray-400"> · {d.reason}</span> : null}
              </span>
              <button
                onClick={() => removeMutation.mutate(d.id)}
                disabled={removeMutation.isPending}
                className="text-sm text-red-500 hover:text-red-600 font-medium disabled:opacity-50"
              >
                Remover
              </button>
            </div>
          ))
        )}
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={form.date}
            onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
            className={inputClass}
          />
          <select
            value={form.professional_id}
            onChange={(e) => setForm((f) => ({ ...f, professional_id: e.target.value }))}
            className={inputClass}
          >
            <option value="">Todos os profissionais</option>
            {(professionals as any[]).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input
            type="text"
            value={form.reason}
            onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
            placeholder="Motivo (opcional)"
            className={`${inputClass} flex-1 min-w-[140px]`}
          />
          <button
            onClick={() => form.date && addMutation.mutate()}
            disabled={!form.date || addMutation.isPending}
            className="h-9 px-4 bg-primary hover:bg-primary-dark text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-50"
          >
            {addMutation.isPending ? 'Adicionando...' : 'Adicionar'}
          </button>
        </div>
        {error && <div className="bg-red-50 text-red-600 text-sm rounded-xl px-4 py-2">{error}</div>}
      </div>
    </div>
  )
}
