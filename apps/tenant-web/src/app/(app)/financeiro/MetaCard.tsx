'use client'
import type { FinanceiroResumo } from '@/lib/api'

const fmtBRL = (v: number) => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

export default function MetaCard({ resumo, onEdit }: { resumo?: FinanceiroResumo; onEdit: () => void }) {
  const metaLucro = resumo?.meta_lucro ?? 0
  const lucro = resumo?.lucro ?? 0
  const metaVendas = resumo?.meta_vendas ?? 0
  const vendasNecessarias = resumo?.vendas_necessarias ?? 0
  const vendasFaltantes = resumo?.vendas_faltantes ?? 0
  const numVendas = resumo?.total_vendas ?? 0
  const ticketBase = resumo?.ticket_base ?? 0
  const progresso = Math.min(100, resumo?.progresso_meta ?? 0)
  const inatingivel = resumo?.meta_inatingivel ?? false
  const batida = metaLucro > 0 && lucro >= metaLucro

  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 border-l-4 border-l-success">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">🎯</span>
          <p className="text-sm font-bold text-gray-900">Meta de lucro do mês</p>
        </div>
        <button onClick={onEdit} className="text-xs font-semibold text-primary hover:underline">
          {metaLucro > 0 ? 'Editar meta' : 'Definir meta'}
        </button>
      </div>

      {metaLucro === 0 ? (
        <p className="text-sm text-gray-500">
          Defina uma meta de lucro para descobrir quanto precisa faturar e quantas vendas fazer no mês.
        </p>
      ) : (
        <>
          {/* Progresso lucro/meta */}
          <div className="mb-4">
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-gray-500">Lucro atual: <b className="text-gray-900">{fmtBRL(lucro)}</b></span>
              <span className="text-gray-500">Meta: {fmtBRL(metaLucro)} · {progresso}%</span>
            </div>
            <div className="h-2.5 rounded-full bg-gray-100 overflow-hidden">
              <div className="h-full rounded-full bg-success transition-all" style={{ width: `${Math.max(2, progresso)}%` }} />
            </div>
          </div>

          {inatingivel ? (
            <div className="rounded-xl bg-red-50 border border-red-100 p-4 text-sm text-red-600">
              Taxa de cartão + comissão somam {resumo?.pct_sobre_venda ?? 0}% das vendas — a meta fica inatingível.
              Reduza os percentuais ou a meta de lucro.
            </div>
          ) : (
            <>
              {/* Bloco verde: quanto faturar + nº de vendas */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-success/10 p-4">
                  <p className="text-xs text-gray-500">Você precisa faturar</p>
                  <p className="text-2xl font-bold text-success leading-tight mt-1">{fmtBRL(metaVendas)}</p>
                  <p className="text-xs text-gray-500 mt-1">este mês pra bater a meta</p>
                </div>
                <div className="rounded-xl bg-success/10 p-4">
                  <p className="text-xs text-gray-500">Ou seja</p>
                  <p className="text-2xl font-bold text-success leading-tight mt-1">{vendasNecessarias} vendas</p>
                  <p className="text-xs text-gray-500 mt-1">no ticket médio de {fmtBRL(ticketBase)}</p>
                </div>
              </div>

              {/* Status */}
              <div className={`mt-3 text-sm font-semibold ${batida ? 'text-success' : 'text-amber-600'}`}>
                {batida
                  ? '✓ Meta batida! Parabéns.'
                  : `Faltam ${vendasFaltantes} venda(s) — você já fez ${numVendas} de ${vendasNecessarias}.`}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
