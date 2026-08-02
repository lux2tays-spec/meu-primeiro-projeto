import Link from 'next/link'
import type { Metadata } from 'next'
import {
  MessageCircle, CalendarDays, Coins, CreditCard, Users, Bell,
  Headset, BarChart3, ArrowRight, Clock, TrendingUp, Sparkles, ShieldCheck, Star, Bot,
} from 'lucide-react'
import Logo, { LP_FONT } from '@/components/landing/Logo'
import Reveal from '@/components/landing/Reveal'
import PhoneChat, { type ChatMessage } from '@/components/landing/PhoneChat'
import AgendaMock from '@/components/landing/AgendaMock'
import SupportWhatsAppButton from '@/components/landing/SupportWhatsAppButton'
import PricingPlans from '@/components/landing/PricingPlans'
import Faq from '@/components/landing/Faq'

export const metadata: Metadata = {
  title: 'AíConfirma — Seu atendimento no WhatsApp no piloto automático',
  description:
    'Assistente de IA que responde no WhatsApp, agenda sozinho 24/7 e controla comissões pra você. Agenda cheia, zero cliente perdido. Teste grátis.',
  openGraph: {
    title: 'AíConfirma — Agendamento inteligente no WhatsApp',
    description:
      'A IA responde, agenda e confirma pelo WhatsApp enquanto você trabalha. Controle de agenda, profissionais e comissões num só lugar.',
    type: 'website',
  },
}

const NAVY = '#1E3C66'

// ── Demo scripts ──────────────────────────────────────────────────────────────
const BOOKING: ChatMessage[] = [
  { from: 'in',  text: 'Oi! 😊 Aqui é do Studio Bella. Como posso te ajudar?', time: '14:31' },
  { from: 'out', text: 'Oi! Queria agendar um corte', time: '14:31' },
  { from: 'in',  text: 'Claro! Pra quando fica bom pra você?', time: '14:31' },
  { from: 'out', text: 'Amanhã à tarde', time: '14:32' },
  { from: 'in',  text: 'Tenho amanhã às 14h, 15h30 e 17h com a Ana 💇\nQual prefere?', time: '14:32' },
  { from: 'out', text: 'Pode ser 15h30', time: '14:32' },
  { from: 'in',  text: 'Fechado! Corte amanhã às 15h30 com a Ana. Confirmo? 🙂', time: '14:33' },
  { from: 'out', text: 'Confirma!', time: '14:33' },
  { from: 'sys', text: 'Agendamento criado na agenda ✅' },
  { from: 'in',  text: 'Prontinho, Marina! Te espero amanhã às 15h30 🥰\nSe precisar remarcar, é só me chamar.', time: '14:33' },
]

const REMINDER: ChatMessage[] = [
  { from: 'sys', text: 'Lembrete automático — 1 dia antes' },
  { from: 'in',  text: 'Oi Marina! Passando pra lembrar do seu horário amanhã às 15h30 com a Ana 💇 Posso confirmar?', time: '09:00' },
  { from: 'out', text: 'Consegue mudar pra 17h?', time: '09:04' },
  { from: 'in',  text: 'Consigo sim! Troquei pra amanhã às 17h ✅ Fica ótimo assim?', time: '09:04' },
  { from: 'out', text: 'Perfeito, obrigada!', time: '09:05' },
  { from: 'in',  text: 'Imagina! Até amanhã 💚', time: '09:05' },
]

const FEATURES = [
  { icon: MessageCircle, title: 'Assistente de IA no WhatsApp', desc: 'Responde na hora, entende o cliente e conduz até o agendamento — 24 horas por dia.' },
  { icon: CalendarDays,  title: 'Agenda inteligente',          desc: 'Visões dia, semana e mês. Veja, edite e remarque em segundos, sem papel nem planilha.' },
  { icon: Coins,         title: 'Comissões automáticas',       desc: 'Defina % ou valor por profissional em cada serviço. O sistema calcula quanto pagar.' },
  { icon: CreditCard,    title: 'Pagamentos',                  desc: 'Cobrança e assinatura integradas com Mercado Pago, direto no app.' },
  { icon: Users,         title: 'Vários profissionais',        desc: 'Cada colaborador vê só a agenda e as comissões dele. Admin e dono veem tudo.' },
  { icon: Bell,          title: 'Lembretes automáticos',       desc: 'Confirmação e lembrete antes do horário — menos faltas, agenda mais cheia.' },
  { icon: Headset,       title: 'Atendimento humano na hora',  desc: 'Precisou entrar? O bot pausa sozinho quando você responde e volta depois.' },
  { icon: BarChart3,     title: 'Tudo sob controle',           desc: 'Clientes, histórico, receitas e comissões organizados num só lugar.' },
]

