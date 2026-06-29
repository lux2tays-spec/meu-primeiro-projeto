'use client'
import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { tenantApi } from '@/lib/api'

export default function PaymentsPage() {
  const qc = useQueryClient()
  const { data: cfg, isLoading } = useQuery({ queryKey: ['payment-config'], queryFn: tenantApi.paymentConfig })

  const [accessToken, setAccessToken] = useState('')
  const [publicKey, setPublicKey] = useState('')
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (cfg) {
      setPublicKey(cfg.mp_public_key ?? '')
    }
  }, [cfg])

  const saveMutation = useMutation({
    mutationFn: () => tenantApi.savePaymentConfig({
      mp_access_token: accessToken || undefined,
      mp_public_key:   publicKey   || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payment-config'] })
      setSaved(true)
      setAccessToken('')
      setTimeout(() => setSaved(false), 3000)
    },
    onError: (e: any) => setError(e.message),
  })

  const inputCls = 'w-full h-11 px-4 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary font-mono'

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Meios de Pagamento</h1>
        <p className="text-gray-500 text-sm mt-1">Configure sua conta do Mercado Pago para receber pagamentos e gerar links.</p>
      </div>

      {/* Como obter as credenciais */}
      <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 text-sm text-blue-800 space-y-1">
        <p className="font-semibold">Como obter suas credenciais:</p>
        <ol className="list-decimal list-inside space-y-0.5 text-blue-700">
          <li>Acesse <strong>mercadopago.com.br</strong> e faça login</li>
          <li>Vá em <strong>Seu negócio → Configurações → Credenciais</strong></li>
          <li>Copie o <strong>Access Token</strong> e a <strong>Public Key</strong> de produção</li>
        </ol>
      </div>

      <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <div className={`w-2.5 h-2.5 rounded-full ${cfg?.configured ? 'bg-green-500' : 'bg-gray-300'}`} />
          <span className="text-sm font-medium text-gray-700">
            {cfg?.configured ? 'Mercado Pago configurado' : 'Mercado Pago não configurado'}
          </span>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Access Token {cfg?.mp_access_token && <span className="text-xs text-gray-400 font-normal">(atual: {cfg.mp_access_token})</span>}
          </label>
          <input
            type="password"
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
            className={inputCls}
            placeholder={cfg?.configured ? 'Digite para substituir o token atual' : 'APP_USR-...'}
            autoComplete="off"
          />
          <p className="text-xs text-gray-400 mt-1">Mantenha em branco para não alterar o token atual.</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Public Key</label>
          <input
            type="text"
            value={publicKey}
            onChange={(e) => setPublicKey(e.target.value)}
            className={inputCls}
            placeholder="APP_USR-..."
            autoComplete="off"
          />
        </div>

        {error && <p className="text-red-500 text-sm">{error}</p>}
        {saved && <p className="text-green-600 text-sm font-medium">Configurações salvas com sucesso!</p>}

        <button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending || isLoading}
          className="w-full h-11 bg-primary hover:bg-primary-dark text-white font-semibold rounded-xl transition-colors disabled:opacity-50"
        >
          {saveMutation.isPending ? 'Salvando...' : 'Salvar configurações'}
        </button>

        {cfg?.configured && (
          <button
            onClick={() => { if (confirm('Remover a integração com Mercado Pago?')) tenantApi.savePaymentConfig({ mp_access_token: '', mp_public_key: '' }).then(() => { qc.invalidateQueries({ queryKey: ['payment-config'] }); setPublicKey('') }) }}
            className="w-full h-10 border border-red-200 text-red-500 text-sm rounded-xl hover:bg-red-50 transition-colors"
          >
            Remover integração
          </button>
        )}
      </div>
    </div>
  )
}
