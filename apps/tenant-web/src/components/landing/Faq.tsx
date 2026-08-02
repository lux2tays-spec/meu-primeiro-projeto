'use client'
import { useState } from 'react'
import { ChevronDown } from 'lucide-react'

const FAQ: { q: string; a: string }[] = [
  {
    q: 'Preciso trocar meu número de WhatsApp?',
    a: 'Não. Você conecta o número que já usa lendo um QR Code no app — o mesmo número passa a ser atendido pela IA, e você continua podendo responder manualmente quando quiser.',
  },
  {
    q: 'A IA responde sozinha mesmo? E se eu quiser assumir a conversa?',
    a: 'Sim, ela atende 24h, tira dúvidas e agenda de verdade na sua agenda. Assim que você responde a conversa, o bot pausa automaticamente e deixa você assumir — depois volta a atender.',
  },
  {
    q: 'Tem fidelidade ou posso cancelar quando quiser?',
    a: 'Sem fidelidade. Você pode cancelar a assinatura a qualquer momento direto no app; o cancelamento vale na hora e sua conta volta para o plano gratuito.',
  },
  {
    q: 'Como funciona o teste grátis?',
    a: 'Você cria a conta e testa sem cartão. Ao final do período de teste, escolhe um plano para continuar usando o atendimento automático.',
  },
  {
    q: 'Preciso instalar alguma coisa?',
    a: 'Só o app (Android/iOS) para configurar e acompanhar. Seus clientes não instalam nada — eles falam com você pelo WhatsApp de sempre.',
  },
  {
    q: 'Consigo controlar comissões dos profissionais?',
    a: 'Sim. Você define % ou valor fixo por profissional em cada serviço, e o sistema calcula automaticamente quanto pagar a cada um (nos planos que incluem o recurso).',
  },
  {
    q: 'Meus dados e os dos meus clientes ficam seguros?',
    a: 'Sim. Seguimos a LGPD, os dados trafegam de forma criptografada e você pode excluir informações quando quiser. Pagamentos são processados pelo Mercado Pago.',
  },
  {
    q: 'A cobrança é segura?',
    a: 'Sim — a assinatura é feita pelo Mercado Pago, direto no app, sem precisar sair da plataforma nem criar conta em outro lugar.',
  },
]

export default function Faq() {
  const [open, setOpen] = useState<number | null>(0)
  return (
    <div className="mx-auto mt-10 max-w-3xl space-y-3">
      {FAQ.map((item, i) => {
        const isOpen = open === i
        return (
          <div key={i} className="overflow-hidden rounded-2xl border border-slate-100 bg-white dark:border-white/10 dark:bg-white/5">
            <button
              onClick={() => setOpen(isOpen ? null : i)}
              className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
              aria-expanded={isOpen}
            >
              <span className="font-semibold text-slate-900 dark:text-white">{item.q}</span>
              <ChevronDown size={18} className={`shrink-0 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>
            {isOpen && (
              <div className="px-5 pb-4 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{item.a}</div>
            )}
          </div>
        )
      })}
    </div>
  )
}
