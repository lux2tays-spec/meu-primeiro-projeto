'use client'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { rootApi } from '@/lib/api'
import { Badge } from '@/components/ui/Badge'

const planVariant: Record<string, any> = { free: 'default', basico: 'info', premium: 'purple', profissional: 'success' }
const planLabel: Record<string, string> = { free: 'Free', basico: 'Básico', premium: 'Premium', profissional: 'Profissional' }
const statusVariant: Record<string, any> = { active: 'success', trial: 'warning', suspended: 'danger', cancelled: 'danger' }
const statusLabel: Record<string, string> = { active: 'Ativo', trial: 'Trial', suspended: 'Suspenso', cancelled: 'Cancelado' }
const whatsappVariant: Record<string, any> = { connected: 'success', qr_pending: 'warning', disconnected: 'default' }
const whatsappLabel: Record<string, string> = { connected: 'WhatsApp ✓', qr_pending: 'Aguardando QR', disconnected: 'Desconectado' }

export default function TenantsPage() {
  const [search, setSearch] = useState('')
  const [plan, setPlan] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['root-tenants', search, plan, status, page],
    queryFn: () => rootApi.tenants({ search: search || undefined, plan: plan || undefined, status: status || undefined, page }),
  })

  const tenants = data?.data ?? []
  const total = data?.total ?? 0

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Tenants</h1>
        <p className="text-gray-500 text-sm mt-1">{total} estabelecimentos cadastrados</p>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1) }}
          placeholder="Buscar por nome ou e-mail..."
          className="h-10 px-4 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary flex-1 min-w-48"
        />
        <select
          value={plan}
          onChange={(e) => { setPlan(e.target.value); setPage(1) }}
          className="h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white"
        >
          <option value="">Todos os planos</option>
          <option value="free">Free</option>
          <option value="basico">Básico</option>
          <option value="premium">Premium</option>
          <option value="profissional">Profissional</option>
        </select>
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1) }}
          className="h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white"
        >
          <option value="">Todos os status</option>
          <option value="trial">Trial</option>
          <option value="active">Ativo</option>
          <option value="suspended">Suspenso</option>
          <option value="cancelled">Cancelado</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="text-left px-6 py-3 font-medium text-gray-500">Negócio</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">Proprietário</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">Plano</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">Status</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">WhatsApp</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">Usuários</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">Cadastro</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={8} className="text-center py-12 text-gray-400">Carregando...</td></tr>
            ) : tenants.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-12 text-gray-400">Nenhum tenant encontrado</td></tr>
            ) : tenants.map((t: any) => (
              <tr key={t.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-primary-light flex items-center justify-center font-bold text-primary text-sm flex-shrink-0">
                      {t.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="font-semibold text-gray-900">{t.name}</div>
                      <div className="text-xs text-gray-400 font-mono">{t.slug}</div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-4">
                  <div className="text-gray-700">{t.owner_name ?? '—'}</div>
                  <div className="text-xs text-gray-400">{t.owner_email ?? '—'}</div>
                </td>
                <td className="px-4 py-4">
                  <Badge label={planLabel[t.plan] ?? t.plan} variant={planVariant[t.plan]} />
                </td>
                <td className="px-4 py-4">
                  <Badge label={statusLabel[t.status] ?? t.status} variant={statusVariant[t.status]} />
                </td>
                <td className="px-4 py-4">
                  <Badge
                    label={whatsappLabel[t.whatsapp_status ?? 'disconnected']}
                    variant={whatsappVariant[t.whatsapp_status ?? 'disconnected']}
                  />
                </td>
                <td className="px-4 py-4 text-gray-700">{t.user_count}</td>
                <td className="px-4 py-4 text-gray-400 text-xs">
                  {new Date(t.created_at).toLocaleDateString('pt-BR')}
                </td>
                <td className="px-4 py-4">
                  <Link
                    href={`/dashboard/tenants/${t.id}`}
                    className="text-primary hover:text-primary-dark font-medium text-xs"
                  >
                    Detalhes →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Pagination */}
        {total > 20 && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100">
            <span className="text-sm text-gray-500">
              Mostrando {Math.min((page - 1) * 20 + 1, total)}–{Math.min(page * 20, total)} de {total}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="h-8 px-3 rounded-lg border border-gray-200 text-sm font-medium disabled:opacity-40 hover:bg-gray-50"
              >
                ← Anterior
              </button>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={page * 20 >= total}
                className="h-8 px-3 rounded-lg border border-gray-200 text-sm font-medium disabled:opacity-40 hover:bg-gray-50"
              >
                Próxima →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
