'use client'
import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { financeiroApi, tenantApi, friendlyMessage } from '@/lib/api'

// Formas de pagamento vêm dinâmicas do backend (gerenciadas no Root Admin).
const PM_FALLBACK: { key: string; label: string }[] = [
  { key: 'pix', label: 'Pix' }, { key: 'payment_link', label: 'Link de Pagamento' },
  { key: 'credit_card', label: 'Cartão Crédito' }, { key: 'debit_card', label: 'Cartão Débito' }, { key: 'cash', label: 'Dinheiro' },
]

const inputCls = 'w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary'
const labelCls = 'block text-xs font-medium text-gray-600 mb-1'

// Venda rápida (venda avulsa): cria uma venda concluída que conta na receita,
// sem ocupar horário na agenda.
export default function NovaVendaModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [customerId, setCustomerId] = useState('')
  const [newCustomer, setNewCustomer] = useState({ name: '', last_name: '', phone: '' })
  const [creatingNew, setCreatingNew] = useState(false)
  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [isOutro, setIsOutro] = useState(false)
  const [serviceSearch, setServiceSearch] = useState('')
  const [professionalId, setProfessionalId] = useState('')
  const [valor, setValor] = useState('')
  const [notes, setNotes] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('pix')
  const [outroDesc, setOutroDesc] = useState('')
  const [error, setError] = useState('')

  const { data: services = [] } = useQuery({ queryKey: ['services'], queryFn: () => tenantApi.services() })
  const { data: professionals = [] } = useQuery({ queryKey: ['professionals'], queryFn: tenantApi.professionals })
  const { data: pmData = [] } = useQuery({ queryKey: ['payment-methods'], queryFn: financeiroApi.paymentMethods })
  const methods = (pmData as any[]).length ? (pmData as any[]) : PM_FALLBACK
  const { data: customers = [] } = useQuery({
    queryKey: ['customers', search],
    queryFn: () => tenantApi.customers(search),
    enabled: !creatingNew && search.length >= 2,
  })

  const sumFor = (ids: string[]) =>
    (services as any[]).filter((x) => ids.includes(x.id)).reduce((acc, x) => acc + (Number(x.price) || 0), 0)

  // Marca/desmarca um serviço; o valor sempre re-soma (e continua editável).
  function toggleService(id: string) {
    setIsOutro(false)
    setSelectedIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
      setValor(next.length ? String(sumFor(next)) : '')
      return next
    })
  }
  function chooseOutro() { setIsOutro(true); setSelectedIds([]); setValor('') }

  const filteredServices = (services as any[]).filter((s) =>
    s.name.toLowerCase().includes(serviceSearch.trim().toLowerCase())
  )

  const save = useMutation({
    mutationFn: async () => {
      let cid = customerId
      if (creatingNew) {
        const c = await tenantApi.addCustomer({ name: newCustomer.name.trim(), last_name: newCustomer.last_name.trim() || undefined, phone: newCustomer.phone.trim() })
        cid = c.id
      }
      if (!cid) throw new Error('Selecione ou cadastre um cliente.')
      if (isOutro && !outroDesc.trim()) throw new Error('Descreva o serviço avulso.')
      if (!isOutro && selectedIds.length === 0) throw new Error('Selecione ao menos um serviço.')
      return financeiroApi.createVenda({
        customer_id: cid,
        service_ids: isOutro ? undefined : selectedIds,
        custom_service: isOutro ? outroDesc.trim() : undefined,
        professional_id: professionalId || null,
        valor: Number(valor || 0),
        notes: notes.trim() || undefined,
        payment_method: paymentMethod,
      })
    },
    onSuccess: (data: any) => {
      const url = data?.payment?.url as string | undefined
      if (url) setPaymentLink({ url, sent: !!data?.payment?.whatsapp_sent })
      else onSaved()
    },
    onError: (e: any) => setError(friendlyMessage(e, 'Não foi possível registrar a venda.')),
  })

  const [paymentLink, setPaymentLink] = useState<{ url: string; sent: boolean } | null>(null)
  const [copied, setCopied] = useState(false)

  const canSave = (creatingNew ? (newCustomer.name.trim() && newCustomer.phone.trim()) : customerId)
    && (isOutro ? outroDesc.trim() : selectedIds.length > 0) && Number(valor) > 0 && !save.isPending

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md shadow-xl p-6 space-y-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">Nova venda</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        {paymentLink ? (
          <div className="space-y-4">
            <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-sm text-green-800">
              Link de pagamento gerado 💳 {paymentLink.sent ? '— enviado ao WhatsApp do cliente ✓' : '— envie o link ao cliente:'}
              <p className="text-green-700 text-xs mt-1">A venda fica <strong>pendente</strong> e entra na receita quando o pagamento for confirmado.</p>
            </div>
            <input readOnly value={paymentLink.url} onFocus={(e) => e.currentTarget.select()} className={inputCls} />
            <div className="flex gap-2">
              <button onClick={() => { navigator.clipboard?.writeText(paymentLink.url); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
                className="flex-1 h-10 border border-gray-200 text-gray-700 text-sm font-semibold rounded-xl hover:bg-gray-50">
                {copied ? 'Copiado ✓' : 'Copiar link'}
              </button>
              <a href={paymentLink.url} target="_blank" rel="noreferrer"
                className="flex-1 h-10 leading-10 text-center border border-gray-200 text-gray-700 text-sm font-semibold rounded-xl hover:bg-gray-50">
                Abrir
              </a>
            </div>
            <button onClick={onSaved} className="w-full h-11 bg-primary hover:bg-primary-dark text-white text-sm font-semibold rounded-xl">
              Concluir
            </button>
          </div>
        ) : (
        <>
        {/* Cliente */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className={labelCls}>Cliente <span className="text-red-500">*</span></label>
            <button onClick={() => { setCreatingNew(!creatingNew); setCustomerId(''); }} className="text-xs font-semibold text-primary hover:underline">
              {creatingNew ? 'Buscar existente' : '+ Novo cliente'}
            </button>
          </div>
          {creatingNew ? (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <input className={inputCls} placeholder="Nome" value={newCustomer.name} onChange={(e) => setNewCustomer((c) => ({ ...c, name: e.target.value }))} />
                <input className={inputCls} placeholder="Sobrenome" value={newCustomer.last_name} onChange={(e) => setNewCustomer((c) => ({ ...c, last_name: e.target.value }))} />
              </div>
              <input className={inputCls} placeholder="WhatsApp" value={newCustomer.phone} onChange={(e) => setNewCustomer((c) => ({ ...c, phone: e.target.value }))} />
            </div>
          ) : (
            <>
              <input className={inputCls} placeholder="Buscar por nome ou telefone…" value={search} onChange={(e) => { setSearch(e.target.value); setCustomerId('') }} />
              {search.length >= 2 && (customers as any[]).length > 0 && (
                <div className="mt-1 border border-gray-100 rounded-xl max-h-40 overflow-y-auto">
                  {(customers as any[]).map((c) => (
                    <button key={c.id} onClick={() => { setCustomerId(c.id); setSearch([c.name, c.last_name].filter(Boolean).join(' ')) }}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${customerId === c.id ? 'bg-primary/5 font-semibold' : ''}`}>
                      {[c.name, c.last_name].filter(Boolean).join(' ')} <span className="text-gray-400 text-xs">{c.phone}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Serviços (múltipla seleção + busca) */}
        <div>
          <label className={labelCls}>Serviços <span className="text-red-500">*</span></label>
          <input className={inputCls} placeholder="Buscar serviço…" value={serviceSearch} onChange={(e) => setServiceSearch(e.target.value)} />
          <div className="mt-2 border border-gray-100 rounded-xl max-h-44 overflow-y-auto divide-y divide-gray-50">
            {filteredServices.map((s) => {
              const on = selectedIds.includes(s.id)
              return (
                <button key={s.id} type="button" onClick={() => toggleService(s.id)}
                  className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between hover:bg-gray-50 ${on ? 'bg-primary/5' : ''}`}>
                  <span className="flex items-center gap-2">
                    <span className={`w-4 h-4 rounded border flex items-center justify-center text-[10px] ${on ? 'bg-primary border-primary text-white' : 'border-gray-300'}`}>{on ? '✓' : ''}</span>
                    {s.name}
                  </span>
                  {Number(s.price) > 0 && <span className="text-gray-400 text-xs">R$ {Number(s.price).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>}
                </button>
              )
            })}
            {filteredServices.length === 0 && <p className="px-3 py-2 text-xs text-gray-400">Nenhum serviço encontrado.</p>}
          </div>
          <button type="button" onClick={chooseOutro}
            className={`mt-2 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${isOutro ? 'bg-primary text-white border-primary' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
            Outro serviço (sem preço fixo)
          </button>
          {selectedIds.length > 1 && <p className="text-xs text-gray-500 mt-1">{selectedIds.length} serviços — o valor soma automaticamente (pode ajustar).</p>}
        </div>

        {/* Descrição do serviço avulso (obrigatória quando "Outro serviço") */}
        {isOutro && (
          <div>
            <label className={labelCls}>Descrição do serviço <span className="text-red-500">*</span></label>
            <input className={inputCls} value={outroDesc} onChange={(e) => setOutroDesc(e.target.value)} placeholder="Ex.: Retoque de sobrancelha" />
          </div>
        )}

        {/* Valor + Profissional */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Valor (R$) <span className="text-red-500">*</span></label>
            <input type="number" min="0" step="0.01" className={inputCls} value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" />
          </div>
          <div>
            <label className={labelCls}>Profissional (opcional)</label>
            <select value={professionalId} onChange={(e) => setProfessionalId(e.target.value)} className={inputCls}>
              <option value="">—</option>
              {(professionals as any[]).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </div>

        {/* Forma de pagamento */}
        <div>
          <label className={labelCls}>Forma de pagamento <span className="text-red-500">*</span></label>
          <div className="flex flex-wrap gap-2">
            {methods.map((pm) => (
              <button key={pm.key} onClick={() => setPaymentMethod(pm.key)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                  paymentMethod === pm.key ? 'bg-primary text-white border-primary' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                }`}>
                {pm.label}
              </button>
            ))}
          </div>
        </div>

        {/* Nota */}
        <div>
          <label className={labelCls}>Descrição / Nota (opcional)</label>
          <input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Observação da venda" />
        </div>

        {error && <p className="text-red-500 text-sm">{error}</p>}

        <button onClick={() => { setError(''); save.mutate() }} disabled={!canSave}
          className="w-full h-11 bg-primary hover:bg-primary-dark text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-50">
          {save.isPending ? 'Registrando…' : (paymentMethod === 'payment_link' ? 'Gerar link e registrar' : 'Registrar venda')}
        </button>
        </>
        )}
      </div>
    </div>
  )
}
