'use client'
import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { rootApi } from '@/lib/api'
import { Badge } from '@/components/ui/Badge'
import { RemoteSupport } from './RemoteSupport'

const planVariant: Record<string, any> = { free: 'default', basico: 'info', premium: 'purple', profissional: 'success' }
const planLabel: Record<string, string> = { free: 'Free', basico: 'Básico', premium: 'Premium', profissional: 'Profissional' }
const statusVariant: Record<string, any> = { active: 'success', trial: 'warning', suspended: 'danger', cancelled: 'danger' }
const statusLabel: Record<string, string> = { active: 'Ativo', trial: 'Trial', suspended: 'Suspenso', cancelled: 'Cancelado' }
const roleLabel: Record<string, string> = { owner: 'Proprietário', admin: 'Admin', staff: 'Colaborador' }

const STAFF_BLANK = { name: '', email: '', phone: '', role: 'staff', user_id: '' }

export default function TenantDetailPage() {
  const { id } = useParams<{ id: string }>()
  const qc = useQueryClient()

  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<any>(null)
  const [successMsg, setSuccessMsg] = useState('')
  const [handoff, setHandoff] = useState<any>(null)
  const [agent, setAgent] = useState<any>(null)

  // Staff modal state: null | 'add' | user obj (edit)
  const [staffModal, setStaffModal] = useState<null | 'add' | any>(null)
  const [staffForm, setStaffForm] = useState(STAFF_BLANK)
  const [staffErr, setStaffErr] = useState('')
  const [confirmRemove, setConfirmRemove] = useState<any>(null)

  const { data: tenant, isLoading } = useQuery({
    queryKey: ['root-tenant', id],
    queryFn: () => rootApi.tenant(id),
  })

  // Registered business types (AI templates) — used to pick the tenant's segment.
  const { data: bizTemplates = [] } = useQuery({ queryKey: ['ai-templates'], queryFn: rootApi.businessTypeTemplates })

  useEffect(() => {
    if (tenant && !form) {
      setForm({
        plan: tenant.plan,
        status: tenant.status,
        max_agendas: tenant.max_agendas,
        max_users: tenant.max_users,
        trial_ends_at: tenant.trial_ends_at ? tenant.trial_ends_at.slice(0, 10) : '',
      })
    }
  }, [tenant])

  useEffect(() => {
    if (tenant && !handoff) {
      setHandoff({
        handoff_enabled: tenant.handoff_enabled ?? true,
        handoff_pause_on_owner_reply: tenant.handoff_pause_on_owner_reply ?? true,
        handoff_timeout_min: tenant.handoff_timeout_min ?? 30,
        handoff_offer_message: tenant.handoff_offer_message ?? '',
        handoff_button_label: tenant.handoff_button_label ?? '',
        handoff_ack_message: tenant.handoff_ack_message ?? '',
        handoff_resume_message: tenant.handoff_resume_message ?? '',
        handoff_owner_resume_keyword: tenant.handoff_owner_resume_keyword ?? '',
      })
    }
  }, [tenant])

  useEffect(() => {
    if (tenant && !agent) {
      setAgent({
        business_type: tenant.business_type ?? '',
        tone: tenant.tone ?? '',
        language: tenant.language ?? '',
        business_info: tenant.business_info ?? '',
        system_prompt: tenant.system_prompt ?? '',
        custom_instructions: tenant.custom_instructions ?? '',
      })
    }
  }, [tenant])

  const showSuccess = (msg: string) => { setSuccessMsg(msg); setTimeout(() => setSuccessMsg(''), 3000) }

  const updateMutation = useMutation({
    mutationFn: (data: any) => rootApi.updateTenant(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['root-tenant', id] }); qc.invalidateQueries({ queryKey: ['root-tenants'] }); setEditing(false); showSuccess('Tenant atualizado!') },
  })

  const extendMutation = useMutation({
    mutationFn: (days: number) => rootApi.extendTrial(id, days),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['root-tenant', id] }); showSuccess('Trial estendido!') },
  })

  const handoffMutation = useMutation({
    mutationFn: () => rootApi.updateTenantHandoff(id, {
      ...handoff,
      handoff_timeout_min: Math.max(1, parseInt(String(handoff.handoff_timeout_min), 10) || 30),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['root-tenant', id] }); showSuccess('Atendimento humano atualizado!') },
  })

  const agentMutation = useMutation({
    mutationFn: () => {
      // Only send fields that are defined (backend accepts any subset)
      const payload = Object.fromEntries(
        Object.entries(agent ?? {}).filter(([, v]) => v !== undefined)
      )
      return rootApi.updateTenantAgent(id, payload)
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['root-tenant', id] }); showSuccess('Configuração da IA atualizada!') },
  })

  const addStaffMutation = useMutation({
    mutationFn: () => rootApi.addTenantStaff(id, { user_id: staffForm.user_id, role: staffForm.role }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['root-tenant', id] }); setStaffModal(null) },
    onError: (e: any) => setStaffErr(e.message),
  })

  const editStaffMutation = useMutation({
    mutationFn: () => rootApi.editTenantStaff(id, staffModal.id, {
      name: staffForm.name || undefined,
      email: staffForm.email || undefined,
      phone: staffForm.phone,
      role: staffForm.role !== staffModal.role ? staffForm.role : undefined,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['root-tenant', id] }); setStaffModal(null) },
    onError: (e: any) => setStaffErr(e.message),
  })

  const removeStaffMutation = useMutation({
    mutationFn: (userId: string) => rootApi.removeTenantStaff(id, userId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['root-tenant', id] }); setConfirmRemove(null) },
  })

  const openAddStaff = () => { setStaffForm(STAFF_BLANK); setStaffErr(''); setStaffModal('add') }
  const openEditStaff = (u: any) => { setStaffForm({ name: u.name, email: u.email, phone: u.phone ?? '', role: u.role, user_id: u.id }); setStaffErr(''); setStaffModal(u) }

  if (isLoading) return <div className="p-8 text-gray-400">Carregando...</div>
  if (!tenant) return <div className="p-8 text-red-500">Tenant não encontrado</div>

  const isStaffEditing = staffModal && staffModal !== 'add'

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <Link href="/dashboard/tenants" className="text-sm text-gray-400 hover:text-gray-600 mb-2 inline-block">← Tenants</Link>
          <h1 className="text-2xl font-bold text-gray-900">{tenant.name}</h1>
          <p className="text-gray-400 text-sm font-mono mt-1">{tenant.id}</p>
        </div>
        <div className="flex gap-3">
          <Badge label={planLabel[tenant.plan] ?? tenant.plan} variant={planVariant[tenant.plan]} />
          <Badge label={statusLabel[tenant.status] ?? tenant.status} variant={statusVariant[tenant.status]} />
        </div>
      </div>

      {successMsg && <div className="bg-green-50 text-green-700 rounded-xl px-4 py-3 text-sm font-medium">{successMsg}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">

          {/* Account config */}
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-gray-900">Configuração da conta</h2>
              <button onClick={() => {
                if (editing) {
                  // Reset form on cancel
                  setForm({ plan: tenant.plan, status: tenant.status, max_agendas: tenant.max_agendas, max_users: tenant.max_users, trial_ends_at: tenant.trial_ends_at ? tenant.trial_ends_at.slice(0, 10) : '' })
                }
                setEditing(!editing)
              }} className="text-sm text-primary hover:text-primary-dark font-medium">
                {editing ? 'Cancelar' : 'Editar'}
              </button>
            </div>

            {editing && form ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Plano</label>
                    <select
                      value={form.plan}
                      onChange={(e) => setForm((f: any) => ({ ...f, plan: e.target.value }))}
                      className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white"
                    >
                      {Object.entries(planLabel).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                    <select
                      value={form.status}
                      onChange={(e) => setForm((f: any) => ({ ...f, status: e.target.value }))}
                      className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white"
                    >
                      {Object.entries(statusLabel).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Máx. agendas</label>
                    <input type="number" value={form.max_agendas} onChange={(e) => setForm((f: any) => ({ ...f, max_agendas: Number(e.target.value) }))}
                      className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Máx. usuários</label>
                    <input type="number" value={form.max_users} onChange={(e) => setForm((f: any) => ({ ...f, max_users: Number(e.target.value) }))}
                      className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Trial expira em</label>
                    <input type="date" value={form.trial_ends_at ?? ''} onChange={(e) => setForm((f: any) => ({ ...f, trial_ends_at: e.target.value || null }))}
                      className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
                  </div>
                </div>
                <button
                  onClick={() => updateMutation.mutate({
                    plan: form.plan,
                    status: form.status,
                    max_agendas: Number(form.max_agendas) || 1,
                    max_users: Number(form.max_users) || 1,
                    // Backend expects a full ISO datetime (or null to keep current);
                    // the date input gives YYYY-MM-DD — send noon local as ISO.
                    trial_ends_at: form.trial_ends_at ? new Date(`${form.trial_ends_at}T12:00:00`).toISOString() : null,
                  })}
                  disabled={updateMutation.isPending}
                  className="h-10 px-6 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary-dark disabled:opacity-50 transition-colors"
                >
                  {updateMutation.isPending ? 'Salvando...' : 'Salvar alterações'}
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <Info label="Plano" value={planLabel[tenant.plan] ?? tenant.plan} />
                <Info label="Status" value={statusLabel[tenant.status] ?? tenant.status} />
                <Info label="Máx. agendas" value={tenant.max_agendas} />
                <Info label="Máx. usuários" value={tenant.max_users} />
                <Info label="Trial expira" value={tenant.trial_ends_at ? new Date(tenant.trial_ends_at).toLocaleDateString('pt-BR') : '—'} />
                <Info label="Cadastrado em" value={new Date(tenant.created_at).toLocaleDateString('pt-BR')} />
              </div>
            )}
          </div>

          {/* Staff */}
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-gray-900">Colaboradores ({tenant.staff?.length ?? 0})</h2>
              <button onClick={openAddStaff} className="text-sm text-primary hover:text-primary-dark font-medium">
                + Adicionar
              </button>
            </div>
            <div className="space-y-2">
              {tenant.staff?.map((u: any) => (
                <div key={u.id} className="flex items-center gap-3 p-3 rounded-xl hover:bg-gray-50">
                  <div className="w-9 h-9 rounded-xl bg-primary-light flex items-center justify-center font-bold text-primary text-sm flex-shrink-0">
                    {u.name.charAt(0)}
                  </div>
                  <div className="flex-1">
                    <div className="font-medium text-gray-900 text-sm">{u.name}</div>
                    <div className="text-xs text-gray-400">{u.email}{u.phone ? ` • ${u.phone}` : ''}</div>
                  </div>
                  <Badge label={roleLabel[u.role] ?? u.role} variant={u.role === 'owner' ? 'success' : u.role === 'admin' ? 'info' : 'default'} />
                  <button onClick={() => openEditStaff(u)} className="text-xs text-primary hover:text-primary-dark font-medium ml-1">Editar</button>
                  {u.role !== 'owner' && (
                    <button onClick={() => setConfirmRemove(u)} className="text-xs text-red-400 hover:text-red-600 font-medium">Remover</button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* AI agent config */}
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
            <h2 className="font-semibold text-gray-900">Configuração da IA (bot)</h2>
            <p className="text-sm text-gray-500 mt-1 mb-4">Ajuste os prompts e o comportamento do assistente desta empresa (útil para corrigir respostas no WhatsApp).</p>

            {agent && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Tipo de negócio</label>
                  <select
                    value={agent.business_type ?? ''}
                    onChange={(e) => setAgent((a: any) => ({ ...a, business_type: e.target.value }))}
                    className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="">— Nenhum —</option>
                    {(bizTemplates as any[]).map((tpl) => (
                      <option key={tpl.id} value={tpl.business_type}>{tpl.display_name}</option>
                    ))}
                    {/* Preserva um valor antigo que não está mais na lista de templates */}
                    {agent.business_type && !(bizTemplates as any[]).some((tpl) => tpl.business_type === agent.business_type) && (
                      <option value={agent.business_type}>{agent.business_type} (não cadastrado)</option>
                    )}
                  </select>
                  <p className="text-xs text-gray-400 mt-1">Escolha um dos tipos cadastrados em <strong>Templates de IA</strong>. Define o comportamento padrão do bot para o segmento.</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Tom de voz</label>
                  <input
                    type="text"
                    value={agent.tone}
                    onChange={(e) => setAgent((a: any) => ({ ...a, tone: e.target.value }))}
                    className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  <p className="text-xs text-gray-400 mt-1">Como o assistente fala (ex: amigável e caloroso, formal, descontraído).</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Idioma</label>
                  <input
                    type="text"
                    value={agent.language}
                    onChange={(e) => setAgent((a: any) => ({ ...a, language: e.target.value }))}
                    className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  <p className="text-xs text-gray-400 mt-1">Idioma das respostas (padrão: Português do Brasil).</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Informações do negócio</label>
                  <textarea
                    value={agent.business_info}
                    onChange={(e) => setAgent((a: any) => ({ ...a, business_info: e.target.value }))}
                    rows={3}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-y"
                  />
                  <p className="text-xs text-gray-400 mt-1">Dados que o bot pode usar (diferenciais, políticas, observações).</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Prompt do sistema</label>
                  <textarea
                    value={agent.system_prompt}
                    onChange={(e) => setAgent((a: any) => ({ ...a, system_prompt: e.target.value }))}
                    rows={5}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-y font-mono"
                  />
                  <p className="text-xs text-gray-400 mt-1">Instruções base do assistente. Cuidado ao editar — define a personalidade e as regras.</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Instruções personalizadas</label>
                  <textarea
                    value={agent.custom_instructions}
                    onChange={(e) => setAgent((a: any) => ({ ...a, custom_instructions: e.target.value }))}
                    rows={4}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-y"
                  />
                  <p className="text-xs text-gray-400 mt-1">Regras específicas desta empresa, somadas ao prompt do sistema.</p>
                </div>

                {agentMutation.isError && (
                  <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-2">{(agentMutation.error as any)?.message ?? 'Erro ao salvar'}</p>
                )}

                <button
                  onClick={() => agentMutation.mutate()}
                  disabled={agentMutation.isPending}
                  className="h-10 px-6 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary-dark disabled:opacity-50 transition-colors"
                >
                  {agentMutation.isPending ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            )}
          </div>

          {/* Human handoff */}
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
            <h2 className="font-semibold text-gray-900">Atendimento humano</h2>
            <p className="text-sm text-gray-500 mt-1 mb-4">Como o bot passa a conversa para um humano nesta empresa (mesmas opções que o dono vê no app).</p>

            {handoff && (
              <div className="space-y-4">
                <div>
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={handoff.handoff_enabled}
                      onChange={(e) => setHandoff((h: any) => ({ ...h, handoff_enabled: e.target.checked }))}
                      className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary"
                    />
                    Atendimento humano ativado
                  </label>
                  <p className="text-xs text-gray-400 mt-1">Quando ligado, o bot pausa se um humano assumir e volta sozinho depois.</p>
                </div>

                <div>
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={handoff.handoff_pause_on_owner_reply}
                      onChange={(e) => setHandoff((h: any) => ({ ...h, handoff_pause_on_owner_reply: e.target.checked }))}
                      className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary"
                    />
                    Pausar o bot quando o dono responder
                  </label>
                  <p className="text-xs text-gray-400 mt-1">Se o dono responder o cliente pelo WhatsApp dele, o bot para de responder automaticamente.</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Tempo de retorno do bot (min)</label>
                  <input
                    type="number"
                    min={1}
                    value={handoff.handoff_timeout_min}
                    onChange={(e) => setHandoff((h: any) => ({ ...h, handoff_timeout_min: e.target.value }))}
                    className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  <p className="text-xs text-gray-400 mt-1">Minutos sem resposta do humano até o bot voltar a atender sozinho.</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Frase de ativação (pergunta do bot)</label>
                  <input
                    type="text"
                    value={handoff.handoff_offer_message}
                    onChange={(e) => setHandoff((h: any) => ({ ...h, handoff_offer_message: e.target.value }))}
                    placeholder="Quer que eu encaminhe para um especialista?"
                    className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  <p className="text-xs text-gray-400 mt-1">Pergunta que o bot envia quando não consegue resolver, oferecendo um especialista.</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Texto do botão</label>
                  <input
                    type="text"
                    value={handoff.handoff_button_label}
                    onChange={(e) => setHandoff((h: any) => ({ ...h, handoff_button_label: e.target.value }))}
                    placeholder="Quero ajuda de um especialista"
                    className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  <p className="text-xs text-gray-400 mt-1">O que o cliente toca/responde para pedir um humano.</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Confirmação ao cliente</label>
                  <textarea
                    value={handoff.handoff_ack_message}
                    onChange={(e) => setHandoff((h: any) => ({ ...h, handoff_ack_message: e.target.value }))}
                    placeholder="Perfeito! Já avisei a equipe 🙌 …"
                    rows={3}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-y"
                  />
                  <p className="text-xs text-gray-400 mt-1">Mensagem enviada ao cliente logo depois que ele pede o especialista.</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Mensagem de retorno (opcional)</label>
                  <input
                    type="text"
                    value={handoff.handoff_resume_message}
                    onChange={(e) => setHandoff((h: any) => ({ ...h, handoff_resume_message: e.target.value }))}
                    className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  <p className="text-xs text-gray-400 mt-1">Enviada quando o bot volta a atender após o tempo. Deixe vazio para voltar sem avisar.</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Palavra para devolver ao bot (opcional)</label>
                  <input
                    type="text"
                    value={handoff.handoff_owner_resume_keyword}
                    onChange={(e) => setHandoff((h: any) => ({ ...h, handoff_owner_resume_keyword: e.target.value }))}
                    className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  <p className="text-xs text-gray-400 mt-1">O dono digita essa palavra no chat para devolver o atendimento ao bot na hora. Deixe vazio para desativar.</p>
                </div>

                {handoffMutation.isError && (
                  <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-2">{(handoffMutation.error as any)?.message ?? 'Erro ao salvar'}</p>
                )}

                <button
                  onClick={() => handoffMutation.mutate()}
                  disabled={handoffMutation.isPending}
                  className="h-10 px-6 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary-dark disabled:opacity-50 transition-colors"
                >
                  {handoffMutation.isPending ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-4">
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 space-y-3">
            <h2 className="font-semibold text-gray-900">Proprietário</h2>
            <Info label="Nome" value={tenant.owner_name ?? '—'} />
            <Info label="E-mail" value={tenant.owner_email ?? '—'} />
            <Info label="WhatsApp" value={tenant.whatsapp_status === 'connected' ? `✅ ${tenant.whatsapp_phone ?? 'Conectado'}` : '❌ Desconectado'} />
            {tenant.subscription_status && <Info label="Assinatura MP" value={tenant.subscription_status} />}
          </div>

          <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 space-y-3">
            <h2 className="font-semibold text-gray-900 mb-3">Ações rápidas</h2>
            <button onClick={() => extendMutation.mutate(7)} disabled={extendMutation.isPending}
              className="w-full h-10 bg-yellow-50 text-yellow-700 border border-yellow-200 rounded-xl text-sm font-medium hover:bg-yellow-100 transition-colors disabled:opacity-50">
              ⏰ Estender trial 7 dias
            </button>
            <button onClick={() => updateMutation.mutate({ status: 'active' })}
              className="w-full h-10 bg-green-50 text-green-700 border border-green-200 rounded-xl text-sm font-medium hover:bg-green-100 transition-colors">
              ✅ Ativar conta
            </button>
            <button onClick={() => { if (confirm('Suspender este tenant?')) updateMutation.mutate({ status: 'suspended' }) }}
              className="w-full h-10 bg-red-50 text-red-600 border border-red-200 rounded-xl text-sm font-medium hover:bg-red-100 transition-colors">
              🚫 Suspender
            </button>
          </div>
        </div>
      </div>

      {/* Remote support toolkit */}
      <RemoteSupport tenantId={id} showSuccess={showSuccess} />

      {/* Staff modal (add or edit) */}
      {staffModal !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <h2 className="text-lg font-bold text-gray-900">
              {isStaffEditing ? 'Editar colaborador' : 'Adicionar colaborador'}
            </h2>

            {staffErr && <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-2">{staffErr}</p>}

            {isStaffEditing ? (
              <>
                <SField label="Nome" value={staffForm.name} onChange={(v) => setStaffForm((f: any) => ({ ...f, name: v }))} />
                <SField label="E-mail" value={staffForm.email} onChange={(v) => setStaffForm((f: any) => ({ ...f, email: v }))} type="email" />
                <SField label="Telefone" value={staffForm.phone} onChange={(v) => setStaffForm((f: any) => ({ ...f, phone: v }))} />
                {staffModal.role !== 'owner' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Tipo</label>
                    <select value={staffForm.role} onChange={(e) => setStaffForm((f: any) => ({ ...f, role: e.target.value }))}
                      className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white">
                      <option value="admin">Admin</option>
                      <option value="staff">Colaborador</option>
                    </select>
                  </div>
                )}
              </>
            ) : (
              <>
                <SField label="ID do usuário (UUID)" value={staffForm.user_id} onChange={(v) => setStaffForm((f: any) => ({ ...f, user_id: v }))} placeholder="Cole o UUID do usuário" />
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Tipo</label>
                  <select value={staffForm.role} onChange={(e) => setStaffForm((f: any) => ({ ...f, role: e.target.value }))}
                    className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white">
                    <option value="admin">Admin</option>
                    <option value="staff">Colaborador</option>
                  </select>
                </div>
              </>
            )}

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => isStaffEditing ? editStaffMutation.mutate() : addStaffMutation.mutate()}
                disabled={addStaffMutation.isPending || editStaffMutation.isPending}
                className="flex-1 h-10 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary-dark disabled:opacity-50 transition-colors"
              >
                {addStaffMutation.isPending || editStaffMutation.isPending ? 'Salvando...' : isStaffEditing ? 'Salvar' : 'Adicionar'}
              </button>
              <button onClick={() => setStaffModal(null)} className="h-10 px-4 rounded-xl border border-gray-200 text-sm font-medium hover:bg-gray-50">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Remove staff confirm */}
      {confirmRemove && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h2 className="text-lg font-bold text-gray-900">Remover colaborador</h2>
            <p className="text-sm text-gray-600">Remover <strong>{confirmRemove.name}</strong> deste tenant?</p>
            <div className="flex gap-3">
              <button onClick={() => removeStaffMutation.mutate(confirmRemove.id)} disabled={removeStaffMutation.isPending}
                className="flex-1 h-10 bg-red-600 text-white rounded-xl text-sm font-semibold hover:bg-red-700 disabled:opacity-50">
                {removeStaffMutation.isPending ? 'Removendo...' : 'Confirmar'}
              </button>
              <button onClick={() => setConfirmRemove(null)} className="h-10 px-4 rounded-xl border border-gray-200 text-sm font-medium hover:bg-gray-50">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Info({ label, value }: { label: string; value: any }) {
  return (
    <div>
      <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">{label}</span>
      <p className="text-sm font-medium text-gray-900 mt-0.5">{String(value)}</p>
    </div>
  )
}

function SField({ label, value, onChange, placeholder, type = 'text' }: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: string
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
    </div>
  )
}
