'use client'
import { useQuery } from '@tanstack/react-query'
import { rootApi } from '@/lib/api'
import { StatCard } from '@/components/ui/StatCard'

// #1 — Relatórios: onde os tenants estão (mapa de calor por estado + cidades).
export default function RelatoriosPage() {
  const { data, isLoading } = useQuery({ queryKey: ['tenant-locations'], queryFn: rootApi.tenantLocations })

  if (isLoading) return <div className="p-8 text-gray-400">Carregando...</div>
  if (!data) return null

  const states = data.states ?? []
  const cities = data.cities ?? []
  const maxState = Math.max(1, ...states.map((s) => s.total))

  // Cor do "calor": do azul claro ao roxo forte conforme a intensidade.
  const heat = (v: number) => {
    const p = v / maxState
    if (p >= 0.75) return 'bg-primary text-white'
    if (p >= 0.5) return 'bg-primary/70 text-white'
    if (p >= 0.25) return 'bg-primary/40 text-gray-900'
    return 'bg-primary/15 text-gray-900'
  }

  return (
    <div className="p-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Relatórios</h1>
        <p className="text-gray-500 text-sm mt-1">Onde os negócios estão usando a plataforma</p>
      </div>

      {/* Resumo */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon="🏢" label="Total de tenants" value={data.total_tenants} />
        <StatCard icon="📍" label="Com localização" value={data.with_location} color="bg-green-100 text-green-700" />
        <StatCard icon="🗺️" label="Estados alcançados" value={data.states_count} color="bg-purple-100 text-purple-700" />
        <StatCard icon="❓" label="Sem localização" value={data.no_location} color="bg-gray-100 text-gray-600" />
      </div>

      {/* Mapa de calor por estado */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-semibold text-gray-900">Mapa de calor por estado</h2>
          <span className="text-xs text-gray-400">cor mais forte = mais uso</span>
        </div>
        <p className="text-xs text-gray-400 mb-4">Baseado no estado cadastrado no negócio (Agente IA → dados do negócio).</p>

        {states.length === 0 ? (
          <p className="text-gray-400 text-sm py-6 text-center">Nenhum tenant com estado cadastrado ainda.</p>
        ) : (
          <>
            {/* Grade de UFs (tile heatmap) */}
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2 mb-6">
              {states.map((s) => (
                <div key={s.uf} className={`rounded-xl p-3 ${heat(s.total)}`} title={`${s.name}: ${s.total} (${s.active} ativos)`}>
                  <div className="text-lg font-extrabold leading-none">{s.uf}</div>
                  <div className="text-2xl font-bold mt-1 leading-none">{s.total}</div>
                  <div className="text-[11px] opacity-80 mt-0.5">{s.active} ativo(s)</div>
                </div>
              ))}
            </div>

            {/* Barras por estado */}
            <div className="space-y-2">
              {states.map((s) => (
                <div key={s.uf} className="flex items-center gap-3 text-sm">
                  <span className="w-28 shrink-0 text-gray-700">{s.name}</span>
                  <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full" style={{ width: `${Math.max(4, (s.total / maxState) * 100)}%` }} />
                  </div>
                  <span className="w-16 text-right text-gray-500 shrink-0">{s.total}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Ranking de cidades */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <h2 className="font-semibold text-gray-900 mb-3">Top cidades</h2>
        {cities.length === 0 ? (
          <p className="text-gray-400 text-sm py-4 text-center">Nenhuma cidade cadastrada ainda.</p>
        ) : (
          <div className="divide-y divide-gray-50">
            {cities.map((c, i) => (
              <div key={`${c.city}-${c.uf}-${i}`} className="flex items-center justify-between py-2.5 text-sm">
                <span className="text-gray-700"><span className="text-gray-400 mr-2">{i + 1}.</span>{c.city}{c.uf ? ` — ${c.uf}` : ''}</span>
                <span className="text-gray-500">{c.total} tenant(s) · {c.active} ativo(s)</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
