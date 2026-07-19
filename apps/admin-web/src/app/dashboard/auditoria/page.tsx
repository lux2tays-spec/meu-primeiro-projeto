'use client'
import { useQuery } from '@tanstack/react-query'
import { rootApi } from '@/lib/api'

const ACTION_LABELS: Record<string, string> = {
  'settings.update': 'Alterou configuração',
  'plan.update': 'Alterou plano',
  'plan.create': 'Criou plano',
  'plan.delete': 'Excluiu plano',
  'tenant.update': 'Alterou tenant',
  'user.update': 'Alterou usuário',
  'user.delete': 'Excluiu usuário',
}

export default function AuditoriaPage() {
  const { data, isLoading, isError } = useQuery({ queryKey: ['root-audit'], queryFn: () => rootApi.auditLog() })

  // Backend may return { data: [...] } or a bare array — handle both.
  const rows: any[] = Array.isArray(data) ? data : (data?.data ?? [])

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Auditoria</h1>
        <p className="text-gray-500 text-sm mt-1">Histórico de alterações feitas no Root Admin — quem mudou o quê e quando.</p>
      </div>

      {isError ? (
        <div className="text-red-500 text-sm py-4">Erro ao carregar o histórico. Verifique se o backend está rodando.</div>
      ) : isLoading ? (
        <div className="text-gray-400 text-sm py-4">Carregando...</div>
      ) : rows.length === 0 ? (
        <div className="bg-white rounded-2xl p-8 shadow-sm border border-gray-100 text-center text-gray-400 text-sm">
          Nenhuma ação registrada ainda.
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                <th className="px-5 py-3 font-medium">Quando</th>
                <th className="px-5 py-3 font-medium">Quem</th>
                <th className="px-5 py-3 font-medium">Ação</th>
                <th className="px-5 py-3 font-medium">Alvo</th>
                <th className="px-5 py-3 font-medium">Detalhe</th>
                <th className="px-5 py-3 font-medium">IP</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                  <td className="px-5 py-3 text-gray-600 whitespace-nowrap tabular-nums">{r.at ?? '—'}</td>
                  <td className="px-5 py-3 text-gray-800">{r.actor_email ?? '—'}</td>
                  <td className="px-5 py-3">
                    <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                      {ACTION_LABELS[r.action] ?? r.action ?? '—'}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-gray-500 font-mono text-xs">{r.target ?? '—'}</td>
                  <td className="px-5 py-3 text-gray-500">{r.summary ?? '—'}</td>
                  <td className="px-5 py-3 text-gray-400 font-mono text-xs">{r.ip ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
