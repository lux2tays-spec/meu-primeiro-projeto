'use client'
import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Image from 'next/image'
import { whatsappApi } from '@/lib/api'

export default function WhatsAppPage() {
  const qc = useQueryClient()
  const [connecting, setConnecting] = useState(false)

  const { data: status, refetch: refetchStatus } = useQuery({
    queryKey: ['whatsapp-status'],
    queryFn: whatsappApi.getStatus,
    refetchInterval: connecting ? 3000 : false,
  })

  const { data: qrData } = useQuery({
    queryKey: ['whatsapp-qr'],
    queryFn: whatsappApi.getQR,
    enabled: connecting && status?.status === 'qr_pending',
    refetchInterval: 30_000,
  })

  const connectMutation = useMutation({
    mutationFn: whatsappApi.connect,
    onSuccess: () => { setConnecting(true); refetchStatus() },
  })

  useEffect(() => {
    if (status?.status === 'connected') {
      setConnecting(false)
      qc.invalidateQueries({ queryKey: ['whatsapp-status'] })
    }
  }, [status?.status, qc])

  const isConnected = status?.status === 'connected'
  const isPending = status?.status === 'qr_pending'

  return (
    <div className="max-w-lg space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Conexão WhatsApp</h1>

      {/* Status */}
      <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
        <div className="flex items-center gap-3">
          <span className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500' : isPending ? 'bg-yellow-400 animate-pulse' : 'bg-red-400'}`} />
          <span className="font-semibold text-gray-900">
            {isConnected ? 'Conectado' : isPending ? 'Aguardando leitura do QR Code...' : 'Desconectado'}
          </span>
        </div>
        {isConnected && status?.phone_number && (
          <p className="text-gray-500 text-sm mt-2 ml-6">📱 {status.phone_number}</p>
        )}
      </div>

      {/* QR Code */}
      {isPending && (
        <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm text-center space-y-4">
          <h2 className="text-lg font-bold text-gray-900">Escaneie o QR Code</h2>
          <p className="text-gray-500 text-sm">
            Abra o WhatsApp no celular do seu negócio → Configurações → Aparelhos conectados → Conectar aparelho
          </p>
          {qrData?.qrcode ? (
            <div className="flex justify-center">
              <img
                src={qrData.qrcode}
                alt="QR Code WhatsApp"
                className="w-56 h-56 rounded-2xl border border-gray-100"
              />
            </div>
          ) : (
            <div className="flex justify-center items-center w-56 h-56 mx-auto bg-gray-50 rounded-2xl border border-gray-100">
              <div className="text-center">
                <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-2" />
                <p className="text-gray-400 text-sm">Gerando QR Code...</p>
              </div>
            </div>
          )}
          <p className="text-gray-400 text-xs">O código expira em 60 segundos e é atualizado automaticamente</p>
        </div>
      )}

      {/* How it works */}
      {!isConnected && !isPending && (
        <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm space-y-4">
          <h2 className="text-lg font-bold text-gray-900">Como funciona</h2>
          {[
            'Clique em "Conectar WhatsApp" abaixo',
            'Um QR Code será gerado para o número do seu negócio',
            'Abra o WhatsApp do estabelecimento e escaneie o código',
            'Pronto! O bot já começa a responder seus clientes automaticamente',
          ].map((step, i) => (
            <div key={i} className="flex items-start gap-3">
              <div className="w-7 h-7 rounded-full bg-primary-light flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-primary text-xs font-bold">{i + 1}</span>
              </div>
              <p className="text-gray-700 text-sm">{step}</p>
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      <div>
        {!isConnected && (
          <button
            onClick={() => {
              if (isPending) {
                setConnecting(false)
              } else {
                connectMutation.mutate()
              }
            }}
            disabled={connectMutation.isPending}
            className={`w-full h-12 font-semibold rounded-xl transition-colors disabled:opacity-50 ${
              isPending
                ? 'border-2 border-gray-300 text-gray-600 hover:bg-gray-50'
                : 'bg-[#25D366] hover:bg-[#1ebe57] text-white'
            }`}
          >
            {connectMutation.isPending ? 'Iniciando...' : isPending ? 'Cancelar' : '📱 Conectar WhatsApp'}
          </button>
        )}
        {isConnected && (
          <button
            onClick={() => { if (confirm('Tem certeza? O bot parará de responder.')) {} }}
            className="w-full h-12 border-2 border-gray-200 text-gray-600 hover:bg-gray-50 font-semibold rounded-xl transition-colors"
          >
            Desconectar
          </button>
        )}
      </div>
    </div>
  )
}
