'use client'
import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter, useParams } from 'next/navigation'
import { appointmentsApi, getToken, friendlyMessage } from '@/lib/api'
import { getTokenPayload } from '@/lib/auth'

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

  // UI-4: papel "staff" só visualiza — sem Confirmar/Concluir/Cancelar.
  const [role, setRole] = useState<string | null>(null)
  useEffect(() => { setRole(getTokenPayload(getToken())?.role ?? null) }, [])
  const isManager = role === 'owner' || role === 'admin' || role === 'root'

  const [actionError, setActionError] = useState('')

  // UI-4: observações editáveis (paridade com o mobile)
  const [notes, setNotes] = useState('')
  const [notesLoaded, setNotesLoaded] = useState(false)
  const [notesSaved, setNotesSaved] = useState(false)

  const { data: appt, isLoading } = useQuery({ queryKey: ['appointment', id], queryFn: () => appointmentsApi.getById(id) })

  useEffect(() => {
    if (appt && !notesLoaded) {
      setNotes(appt.notes ?? '')
      setNotesLoaded(true)
    }
  }, [appt, notesLoaded])

  const statusMutation = useMutation({
    mutationFn: (status: string) => appointmentsApi.updateStatus(id, status),
    onSuccess: () => {
      setActionError('')
      qc.invalidateQueries({ queryKey: ['appointment', id] })
      qc.invalidateQueries({ queryKey: ['appointments'] })
    },
    onError: (e: any) =>
      setActionError(friendlyMessage(e, 'Não foi possível atualizar o agendamento. Tente novamente em instantes.')),
  })

  const notesMutation = useMutation({
    mutationFn: () => appointmentsApi.update(id, { notes: notes.trim() || null }),
    onSuccess: () => {
      setActionError('')
      qc.invalidateQueries({ queryKey: ['appointment', id] })
      setNotesSaved(true)
      setTimeout(() => setNotesSaved(false), 2500)
    },
    onError: (e: any) =>
      setActionError(friendlyMessage(e, 'Não foi possível salvar as observações. Tente novamente.')),
  })

  if (isLoading) return <div className="text-gray-400 text-sm">Carregando...</div>
  if (!appt) return <div className="text-gray-400 text-sm">Agendamento não encontrado</div>

  const notesDirty = notesLoaded && notes !== (appt.notes ?? '')

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
          ].map((row) => (
            <div key={row.label} className="flex gap-3">
              <span className="text-gray-400 w-28 shrink-0">{row.label}</span>
              <span className="text-gray-900 font-medium">{row.value}</span>
            </div>
          ))}
        </div>

        {/* UI-4: observações editáveis */}
        <div className="pt-2 border-t border-gray-100">
          <label className="block text-sm font-medium text-gray-700 mb-1">Observações</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary resize-none"
            placeholder="Observações internas (opcional)"
          />
          {(notesDirty || notesSaved) && (
            <button
              onClick={() => notesMutation.mutate()}
              disabled={notesMutation.isPending || !notesDirty}
              className="mt-2 bg-primary hover:bg-primary-dark text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors disabled:opacity-50"
            >
              {notesMutation.isPending ? 'Salvando...' : notesSaved ? '✓ Salvo!' : 'Salvar observações'}
            </button>
          )}
        </div>

        {actionError && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-600 text-sm">{actionError}</div>
        )}

        {/* UI-4: ações de status somente para owner/admin */}
        {isManager && (
          <div className="pt-2 border-t border-gray-100 flex flex-wrap gap-2">
            {appt.status === 'pending' && (
              <button
                onClick={() => statusMutation.mutate('confirmed')}
                disabled={statusMutation.isPending}
                className="bg-primary hover:bg-primary-dark text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors disabled:opacity-50"
              >
                ✓ Confirmar
              </button>
            )}
            {appt.status === 'confirmed' && (
              <button
                onClick={() => statusMutation.mutate('completed')}
                disabled={statusMutation.isPending}
                className="bg-primary hover:bg-primary-dark text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors disabled:opacity-50"
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
        )}
      </div>
    </div>
  )
}
