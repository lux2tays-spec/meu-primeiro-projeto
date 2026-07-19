'use client'
import { useQuery } from '@tanstack/react-query'
import { rootApi } from '@/lib/api'

export default function InfraPage() {
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['root-infra'],
    queryFn: rootApi.infraStatus,
    refetchInterval: 30000,
  })

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Infraestrutura</h1>
          <p className="text-gray-500 text-sm mt-1">Saúde dos serviços em tempo real (somente leitura — nenhum segredo é exibido).</p>
        </div>
        <button onClick={() => refetch()} disabled={isFetching}
          className="h-10 px-4 rounded-xl border border-gray-200 text-sm font-medium hover:bg-gray-50 disabled:opacity-50">
          {isFetching ? 'Atualizando...' : '↻ Atualizar'}
        </button>
      </div>

      {isError ? (
        <div className="text-red-500 text-sm py-4">Erro ao carregar o status. Verifique se o backend está rodando.</div>
      ) : isLoading ? (
        <div className="text-gray-400 text-sm py-4">Carregando...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card title="Banco de Dados (PostgreSQL)" ok={data.db?.ok}>
            <Metric label="Latência" value={data.db?.latency_ms != null ? `${data.db.latency_ms} ms` : '—'} />
          </Card>

          <Card title="Cache (Redis)" ok={data.redis?.ok}>
            <Metric label="Latência" value={data.redis?.latency_ms != null ? `${data.redis.latency_ms} ms` : '—'} />
          </Card>

          <Card title="WhatsApp (Evolution)" ok={data.evolution?.ok}>
            {!data.evolution?.configured ? (
              <p className="text-xs text-amber-600">Não configurado — defina em Integrações › WhatsApp.</p>
            ) : (
              <>
                <Metric label="Instâncias" value={String(data.evolution?.total ?? 0)} />
                <Metric label="Conectadas" value={String(data.evolution?.connected ?? 0)} />
              </>
            )}
          </Card>

          <Card title="Backup do Banco" ok={data.backup?.ok}>
            {data.backup?.last_at ? (
              <>
                <Metric label="Último backup" value={data.backup.last_at} />
                <Metric label="Há" value={data.backup.age_hours != null ? `${data.backup.age_hours} h` : '—'} />
                {data.backup.size_bytes != null && <Metric label="Tamanho" value={fmtBytes(data.backup.size_bytes)} />}
                <Metric label="Total de backups" value={String(data.backup.total ?? 0)} />
              </>
            ) : (
              <p className="text-xs text-amber-600">Nenhum backup registrado ainda.</p>
            )}
          </Card>
        </div>
      )}
    </div>
  )
}

function Card({ title, ok, children }: { title: string; ok?: boolean; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-gray-900">{title}</h2>
        <StatusPill ok={ok} />
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  )
}

function StatusPill({ ok }: { ok?: boolean }) {
  const cls = ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'
  const dot = ok ? 'bg-green-500' : 'bg-red-500'
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      {ok ? 'Operacional' : 'Atenção'}
    </span>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-900 font-medium tabular-nums">{value}</span>
    </div>
  )
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}
