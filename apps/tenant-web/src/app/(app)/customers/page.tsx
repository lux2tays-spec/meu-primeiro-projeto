'use client'
import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { tenantApi, getToken } from '@/lib/api'
import { getTokenPayload } from '@/lib/auth'
import { useModalA11y } from '@/lib/useModalA11y'
import Loading from '@/components/ui/Loading'

// Full display name: "Nome Sobrenome" (last_name is optional).
function fullName(c: { name?: string | null; last_name?: string | null }) {
  return [c?.name, c?.last_name].filter(Boolean).join(' ')
}

// Digits-only phone for wa.me links (strips +, spaces, parentheses, dashes).
function waLink(phone?: string | null) {
  const digits = (phone ?? '').replace(/\D/g, '')
  return digits ? `https://wa.me/${digits}` : null
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pendente',
  confirmed: 'Confirmado',
  completed: 'Concluído',
  cancelled: 'Cancelado',
}
const STATUS_COLOR: Record<string, string> = {
  pending: 'bg-yellow-50 text-yellow-700',
  confirmed: 'bg-blue-50 text-blue-700',
  completed: 'bg-green-50 text-green-700',
  cancelled: 'bg-red-50 text-red-600',
}

function NewCustomerModal({ onClose, initialName = '' }: { onClose: () => void; initialName?: string }) {
  const qc = useQueryClient()
  // Prefill Nome with whatever the user typed in the search box (#7).
  const [form, setForm] = useState({ name: initialName, last_name: '', phone: '', email: '', birth_date: '' })
  const [error, setError] = useState('')
  // UI-8: ESC fecha + focus trap básico
  const dialogRef = useModalA11y<HTMLDivElement>(onClose)

  const createMutation = useMutation({
    mutationFn: () =>
      tenantApi.addCustomer({
        name: form.name.trim(),
        last_name: form.last_name.trim() || undefined,
        phone: form.phone.trim(),
        email: form.email.trim() || undefined,
        birth_date: form.birth_date || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customers'] })
      onClose()
    },
    onError: (e: any) => setError(e.message),
  })

  function submit() {
    setError('')
    if (!form.name.trim()) return setError('Informe o nome do cliente')
    if (!form.phone.trim()) return setError('Informe o telefone (WhatsApp)')
    createMutation.mutate()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Novo cliente"
        className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl p-6 space-y-4 focus:outline-none">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">Novo cliente</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Nome *</label>
          <input
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            placeholder="Nome do cliente"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Sobrenome</label>
          <input
            value={form.last_name}
            onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))}
            className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            placeholder="Sobrenome do cliente"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Telefone (WhatsApp) *</label>
          <input
            type="tel"
            value={form.phone}
            onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
            className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            placeholder="5511999999999"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">E-mail (opcional)</label>
          <input
            type="email"
            value={form.email}
            onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
            className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            placeholder="email@exemplo.com"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Aniversário (opcional)</label>
          <input
            type="date"
            value={form.birth_date}
            onChange={e => setForm(f => ({ ...f, birth_date: e.target.value }))}
            className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>

        {error && <p className="text-red-500 text-xs">{error}</p>}

        <div className="flex gap-2 pt-1">
          <button
            onClick={submit}
            disabled={createMutation.isPending}
            className="flex-1 h-10 bg-primary text-white text-sm font-semibold rounded-xl disabled:opacity-50"
          >
            {createMutation.isPending ? 'Salvando...' : 'Adicionar cliente'}
          </button>
          <button onClick={onClose}
            className="flex-1 h-10 border border-gray-200 text-gray-600 text-sm rounded-xl hover:bg-gray-50">
            Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}

