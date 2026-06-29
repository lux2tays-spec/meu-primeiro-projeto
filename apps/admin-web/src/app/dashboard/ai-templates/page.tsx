'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { rootApi } from '@/lib/api'

const BLANK = { business_type: '', display_name: '', system_prompt: '', custom_instructions: '', tone: 'amigável e profissional' }

export default function AITemplatesPage() {
  const qc = useQueryClient()
  const { data: templates = [], isLoading } = useQuery({ queryKey: ['ai-templates'], queryFn: rootApi.businessTypeTemplates })

  const [editing, setEditing] = useState<any>(null)
  const [showNew, setShowNew] = useState(false)
  const [form, setForm] = useState(BLANK)
  const [error, setError] = useState('')

  const createMutation = useMutation({
    mutationFn: rootApi.createBusinessTypeTemplate,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ai-templates'] }); setShowNew(false); setForm(BLANK); setError('') },
    onError: (e: any) => setError(e.message),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: any) => rootApi.updateBusinessTypeTemplate(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ai-templates'] }); setEditing(null); setError('') },
    onError: (e: any) => setError(e.message),
  })

  const deleteMutation = useMutation({
    mutationFn: rootApi.deleteBusinessTypeTemplate,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai-templates'] }),
  })

  function openEdit(t: any) {
    setEditing(t)
    setForm({ business_type: t.business_type, display_name: t.display_name, system_prompt: t.system_prompt, custom_instructions: t.custom_instructions, tone: t.tone })
    setError('')
  }

  const inputCls = 'w-full h-10 px-3 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary'
  const textareaCls = 'w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none'

  const FormFields = ({ isNew }: { isNew: boolean }) => (
    <div className="space-y-3 mt-3">
      <div className="grid grid-cols-2 gap-3">
        {isNew && (
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Chave (slug) *</label>
            <input value={form.business_type} onChange={e => setForm(f => ({ ...f, business_type: e.target.value }))}
              className={inputCls} placeholder="clinica_estetica" />
          </div>
        )}
        <div className={isNew ? '' : 'col-span-2'}>
          <label className="block text-xs font-medium text-gray-600 mb-1">Nome de exibição *</label>
          <input value={form.display_name} onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))}
            className={inputCls} placeholder="Clínica Estética" />
        </div>
        {!isNew && (
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Tom de voz</label>
            <input value={form.tone} onChange={e => setForm(f => ({ ...f, tone: e.target.value }))}
              className={inputCls} placeholder="amigável e profissional" />
          </div>
        )}
        {isNew && (
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-600 mb-1">Tom de voz</label>
            <input value={form.tone} onChange={e => setForm(f => ({ ...f, tone: e.target.value }))}
              className={inputCls} placeholder="amigável e profissional" />
          </div>
        )}
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Prompt base do agente</label>
        <p className="text-xs text-gray-400 mb-1">Instrução principal que define como o bot se comporta neste tipo de negócio.</p>
        <textarea value={form.system_prompt} onChange={e => setForm(f => ({ ...f, system_prompt: e.target.value }))}
          className={textareaCls} rows={4} placeholder="Você é a atendente virtual de uma clínica de estética..." />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Instruções específicas do ramo</label>
        <p className="text-xs text-gray-400 mb-1">Regras e orientações específicas para este tipo de negócio (aplicadas a todos os tenants do ramo).</p>
        <textarea value={form.custom_instructions} onChange={e => setForm(f => ({ ...f, custom_instructions: e.target.value }))}
          className={textareaCls} rows={4} placeholder="Sempre pergunte se o cliente já veio antes..." />
      </div>
    </div>
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Templates de IA por Tipo de Negócio</h1>
          <p className="text-gray-500 text-sm mt-1">Configure o comportamento padrão do agente para cada ramo de atuação. Esses templates são aplicados automaticamente a todos os tenants do ramo.</p>
        </div>
        <button onClick={() => { setShowNew(true); setEditing(null); setForm(BLANK); setError('') }}
          className="bg-primary hover:bg-primary-dark text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors">
          + Novo template
        </button>
      </div>

      {showNew && (
        <div className="bg-white rounded-2xl p-5 border border-primary/30 shadow-sm">
          <p className="font-semibold text-gray-900 text-sm">Novo template</p>
          <FormFields isNew={true} />
          {error && <p className="text-red-500 text-xs mt-2">{error}</p>}
          <div className="flex gap-2 mt-4">
            <button onClick={() => createMutation.mutate(form)} disabled={createMutation.isPending}
              className="flex-1 h-10 bg-primary text-white text-sm font-semibold rounded-xl disabled:opacity-50">
              {createMutation.isPending ? 'Salvando...' : 'Criar template'}
            </button>
            <button onClick={() => setShowNew(false)}
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
          {(templates as any[]).map((t) => (
            <div key={t.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              {editing?.id === t.id ? (
                <div className="p-5">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="font-semibold text-gray-900 text-sm">{t.display_name}</p>
                    <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full font-mono">{t.business_type}</span>
                  </div>
                  <FormFields isNew={false} />
                  {error && <p className="text-red-500 text-xs mt-2">{error}</p>}
                  <div className="flex gap-2 mt-4">
                    <button onClick={() => updateMutation.mutate({ id: t.id, data: { display_name: form.display_name, system_prompt: form.system_prompt, custom_instructions: form.custom_instructions, tone: form.tone } })}
                      disabled={updateMutation.isPending}
                      className="flex-1 h-10 bg-primary text-white text-sm font-semibold rounded-xl disabled:opacity-50">
                      {updateMutation.isPending ? 'Salvando...' : 'Salvar alterações'}
                    </button>
                    <button onClick={() => setEditing(null)}
                      className="flex-1 h-10 border border-gray-200 text-gray-600 text-sm rounded-xl hover:bg-gray-50">
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <div className="p-4 flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-gray-900">{t.display_name}</p>
                      <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full font-mono">{t.business_type}</span>
                      <span className="text-xs bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full">{t.tone}</span>
                    </div>
                    {t.system_prompt && (
                      <p className="text-gray-500 text-xs mt-1 line-clamp-2">{t.system_prompt}</p>
                    )}
                    {t.custom_instructions && (
                      <p className="text-gray-400 text-xs mt-0.5 line-clamp-1">Instruções: {t.custom_instructions}</p>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => openEdit(t)}
                      className="text-gray-400 hover:text-primary text-sm px-3 py-1.5 rounded-lg hover:bg-primary/5 transition-colors font-medium">
                      Editar
                    </button>
                    <button onClick={() => { if (confirm('Excluir este template?')) deleteMutation.mutate(t.id) }}
                      className="text-gray-400 hover:text-red-500 text-sm px-3 py-1.5 rounded-lg hover:bg-red-50 transition-colors">
                      Excluir
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
