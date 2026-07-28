'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { tenantApi, getToken, friendlyMessage } from '@/lib/api'
import Loading from '@/components/ui/Loading'
import { getTokenPayload } from '@/lib/auth'
import { formatBRPhone } from '@/lib/phone'

const ROLE_LABEL: Record<string, string> = { owner: 'Proprietário', admin: 'Administrador', staff: 'Colaborador' }
const ROLE_COLOR: Record<string, string> = {
  owner: 'bg-purple-100 text-purple-700',
  admin: 'bg-blue-100 text-blue-700',
  staff: 'bg-gray-100 text-gray-600',
}

export default function StaffPage() {
  const qc = useQueryClient()
  const { data: staff = [], isLoading } = useQuery({ queryKey: ['staff'], queryFn: tenantApi.staff })
  const { data: professionals = [] } = useQuery({ queryKey: ['professionals'], queryFn: tenantApi.professionals })

  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'staff' as 'admin' | 'staff', also_professional: false })
  const [error, setError] = useState('')

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({ name: '', email: '', phone: '', role: 'staff' as 'owner' | 'admin' | 'staff' })
  const [editError, setEditError] = useState('')

  // Erros de ações da lista (remover membro / vínculo profissional) — UI amigável, sem alert()
  const [listError, setListError] = useState('')

  // CFG-7: profissionais sem conta de acesso ao app
  const [showProForm, setShowProForm] = useState(false)
  const [proForm, setProForm] = useState({ name: '', phone: '', bio: '' })
  const [proError, setProError] = useState('')
  const [editingProId, setEditingProId] = useState<string | null>(null)
  const [proEditForm, setProEditForm] = useState({ name: '', phone: '', bio: '' })
  const [proEditError, setProEditError] = useState('')

  const payload = getTokenPayload(getToken())
  const myUserId: string | undefined = payload?.user_id
  // CFG-10: papel "staff" só visualiza — ações de gestão ficam ocultas.
  const isManager = ['owner', 'admin', 'root'].includes(payload?.role)

  const addMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      const member = await tenantApi.addStaff({ name: data.name, email: data.email, password: data.password, role: data.role })
      if (data.also_professional) {
        await tenantApi.addProfessional({ name: data.name, user_id: member.id })
      }
      return member
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff'] })
      qc.invalidateQueries({ queryKey: ['professionals'] })
      setShowForm(false)
      setForm({ name: '', email: '', password: '', role: 'staff', also_professional: false })
      setError('')
    },
    onError: (e: any) => setError(e.message),
  })

  const removeMutation = useMutation({
    mutationFn: tenantApi.removeStaff,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['staff'] }); setListError('') },
    // CFG-6: sem alert() — mensagem amigável na própria tela.
    onError: (e: any) => setListError(friendlyMessage(e, 'Não foi possível remover este membro da equipe. Tente novamente.')),
  })

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

  const addAsProfessional = useMutation({
    mutationFn: ({ userId, name }: { userId: string; name: string }) =>
      tenantApi.addProfessional({ name, user_id: userId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['professionals'] })
      setListError('')
    },
    onError: (e: any) => setListError(friendlyMessage(e, 'Não foi possível habilitar como profissional. Tente novamente.')),
  })

  const removeProfessional = useMutation({
    mutationFn: tenantApi.removeProfessional,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['professionals'] }); setListError('') },
    // CFG-6: falha ao remover profissional mostra mensagem amigável.
    onError: (e: any) => setListError(friendlyMessage(e, 'Não foi possível remover o profissional. Tente novamente.')),
  })

  // CFG-7: criar profissional SEM conta de acesso (POST sem user_id)
  const addProMutation = useMutation({
    mutationFn: () => tenantApi.addProfessional({
      name: proForm.name.trim(),
      phone: proForm.phone.trim() || null,
      bio: proForm.bio.trim() || null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['professionals'] })
      setShowProForm(false)
      setProForm({ name: '', phone: '', bio: '' })
      setProError('')
    },
    onError: (e: any) => setProError(friendlyMessage(e, 'Não foi possível adicionar o profissional. Tente novamente.')),
  })

  // CFG-7: editar profissional (nome/telefone/bio) via PATCH /tenant/professionals/:id
  const updateProMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { name: string; phone: string | null; bio: string | null } }) =>
      tenantApi.updateProfessional(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['professionals'] })
      setEditingProId(null)
      setProEditError('')
    },
    onError: (e: any) => setProEditError(friendlyMessage(e, 'Não foi possível salvar o profissional. Tente novamente.')),
  })

  function startEditPro(p: any) {
    setEditingProId(p.id)
    setProEditForm({ name: p.name ?? '', phone: p.phone ?? '', bio: p.bio ?? '' })
    setProEditError('')
  }

  function saveEditPro(id: string) {
    if (!proEditForm.name.trim()) { setProEditError('Informe o nome do profissional.'); return }
    updateProMutation.mutate({
      id,
      data: {
        name: proEditForm.name.trim(),
        phone: proEditForm.phone.trim() || null,
        bio: proEditForm.bio.trim() || null,
      },
    })
  }

  function isProfessional(userId: string) {
    return (professionals as any[]).some((p) => p.user_id === userId)
  }

  function professionalId(userId: string) {
    return (professionals as any[]).find((p) => p.user_id === userId)?.id
  }

  const inputCls = 'w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary'

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Colaboradores</h1>
        {isManager && (
          <button onClick={() => setShowForm(true)}
            className="bg-primary hover:bg-primary-dark text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors">
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
              <label className="block text-xs font-medium text-gray-600 mb-1">Função</label>
              <select value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as any }))}
                className={inputCls + ' bg-white'}>
                <option value="staff">Colaborador</option>
                <option value="admin">Administrador</option>
              </select>
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.also_professional}
              onChange={(e) => setForm((f) => ({ ...f, also_professional: e.target.checked }))}
              className="rounded border-gray-300 text-primary focus:ring-primary" />
            <span className="text-sm text-gray-700">Também prestar serviços (cadastrar como profissional)</span>
          </label>

          {error && <p className="text-red-500 text-xs">{error}</p>}
          <div className="flex gap-2">
            <button onClick={() => addMutation.mutate(form)} disabled={addMutation.isPending}
              className="flex-1 h-10 bg-primary text-white text-sm font-semibold rounded-xl disabled:opacity-50">
              {addMutation.isPending ? 'Adicionando...' : 'Adicionar'}
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
      ) : (
        <div className="space-y-3">
          {(staff as any[]).map((u) => {
            const isProf = isProfessional(u.id)
            const profId = professionalId(u.id)
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
                      {isProf && (
                        <span className="text-xs font-medium px-2.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
                          Profissional
                        </span>
                      )}
                    </div>
                    <p className="text-gray-400 text-sm mt-0.5">{u.email}</p>
                  </div>

                  {/* CFG-10: staff não vê ações de gestão */}
                  {isManager && (
                    <div className="flex items-center gap-1 shrink-0">
                      {!isProf ? (
                        <button
                          onClick={() => addAsProfessional.mutate({ userId: u.id, name: u.name })}
                          disabled={addAsProfessional.isPending}
                          className="text-indigo-500 hover:text-indigo-700 text-xs font-medium px-2.5 py-1.5 rounded-lg hover:bg-indigo-50 transition-colors whitespace-nowrap"
                          title="Habilitar para prestar serviços"
                        >
                          + Profissional
                        </button>
                      ) : (
                        <button
                          onClick={() => { if (confirm('Remover como profissional?')) removeProfessional.mutate(profId) }}
                          className="text-gray-400 hover:text-orange-500 text-xs px-2.5 py-1.5 rounded-lg hover:bg-orange-50 transition-colors whitespace-nowrap"
                        >
                          − Profissional
                        </button>
                      )}
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
                        <label className="block text-xs font-medium text-gray-600 mb-1">Função</label>
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

      {/* ── CFG-7: Profissionais sem acesso ao app ─────────────────────────── */}
      <div className="pt-2 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Profissionais sem acesso ao app</h2>
            <p className="text-sm text-gray-400">
              Prestam serviços e aparecem na agenda, mas não entram no sistema.
            </p>
          </div>
          {isManager && (
            <button
              onClick={() => { setShowProForm(true); setProError('') }}
              className="border border-primary text-primary hover:bg-primary/5 text-sm font-semibold px-4 py-2 rounded-xl transition-colors whitespace-nowrap"
            >
              + Profissional
            </button>
          )}
        </div>

        {isManager && showProForm && (
          <div className="bg-white rounded-2xl p-5 border border-primary/30 shadow-sm space-y-3">
            <p className="font-semibold text-gray-900 text-sm">Novo profissional (sem conta)</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Nome *</label>
                <input value={proForm.name} onChange={(e) => setProForm((f) => ({ ...f, name: e.target.value }))}
                  className={inputCls} placeholder="Ana Souza" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Telefone</label>
                <input value={proForm.phone} onChange={(e) => setProForm((f) => ({ ...f, phone: formatBRPhone(e.target.value) }))}
                  className={inputCls} placeholder="(11) 99999-9999" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Bio (opcional)</label>
                <input value={proForm.bio} onChange={(e) => setProForm((f) => ({ ...f, bio: e.target.value }))}
                  className={inputCls} placeholder="Especialista em..." />
              </div>
            </div>
            {proError && <p className="text-red-500 text-xs">{proError}</p>}
            <div className="flex gap-2">
              <button
                onClick={() => { if (!proForm.name.trim()) { setProError('Informe o nome do profissional.'); return } addProMutation.mutate() }}
                disabled={addProMutation.isPending}
                className="flex-1 h-10 bg-primary text-white text-sm font-semibold rounded-xl disabled:opacity-50">
                {addProMutation.isPending ? 'Adicionando...' : 'Adicionar'}
              </button>
              <button onClick={() => setShowProForm(false)}
                className="flex-1 h-10 border border-gray-200 text-gray-600 text-sm rounded-xl hover:bg-gray-50">
                Cancelar
              </button>
            </div>
          </div>
        )}

        {(() => {
          const standalone = (professionals as any[]).filter((p) => !p.user_id)
          if (standalone.length === 0) {
            return (
              <div className="bg-white rounded-2xl p-6 text-center border border-gray-100">
                <p className="text-gray-400 text-sm">Nenhum profissional sem conta cadastrado.</p>
              </div>
            )
          }
          return (
            <div className="space-y-3">
              {standalone.map((p) => {
                const isEditingPro = editingProId === p.id
                return (
                  <div key={p.id} className={`bg-white rounded-2xl p-4 border shadow-sm ${isEditingPro ? 'border-primary/30' : 'border-gray-100'}`}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-gray-900">{p.name}</p>
                          <span className="text-xs font-medium px-2.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
                            Profissional
                          </span>
                        </div>
                        <p className="text-gray-400 text-sm mt-0.5">
                          {p.phone || 'Sem telefone'}{p.bio ? ` · ${p.bio}` : ''}
                        </p>
                      </div>
                      {isManager && (
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => (isEditingPro ? setEditingProId(null) : startEditPro(p))}
                            className="text-gray-400 hover:text-primary text-sm px-2.5 py-1.5 rounded-lg hover:bg-gray-50 transition-colors"
                          >
                            Editar
                          </button>
                          <button
                            onClick={() => { if (confirm(`Remover ${p.name}?`)) removeProfessional.mutate(p.id) }}
                            className="text-gray-400 hover:text-red-500 text-sm px-2.5 py-1.5 rounded-lg hover:bg-red-50 transition-colors"
                          >
                            Excluir
                          </button>
                        </div>
                      )}
                    </div>

                    {isManager && isEditingPro && (
                      <div className="mt-4 pt-4 border-t border-gray-100 space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">Nome *</label>
                            <input value={proEditForm.name} onChange={(e) => setProEditForm((f) => ({ ...f, name: e.target.value }))}
                              className={inputCls} />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">Telefone</label>
                            <input value={proEditForm.phone} onChange={(e) => setProEditForm((f) => ({ ...f, phone: formatBRPhone(e.target.value) }))}
                              className={inputCls} placeholder="(11) 99999-9999" />
                          </div>
                          <div className="col-span-2">
                            <label className="block text-xs font-medium text-gray-600 mb-1">Bio</label>
                            <input value={proEditForm.bio} onChange={(e) => setProEditForm((f) => ({ ...f, bio: e.target.value }))}
                              className={inputCls} />
                          </div>
                        </div>
                        {proEditError && <p className="text-red-500 text-xs">{proEditError}</p>}
                        <div className="flex gap-2">
                          <button onClick={() => saveEditPro(p.id)} disabled={updateProMutation.isPending}
                            className="flex-1 h-10 bg-primary text-white text-sm font-semibold rounded-xl disabled:opacity-50">
                            {updateProMutation.isPending ? 'Salvando...' : 'Salvar'}
                          </button>
                          <button onClick={() => { setEditingProId(null); setProEditError('') }}
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
          )
        })()}
      </div>
    </div>
  )
}
