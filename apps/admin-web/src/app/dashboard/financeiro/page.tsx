'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { rootApi } from '@/lib/api'

// Gestão dos parâmetros financeiros da plataforma: os subtipos de despesa
// (Tipo/Subtipo) que os tenants usam no módulo financeiro. Root pode incluir,
// editar e excluir.
const BLANK = { tipo: 'Fixa', nome: '', is_percent: false, color: '#6B7280', icon: '', sort: 0, active: true }

export default function FinanceiroParamsPage() {
  const qc = useQueryClient()
  const { data: subtypes = [], isLoading } = useQuery({ queryKey: ['expense-subtypes'], queryFn: rootApi.expenseSubtypes })
  const [form, setForm] = useState<any>(BLANK)
  const [editingId, setEditingId] = useState<string | null>(null)

  const invalidate = () => qc.invalidateQueries({ queryKey: ['expense-subtypes'] })
  const save = useMutation({
    mutationFn: () => editingId ? rootApi.updateExpenseSubtype(editingId, form) : rootApi.createExpenseSubtype(form),
    onSuccess: () => { invalidate(); setForm(BLANK); setEditingId(null) },
  })
  const del = useMutation({ mutationFn: (id: string) => rootApi.deleteExpenseSubtype(id), onSuccess: invalidate })
  const toggleActive = useMutation({
    mutationFn: (s: any) => rootApi.updateExpenseSubtype(s.id, { active: !s.active }),
    onSuccess: invalidate,
  })

  const byTipo = (t: string) => (subtypes as any[]).filter((s) => s.tipo === t)

  function edit(s: any) {
    setEditingId(s.id)
    setForm({ tipo: s.tipo, nome: s.nome, is_percent: s.is_percent, color: s.color, icon: s.icon ?? '', sort: s.sort, active: s.active })
  }

  const inputCls = 'h-9 px-3 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500'

  return (
    <div className="p-8 space-y-8 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Financeiro — Parâmetros</h1>
        <p className="text-gray-500 text-sm mt-1">Formas de pagamento e subtipos de despesa disponíveis para os negócios.</p>
      </div>

      <PaymentMethodsSection />

      <h2 className="text-lg font-bold text-gray-900 pt-4 border-t border-gray-200">Subtipos de despesa</h2>

      {/* Form */}
      <section className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <p className="font-semibold text-gray-900">{editingId ? 'Editar subtipo' : 'Novo subtipo'}</p>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Tipo</label>
            <select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })} className={inputCls}>
              <option value="Fixa">Fixa</option>
              <option value="Variável">Variável</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Nome</label>
            <input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} className={inputCls} placeholder="Ex.: Aluguel" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Cor</label>
            <input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} className="h-9 w-14 rounded-lg border border-gray-300" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Ordem</label>
            <input type="number" value={form.sort} onChange={(e) => setForm({ ...form, sort: Number(e.target.value) })} className={`${inputCls} w-20`} />
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700 h-9">
            <input type="checkbox" checked={form.is_percent} onChange={(e) => setForm({ ...form, is_percent: e.target.checked })} />
            % sobre vendas
          </label>
          <button onClick={() => save.mutate()} disabled={!form.nome.trim() || save.isPending}
            className="h-9 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-semibold">
            {editingId ? 'Salvar' : 'Adicionar'}
          </button>
          {editingId && (
            <button onClick={() => { setEditingId(null); setForm(BLANK) }} className="h-9 px-3 rounded-lg border border-gray-300 text-sm text-gray-600">Cancelar</button>
          )}
        </div>
      </section>

      {/* Lists */}
      {isLoading ? <p className="text-gray-400 text-sm">Carregando…</p> : (['Fixa', 'Variável'] as const).map((tipo) => (
        <section key={tipo}>
          <h2 className="text-lg font-bold text-gray-900 mb-2">{tipo}s</h2>
          <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
            {byTipo(tipo).map((s) => (
              <div key={s.id} className={`flex items-center gap-3 px-4 py-3 ${s.active ? '' : 'opacity-50'}`}>
                <span className="w-3 h-3 rounded-full shrink-0" style={{ background: s.color }} />
                <span className="text-sm font-medium text-gray-900">{s.nome}</span>
                {s.is_percent && <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">% sobre vendas</span>}
                <span className="ml-auto flex items-center gap-3 text-xs">
                  <button onClick={() => toggleActive.mutate(s)} className="text-gray-400 hover:text-gray-700">{s.active ? 'Desativar' : 'Ativar'}</button>
                  <button onClick={() => edit(s)} className="text-indigo-600 hover:underline">Editar</button>
                  <button onClick={() => { if (confirm(`Excluir "${s.nome}"?`)) del.mutate(s.id) }} className="text-red-500 hover:underline">Excluir</button>
                </span>
              </div>
            ))}
            {byTipo(tipo).length === 0 && <p className="text-sm text-gray-400 p-4">Nenhum subtipo.</p>}
          </div>
        </section>
      ))}
    </div>
  )
}

// Formas de pagamento (parâmetros da plataforma) — Root pode incluir/editar/excluir.
function PaymentMethodsSection() {
  const qc = useQueryClient()
  const { data: methods = [] } = useQuery({ queryKey: ['payment-methods'], queryFn: rootApi.paymentMethods })
  const [form, setForm] = useState({ key: '', label: '' })
  const invalidate = () => qc.invalidateQueries({ queryKey: ['payment-methods'] })
  const create = useMutation({ mutationFn: () => rootApi.createPaymentMethod(form), onSuccess: () => { invalidate(); setForm({ key: '', label: '' }) } })
  const toggle = useMutation({ mutationFn: (m: any) => rootApi.updatePaymentMethod(m.key, { active: !m.active }), onSuccess: invalidate })
  const del = useMutation({ mutationFn: (k: string) => rootApi.deletePaymentMethod(k), onSuccess: invalidate })
  const inputCls = 'h-9 px-3 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500'

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-bold text-gray-900">Formas de pagamento</h2>
      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
        {(methods as any[]).map((m) => (
          <div key={m.key} className={`flex items-center gap-3 px-4 py-3 ${m.active ? '' : 'opacity-50'}`}>
            <span className="text-sm font-medium text-gray-900">{m.label}</span>
            <span className="text-xs text-gray-400">{m.key}</span>
            <span className="ml-auto flex items-center gap-3 text-xs">
              <button onClick={() => toggle.mutate(m)} className="text-gray-400 hover:text-gray-700">{m.active ? 'Desativar' : 'Ativar'}</button>
              <button onClick={() => { if (confirm(`Excluir "${m.label}"?`)) del.mutate(m.key) }} className="text-red-500 hover:underline">Excluir</button>
            </span>
          </div>
        ))}
        {(methods as any[]).length === 0 && <p className="text-sm text-gray-400 p-4">Nenhuma forma de pagamento.</p>}
      </div>
      <div className="flex flex-wrap gap-3 items-end bg-white rounded-xl border border-gray-200 p-4">
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Chave (a-z, _)</label>
          <input value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })} className={inputCls} placeholder="ex.: boleto" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Nome</label>
          <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} className={inputCls} placeholder="ex.: Boleto" />
        </div>
        <button onClick={() => create.mutate()} disabled={!form.key || !form.label.trim() || create.isPending}
          className="h-9 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-semibold">Adicionar</button>
      </div>
    </section>
  )
}
