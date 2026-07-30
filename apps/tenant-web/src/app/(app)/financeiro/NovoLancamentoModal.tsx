'use client'
import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { financeiroApi, friendlyMessage, type ExpenseSubtype } from '@/lib/api'

const CATEGORIAS_RECEITA = ['Venda avulsa', 'Aporte de sócio', 'Reembolso', 'Rendimento', 'Outro']
const inputCls = 'w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary'
const labelCls = 'block text-xs font-medium text-gray-600 mb-1'

type Mode = 'menu' | 'despesa' | 'receita' | 'meta'

const today = () => new Date().toISOString().slice(0, 10)

export default function NovoLancamentoModal({ onClose, onSaved, currentMeta }: {
  onClose: () => void
  onSaved: () => void
  currentMeta: number
}) {
  const [mode, setMode] = useState<Mode>('menu')

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md shadow-xl p-6 space-y-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">
            {mode === 'menu' ? 'Novo lançamento' : mode === 'despesa' ? 'Nova despesa' : mode === 'receita' ? 'Nova receita' : 'Meta de lucro'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        {mode === 'menu' && (
          <div className="space-y-2">
            <MenuButton label="Nova receita" hint="Aporte, reembolso, venda avulsa, rendimento…" color="#22C55E" onClick={() => setMode('receita')} />
            <MenuButton label="Nova despesa" hint="Fixa ou variável, com recorrência opcional" color="#EF4444" onClick={() => setMode('despesa')} />
            <MenuButton label="Meta de lucro do mês" hint="Quanto você quer de lucro" color="#F59E0B" onClick={() => setMode('meta')} />
          </div>
        )}

        {mode === 'despesa' && <DespesaForm onSaved={onSaved} onBack={() => setMode('menu')} />}
        {mode === 'receita' && <ReceitaForm onSaved={onSaved} onBack={() => setMode('menu')} />}
        {mode === 'meta' && <MetaForm onSaved={onSaved} onBack={() => setMode('menu')} currentMeta={currentMeta} />}
      </div>
    </div>
  )
}

function MenuButton({ label, hint, color, onClick }: { label: string; hint: string; color: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-full text-left p-4 rounded-xl border border-gray-100 hover:bg-gray-50 flex items-center gap-3">
      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
      <div>
        <p className="text-sm font-semibold text-gray-900">{label}</p>
        <p className="text-xs text-gray-400">{hint}</p>
      </div>
    </button>
  )
}

