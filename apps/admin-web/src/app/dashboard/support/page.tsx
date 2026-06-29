'use client'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { rootApi } from '@/lib/api'
import { Badge } from '@/components/ui/Badge'

const planVariant: Record<string, any> = { free: 'default', basico: 'info', premium: 'purple', profissional: 'success' }
const planLabel: Record<string, string> = { free: 'Free', basico: 'Básico', premium: 'Premium', profissional: 'Profissional' }

export default function SupportPage() {
  const [search, setSearch] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['root-tenants-support', search],
    queryFn: () => rootApi.tenants({ search: search || undefined, limit: 50 } as any),
  })

  const tenants = data?.data ?? []

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Suporte</h1>
        <p className="text-gray-500 text-sm mt-1">
          Acesse qualquer tenant para inspecionar e ajudar com problemas
        </p>
      </div>

      {/* Search */}
      <div className="bg-primary-light rounded-2xl p-6 border border-primary/20">
        <h2 className="font-semibold text-primary-dark mb-1">Buscar tenant para suporte</h2>
        <p className="text-sm text-primary-dark/70 mb-4">
          Encontre o tenant pelo nome do negócio ou e-mail do proprietário e acesse seus detalhes completos.
        </p>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Nome do negócio ou e-mail..."
          className="h-11 px-4 rounded-xl border border-primary/30 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white w-full max-w-md"
          autoFocus
        />
      </div>

      {/* Results */}
      {search && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          {isLoading ? (
            <div className="text-center py-12 text-gray-400">Buscando...</div>
          ) : tenants.length === 0 ? (
            <div className="text-center py-12 text-gray-400">Nenhum resultado para "{search}"</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-6 py-3 font-medium text-gray-500">Negócio</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Proprietário</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Plano / Status</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">WhatsApp</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {tenants.map((t: any) => (
                  <tr key={t.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-primary-light flex items-center justify-center font-bold text-primary text-sm">
                          {t.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div className="font-semibold text-gray-900">{t.name}</div>
                          <div className="text-xs text-gray-400 font-mono">{t.id.split('-')[0]}...</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="text-gray-700">{t.owner_name ?? '—'}</div>
                      <div className="text-xs text-gray-400">{t.owner_email ?? '—'}</div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex gap-2">
                        <Badge label={planLabel[t.plan] ?? t.plan} variant={planVariant[t.plan]} />
                        <Badge
                          label={t.status}
                          variant={t.status === 'active' ? 'success' : t.status === 'trial' ? 'warning' : 'danger'}
                        />
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <span className={t.whatsapp_status === 'connected' ? 'text-green-600' : 'text-gray-400'}>
                        {t.whatsapp_status === 'connected' ? '✅ Conectado' : '❌ Desconectado'}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <Link
                        href={`/dashboard/tenants/${t.id}`}
                        className="h-8 px-4 bg-primary text-white rounded-lg text-xs font-semibold hover:bg-primary-dark transition-colors inline-flex items-center"
                      >
                        Abrir →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Quick tips */}
      {!search && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[
            { icon: '🔧', title: 'Ajustar plano', desc: 'Altere plano, limites ou status de qualquer tenant na tela de detalhes' },
            { icon: '⏰', title: 'Estender trial', desc: 'Adicione dias extras ao período de trial com um clique' },
            { icon: '👥', title: 'Gerenciar equipe', desc: 'Adicione ou remova colaboradores de qualquer tenant' },
            { icon: '📊', title: 'Ver métricas', desc: 'Acesse agendamentos, mensagens e configuração do agente IA' },
          ].map((tip) => (
            <div key={tip.title} className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 flex gap-4">
              <span className="text-3xl">{tip.icon}</span>
              <div>
                <div className="font-semibold text-gray-900">{tip.title}</div>
                <div className="text-sm text-gray-500 mt-1">{tip.desc}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
