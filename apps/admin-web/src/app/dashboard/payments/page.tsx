'use client'
import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { rootApi } from '@/lib/api'

const DEFAULT = { provider: 'mercadopago', mp_access_token: '', mp_public_key: '', mp_webhook_secret: '', back_url: '' }

export default function PaymentsPage() {
  const qc = useQueryClient()
  const [cfg, setCfg] = useState<any>(DEFAULT)
  const [success, setSuccess] = useState('')

  const { data: settings, isLoading } = useQuery({ queryKey: ['root-settings'], queryFn: rootApi.settings })

  useEffect(() => {
    if (settings?.payment_config) setCfg({ ...DEFAULT, ...settings.payment_config })
  }, [settings])

  const mutation = useMutation({
    mutationFn: () => rootApi.updateSettings('payment_config', cfg),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['root-settings'] }); setSuccess('Configuração de pagamento salva!'); setTimeout(() => setSuccess(''), 3000) },
  })

  const set = (k: string, v: string) => setCfg((c: any) => ({ ...c, [k]: v }))
  const configured = !!cfg.mp_access_token

  return (
    <div className="p-8 space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Meios de Pagamento</h1>
        <p className="text-gray-500 text-sm mt-1">Conecte o provedor que cobrará as assinaturas dos seus tenants (a cobrança da plataforma).</p>
      </div>

      {isLoading ? <div className="text-gray-400 text-sm">Carregando...</div> : (
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 space-y-5">
          {success && <div className="bg-green-50 text-green-700 rounded-xl px-4 py-3 text-sm font-medium">{success}</div>}

          <div className="flex items-center gap-2">
            <span className={`inline-block w-2 h-2 rounded-full ${configured ? 'bg-green-500' : 'bg-gray-300'}`} />
            <span className="text-sm text-gray-600">{configured ? 'Provedor configurado' : 'Não configurado — as assinaturas ficam indisponíveis até preencher'}</span>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Provedor</label>
            <select value={cfg.provider} onChange={(e) => set('provider', e.target.value)}
              className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary">
              <option value="mercadopago">Mercado Pago</option>
              <option value="none">Desativado</option>
            </select>
          </div>

          {cfg.provider === 'mercadopago' && (
            <>
              <Field label="Access Token (Mercado Pago)" value={cfg.mp_access_token} onChange={(v) => set('mp_access_token', v)}
                type="password" placeholder="APP_USR-..." hint="Credenciais → Produção → Access Token" />
              <Field label="Public Key" value={cfg.mp_public_key} onChange={(v) => set('mp_public_key', v)}
                placeholder="APP_USR-..." />
              <Field label="Segredo do Webhook (x-signature)" value={cfg.mp_webhook_secret} onChange={(v) => set('mp_webhook_secret', v)}
                type="password" placeholder="Assinatura secreta do webhook" hint="Em Webhooks → sua integração → Chave secreta" />
              <Field label="URL de retorno após pagamento" value={cfg.back_url} onChange={(v) => set('back_url', v)}
                placeholder="https://app.agendabot.com.br/settings/subscription" />

              <div className="bg-blue-50 rounded-xl p-4 text-xs text-blue-700 space-y-1">
                <p className="font-semibold">Configure no painel do Mercado Pago:</p>
                <p>• URL de notificação (webhook): <code className="bg-blue-100 px-1 rounded">https://SEU_DOMINIO/webhook/mercadopago</code></p>
                <p>• Evento: <strong>Assinaturas (preapproval)</strong></p>
                <p>• Copie a <strong>chave secreta</strong> do webhook para o campo acima (valida a assinatura das notificações).</p>
              </div>
            </>
          )}

          <button onClick={() => mutation.mutate()} disabled={mutation.isPending}
            className="h-10 px-5 bg-primary hover:bg-primary-dark text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-50">
            {mutation.isPending ? 'Salvando...' : 'Salvar configuração'}
          </button>
        </div>
      )}
    </div>
  )
}

function Field({ label, value, onChange, type = 'text', placeholder, hint }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string; hint?: string
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <input type={type} value={value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
      {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
    </div>
  )
}
