'use client'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter, useParams } from 'next/navigation'
import { appointmentsApi } from '@/lib/api'

const STATUS_COLOR: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  confirmed: 'bg-green-100 text-green-700',
  completed: 'bg-blue-100 text-blue-700',
  cancelled: 'bg-red-100 text-red-700',
}
const STATUS_LABEL: Record<string, string> = { pending: 'Pendente', confirmed: 'Confirmado', completed: 'Concluído', cancelled: 'Cancelado' }

export default function AppointmentDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const qc = useQueryClient()

  const { data: appt, isLoading } = useQuery({ queryKey: ['appointment', id], queryFn: () => appointmentsApi.getById(id) })
  const statusMutation = useMutation({
    mutationFn: (status: string) => appointmentsApi.updateStatus(id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['appointment', id] }),
  })

  if (isLoading) return <div className="text-gray-400 text-sm">Carregando...</div>
  if (!appt) return <div className="text-gray-400 text-sm">Agendamento não encontrado</div>

  return (
    <div className="max-w-lg space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} className="text-gray-400 hover:text-gray-600 text-xl">←</button>
        <h1 className="text-2xl font-bold text-gray-900">Agendamento</h1>
      </div>

      <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">{appt.customer_name}</h2>
          <span className={`text-xs font-medium px-3 py-1.5 rounded-full ${STATUS_COLOR[appt.status] ?? 'bg-gray-100 text-gray-600'}`}>
            {STATUS_LABEL[appt.status] ?? appt.status}
          </span>
        </div>

        <div className="space-y-2 text-sm">
          {[
            { label: 'Serviço', value: appt.service_name },
            { label: 'Profissional', value: appt.professional_name },
            { label: 'Telefone', value: appt.customer_phone },
            { label: 'Data/hora', value: new Date(appt.starts_at).toLocaleString('pt-BR') },
            { label: 'Duração', value: `${appt.duration_minutes} minutos` },
            { label: 'Valor', value: `R$ ${Number(appt.price).toFixed(2)}` },
            ...(appt.notes ? [{ label: 'Observações', value: appt.notes }] : []),
          ].map((row) => (
            <div key={row.label} className="flex gap-3">
              <span className="text-gray-400 w-28 shrink-0">{row.label}</span>
              <span className="text-gray-900 font-medium">{row.value}</span>
            </div>
          ))}
        </div>

        <div className="pt-2 border-t border-gray-100 flex flex-wrap gap-2">
          {appt.status === 'pending' && (
            <button
              onClick={() => statusMutation.mutate('confirmed')}
              disabled={statusMutation.isPending}
              className="bg-green-600 hover:bg-green-700 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors disabled:opacity-50"
            >
              ✓ Confirmar
            </button>
          )}
          {appt.status === 'confirmed' && (
            <button
              onClick={() => statusMutation.mutate('completed')}
              disabled={statusMutation.isPending}
              className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors disabled:opacity-50"
            >
              ✓ Concluir
            </button>
          )}
          {appt.status !== 'cancelled' && appt.status !== 'completed' && (
            <button
              onClick={() => { if (confirm('Cancelar este agendamento?')) statusMutation.mutate('cancelled') }}
              disabled={statusMutation.isPending}
              className="bg-red-50 hover:bg-red-100 text-red-600 text-sm font-semibold px-4 py-2 rounded-xl transition-colors disabled:opacity-50"
            >
              Cancelar
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
