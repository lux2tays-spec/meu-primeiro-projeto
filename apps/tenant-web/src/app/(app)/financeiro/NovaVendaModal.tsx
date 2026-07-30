'use client'
import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { financeiroApi, tenantApi, friendlyMessage } from '@/lib/api'

const PAYMENT_METHODS: { value: string; label: string }[] = [
  { value: 'pix', label: 'Pix' },
  { value: 'payment_link', label: 'Link de Pagamento' },
  { value: 'credit_card', label: 'Cartão Crédito' },
  { value: 'debit_card', label: 'Cartão Débito' },
  { value: 'cash', label: 'Dinheiro' },
]

const inputCls = 'w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary'
const labelCls = 'block text-xs font-medium text-gray-600 mb-1'

// Venda rápida (venda avulsa): cria uma venda concluída que conta na receita,
// sem ocupar horário na agenda.
export default function NovaVendaModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [customerId, setCustomerId] = useState('')
  const [newCustomer, setNewCustomer] = useState({ name: '', phone: '' })
  const [creatingNew, setCreatingNew] = useState(false)
  const [search, setSearch] = useState('')
  const [serviceId, setServiceId] = useState('')
  const [professionalId, setProfessionalId] = useState('')
  const [valor, setValor] = useState('')
  const [notes, setNotes] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('pix')
  const [error, setError] = useState('')

  const { data: services = [] } = useQuery({ queryKey: ['services'], queryFn: () => tenantApi.services() })
  const { data: professionals = [] } = useQuery({ queryKey: ['professionals'], queryFn: tenantApi.professionals })
  const { data: customers = [] } = useQuery({
    queryKey: ['customers', search],
    queryFn: () => tenantApi.customers(search),
    enabled: !creatingNew && search.length >= 2,
  })

  function pickService(id: string) {
    setServiceId(id)
    const s = (services as any[]).find((x) => x.id === id)
    if (s && !valor) setValor(String(Number(s.price)))
  }

  const save = useMutation({
    mutationFn: async () => {
      let cid = customerId
      if (creatingNew) {
        const c = await tenantApi.addCustomer({ name: newCustomer.name.trim(), phone: newCustomer.phone.trim() })
        cid = c.id
      }
      if (!cid) throw new Error('Selecione ou cadastre um cliente.')
      if (!serviceId) throw new Error('Selecione o serviço.')
      return financeiroApi.createVenda({
        customer_id: cid,
        service_id: serviceId,
        professional_id: professionalId || null,
        valor: Number(valor || 0),
        notes: notes.trim() || undefined,
        payment_method: paymentMethod,
      })
    },
    onSuccess: onSaved,
    onError: (e: any) => setError(friendlyMessage(e, 'Não foi possível registrar a venda.')),
  })

  const canSave = (creatingNew ? (newCustomer.name.trim() && newCustomer.phone.trim()) : customerId) && serviceId && Number(valor) > 0 && !save.isPending

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md shadow-xl p-6 space-y-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">Nova venda</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        {/* Cliente */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className={labelCls}>Cliente</label>
            <button onClick={() => { setCreatingNew(!creatingNew); setCustomerId(''); }} className="text-xs font-semibold text-primary hover:underline">
              {creatingNew ? 'Buscar existente' : '+ Novo cliente'}
            </button>
          </div>
          {creatingNew ? (
            <div className="grid grid-cols-2 gap-2">
              <input className={inputCls} placeholder="Nome" value={newCustomer.name} onChange={(e) => setNewCustomer((c) => ({ ...c, name: e.target.value }))} />
              <input className={inputCls} placeholder="WhatsApp" value={newCustomer.phone} onChange={(e) => setNewCustomer((c) => ({ ...c, phone: e.target.value }))} />
            </div>
          ) : (
            <>
              <input className={inputCls} placeholder="Buscar por nome ou telefone…" value={search} onChange={(e) => { setSearch(e.target.value); setCustomerId('') }} />
              {search.length >= 2 && (customers as any[]).length > 0 && (
                <div className="mt-1 border border-gray-100 rounded-xl max-h-40 overflow-y-auto">
                  {(customers as any[]).map((c) => (
                    <button key={c.id} onClick={() => { setCustomerId(c.id); setSearch(c.name) }}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${customerId === c.id ? 'bg-primary/5 font-semibold' : ''}`}>
                      {c.name} <span className="text-gray-400 text-xs">{c.phone}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Serviço */}
        <div>
          <label className={labelCls}>Serviço</label>
          <select value={serviceId} onChange={(e) => pickService(e.target.value)} className={inputCls}>
            <option value="">Selecione…</option>
            {(services as any[]).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        {/* Valor + Profissional */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Valor (R$)</label>
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
          <label className={labelCls}>Forma de pagamento</label>
          <div className="flex flex-wrap gap-2">
            {PAYMENT_METHODS.map((pm) => (
              <button key={pm.value} onClick={() => setPaymentMethod(pm.value)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                  paymentMethod === pm.value ? 'bg-primary text-white border-primary' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
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
          {save.isPending ? 'Registrando…' : 'Registrar venda'}
        </button>
      </div>
    </div>
  )
}
