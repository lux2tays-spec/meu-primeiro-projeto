'use client'
import { useState } from 'react'
import { rootApi } from '@/lib/api'

type ExportKey =
  | 'customers' | 'tenants' | 'appointments' | 'subscriptions'
  | 'commissions' | 'services' | 'professionals' | 'affiliates' | 'users' | 'ai-usage'

const EXPORTS: {
  key: ExportKey
  icon: string
  title: string
  description: string
  run: () => Promise<void>
}[] = [
  {
    key: 'customers',
    icon: '👥',
    title: 'Clientes',
    description:
      'Todos os clientes de todos os estabelecimentos: contato, nº de atendimentos, valor total gasto, último serviço e data de cadastro.',
    run: rootApi.exportCustomers,
  },
  {
    key: 'tenants',
    icon: '🏢',
    title: 'Tenants (Estabelecimentos)',
    description:
      'Todos os estabelecimentos: plano, status, dono, contatos, endereço, nº de usuários, agendamentos e status do WhatsApp.',
    run: rootApi.exportTenants,
  },
  {
    key: 'appointments',
    icon: '📅',
    title: 'Agendamentos (Financeiro)',
    description:
      'Todos os agendamentos da plataforma com data, cliente, serviço, profissional, valor e status — visão financeira completa.',
    run: rootApi.exportAppointments,
  },
  {
    key: 'subscriptions',
    icon: '💳',
    title: 'Assinaturas / Receita',
    description:
      'Assinaturas por estabelecimento: status no Mercado Pago, próxima cobrança e valor do plano (inclui tenants sem assinatura).',
    run: rootApi.exportSubscriptions,
  },
  {
    key: 'commissions',
    icon: '💰',
    title: 'Comissões',
    description:
      'Comissões geradas por atendimento: profissional, estabelecimento, serviço, cliente, valor, tipo (% ou fixo), status e data do atendimento.',
    run: rootApi.exportCommissions,
  },
  {
    key: 'services',
    icon: '✂️',
    title: 'Serviços',
    description:
      'Catálogo de serviços de todos os estabelecimentos: preço, duração, comissões configuradas, dias de lembrete, nº de atendimentos e status.',
    run: rootApi.exportServices,
  },
  {
    key: 'professionals',
    icon: '🧑‍💼',
    title: 'Profissionais',
    description:
      'Profissionais de todos os estabelecimentos: usuário vinculado, serviços que atendem, nº de agendamentos e comissões pendentes.',
    run: rootApi.exportProfessionals,
  },
  {
    key: 'affiliates',
    icon: '🤝',
    title: 'Afiliados / Indicações',
    description:
      'Programa de afiliados: código de indicação, estabelecimentos indicados, comissão por indicação, status e ganhos pendentes/pagos.',
    run: rootApi.exportAffiliates,
  },
  {
    key: 'users',
    icon: '🔑',
    title: 'Usuários da Plataforma',
    description:
      'Todos os usuários (donos e equipe): contato, papéis por estabelecimento, e-mail verificado, login Google e data de cadastro.',
    run: rootApi.exportUsers,
  },
  {
    key: 'ai-usage',
    icon: '🤖',
    title: 'Uso de IA / Custos',
    description:
      'Custo de IA do mês por estabelecimento: custo em US$ e R$, tokens, nº de chamadas e margem estimada vs. o valor do plano.',
    run: rootApi.exportAiUsage,
  },
]

export default function ExportacoesPage() {
  const [exporting, setExporting] = useState<ExportKey | null>(null)
  const [errors, setErrors] = useState<Partial<Record<ExportKey, string>>>({})

  async function handleExport(item: (typeof EXPORTS)[number]) {
    setExporting(item.key)
    setErrors((prev) => ({ ...prev, [item.key]: undefined }))
    try {
      await item.run()
    } catch (e) {
      setErrors((prev) => ({
        ...prev,
        [item.key]: e instanceof Error ? e.message : 'Não foi possível exportar. Tente novamente.',
      }))
    } finally {
      setExporting(null)
    }
  }

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Exportar Dados</h1>
        <p className="text-gray-500 text-sm mt-1">
          Baixe os dados da plataforma em CSV compatível com o Excel (pt-BR): separador ponto e vírgula, datas e valores no formato brasileiro.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {EXPORTS.map((item) => (
          <div key={item.key} className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 flex flex-col">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center text-xl">
                {item.icon}
              </div>
              <h2 className="font-semibold text-gray-900">{item.title}</h2>
            </div>
            <p className="text-sm text-gray-500 mt-3 flex-1">{item.description}</p>
            {errors[item.key] && (
              <p className="text-sm text-red-500 mt-3">{errors[item.key]}</p>
            )}
            <button
              onClick={() => handleExport(item)}
              disabled={exporting !== null}
              className="mt-4 h-10 px-4 rounded-xl bg-primary text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 self-start"
            >
              {exporting === item.key ? 'Exportando...' : '⬇ Exportar Excel'}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