function CustomerDrawer({ customerId, canDelete, onClose }: { customerId: string; canDelete: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const { data: customer, isLoading } = useQuery({
    queryKey: ['customer', customerId],
    queryFn: () => tenantApi.customer(customerId),
  })

  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ name: '', last_name: '', email: '', birth_date: '' })
  const [error, setError] = useState('')
  const [deleteError, setDeleteError] = useState('')
  const [success, setSuccess] = useState(false)

  function openEdit() {
    setForm({
      name: customer?.name ?? '',
      last_name: customer?.last_name ?? '',
      email: customer?.email ?? '',
      birth_date: customer?.birth_date ? String(customer.birth_date).slice(0, 10) : '',
    })
    setEditing(true)
    setError('')
  }

  const updateMutation = useMutation({
    mutationFn: (data: { name?: string; last_name?: string; email?: string; birth_date?: string }) => tenantApi.updateCustomer(customerId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customer', customerId] })
      qc.invalidateQueries({ queryKey: ['customers'] })
      setEditing(false)
      setSuccess(true)
      setTimeout(() => setSuccess(false), 2500)
    },
    onError: (e: any) => setError(e.message),
  })

  const deleteMutation = useMutation({
    mutationFn: () => tenantApi.deleteCustomer(customerId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customers'] })
      qc.removeQueries({ queryKey: ['customer', customerId] })
      onClose()
    },
    onError: (e: any) => {
      // 403 (staff) or any other failure — friendly message, never a raw stack.
      const msg = String(e?.message ?? '')
      setDeleteError(
        msg.includes('403') || /permiss|forbidden/i.test(msg)
          ? 'Você não tem permissão para excluir clientes.'
          : msg || 'Não foi possível excluir o cliente. Tente novamente.'
      )
    },
  })

  function handleDelete() {
    setDeleteError('')
    if (!confirm('Excluir este cliente e todo o histórico dele? Não pode ser desfeito.')) return
    deleteMutation.mutate()
  }

  const nameIsPhone = customer && customer.name === customer.phone

  // SAL-22: total gasto pelo cliente (serviços concluídos).
  const totalSpent = ((customer?.appointments ?? []) as any[])
    .filter((a) => a.status === 'completed')
    .reduce((sum, a) => sum + Number(a.price || 0), 0)

  // UI-8: ESC fecha + focus trap básico
  const dialogRef = useModalA11y<HTMLDivElement>(onClose)

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Detalhes do cliente"
        className="relative w-full max-w-lg bg-white shadow-2xl flex flex-col h-full overflow-y-auto focus:outline-none">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white z-10">
          <h2 className="text-lg font-bold text-gray-900">Detalhes do cliente</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        {isLoading ? (
          <div className="flex-1 flex items-center justify-center"><Loading /></div>
        ) : !customer ? (
          <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">Cliente não encontrado</div>
        ) : (
          <div className="flex-1 p-6 space-y-6">
            {/* Customer info */}
            <div className="bg-gray-50 rounded-2xl p-4 space-y-3">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-lg font-bold text-gray-900">
                      {nameIsPhone ? <span className="text-gray-400 italic">Nome não informado</span> : fullName(customer)}
                    </p>
                    {nameIsPhone && (
                      <span className="text-xs bg-amber-50 text-amber-600 border border-amber-200 px-2 py-0.5 rounded-full">
                        Aguardando nome via bot
                      </span>
                    )}
                  </div>
                  {waLink(customer.phone) ? (
                    <a
                      href={waLink(customer.phone)!}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-sm text-green-600 hover:text-green-700 hover:underline mt-0.5 font-medium"
                      title="Conversar no WhatsApp"
                    >
                      <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" fill="currentColor" aria-hidden="true">
                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.71.306 1.263.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                      </svg>
                      {customer.phone}
                    </a>
                  ) : (
                    <p className="text-sm text-gray-500 mt-0.5">{customer.phone}</p>
                  )}
                  {customer.email ? (
                    <p className="text-sm text-gray-500">{customer.email}</p>
                  ) : (
                    <p className="text-sm text-gray-400 italic">E-mail não informado</p>
                  )}
                  {customer.birth_date && (
                    <p className="text-sm text-gray-500">🎂 Aniversário: {String(customer.birth_date).slice(0, 10).split('-').reverse().join('/')}</p>
                  )}
                  <p className="text-xs text-gray-400 mt-1">
                    Cliente desde {new Date(customer.created_at).toLocaleDateString('pt-BR')}
                  </p>
                </div>
                {!editing && (
                  <button onClick={openEdit}
                    className="text-primary text-sm font-medium hover:underline shrink-0 ml-2">
                    Editar
                  </button>
                )}
              </div>

              {/* Edit form */}
              {editing && (
                <div className="border-t border-gray-200 pt-3 space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Nome</label>
                    <input
                      value={form.name}
                      onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                      className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      placeholder="Nome do cliente"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Sobrenome</label>
                    <input
                      value={form.last_name}
                      onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))}
                      className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      placeholder="Sobrenome do cliente"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">E-mail</label>
                    <input
                      type="email"
                      value={form.email}
                      onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                      className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      placeholder="email@exemplo.com"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Aniversário</label>
                    <input
                      type="date"
                      value={form.birth_date}
                      onChange={e => setForm(f => ({ ...f, birth_date: e.target.value }))}
                      className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  {error && <p className="text-red-500 text-xs">{error}</p>}
                  <div className="flex gap-2">
                    <button
                      onClick={() => updateMutation.mutate({ name: form.name.trim() || undefined, last_name: form.last_name.trim(), email: form.email.trim() || undefined, birth_date: form.birth_date || '' })}
                      disabled={updateMutation.isPending}
                      className="flex-1 h-9 bg-primary text-white text-sm font-semibold rounded-xl disabled:opacity-50"
                    >
                      {updateMutation.isPending ? 'Salvando...' : 'Salvar'}
                    </button>
                    <button onClick={() => setEditing(false)}
                      className="flex-1 h-9 border border-gray-200 text-gray-600 text-sm rounded-xl hover:bg-gray-50">
                      Cancelar
                    </button>
                  </div>
                </div>
              )}

              {success && (
                <p role="status" className="text-green-600 text-xs font-medium">✓ Cliente atualizado com sucesso</p>
              )}

              {/* SAL-22: agendar direto a partir do cliente (pré-selecionado) */}
              <Link
                href={`/appointments/new?customer_id=${customerId}`}
                className="flex items-center justify-center w-full h-10 bg-primary hover:bg-primary-dark text-white text-sm font-semibold rounded-xl transition-colors"
              >
                + Novo agendamento
              </Link>
            </div>

            {/* SAL-22: total gasto (serviços concluídos) */}
            <div className="bg-green-50 border border-green-100 rounded-2xl px-4 py-3 flex items-center justify-between">
              <p className="text-sm font-medium text-green-800">Total gasto pelo cliente</p>
              <p className="text-lg font-bold text-green-700">
                {totalSpent.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
              </p>
            </div>

            {/* Interest (from WhatsApp bot — migration 013, may be absent) */}
            {customer.interested_services && (
              <div>
                <h3 className="text-sm font-semibold text-gray-900 mb-3">Interesse</h3>
                <div className="bg-blue-50 border border-blue-100 rounded-xl p-3">
                  <p className="text-sm font-medium text-blue-900">{customer.interested_services}</p>
                  {customer.last_interest_at && (
                    <p className="text-xs text-blue-500 mt-1">Último interesse em {customer.last_interest_at}</p>
                  )}
                </div>
              </div>
            )}

            {/* Appointment history */}
            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-3">
                Serviços realizados
                <span className="ml-2 text-gray-400 font-normal">({customer.appointments?.length ?? 0})</span>
              </h3>

              {!customer.appointments?.length ? (
                <div className="bg-gray-50 rounded-xl p-4 text-center">
                  <p className="text-gray-400 text-sm">Nenhum serviço registrado</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {(customer.appointments as any[]).map((a: any) => (
                    <div key={a.id} className="bg-white border border-gray-100 rounded-xl p-3 shadow-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-900 truncate">{a.service_name}</p>
                          <p className="text-xs text-gray-500 mt-0.5">com {a.professional_name}</p>
                        </div>
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${STATUS_COLOR[a.status] ?? 'bg-gray-50 text-gray-500'}`}>
                          {STATUS_LABEL[a.status] ?? a.status}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
                        <span>{a.date}</span>
                        <span>{a.time}</span>
                        <span>· {a.duration_minutes} min</span>
                        <span className="ml-auto font-medium text-gray-600">R$ {Number(a.price).toFixed(2)}</span>
                      </div>
                      {a.notes && <p className="text-xs text-gray-400 mt-1 italic">{a.notes}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Danger zone — only owner/admin/root can delete (#8) */}
            {canDelete && (
              <div className="border-t border-gray-100 pt-4">
                <button
                  onClick={handleDelete}
                  disabled={deleteMutation.isPending}
                  className="text-red-600 text-sm font-medium hover:underline disabled:opacity-50"
                >
                  {deleteMutation.isPending ? 'Excluindo...' : 'Excluir cliente'}
                </button>
                <p className="text-xs text-gray-400 mt-1">Remove o cliente e todo o histórico dele. Não pode ser desfeito.</p>
                {deleteError && <p className="text-red-500 text-xs mt-2">{deleteError}</p>}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default function CustomersPage() {
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)

  // Role is read from the JWT in localStorage — only available on the client.
  const [role, setRole] = useState<string | null>(null)
  useEffect(() => {
    setRole(getTokenPayload(getToken())?.role ?? null)
  }, [])
  const canDelete = role === 'owner' || role === 'admin' || role === 'root'

  const { data: customers = [], isLoading } = useQuery({
    queryKey: ['customers', search],
    queryFn: () => tenantApi.customers(search || undefined),
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Clientes</h1>
        <button
          onClick={() => setShowNew(true)}
          className="h-10 px-4 bg-primary text-white text-sm font-semibold rounded-xl hover:opacity-90"
        >
          + Novo cliente
        </button>
      </div>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Buscar por nome, telefone ou e-mail..."
        className="w-full max-w-md h-11 px-4 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
      />

      {isLoading ? (
        <Loading card />
      ) : (customers as any[]).length === 0 ? (
        <div className="bg-white rounded-2xl p-8 text-center border border-gray-100">
          <p className="text-gray-400 text-sm">Nenhum cliente encontrado</p>
          <p className="text-gray-400 text-xs mt-1">
            Os clientes são criados automaticamente via WhatsApp — ou adicione um manualmente em “+ Novo cliente”
          </p>
        </div>
      ) : (
        // UI-9: tabela rola horizontalmente no mobile em vez de estourar a página
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Nome</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Telefone</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">E-mail</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Atendimentos</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Último serviço</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {(customers as any[]).map((c) => {
                const nameIsPhone = c.name === c.phone
                return (
                  <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className={nameIsPhone ? 'text-gray-400 italic text-xs' : 'font-medium text-gray-900'}>
                          {nameIsPhone ? 'Não informado' : fullName(c)}
                        </span>
                        {nameIsPhone && (
                          <span className="text-xs bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded-full border border-amber-200">
                            bot
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {waLink(c.phone) ? (
                        <a
                          href={waLink(c.phone)!}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1.5 text-green-600 hover:text-green-700 hover:underline font-medium"
                          title="Conversar no WhatsApp"
                        >
                          <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" fill="currentColor" aria-hidden="true">
                            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.71.306 1.263.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                          </svg>
                          {c.phone}
                        </a>
                      ) : (
                        <span className="text-gray-600">{c.phone}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{c.email ?? <span className="text-gray-300">—</span>}</td>
                    <td className="px-4 py-3 text-gray-600 text-center">{c.appointment_count ?? 0}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">
                      {c.last_appointment_at
                        ? new Date(c.last_appointment_at).toLocaleDateString('pt-BR')
                        : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => setSelectedId(c.id)}
                        className="text-primary text-xs font-semibold hover:underline px-2 py-1"
                      >
                        Ver detalhes
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {showNew && <NewCustomerModal initialName={search} onClose={() => setShowNew(false)} />}

      {selectedId && (
        <CustomerDrawer customerId={selectedId} canDelete={canDelete} onClose={() => setSelectedId(null)} />
      )}
    </div>
  )
}