const STEPS = [
  { n: '1', title: 'Conecte seu WhatsApp', desc: 'Leia um QR Code no app e pronto — o número que você já usa vira um atendente com IA.' },
  { n: '2', title: 'A IA atende e agenda', desc: 'O assistente responde, oferece horários reais da sua agenda e confirma sozinho.' },
  { n: '3', title: 'Você acompanha tudo',  desc: 'Agenda, clientes e comissões atualizados em tempo real no app e no computador.' },
]

const ROI = [
  { icon: TrendingUp, stat: 'Menos clientes perdidos', desc: 'Cada mensagem respondida na hora é um agendamento que não escapa pro concorrente.' },
  { icon: Clock,      stat: 'Horas de volta na semana', desc: 'Chega de vai-e-vem no WhatsApp pra marcar horário — a IA faz isso por você.' },
  { icon: Coins,      stat: 'Comissão sem erro',        desc: 'Cálculo automático por profissional. Fim da planilha e das dúvidas no fim do mês.' },
]

// Depoimentos ilustrativos (prova social). Ajuste os textos conforme cases reais.
const TESTIMONIALS = [
  { name: 'Marina S.', role: 'Studio de beleza', text: 'A IA responde na hora, mesmo quando estou atendendo. Parei de perder cliente por demora no WhatsApp — a agenda encheu.', bot: 320 },
  { name: 'Rafael L.', role: 'Barbearia', text: 'Configurei em minutos lendo o QR Code. Agora o bot agenda e confirma sozinho, e ainda calcula a comissão da equipe.', bot: 540 },
  { name: 'Dra. Aline', role: 'Clínica de estética', text: 'Os lembretes automáticos reduziram muito as faltas. E quando precisa, eu assumo a conversa e o bot pausa sozinho.', bot: 410 },
]

function Section({ id, className = '', children }: { id?: string; className?: string; children: React.ReactNode }) {
  return (
    <section id={id} className={`mx-auto w-full max-w-6xl px-5 sm:px-8 ${className}`}>{children}</section>
  )
}

