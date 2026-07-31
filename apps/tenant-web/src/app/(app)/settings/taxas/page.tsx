'use client'
import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { financeiroApi } from '@/lib/api'

// #4: taxas (%) por forma de pagamento. O valor é abatido na exibição das vendas
// e do financeiro (receita líquida).
export default function TaxasPage() {
  const qc = useQueryClient()
  const { data: methods = [] } = useQuery({ queryKey: ['payment-methods'], queryFn: financeiroApi.paymentMethods })
  const { data: fees = [] } = useQuery({ queryKey: ['payment-fees'], queryFn: financeiroApi.paymentFees })
  const [values, setValues] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    const map: Record<string, string> = {}
    for (const f of fees) map[f.method_key] = String(Number(f.pct))
    setValues(map)
  }, [fees])

  const save = useMutation({
    mutationFn: () => financeiroApi.updatePaymentFees(
      (methods as any[]).map((m) => ({ method_key: m.key, pct: Number(values[m.key] || 0) }))
    ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payment-fees'] })
      qc.invalidateQueries({ queryKey: ['fin-resumo'] })
      qc.invalidateQueries({ queryKey: ['fin-resumo-dashboard'] })
      qc.invalidateQueries({ queryKey: ['vendas-range'] })
      setSaved(true); setTimeout(() => setSaved(false), 2500)
    },
  })

  return (
    <div className="max-w-lg space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Taxas de pagamento</h1>
        <p className="text-sm text-gray-500 mt-1">Percentual cobrado pela maquininha/gateway em cada forma de pagamento. O valor é <b>descontado automaticamente</b> ao exibir suas vendas e sua receita (receita líquida).</p>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
        Usando as taxas aqui, <b>não adicione</b> a despesa “Taxa de Cartão” no Financeiro — senão a taxa contaria em dobro.
      </div>

      <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm space-y-3">
        {(methods as any[]).map((m) => (
          <div key={m.key} className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-gray-900">{m.label}</span>
            <div className="relative w-28">
              <input
                type="number" min="0" max="100" step="0.01"
                value={values[m.key] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [m.key]: e.target.value }))}
                placeholder="0"
                className="w-full h-9 pl-3 pr-7 rounded-xl border border-gray-200 text-sm text-right focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">%</span>
            </div>
          </div>
        ))}
        {(methods as any[]).length === 0 && <p className="text-sm text-gray-400">Nenhuma forma de pagamento disponível.</p>}
      </div>

      {saved && <p className="text-sm text-green-600 font-semibold">Taxas salvas ✓</p>}
      <button onClick={() => save.mutate()} disabled={save.isPending}
        className="h-11 px-6 rounded-xl bg-primary hover:bg-primary-dark text-white text-sm font-semibold disabled:opacity-50">
        {save.isPending ? 'Salvando…' : 'Salvar taxas'}
      </button>
    </div>
  )
}
