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
    </div>
  )
}