export default function Home() {
  return (
    <main className="min-h-screen bg-white text-slate-800 dark:bg-[#0B1220] dark:text-slate-100" style={{ fontFamily: LP_FONT }}>
      {/* ── Nav ─────────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 border-b border-slate-100/80 bg-white/85 backdrop-blur dark:border-white/10 dark:bg-[#0B1220]/85">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5 sm:px-8">
          <Logo id="lp-nav" size={30} />
          <nav className="flex items-center gap-2 sm:gap-3">
            <a href="#planos" className="hidden rounded-xl px-3 py-2 text-sm font-semibold text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white md:inline-block">
              Planos
            </a>
            <a href="#faq" className="hidden rounded-xl px-3 py-2 text-sm font-semibold text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white md:inline-block">
              Dúvidas
            </a>
            <Link href="/login" className="rounded-xl px-3 py-2 text-sm font-semibold text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white">
              Entrar
            </Link>
            <Link href="/register" className="rounded-xl bg-[#2CB86E] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:brightness-105">
              Testar grátis
            </Link>
          </nav>
        </div>
      </header>

      {/* ── Hero ────────────────────────────────────────────────────────────── */}
      <Section className="grid items-center gap-10 pb-8 pt-12 sm:pt-16 lg:grid-cols-2 lg:gap-12">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#2CB86E]/10 px-3 py-1 text-xs font-bold text-[#1C9DAA]">
            <Sparkles size={13} /> Agendamento inteligente no WhatsApp
          </span>
          <h1 className="mt-4 text-4xl font-extrabold leading-[1.08] tracking-tight sm:text-5xl" style={{ color: NAVY }}>
            <span className="dark:text-white">Sua agenda cheia,</span>{' '}
            <span className="bg-gradient-to-r from-[#2CB86E] via-[#1C9DAA] to-[#1D62B5] bg-clip-text text-transparent">sem perder nenhum cliente.</span>
          </h1>
          <p className="mt-4 max-w-xl text-lg text-slate-600 dark:text-slate-300">
            O AíConfirma responde no seu WhatsApp, agenda sozinho 24 horas por dia e ainda controla
            comissões da sua equipe. Você atende mais, com menos esforço.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link href="/register" className="inline-flex items-center gap-2 rounded-2xl bg-[#2CB86E] px-6 py-3.5 text-base font-bold text-white shadow-lg shadow-[#2CB86E]/25 transition hover:brightness-105">
              Começar grátis <ArrowRight size={18} />
            </Link>
            <a href="#como-funciona" className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-6 py-3.5 text-base font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-white/15 dark:text-slate-200 dark:hover:bg-white/5">
              Ver como funciona
            </a>
          </div>
          <p className="mt-3 flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400">
            <ShieldCheck size={15} className="text-[#2CB86E]" /> Sem cartão para testar · Cancele quando quiser
          </p>
        </div>
        <Reveal className="flex justify-center">
          <PhoneChat contactName="Studio Bella" messages={BOOKING} label="Cliente agendando um corte pelo WhatsApp com o assistente de IA" />
        </Reveal>
      </Section>

      {/* ── Problema ────────────────────────────────────────────────────────── */}
      <Section className="py-16 sm:py-20">
        <Reveal>
          <h2 className="text-center text-3xl font-extrabold tracking-tight sm:text-4xl" style={{ color: NAVY }}>
            <span className="dark:text-white">Quantos clientes você perde</span>{' '}
            <span className="text-[#1D62B5] dark:text-[#5B9BE0]">sem nem perceber?</span>
          </h2>
        </Reveal>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['Demorou pra responder', 'O cliente não espera: manda mensagem pra outro e agenda lá.'],
            ['Agenda no vai-e-vem', 'Horas trocando mensagem só pra marcar um horário.'],
            ['Comissão na planilha', 'Cálculo manual no fim do mês, com erro e retrabalho.'],
            ['WhatsApp bagunçado', 'Conversa, agenda e pagamento em lugares diferentes.'],
          ].map(([t, d], i) => (
            <Reveal key={t} delay={i * 80}>
              <div className="h-full rounded-2xl border border-slate-100 bg-slate-50/60 p-5 dark:border-white/10 dark:bg-white/5">
                <p className="font-bold text-slate-800 dark:text-white">{t}</p>
                <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">{d}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* ── Como funciona ───────────────────────────────────────────────────── */}
      <Section id="como-funciona" className="py-4">
        <Reveal>
          <h2 className="text-center text-3xl font-extrabold tracking-tight sm:text-4xl" style={{ color: NAVY }}>
            <span className="dark:text-white">Funciona em </span>
            <span className="bg-gradient-to-r from-[#2CB86E] to-[#1D62B5] bg-clip-text text-transparent">3 passos</span>
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-center text-slate-600 dark:text-slate-300">
            Sem instalar nada novo pro seu cliente. Ele continua no WhatsApp de sempre.
          </p>
        </Reveal>
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <Reveal key={s.n} delay={i * 90}>
              <div className="relative h-full rounded-2xl border border-slate-100 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-white/5">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-[#2CB86E] to-[#1D62B5] text-lg font-black text-white">{s.n}</div>
                <h3 className="mt-4 text-lg font-bold text-slate-900 dark:text-white">{s.title}</h3>
                <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-300">{s.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* ── Recursos ────────────────────────────────────────────────────────── */}
      <Section className="py-16 sm:py-20">
        <Reveal>
          <h2 className="text-center text-3xl font-extrabold tracking-tight sm:text-4xl" style={{ color: NAVY }}>
            <span className="dark:text-white">Tudo que o seu negócio precisa</span>
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-center text-slate-600 dark:text-slate-300">
            Um sistema pensado pra quem vive de agenda — salões, clínicas, estética, pet e muito mais.
          </p>
        </Reveal>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} delay={(i % 4) * 70}>
              <div className="h-full rounded-2xl border border-slate-100 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-white/5">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#2CB86E]/10 text-[#1C9DAA]">
                  <f.icon size={20} />
                </div>
                <h3 className="mt-3.5 font-bold text-slate-900 dark:text-white">{f.title}</h3>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{f.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* ── Demos (WhatsApp + app) ──────────────────────────────────────────── */}
      <Section className="py-4">
        <Reveal>
          <h2 className="text-center text-3xl font-extrabold tracking-tight sm:text-4xl" style={{ color: NAVY }}>
            <span className="dark:text-white">Veja o AíConfirma </span>
            <span className="bg-gradient-to-r from-[#2CB86E] to-[#1D62B5] bg-clip-text text-transparent">trabalhando por você</span>
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-center text-slate-600 dark:text-slate-300">
            Conversas reais de agendamento e confirmação — e o painel que você acompanha no app.
          </p>
        </Reveal>
        <div className="mt-12 grid items-start gap-10 lg:grid-cols-3">
          <Reveal className="flex flex-col items-center">
            <PhoneChat contactName="Studio Bella" messages={BOOKING} label="Agendamento pelo WhatsApp" />
            <p className="mt-4 max-w-xs text-center text-sm font-medium text-slate-600 dark:text-slate-300">Agendou sozinho, do “oi” ao horário confirmado.</p>
          </Reveal>
          <Reveal className="flex flex-col items-center" delay={100}>
            <PhoneChat contactName="Studio Bella" messages={REMINDER} label="Confirmação e remarcação automáticas" />
            <p className="mt-4 max-w-xs text-center text-sm font-medium text-slate-600 dark:text-slate-300">Confirma e remarca sozinho — menos faltas.</p>
          </Reveal>
          <Reveal className="flex flex-col items-center" delay={200}>
            <AgendaMock />
            <p className="mt-4 max-w-xs text-center text-sm font-medium text-slate-600 dark:text-slate-300">E cai na sua agenda, com a comissão já calculada.</p>
          </Reveal>
        </div>
      </Section>

      {/* ── ROI ─────────────────────────────────────────────────────────────── */}
      <Section className="py-16 sm:py-20">
        <div className="rounded-3xl bg-gradient-to-br from-[#1E3C66] via-[#1C4E7A] to-[#1D62B5] p-8 text-white sm:p-12">
          <Reveal>
            <h2 className="text-center text-3xl font-extrabold tracking-tight sm:text-4xl">
              Quanto vale <span className="text-[#8FE3B4]">não perder um cliente?</span>
            </h2>
            <p className="mx-auto mt-3 max-w-2xl text-center text-white/80">
              Números ilustrativos — o retorno real depende do seu movimento. A ideia é simples: atender mais, com menos trabalho manual.
            </p>
          </Reveal>
          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            {ROI.map((r, i) => (
              <Reveal key={r.stat} delay={i * 90}>
                <div className="h-full rounded-2xl bg-white/10 p-6 ring-1 ring-white/15 backdrop-blur">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 text-[#8FE3B4]"><r.icon size={20} /></div>
                  <p className="mt-3.5 text-lg font-bold">{r.stat}</p>
                  <p className="mt-1 text-sm text-white/75">{r.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </Section>

      {/* ── Depoimentos (prova social) ──────────────────────────────────────── */}
      <Section id="depoimentos" className="py-16 sm:py-20">
        <Reveal>
          <h2 className="text-center text-3xl font-extrabold tracking-tight sm:text-4xl" style={{ color: NAVY }}>
            <span className="dark:text-white">Negócios que já </span>
            <span className="bg-gradient-to-r from-[#2CB86E] to-[#1D62B5] bg-clip-text text-transparent">atendem no automático</span>
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-center text-slate-600 dark:text-slate-300">
            Veja quantos agendamentos a IA já fechou sozinha para cada um.
          </p>
        </Reveal>
        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {TESTIMONIALS.map((t, i) => (
            <Reveal key={t.name} delay={i * 90}>
              <figure className="flex h-full flex-col rounded-2xl border border-slate-100 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-white/5">
                <div className="flex gap-0.5 text-[#F5B301]">
                  {Array.from({ length: 5 }).map((_, s) => <Star key={s} size={15} fill="currentColor" strokeWidth={0} />)}
                </div>
                <blockquote className="mt-3 flex-1 text-sm leading-relaxed text-slate-600 dark:text-slate-300">“{t.text}”</blockquote>
                {/* Painel do app: agendamentos fechados pela IA */}
                <div className="mt-4 flex items-center gap-3 rounded-xl bg-[#2CB86E]/10 px-4 py-3 ring-1 ring-[#2CB86E]/20">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#2CB86E]/15 text-[#2CB86E]"><Bot size={18} /></div>
                  <div>
                    <p className="text-lg font-extrabold leading-none text-[#1C9DAA] dark:text-[#8FE3B4]">{t.bot}+</p>
                    <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">agendamentos feitos pela IA</p>
                  </div>
                </div>
                <figcaption className="mt-4 flex items-center gap-3 border-t border-slate-100 pt-4 dark:border-white/10">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 font-bold text-slate-500 dark:bg-white/10 dark:text-white">{t.name.charAt(0)}</div>
                  <div>
                    <p className="text-sm font-bold text-slate-900 dark:text-white">{t.name}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{t.role}</p>
                  </div>
                </figcaption>
              </figure>
            </Reveal>
          ))}
        </div>
        <Reveal>
          <p className="mx-auto mt-6 max-w-2xl text-center text-xs text-slate-400">Depoimentos ilustrativos.</p>
        </Reveal>
      </Section>

      {/* ── Planos ──────────────────────────────────────────────────────────── */}
      <Section id="planos" className="py-4">
        <Reveal>
          <h2 className="text-center text-3xl font-extrabold tracking-tight sm:text-4xl" style={{ color: NAVY }}>
            <span className="dark:text-white">Planos que cabem no seu negócio</span>
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-center text-slate-600 dark:text-slate-300">
            Comece grátis. Cresça quando quiser. <span className="whitespace-nowrap">No plano anual você economiza.</span>
          </p>
        </Reveal>
        <PricingPlans />
      </Section>

      {/* ── FAQ ─────────────────────────────────────────────────────────────── */}
      <Section id="faq" className="py-16 sm:py-20">
        <Reveal>
          <h2 className="text-center text-3xl font-extrabold tracking-tight sm:text-4xl" style={{ color: NAVY }}>
            <span className="dark:text-white">Perguntas frequentes</span>
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-center text-slate-600 dark:text-slate-300">
            Tudo o que você precisa saber antes de começar.
          </p>
        </Reveal>
        <Faq />
      </Section>

      {/* ── CTA final ───────────────────────────────────────────────────────── */}
      <Section className="py-16 sm:py-24">
        <Reveal className="mx-auto max-w-3xl text-center">
          <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl" style={{ color: NAVY }}>
            <span className="dark:text-white">Comece hoje. Sua próxima cliente já está no WhatsApp.</span>
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-slate-600 dark:text-slate-300">
            Ative o assistente em minutos e veja a agenda encher — sem cartão para testar.
          </p>
          <Link href="/register" className="mt-8 inline-flex items-center gap-2 rounded-2xl bg-[#2CB86E] px-8 py-4 text-lg font-bold text-white shadow-lg shadow-[#2CB86E]/25 transition hover:brightness-105">
            Criar minha conta grátis <ArrowRight size={20} />
          </Link>
        </Reveal>
      </Section>

      {/* ── Afiliados (CTA) ──────────────────────────────────────────────────── */}
      <section className="border-t border-slate-100 dark:border-white/10">
        <div className="mx-auto max-w-6xl px-5 py-10 sm:px-8">
          <div className="flex flex-col items-center gap-4 rounded-3xl bg-gradient-to-br from-[#2CB86E]/10 to-[#2CB86E]/5 px-6 py-8 text-center dark:from-[#2CB86E]/15 dark:to-transparent sm:flex-row sm:justify-between sm:text-left">
            <div>
              <h3 className="text-lg font-extrabold text-slate-900 dark:text-white sm:text-xl">
                Quer ganhar indicando nosso sistema? 💸
              </h3>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                Acesse agora nosso portal de afiliados e receba comissão a cada indicação que assinar.
              </p>
            </div>
            <Link
              href="/register?ref=afiliado"
              className="inline-flex shrink-0 items-center gap-2 rounded-2xl bg-[#2CB86E] px-6 py-3.5 text-base font-bold text-white shadow-lg shadow-[#2CB86E]/25 transition hover:brightness-105"
            >
              Quero ser afiliado
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <footer className="border-t border-slate-100 py-10 dark:border-white/10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-5 sm:flex-row sm:px-8">
          <Logo id="lp-footer" size={26} />
          <nav className="flex items-center gap-5 text-sm text-slate-500 dark:text-slate-400">
            <Link href="/privacidade" className="hover:text-slate-800 dark:hover:text-white">Privacidade</Link>
            <Link href="/termos" className="hover:text-slate-800 dark:hover:text-white">Termos</Link>
            <Link href="/register?ref=afiliado" className="hover:text-slate-800 dark:hover:text-white">Afiliados</Link>
            <Link href="/login" className="hover:text-slate-800 dark:hover:text-white">Entrar</Link>
          </nav>
          <p className="text-xs text-slate-400">© 2026 AíConfirma</p>
        </div>
      </footer>

      {/* Floating WhatsApp — only renders when the system bot is connected */}
      <SupportWhatsAppButton />
    </main>
  )
}
