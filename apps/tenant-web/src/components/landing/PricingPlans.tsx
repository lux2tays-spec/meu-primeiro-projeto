'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Check } from 'lucide-react'
import { BASE_URL } from '@/lib/api'

const NAVY = '#1E3C66'

type ApiPlan = {
  slug: string
  name: string
  price_cents: number
  annual_discount_pct?: number
  annual_price_cents?: number
  max_agendas: number
  max_users: number
  features?: string[]
}

// Fallback (usado se a API estiver indisponível) — os mesmos valores de referência.
const FALLBACK: ApiPlan[] = [
  { slug: 'free', name: 'Grátis', price_cents: 0, max_agendas: 1, max_users: 1, features: ['1 agenda', '1 usuário', 'Assistente de IA', 'Sem cartão para testar'] },
  { slug: 'basico', name: 'Básico', price_cents: 8900, max_agendas: 1, max_users: 1, features: ['1 agenda', '1 usuário', 'Agenda + lembretes', 'Comissões'] },
  { slug: 'premium', name: 'Premium', price_cents: 16900, max_agendas: 3, max_users: 3, features: ['3 agendas', '3 usuários', 'Tudo do Básico', 'Multi-profissional'] },
  { slug: 'profissional', name: 'Profissional', price_cents: 29900, max_agendas: 10, max_users: 10, features: ['10 agendas', '10 usuários', 'Tudo do Premium', 'Ideal para equipes'] },
]

const brl = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export default function PricingPlans() {
  const [plans, setPlans] = useState<ApiPlan[]>(FALLBACK)
  const [period, setPeriod] = useState<'monthly' | 'annual'>('monthly')

  useEffect(() => {
    let alive = true
    fetch(`${BASE_URL}/public-plans`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: ApiPlan[]) => { if (alive && Array.isArray(data) && data.length) setPlans(data) })
      .catch(() => { /* mantém fallback */ })
    return () => { alive = false }
  }, [])

  const anyDiscount = plans.some((p) => (p.annual_discount_pct ?? 0) > 0)

  return (
    <>
      {/* Toggle mensal / anual */}
      <div className="mt-6 flex justify-center">
        <div className="inline-flex rounded-full bg-slate-100 p-1 dark:bg-white/10">
          <button
            onClick={() => setPeriod('monthly')}
            className={`rounded-full px-5 py-1.5 text-sm font-bold transition ${period === 'monthly' ? 'bg-white text-slate-900 shadow dark:bg-white/20 dark:text-white' : 'text-slate-500 dark:text-slate-300'}`}>
            Mensal
          </button>
          <button
            onClick={() => setPeriod('annual')}
            className={`rounded-full px-5 py-1.5 text-sm font-bold transition ${period === 'annual' ? 'bg-white text-slate-900 shadow dark:bg-white/20 dark:text-white' : 'text-slate-500 dark:text-slate-300'}`}>
            Anual{anyDiscount ? ' • economize' : ''}
          </button>
        </div>
      </div>

      <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {plans.map((p, i) => {
          const isFree = p.price_cents <= 0
          const highlight = p.slug === 'premium'
          const annualCents = p.annual_price_cents ?? Math.round(p.price_cents * 12)
          const discount = p.annual_discount_pct ?? 0
          const features = (p.features && p.features.length)
            ? p.features
            : [`${p.max_agendas} agenda${p.max_agendas > 1 ? 's' : ''}`, `${p.max_users} usuário${p.max_users > 1 ? 's' : ''}`, 'Bot WhatsApp IA']

          const priceEl = isFree
            ? (<><span className="text-3xl font-extrabold dark:text-white" style={{ color: NAVY }}>Teste</span> <span className="text-sm text-slate-500 dark:text-slate-400">5 dias</span></>)
            : period === 'annual'
              ? (<><span className="text-3xl font-extrabold dark:text-white" style={{ color: NAVY }}>{brl(annualCents)}</span> <span className="text-sm text-slate-500 dark:text-slate-400">/ano</span></>)
              : (<><span className="text-3xl font-extrabold dark:text-white" style={{ color: NAVY }}>{brl(p.price_cents)}</span> <span className="text-sm text-slate-500 dark:text-slate-400">/mês</span></>)

          return (
            <div key={p.slug} style={{ animationDelay: `${i * 70}ms` }}
              className={`flex h-full flex-col rounded-2xl border p-6 ${highlight ? 'border-[#2CB86E] bg-white shadow-xl shadow-[#2CB86E]/10 dark:bg-white/10' : 'border-slate-100 bg-white dark:border-white/10 dark:bg-white/5'}`}>
              {highlight && <span className="mb-2 inline-block w-fit rounded-full bg-[#2CB86E] px-2.5 py-0.5 text-[11px] font-bold text-white">Mais popular</span>}
              <p className="font-bold text-slate-900 dark:text-white">{p.name}</p>
              <p className="mt-1">{priceEl}</p>
              {!isFree && period === 'annual' && discount > 0 && (
                <p className="mt-0.5 text-xs font-semibold text-[#2CB86E]">de {brl(p.price_cents * 12)} — economize {discount}%</p>
              )}
              <ul className="mt-4 flex-1 space-y-2">
                {features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300">
                    <Check size={16} className="mt-0.5 shrink-0 text-[#2CB86E]" /> {f}
                  </li>
                ))}
              </ul>
              <Link href="/register" className={`mt-6 rounded-xl px-4 py-2.5 text-center text-sm font-bold transition ${highlight ? 'bg-[#2CB86E] text-white hover:brightness-105' : 'border border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-white/15 dark:text-white dark:hover:bg-white/5'}`}>
                Testar grátis
              </Link>
            </div>
          )
        })}
      </div>
    </>
  )
}
