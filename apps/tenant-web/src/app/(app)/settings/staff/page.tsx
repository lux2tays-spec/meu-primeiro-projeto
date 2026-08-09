'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { tenantApi, getToken, friendlyMessage } from '@/lib/api'
import Loading from '@/components/ui/Loading'
import { getTokenPayload } from '@/lib/auth'

// Equipe = Profissionais: todo membro tem acesso ao app (login) E aparece na
// agenda/serviços. Não há mais "profissional sem acesso". As opções abaixo são
// níveis de ACESSO (permissão), não tipos de pessoa.
const ROLE_LABEL: Record<string, string> = { owner: 'Proprietário', admin: 'Administrador', staff: 'Colaborador' }
const ROLE_COLOR: Record<string, string> = {
  owner: 'bg-purple-100 text-purple-700',
  admin: 'bg-blue-100 text-blue-700',
  staff: 'bg-gray-100 text-gray-600',
}

export default function StaffPage() {
  const qc = useQueryClient()
  const { data: staff = [], isLoading } = useQuery({ queryKey: ['staff'], queryFn: tenantApi.staff })

  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'staff' as 'admin' | 'staff' })
  const [error, setError] = useState('')

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({ name: '', email: '', phone: '', role: 'staff' as 'owner' | 'admin' | 'staff' })
  const [editError, setEditError] = useState('')

  // Erros de ações da lista (remover membro) — UI amigável, sem alert()
  const [listError, setListError] = useState('')

  const payload = getTokenPayload(getToken())
  const myUserId: string | undefined = payload?.user_id
  // CFG-10: papel "staff" só visualiza — ações de gestão ficam ocultas.
  const isManager = ['owner', 'admin', 'root'].includes(payload?.role)

  // Adiciona um membro. O backend cria automaticamente o profissional vinculado
  // (todo membro é agendável) — sem passo/opção extra.
  const addMutation = useMutation({
    mutationFn: (data: typeof form) =>
      tenantApi.addStaff({ name: data.name, email: data.email, password: data.password, role: data.role }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff'] })
      qc.invalidateQueries({ queryKey: ['professionals'] })
      setShowForm(false)
      setForm({ name: '', email: '', password: '', role: 'staff' })
      setError('')
    },
    onError: (e: any) => setError(e.message),
  })

  const removeMutation = useMutation({
    mutationFn: tenantApi.removeStaff,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff'] })
      qc.invalidateQueries({ queryKey: ['professionals'] })
      setListError('')
    },
    // CFG-6: sem alert() — mensagem amigável na própria tela.
    onError: (e: any) => setListError(friendlyMessage(e, 'Não foi possível remover este membro da equipe. Tente novamente.')),
  })

  // Editar nome sincroniza o nome do profissional no backend (agenda/serviços).
  const editMutation = useMutation({
    mutationFn: ({ userId, data }: { userId: string; data: typeof editForm }) =>
      tenantApi.editStaff(userId, {
        name: data.name,
        email: data.email,
        phone: data.phone || null,
        role: data.role,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff'] })
      qc.invalidateQueries({ queryKey: ['professionals'] })
      setEditingId(null)
      setEditError('')
    },
    onError: (e: any) => setEditError(e.message),
  })

  function startEdit(u: any) {
    setEditingId(u.id)
    setEditForm({ name: u.name ?? '', email: u.email ?? '', phone: u.phone ?? '', role: u.role })
    setEditError('')
  }

  const inputCls = 'w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary'

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Equipe</h1>
          <p className="text-sm text-gray-400">Todos têm acesso ao app e aparecem na agenda e nos serviços.</p>
        </div>
        {isManager && (
          <button onClick={() => setShowForm(true)}
            className="bg-primary hover:bg-primary-dark text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors whitespace-nowrap">
            + Adicionar
          </button>
        )}
      </div>

      {listError && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-600 text-sm">{listError}</div>
      )}

      {showForm && (
        <div className="bg-white rounded-2xl p-5 border border-primary/30 shadow-sm space-y-3">
          <p className="font-semibold text-gray-900 text-sm">Novo membro</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Nome</label>
              <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className={inputCls} placeholder="Maria Silva" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">E-mail</label>
              <input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                className={inputCls} placeholder="maria@email.com" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Senha</label>
              <input type="password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                className={inputCls} placeholder="••••••" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Nível de acesso</label>
              <select value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as any }))}
                className={inputCls + ' bg-white'}>
                <option value="staff">Colaborador</option>
                <option value="admin">Administrador</option>
              </select>
            </div>
          </div>

          <p className="text-xs text-gray-400">
            O novo membro já entra como profissional agendável — não precisa de cadastro à parte.
          </p>

          {error && <p className="text-red-500 text-xs">{error}</p>}
          <div className="flex gap-2">
            <button onClick={() => addMutation.mutate(form)} disabled={addMutation.isPending}
              className="flex-1 h-10 bg-primary text-white text-sm font-semibold rounded-xl disabled:opacity-50">
              {addMutation.isPending ? 'Adicionando...' : 'Adicionar à equipe'}
            </button>
            <button onClick={() => setShowForm(false)}
              className="flex-1 h-10 border border-gray-200 text-gray-600 text-sm rounded-xl hover:bg-gray-50">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <Loading card />
      ) : (staff as any[]).length === 0 ? (
        <div className="bg-white rounded-2xl p-6 text-center border border-gray-100">
          <p className="text-gray-400 text-sm">Nenhum membro na equipe.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {(staff as any[]).map((u) => {
            const isEditing = editingId === u.id
            return (
              <div key={u.id} className={`bg-white rounded-2xl p-4 border shadow-sm ${isEditing ? 'border-primary/30' : 'border-gray-100'}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-gray-900">{u.name}</p>
                      <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full ${ROLE_COLOR[u.role] ?? 'bg-gray-100 text-gray-600'}`}>
                        {ROLE_LABEL[u.role] ?? u.role}
                      </span>
                    </div>
                    <p className="text-gray-400 text-sm mt-0.5">{u.email}</p>
                  </div>

                  {/* CFG-10: staff não vê ações de gestão */}
                  {isManager && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => (isEditing ? setEditingId(null) : startEdit(u))}
                        className="text-gray-400 hover:text-primary text-sm px-2.5 py-1.5 rounded-lg hover:bg-gray-50 transition-colors"
                      >
                        Editar
                      </button>
                      {u.id !== myUserId && (
                        <button
                          onClick={() => { if (confirm(`Excluir ${u.name} da equipe?`)) removeMutation.mutate(u.id) }}
                          className="text-gray-400 hover:text-red-500 text-sm px-2.5 py-1.5 rounded-lg hover:bg-red-50 transition-colors"
                        >
                          Excluir
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {isEditing && (
                  <div className="mt-4 pt-4 border-t border-gray-100 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Nome</label>
                        <input value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                          className={inputCls} placeholder="Maria Silva" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">E-mail</label>
                        <input type="email" value={editForm.email} onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
                          className={inputCls} placeholder="maria@email.com" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Telefone</label>
                        <input value={editForm.phone} onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))}
                          className={inputCls} placeholder="(11) 99999-9999" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Nível de acesso</label>
                        <select value={editForm.role} onChange={(e) => setEditForm((f) => ({ ...f, role: e.target.value as any }))}
                          className={inputCls + ' bg-white'}>
                          <option value="staff">Colaborador</option>
                          <option value="admin">Administrador</option>
                          <option value="owner">Proprietário</option>
                        </select>
                      </div>
                    </div>

                    {editError && <p className="text-red-500 text-xs">{editError}</p>}
                    <div className="flex gap-2">
                      <button onClick={() => editMutation.mutate({ userId: u.id, data: editForm })} disabled={editMutation.isPending}
                        className="flex-1 h-10 bg-primary text-white text-sm font-semibold rounded-xl disabled:opacity-50">
                        {editMutation.isPending ? 'Salvando...' : 'Salvar'}
                      </button>
                      <button onClick={() => { setEditingId(null); setEditError('') }}
                        className="flex-1 h-10 border border-gray-200 text-gray-600 text-sm rounded-xl hover:bg-gray-50">
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
