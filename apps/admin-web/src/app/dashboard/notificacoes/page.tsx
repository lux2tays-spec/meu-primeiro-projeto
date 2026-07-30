'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { rootApi } from '@/lib/api'

type Channel = 'inapp' | 'push' | 'email' | 'whatsapp'

const CHANNELS: { key: Channel; label: string; hint: string }[] = [
  { key: 'inapp', label: 'Aviso no sistema', hint: 'Aparece no sino de notificações (app e painel). Sempre incluído.' },
  { key: 'push', label: 'Push no celular', hint: 'Notificação no aparelho dos usuários com o app instalado.' },
  { key: 'email', label: 'E-mail', hint: 'Envia para o e-mail de login de cada destinatário.' },
  { key: 'whatsapp', label: 'WhatsApp', hint: 'Envia pela instância da plataforma para o WhatsApp do usuário.' },
]

export default function NotificacoesPage() {
  const qc = useQueryClient()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [link, setLink] = useState('')
  const [target, setTarget] = useState<'owners' | 'all'>('owners')
  const [channels, setChannels] = useState<Channel[]>(['inapp'])
  const [feedback, setFeedback] = useState('')

  const { data: history = [] } = useQuery({ queryKey: ['broadcasts'], queryFn: rootApi.broadcasts })

  const send = useMutation({
    mutationFn: () => rootApi.sendBroadcast({
      title: title.trim(),
      body: body.trim(),
      link: link.trim() || undefined,
      target,
      channels,
    }),
    onSuccess: (res) => {
      setFeedback(`Comunicado enviado para ${res.recipients} destinatário(s).`)
      setTitle(''); setBody(''); setLink('')
      qc.invalidateQueries({ queryKey: ['broadcasts'] })
      setTimeout(() => setFeedback(''), 5000)
    },
    onError: (e: any) => setFeedback(e?.message ?? 'Não foi possível enviar.'),
  })

  function toggleChannel(c: Channel) {
    setChannels((cur) => cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c])
  }

  const canSend = title.trim().length > 0 && body.trim().length > 0 && channels.length > 0 && !send.isPending

  return (
    <div className="p-8 space-y-8 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Notificações</h1>
        <p className="text-gray-500 text-sm mt-1">Envie comunicados, avisos e promoções aos proprietários ou a todos os usuários.</p>
      </div>

      <section className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Título</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={140}
            placeholder="Ex.: Nova funcionalidade disponível!"
            className="w-full h-10 px-3 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Mensagem</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={2000}
            rows={4}
            placeholder="Escreva o comunicado…"
            className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
          />
        </div>
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Link (opcional)</label>
          <input
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="/settings/subscription ou https://…"
            className="w-full h-10 px-3 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <p className="text-xs text-gray-400 mt-1">Ao tocar no aviso, o usuário abre este destino. Caminhos internos (ex.: /calendar) funcionam no app e no painel.</p>
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">Enviar para</label>
          <div className="flex gap-2">
            {([['owners', 'Proprietários'], ['all', 'Todos os usuários']] as const).map(([val, label]) => (
              <button
                key={val}
                onClick={() => setTarget(val)}
                className={`px-4 py-2 rounded-lg text-sm font-semibold border transition-colors ${
                  target === val ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">Canais</label>
          <div className="space-y-2">
            {CHANNELS.map(({ key, label, hint }) => {
              const checked = channels.includes(key)
              const forced = key === 'inapp'
              return (
                <label key={key} className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer ${checked ? 'border-indigo-300 bg-indigo-50/50' : 'border-gray-200'}`}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={forced}
                    onChange={() => toggleChannel(key)}
                    className="mt-0.5"
                  />
                  <div>
                    <p className="text-sm font-medium text-gray-900">{label}{forced && <span className="text-xs text-gray-400 font-normal"> (sempre)</span>}</p>
                    <p className="text-xs text-gray-500">{hint}</p>
                  </div>
                </label>
              )
            })}
          </div>
        </div>

        {feedback && <p className="text-sm font-semibold text-indigo-600">{feedback}</p>}

        <button
          onClick={() => { if (window.confirm(`Enviar este comunicado para ${target === 'owners' ? 'todos os proprietários' : 'TODOS os usuários'}?`)) send.mutate() }}
          disabled={!canSend}
          className="w-full h-11 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors"
        >
          {send.isPending ? 'Enviando…' : 'Enviar comunicado'}
        </button>
      </section>

      <section>
        <h2 className="text-lg font-bold text-gray-900 mb-3">Enviados recentemente</h2>
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
          {history.length === 0 ? (
            <p className="text-sm text-gray-400 p-6 text-center">Nenhum comunicado enviado ainda.</p>
          ) : (
            history.map((b: any) => (
              <div key={b.id} className="p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-gray-900">{b.title}</p>
                  <span className="text-xs text-gray-400 shrink-0">{new Date(b.created_at).toLocaleString('pt-BR')}</span>
                </div>
                <p className="text-sm text-gray-500 mt-0.5 line-clamp-2">{b.body}</p>
                <div className="flex items-center gap-2 mt-2 text-xs text-gray-400">
                  <span className="px-2 py-0.5 rounded-full bg-gray-100">{b.target === 'owners' ? 'Proprietários' : 'Todos'}</span>
                  <span className="px-2 py-0.5 rounded-full bg-gray-100">{(b.channels ?? []).join(', ')}</span>
                  <span>{b.recipients_count} destinatário(s)</span>
                  {b.created_by_name && <span>· por {b.created_by_name}</span>}
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  )
}
