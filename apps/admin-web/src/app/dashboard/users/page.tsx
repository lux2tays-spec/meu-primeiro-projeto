'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { rootApi } from '@/lib/api'
import { Badge } from '@/components/ui/Badge'

const roleLabel: Record<string, string> = { owner: 'Proprietário', admin: 'Admin', staff: 'Colaborador' }
const roleVariant: Record<string, any> = { owner: 'success', admin: 'info', staff: 'default' }

const BLANK = { name: '', email: '', phone: '', password: '' }

export default function UsersPage() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState<null | 'create' | any>(null) // null | 'create' | user obj (edit)
  const [form, setForm] = useState(BLANK)
  const [err, setErr] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<any>(null)

  const { data: users, isLoading } = useQuery({
    queryKey: ['root-users', search],
    queryFn: () => rootApi.users({ search: search || undefined }),
  })

  const openCreate = () => { setForm(BLANK); setErr(''); setModal('create') }
  const openEdit = (u: any) => { setForm({ name: u.name, email: u.email, phone: u.phone ?? '', password: '' }); setErr(''); setModal(u) }
  const closeModal = () => setModal(null)

  const createMutation = useMutation({
    mutationFn: () => rootApi.createUser(form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['root-users'] }); closeModal() },
    onError: (e: any) => setErr(e.message),
  })

  const editMutation = useMutation({
    mutationFn: () => {
      const payload: any = { name: form.name, email: form.email, phone: form.phone }
      if (form.password) payload.password = form.password
      return rootApi.updateUser(modal.id, payload)
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['root-users'] }); closeModal() },
    onError: (e: any) => setErr(e.message),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => rootApi.deleteUser(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['root-users'] }); setConfirmDelete(null) },
  })

  const isEditing = modal && modal !== 'create'
  const isPending = createMutation.isPending || editMutation.isPending

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Usuários</h1>
          <p className="text-gray-500 text-sm mt-1">Todos os usuários da plataforma</p>
        </div>
        <button
          onClick={openCreate}
          className="h-10 px-5 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary-dark transition-colors"
        >
          + Novo usuário
        </button>
      </div>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Buscar por nome ou e-mail..."
        className="h-10 px-4 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary w-full max-w-sm"
      />

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="text-left px-6 py-3 font-medium text-gray-500">Usuário</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">Telefone</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">Tenants</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">Login</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">Cadastro</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={6} className="text-center py-12 text-gray-400">Carregando...</td></tr>
            ) : !users?.length ? (
              <tr><td colSpan={6} className="text-center py-12 text-gray-400">Nenhum usuário</td></tr>
            ) : users.map((u: any) => {
              const tenants = (u.tenants ?? []).filter((t: any) => t.tenant_id)
              return (
                <tr key={u.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-gray-100 flex items-center justify-center font-bold text-gray-500 text-sm flex-shrink-0">
                        {u.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="font-semibold text-gray-900">{u.name}</div>
                        <div className="text-xs text-gray-400">{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-4 text-gray-600 text-xs">{u.phone ?? '—'}</td>
                  <td className="px-4 py-4">
                    <div className="flex flex-wrap gap-1">
                      {tenants.length === 0 ? (
                        <span className="text-gray-400 text-xs">—</span>
                      ) : tenants.slice(0, 2).map((t: any) => (
                        <span key={t.tenant_id} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                          {t.tenant_name} <span className="text-gray-400">({roleLabel[t.role] ?? t.role})</span>
                        </span>
                      ))}
                      {tenants.length > 2 && <span className="text-xs text-gray-400">+{tenants.length - 2}</span>}
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <Badge label={u.has_google ? '🔵 Google' : '📧 E-mail'} variant="default" />
                  </td>
                  <td className="px-4 py-4 text-gray-400 text-xs">
                    {new Date(u.created_at).toLocaleDateString('pt-BR')}
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex items-center gap-3">
                      <button onClick={() => openEdit(u)} className="text-xs text-primary hover:text-primary-dark font-medium">
                        Editar
                      </button>
                      <button onClick={() => setConfirmDelete(u)} className="text-xs text-red-400 hover:text-red-600 font-medium">
                        Excluir
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Create / Edit modal */}
      {modal !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <h2 className="text-lg font-bold text-gray-900">{isEditing ? 'Editar usuário' : 'Novo usuário'}</h2>

            {err && <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-2">{err}</p>}

            <Field label="Nome" value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} placeholder="Nome completo" />
            <Field label="E-mail" value={form.email} onChange={(v) => setForm((f) => ({ ...f, email: v }))} placeholder="email@exemplo.com" type="email" />
            <Field label="Telefone" value={form.phone} onChange={(v) => setForm((f) => ({ ...f, phone: v }))} placeholder="(11) 99999-9999" />
            <Field
              label={isEditing ? 'Nova senha (deixe em branco para manter)' : 'Senha'}
              value={form.password}
              onChange={(v) => setForm((f) => ({ ...f, password: v }))}
              placeholder={isEditing ? 'Nova senha...' : 'Senha de acesso'}
              type="password"
            />

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => isEditing ? editMutation.mutate() : createMutation.mutate()}
                disabled={isPending || !form.name || !form.email || (!isEditing && !form.password)}
                className="flex-1 h-10 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary-dark disabled:opacity-50 transition-colors"
              >
                {isPending ? 'Salvando...' : isEditing ? 'Salvar alterações' : 'Criar usuário'}
              </button>
              <button onClick={closeModal} className="h-10 px-4 rounded-xl border border-gray-200 text-sm font-medium hover:bg-gray-50">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h2 className="text-lg font-bold text-gray-900">Excluir usuário</h2>
            <p className="text-sm text-gray-600">
              Tem certeza que deseja excluir <strong>{confirmDelete.name}</strong>? Esta ação não pode ser desfeita.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => deleteMutation.mutate(confirmDelete.id)}
                disabled={deleteMutation.isPending}
                className="flex-1 h-10 bg-red-600 text-white rounded-xl text-sm font-semibold hover:bg-red-700 disabled:opacity-50"
              >
                {deleteMutation.isPending ? 'Excluindo...' : 'Confirmar exclusão'}
              </button>
              <button onClick={() => setConfirmDelete(null)} className="h-10 px-4 rounded-xl border border-gray-200 text-sm font-medium hover:bg-gray-50">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, value, onChange, placeholder, type = 'text' }: any) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
      />
    </div>
  )
}