function DespesaForm({ onSaved, onBack }: { onSaved: () => void; onBack: () => void }) {
  const { data: subtypes = [] } = useQuery({ queryKey: ['expense-subtypes'], queryFn: financeiroApi.expenseSubtypes })
  const [tipo, setTipo] = useState<'Fixa' | 'Variável'>('Fixa')
  const [subtipo, setSubtipo] = useState('')
  const [customSub, setCustomSub] = useState('')
  const [descricao, setDescricao] = useState('')
  const [valor, setValor] = useState('')
  const [pct, setPct] = useState('')
  const [data, setData] = useState(today())
  const [recorrente, setRecorrente] = useState(true)
  const [error, setError] = useState('')

  const tipoSubs = (subtypes as ExpenseSubtype[]).filter((s) => s.tipo === tipo)
  const selectedSub = (subtypes as ExpenseSubtype[]).find((s) => s.tipo === tipo && s.nome === subtipo)
  const isPercent = !!selectedSub?.is_percent
  const isOutro = subtipo === 'Outro'

  const save = useMutation({
    mutationFn: () => financeiroApi.createDespesa({
      descricao: descricao.trim(),
      tipo,
      subtipo: isOutro ? (customSub.trim() || 'Outro') : subtipo,
      valor: isPercent ? null : Number(valor || 0),
      pct: isPercent ? Number(pct || 0) : null,
      data,
      recorrente,
    } as any),
    onSuccess: onSaved,
    onError: (e: any) => setError(friendlyMessage(e, 'Não foi possível salvar a despesa.')),
  })

  const canSave = descricao.trim() && subtipo && (isPercent ? Number(pct) > 0 : Number(valor) >= 0) && (!isOutro || customSub.trim()) && !save.isPending

  return (
    <div className="space-y-3">
      <div>
        <label className={labelCls}>Tipo</label>
        <div className="flex gap-2">
          {(['Fixa', 'Variável'] as const).map((t) => (
            <button key={t} onClick={() => { setTipo(t); setSubtipo(''); setRecorrente(t === 'Fixa') }}
              className={`flex-1 py-2 rounded-xl text-sm font-medium border ${tipo === t ? 'bg-primary text-white border-primary' : 'bg-white text-gray-600 border-gray-200'}`}>
              {t}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className={labelCls}>Categoria (subtipo)</label>
        <select value={subtipo} onChange={(e) => setSubtipo(e.target.value)} className={inputCls}>
          <option value="">Selecione…</option>
          {tipoSubs.map((s) => <option key={s.nome} value={s.nome}>{s.nome}{s.is_percent ? ' (%)' : ''}</option>)}
        </select>
      </div>
      {isOutro && (
        <input className={inputCls} placeholder="Nome da categoria personalizada" value={customSub} onChange={(e) => setCustomSub(e.target.value)} />
      )}
      <div>
        <label className={labelCls}>Descrição</label>
        <input className={inputCls} value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Ex.: Conta de luz" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        {isPercent ? (
          <div>
            <label className={labelCls}>Percentual (%)</label>
            <input type="number" min="0" max="100" step="0.1" className={inputCls} value={pct} onChange={(e) => setPct(e.target.value)} placeholder="Ex.: 3,2" />
          </div>
        ) : (
          <div>
            <label className={labelCls}>Valor (R$)</label>
            <input type="number" min="0" step="0.01" className={inputCls} value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" />
          </div>
        )}
        <div>
          <label className={labelCls}>Data</label>
          <input type="date" className={inputCls} value={data} onChange={(e) => setData(e.target.value)} />
        </div>
      </div>
      {isPercent && <p className="text-xs text-gray-400">Cobrado como % sobre as vendas do mês (o valor em R$ é calculado automaticamente).</p>}
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" checked={recorrente} onChange={(e) => setRecorrente(e.target.checked)} />
        Repetir todo mês (recorrente)
      </label>
      {error && <p className="text-red-500 text-sm">{error}</p>}
      <div className="flex gap-2 pt-1">
        <button onClick={onBack} className="px-4 h-10 border border-gray-200 text-gray-600 text-sm rounded-xl hover:bg-gray-50">Voltar</button>
        <button onClick={() => { setError(''); save.mutate() }} disabled={!canSave}
          className="flex-1 h-10 bg-primary hover:bg-primary-dark text-white text-sm font-semibold rounded-xl disabled:opacity-50">
          {save.isPending ? 'Salvando…' : 'Salvar despesa'}
        </button>
      </div>
    </div>
  )
}

function ReceitaForm({ onSaved, onBack }: { onSaved: () => void; onBack: () => void }) {
  const [descricao, setDescricao] = useState('')
  const [categoria, setCategoria] = useState(CATEGORIAS_RECEITA[0])
  const [valor, setValor] = useState('')
  const [data, setData] = useState(today())
  const [error, setError] = useState('')

  const save = useMutation({
    mutationFn: () => financeiroApi.createOutraReceita({ descricao: descricao.trim(), categoria, valor: Number(valor || 0), data }),
    onSuccess: onSaved,
    onError: (e: any) => setError(friendlyMessage(e, 'Não foi possível salvar a receita.')),
  })

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-400">Para entradas que não são vendas (aporte, reembolso, rendimento…). As vendas continuam vindo do módulo de vendas.</p>
      <div>
        <label className={labelCls}>Descrição</label>
        <input className={inputCls} value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Ex.: Aporte do sócio" />
      </div>
      <div>
        <label className={labelCls}>Categoria</label>
        <select value={categoria} onChange={(e) => setCategoria(e.target.value)} className={inputCls}>
          {CATEGORIAS_RECEITA.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Valor (R$)</label>
          <input type="number" min="0" step="0.01" className={inputCls} value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" />
        </div>
        <div>
          <label className={labelCls}>Data</label>
          <input type="date" className={inputCls} value={data} onChange={(e) => setData(e.target.value)} />
        </div>
      </div>
      {error && <p className="text-red-500 text-sm">{error}</p>}
      <div className="flex gap-2 pt-1">
        <button onClick={onBack} className="px-4 h-10 border border-gray-200 text-gray-600 text-sm rounded-xl hover:bg-gray-50">Voltar</button>
        <button onClick={() => { setError(''); save.mutate() }} disabled={!descricao.trim() || !(Number(valor) > 0) || save.isPending}
          className="flex-1 h-10 bg-primary hover:bg-primary-dark text-white text-sm font-semibold rounded-xl disabled:opacity-50">
          {save.isPending ? 'Salvando…' : 'Salvar receita'}
        </button>
      </div>
    </div>
  )
}

function MetaForm({ onSaved, onBack, currentMeta }: { onSaved: () => void; onBack: () => void; currentMeta: number }) {
  const [meta, setMeta] = useState(String(currentMeta || ''))
  const [error, setError] = useState('')
  const save = useMutation({
    mutationFn: () => financeiroApi.setMetaLucro(Number(meta || 0)),
    onSuccess: onSaved,
    onError: (e: any) => setError(friendlyMessage(e, 'Não foi possível salvar a meta.')),
  })
  return (
    <div className="space-y-3">
      <div>
        <label className={labelCls}>Meta de lucro mensal (R$)</label>
        <input type="number" min="0" step="0.01" className={inputCls} value={meta} onChange={(e) => setMeta(e.target.value)} placeholder="Ex.: 8000" />
      </div>
      <p className="text-xs text-gray-400">A partir dela e das suas despesas, calculamos quanto você precisa faturar no mês.</p>
      {error && <p className="text-red-500 text-sm">{error}</p>}
      <div className="flex gap-2 pt-1">
        <button onClick={onBack} className="px-4 h-10 border border-gray-200 text-gray-600 text-sm rounded-xl hover:bg-gray-50">Voltar</button>
        <button onClick={() => { setError(''); save.mutate() }} disabled={save.isPending}
          className="flex-1 h-10 bg-primary hover:bg-primary-dark text-white text-sm font-semibold rounded-xl disabled:opacity-50">
          {save.isPending ? 'Salvando…' : 'Salvar meta'}
        </button>
      </div>
    </div>
  )
}
