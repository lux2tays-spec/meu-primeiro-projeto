'use client'
import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { tenantApi, getToken } from '@/lib/api'
import { getTokenPayload } from '@/lib/auth'

// Full display name: "Nome Sobrenome" (last_name is optional).
function fullName(c: { name?: string | null; last_name?: string | null }) {
  return [c?.name, c?.last_name].filter(Boolean).join(' ')
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
  const [form, setForm] = useState({ name: initialName, last_name: '', phone: '', email: '' })
  const [error, setError] = useState('')

  const createMutation = useMutation({
    mutationFn: () =>
      tenantApi.addCustomer({
        name: form.name.trim(),
        last_name: form.last_name.trim() || undefined,
        phone: form.phone.trim(),
        email: form.email.trim() || undefined,
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
      <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl p-6 space-y-4">
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
  const [form, setForm] = useState({ name: '', last_name: '', email: '' })
  const [error, setError] = useState('')
  const [deleteError, setDeleteError] = useState('')
  const [success, setSuccess] = useState(false)

  function openEdit() {
    setForm({ name: customer?.name ?? '', last_name: customer?.last_name ?? '', email: customer?.email ?? '' })
    setEditing(true)
    setError('')
  }

  const updateMutation = useMutation({
    mutationFn: (data: { name?: string; last_name?: string; email?: string }) => tenantApi.updateCustomer(customerId, data),
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

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white shadow-2xl flex flex-col h-full overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white z-10">
          <h2 className="text-lg font-bold text-gray-900">Detalhes do cliente</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        {isLoading ? (
          <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">Carregando...</div>
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
                  <p className="text-sm text-gray-500 mt-0.5">{customer.phone}</p>
                  {customer.email ? (
                    <p className="text-sm text-gray-500">{customer.email}</p>
                  ) : (
                    <p className="text-sm text-gray-400 italic">E-mail não informado</p>
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
                  {error && <p className="text-red-500 text-xs">{error}</p>}
                  <div className="flex gap-2">
                    <button
                      onClick={() => updateMutation.mutate({ name: form.name.trim() || undefined, last_name: form.last_name.trim(), email: form.email.trim() || undefined })}
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
                <p className="text-green-600 text-xs font-medium">✓ Cliente atualizado com sucesso</p>
              )}
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
        <p className="text-gray-400 text-sm">Carregando...</p>
      ) : (customers as any[]).length === 0 ? (
        <div className="bg-white rounded-2xl p-8 text-center border border-gray-100">
          <p className="text-gray-400 text-sm">Nenhum cliente encontrado</p>
          <p className="text-gray-400 text-xs mt-1">
            Os clientes são criados automaticamente via WhatsApp — ou adicione um manualmente em “+ Novo cliente”
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
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
                    <td className="px-4 py-3 text-gray-600">{c.phone}</td>
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
      )}

      {showNew && <NewCustomerModal initialName={search} onClose={() => setShowNew(false)} />}

      {selectedId && (
        <CustomerDrawer customerId={selectedId} canDelete={canDelete} onClose={() => setSelectedId(null)} />
      )}
    </div>
  )
}
