'use client'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from 'recharts'
import { financeiroApi } from '@/lib/api'

const SERIES = [
  { key: 'receita', label: 'Receita', color: '#22C55E' },
  { key: 'despesa', label: 'Despesa', color: '#EF4444' },
  { key: 'lucro', label: 'Lucro', color: '#3B82F6' },
  { key: 'meta', label: 'Meta', color: '#F59E0B' },
] as const

const fmtK = (v: number) => (v >= 1000 ? `${Math.round(v / 100) / 10}k` : String(v))
const fmtBRL = (v: number) => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

export default function ProjecaoTab() {
  const [on, setOn] = useState<Record<string, boolean>>({ receita: true, despesa: true, lucro: true, meta: true })
  const { data: historico = [], isLoading } = useQuery({ queryKey: ['fin-historico'], queryFn: () => financeiroApi.historico(6) })

  return (
    <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <p className="text-sm font-semibold text-gray-900">Evolução mensal</p>
        <div className="flex flex-wrap gap-3">
          {SERIES.map((s) => (
            <button key={s.key} onClick={() => setOn((o) => ({ ...o, [s.key]: !o[s.key] }))}
              className="flex items-center gap-1.5 text-xs font-medium" style={{ opacity: on[s.key] ? 1 : 0.35 }}>
              <span className="w-3 h-3 rounded-sm" style={{ background: s.color }} />
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="text-gray-400 text-sm py-16 text-center">Carregando histórico…</div>
      ) : (
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={historico} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
              <XAxis dataKey="mes" tick={{ fontSize: 12, fill: '#6B7280' }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={fmtK} tick={{ fontSize: 11, fill: '#9CA3AF' }} axisLine={false} tickLine={false} width={38} />
              <Tooltip formatter={(v: any, n: any) => [fmtBRL(Number(v)), n]} labelStyle={{ color: '#111827', fontWeight: 600 }}
                contentStyle={{ borderRadius: 12, border: '1px solid #E5E7EB', fontSize: 12 }} />
              {on.receita && <Bar dataKey="receita" name="Receita" fill="#22C55E" radius={[4, 4, 0, 0]} barSize={14} />}
              {on.despesa && <Bar dataKey="despesa" name="Despesa" fill="#EF4444" radius={[4, 4, 0, 0]} barSize={14} />}
              {on.lucro && <Line type="monotone" dataKey="lucro" name="Lucro" stroke="#3B82F6" strokeWidth={2.5} dot={{ r: 3 }} />}
              {on.meta && <Line type="monotone" dataKey="meta" name="Meta" stroke="#F59E0B" strokeWidth={2} strokeDasharray="5 4" dot={false} />}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
