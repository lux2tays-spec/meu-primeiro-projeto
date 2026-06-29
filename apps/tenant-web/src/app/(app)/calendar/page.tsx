'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { appointmentsApi } from '@/lib/api'

const DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']

function toISO(d: Date) { return d.toISOString().split('T')[0] }
function getWeekDates(base: Date) {
  const start = new Date(base)
  start.setDate(base.getDate() - base.getDay())
  return Array.from({ length: 7 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d })
}

const STATUS_COLOR: Record<string, string> = {
  pending: 'border-l-yellow-400 bg-yellow-50',
  confirmed: 'border-l-green-400 bg-green-50',
  completed: 'border-l-blue-400 bg-blue-50',
  cancelled: 'border-l-red-400 bg-red-50 opacity-60',
}
const STATUS_LABEL: Record<string, string> = { pending: 'Pendente', confirmed: 'Confirmado', completed: 'Concluído', cancelled: 'Cancelado' }

export default function CalendarPage() {
  const [selected, setSelected] = useState(new Date())
  const [weekBase, setWeekBase] = useState(new Date())
  const qc = useQueryClient()
  const weekDates = getWeekDates(weekBase)
  const dateStr = toISO(selected)

  const { data: appointments = [], isLoading } = useQuery({
    queryKey: ['appointments', dateStr],
    queryFn: () => appointmentsApi.list(dateStr),
  })

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => appointmentsApi.updateStatus(id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['appointments', dateStr] }),
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Agenda</h1>
        <Link href="/appointments/new" className="bg-primary hover:bg-primary-dark text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors">
          + Novo
        </Link>
      </div>

      {/* Week navigator */}
      <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
        <div className="flex items-center justify-between mb-4">
          <button onClick={() => { const d = new Date(weekBase); d.setDate(d.getDate()-7); setWeekBase(d) }} className="p-2 hover:bg-gray-100 rounded-xl">‹</button>
          <span className="font-semibold text-gray-900">{MONTHS[selected.getMonth()]} {selected.getFullYear()}</span>
          <button onClick={() => { const d = new Date(weekBase); d.setDate(d.getDate()+7); setWeekBase(d) }} className="p-2 hover:bg-gray-100 rounded-xl">›</button>
        </div>
        <div className="grid grid-cols-7 gap-1">
          {weekDates.map((d) => {
            const iso = toISO(d)
            const isSelected = iso === toISO(selected)
            const isToday = iso === toISO(new Date())
            return (
              <button
                key={iso}
                onClick={() => { setSelected(d); setWeekBase(d) }}
                className={`flex flex-col items-center py-2 px-1 rounded-xl text-sm transition-colors ${
                  isSelected ? 'bg-primary text-white' :
                  isToday ? 'border-2 border-primary text-primary' :
                  'hover:bg-gray-100 text-gray-600'
                }`}
              >
                <span className="text-xs font-medium">{DAYS[d.getDay()]}</span>
                <span className="text-base font-bold mt-0.5">{d.getDate()}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Appointments list */}
      <div>
        <p className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
          {selected.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
        {isLoading ? (
          <p className="text-gray-400 text-sm text-center py-8">Carregando...</p>
        ) : appointments.length === 0 ? (
          <div className="bg-white rounded-2xl p-8 text-center border border-gray-100">
            <p className="text-gray-400 text-sm">Nenhum agendamento neste dia</p>
          </div>
        ) : (
          <div className="space-y-3">
            {(appointments as any[]).map((a) => (
              <div key={a.id} className={`bg-white rounded-2xl p-4 border-l-4 shadow-sm ${STATUS_COLOR[a.status] ?? 'border-l-gray-300'}`}>
                <div className="flex items-start justify-between gap-3">
                  <Link href={`/appointments/${a.id}`} className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900">{a.customer_name}</p>
                    <p className="text-gray-500 text-sm">{a.service_name} · {a.professional_name}</p>
                    <p className="text-gray-400 text-xs mt-1">
                      {new Date(a.starts_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                      {' — '}{a.duration_minutes} min · R$ {Number(a.price).toFixed(2)}
                    </p>
                  </Link>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-gray-500">{STATUS_LABEL[a.status]}</span>
                    {a.status === 'pending' && (
                      <button
                        onClick={() => statusMutation.mutate({ id: a.id, status: 'confirmed' })}
                        className="text-xs bg-green-100 text-green-700 hover:bg-green-200 px-2.5 py-1 rounded-lg font-medium transition-colors"
                      >
                        Confirmar
                      </button>
                    )}
                    {a.status === 'confirmed' && (
                      <button
                        onClick={() => statusMutation.mutate({ id: a.id, status: 'completed' })}
                        className="text-xs bg-blue-100 text-blue-700 hover:bg-blue-200 px-2.5 py-1 rounded-lg font-medium transition-colors"
                      >
                        Concluir
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
