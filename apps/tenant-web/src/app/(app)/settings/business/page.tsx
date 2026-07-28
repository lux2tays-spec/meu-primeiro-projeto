'use client'
import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { tenantApi, getToken } from '@/lib/api'
import Loading from '@/components/ui/Loading'
import { getTokenPayload } from '@/lib/auth'

export default function BusinessPage() {
  const qc = useQueryClient()
  const { data: tenant, isLoading } = useQuery({ queryKey: ['tenant'], queryFn: tenantApi.me })

  const payload = getTokenPayload(getToken())
  const canEdit = ['owner', 'admin', 'root'].includes(payload?.role)

  const [form, setForm] = useState({ name: '', contact_email: '', contact_phone: '', responsible_name: '' })
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (tenant) {
      setForm({
        name: tenant.name ?? '',
        contact_email: tenant.contact_email ?? '',
        contact_phone: tenant.contact_phone ?? '',
        responsible_name: tenant.responsible_name ?? '',
      })
    }
  }, [tenant])

  const saveMutation = useMutation({
    mutationFn: (data: typeof form) =>
      tenantApi.updateBusiness({
        name: data.name,
        contact_email: data.contact_email || null,
        contact_phone: data.contact_phone || null,
        responsible_name: data.responsible_name || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tenant'] })
      setError('')
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    },
    onError: (e: any) => { setSaved(false); setError(e.message) },
  })

  const inputCls = 'w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary'

  if (!canEdit) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-2xl font-bold text-gray-900 mb-4">Dados do negócio</h1>
        <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
          <p className="text-gray-500 text-sm">Apenas o proprietário ou administradores podem editar os dados do negócio.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dados do negócio</h1>
        <p className="text-gray-400 text-sm mt-1">Nome da empresa e informações de contato exibidas na plataforma.</p>
      </div>

      {isLoading ? (
        <Loading card />
      ) : (
        <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Nome da empresa</label>
            <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className={inputCls} placeholder="Minha Empresa" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">E-mail de contato</label>
              <input type="email" value={form.contact_email} onChange={(e) => setForm((f) => ({ ...f, contact_email: e.target.value }))}
                className={inputCls} placeholder="contato@empresa.com" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Telefone</label>
              <input value={form.contact_phone} onChange={(e) => setForm((f) => ({ ...f, contact_phone: e.target.value }))}
                className={inputCls} placeholder="(11) 99999-9999" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Nome do responsável</label>
            <input value={form.responsible_name} onChange={(e) => setForm((f) => ({ ...f, responsible_name: e.target.value }))}
              className={inputCls} placeholder="Maria Silva" />
          </div>

          {error && <p className="text-red-500 text-xs">{error}</p>}
          {saved && <p className="text-green-600 text-xs">Dados salvos com sucesso.</p>}

          <button
            onClick={() => saveMutation.mutate(form)}
            disabled={saveMutation.isPending || !form.name.trim()}
            className="w-full h-10 bg-primary hover:bg-primary-dark text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-50"
          >
            {saveMutation.isPending ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      )}
    </div>
  )
}
