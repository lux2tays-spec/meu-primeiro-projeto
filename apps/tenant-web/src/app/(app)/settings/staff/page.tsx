'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { tenantApi } from '@/lib/api'

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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['staff'] }),
  })

  const addAsProfessional = useMutation({
    mutationFn: ({ userId, name }: { userId: string; name: string }) =>
      tenantApi.addProfessional({ name, user_id: userId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['professionals'] })
    },
    onError: (e: any) => alert(e.message),
  })

  const removeProfessional = useMutation({
    mutationFn: tenantApi.removeProfessional,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['professionals'] }),
  })

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
        <button onClick={() => setShowForm(true)}
          className="bg-primary hover:bg-primary-dark text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors">
          + Adicionar
        </button>
      </div>

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
        <p className="text-gray-400 text-sm">Carregando...</p>
      ) : (
        <div className="space-y-3">
          {(staff as any[]).map((u) => {
            const isProf = isProfessional(u.id)
            const profId = professionalId(u.id)
            return (
              <div key={u.id} className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
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
                    {u.role !== 'owner' && (
                      <button
                        onClick={() => { if (confirm(`Remover ${u.name} da equipe?`)) removeMutation.mutate(u.id) }}
                        className="text-gray-400 hover:text-red-500 text-sm px-2.5 py-1.5 rounded-lg hover:bg-red-50 transition-colors"
                      >
                        Remover
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
