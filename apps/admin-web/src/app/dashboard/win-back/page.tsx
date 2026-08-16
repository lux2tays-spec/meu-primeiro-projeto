'use client'
import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { rootApi } from '@/lib/api'

// Win-back / Prospecção: reengaja a base RETIDA (quem NÃO excluiu a conta) —
// trial expirado, free sem upgrade e cancelados. Lista com contato do dono e
// dispara comunicado segmentado (push/e-mail/WhatsApp) ou fala 1:1 no WhatsApp.

type SegKey = 'trial_expired' | 'free' | 'cancelled'
const SEGMENTS: { key: SegKey; label: string; hint: string; color: string }[] = [
  { key: 'trial_expired', label: 'Trial expirado', hint: 'Testaram e não assinaram — quentes para conversão.', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  { key: 'free',          label: 'Free sem upgrade', hint: 'Usam o grátis — ofereça o premium.', color: 'bg-blue-50 text-blue-700 border-blue-200' },
  { key: 'cancelled',     label: 'Cancelados', hint: 'Já foram clientes — campanha de volta.', color: 'bg-red-50 text-red-700 border-red-200' },
]

function waLink(phone: string | null, name: string) {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  const msg = encodeURIComponent(`Olá ${name.split(' ')[0]}! Aqui é da AiConfirma 😊`)
  return `https://wa.me/${digits}?text=${msg}`
}

function fmtDate(s: string | null) {
  return s ? new Date(s).toLocaleDateString('pt-BR') : '—'
}

export default function WinBackPage() {
  const [segment, setSegment] = useState<SegKey>('trial_expired')
  const { data, isLoading } = useQuery({ queryKey: ['prospects', segment], queryFn: () => rootApi.prospects(segment) })
  const counts = data?.counts

  const [showBroadcast, setShowBroadcast] = useState(false)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Win-back / Prospecção</h1>
        <p className="text-gray-500 text-sm mt-1">Reative e venda para a base que ficou — quem excluiu a conta não aparece aqui (LGPD).</p>
      </div>

      {/* Cards de segmento */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {SEGMENTS.map((s) => {
          const n = counts?.[s.key] ?? 0
          const active = segment === s.key
          return (
            <button key={s.key} onClick={() => setSegment(s.key)}
              className={`text-left rounded-2xl p-5 border-2 transition ${active ? 'border-primary shadow-sm bg-white' : 'border-gray-100 bg-white hover:border-gray-200'}`}>
              <span className={`inline-block text-xs font-semibold px-2.5 py-0.5 rounded-full border ${s.color}`}>{s.label}</span>
              <p className="text-3xl font-bold text-gray-900 mt-3">{isLoading ? '—' : n}</p>
              <p className="text-xs text-gray-400 mt-1">{s.hint}</p>
            </button>
          )
        })}
      </div>

      {/* Ações do segmento */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="font-semibold text-gray-900">
          {SEGMENTS.find((s) => s.key === segment)?.label} · {data?.list.length ?? 0} contato(s)
        </h2>
        <button onClick={() => setShowBroadcast(true)}
          className="h-10 px-4 bg-primary hover:bg-primary-dark text-white text-sm font-semibold rounded-xl transition-colors">
          📣 Enviar comunicado ao segmento
        </button>
      </div>

      {showBroadcast && (
        <BroadcastForm segment={segment} segmentLabel={SEGMENTS.find((s) => s.key === segment)!.label} onClose={() => setShowBroadcast(false)} />
      )}

      {/* Lista */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        {isLoading ? (
          <div className="p-6 text-gray-400 text-sm">Carregando...</div>
        ) : !data?.list.length ? (
          <div className="p-6 text-gray-400 text-sm">Nenhum tenant neste segmento.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                  <th className="py-3 px-4">Negócio</th>
                  <th className="py-3 px-4">Dono / contato</th>
                  <th className="py-3 px-4">Plano</th>
                  <th className="py-3 px-4">Últ. acesso</th>
                  <th className="py-3 px-4">Criado</th>
                  <th className="py-3 px-4"></th>
                </tr>
              </thead>
              <tbody>
                {data.list.map((t) => {
                  const wa = waLink(t.owner_phone, t.owner_name)
                  return (
                    <tr key={t.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="py-3 px-4 font-medium text-gray-900">{t.name}</td>
                      <td className="py-3 px-4 text-gray-600">
                        <div>{t.owner_name}</div>
                        <div className="text-xs text-gray-400">{t.owner_email}{t.owner_phone ? ` · ${t.owner_phone}` : ''}</div>
                      </td>
                      <td className="py-3 px-4"><span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{t.plan}</span></td>
                      <td className="py-3 px-4 text-gray-500">{fmtDate(t.last_seen_at)}</td>
                      <td className="py-3 px-4 text-gray-500">{fmtDate(t.created_at)}</td>
                      <td className="py-3 px-4">
                        {wa && <a href={wa} target="_blank" rel="noreferrer" className="text-green-600 hover:text-green-700 text-xs font-semibold whitespace-nowrap">WhatsApp →</a>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function BroadcastForm({ segment, segmentLabel, onClose }: { segment: SegKey; segmentLabel: string; onClose: () => void }) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [channels, setChannels] = useState<Array<'inapp' | 'push' | 'email' | 'whatsapp'>>(['inapp', 'push'])
  const [result, setResult] = useState('')

  const mutation = useMutation({
    mutationFn: () => rootApi.sendBroadcast({ title, body, target: segment, channels }),
    onSuccess: (r) => setResult(`Enviado para ${r.recipients} destinatário(s).`),
    onError: (e: any) => setResult(e?.message || 'Falha ao enviar.'),
  })

  const toggle = (c: 'inapp' | 'push' | 'email' | 'whatsapp') =>
    setChannels((cs) => cs.includes(c) ? cs.filter((x) => x !== c) : [...cs, c])

  const inputCls = 'w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary'

  return (
    <div className="bg-white rounded-2xl p-5 border border-primary/30 shadow-sm space-y-3">
      <div className="flex items-center justify-between">
        <p className="font-semibold text-gray-900 text-sm">Comunicado para: <span className="text-primary">{segmentLabel}</span></p>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-sm">Fechar</button>
      </div>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título (ex.: Sentimos sua falta!)" className={inputCls} />
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} placeholder="Mensagem — ex.: volte com 20% no primeiro mês do premium."
        className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
      <div className="flex flex-wrap gap-2">
        {(['inapp', 'push', 'email', 'whatsapp'] as const).map((c) => (
          <button key={c} onClick={() => toggle(c)}
            className={`text-xs font-medium px-3 py-1.5 rounded-full border ${channels.includes(c) ? 'bg-primary/10 border-primary/40 text-primary' : 'border-gray-200 text-gray-500'}`}>
            {c === 'inapp' ? 'No app' : c === 'push' ? 'Push' : c === 'email' ? 'E-mail' : 'WhatsApp'}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <button onClick={() => { setResult(''); if (title && body && channels.length) mutation.mutate() }}
          disabled={mutation.isPending || !title || !body || !channels.length}
          className="h-10 px-5 bg-primary hover:bg-primary-dark text-white text-sm font-semibold rounded-xl disabled:opacity-50">
          {mutation.isPending ? 'Enviando...' : 'Enviar comunicado'}
        </button>
        {result && <span className="text-sm text-gray-600">{result}</span>}
      </div>
    </div>
  )
}
