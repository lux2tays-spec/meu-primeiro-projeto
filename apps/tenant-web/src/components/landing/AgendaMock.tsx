'use client'
import { useEffect, useRef, useState } from 'react'
import { BellRing, HandCoins, Sparkles } from 'lucide-react'

/**
 * Animated mockup of the professional's app view: a notification arrives,
 * a new appointment slides into the agenda and the commission is calculated.
 *
 * Stages: 0 base → 1 toast → 2 new appointment → 3 commission → hold → loop.
 * Server-render and prefers-reduced-motion show the final stage statically.
 */
export default function AgendaMock({ className = '' }: { className?: string }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [stage, setStage] = useState(3)
  const [running, setRunning] = useState(false)
  const stageRef = useRef(0)
  const reducedRef = useRef(false)

  useEffect(() => {
    reducedRef.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reducedRef.current) return
    stageRef.current = 0
    setStage(0)
    const el = rootRef.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => setRunning(Boolean(entries[0]?.isIntersecting)),
      { threshold: 0.35 }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!running || reducedRef.current) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const DELAYS = [1000, 1100, 1200, 4200] // time spent before leaving each stage

    const step = () => {
      if (cancelled) return
      timer = setTimeout(() => {
        if (cancelled) return
        stageRef.current = (stageRef.current + 1) % 4
        setStage(stageRef.current)
        step()
      }, DELAYS[stageRef.current])
    }

    step()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [running])

  const row = (time: string, title: string, who: string, chip: string) => (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200/80 bg-white px-3 py-2.5 dark:border-slate-700 dark:bg-slate-800">
      <span className="w-10 shrink-0 text-[12px] font-bold text-slate-500 dark:text-slate-400">{time}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] font-semibold text-slate-800 dark:text-slate-100">{title}</span>
        <span className="block truncate text-[11px] text-slate-500 dark:text-slate-400">{who}</span>
      </span>
      <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">
        {chip}
      </span>
    </div>
  )

  return (
    <div
      ref={rootRef}
      role="img"
      aria-label="Demonstração do app do estabelecimento: novo agendamento entra na agenda e a comissão é calculada automaticamente"
      className={`relative mx-auto w-full max-w-[340px] select-none ${className}`.trim()}
    >
      {/* Notification toast */}
      <div
        className={`absolute -top-5 left-1/2 z-10 w-[92%] -translate-x-1/2 transition-all duration-500 ease-out motion-reduce:transition-none ${
          stage >= 1 ? 'translate-y-0 opacity-100' : '-translate-y-3 opacity-0'
        }`}
      >
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200/70 bg-white px-3 py-2 shadow-lg shadow-emerald-500/10 dark:border-emerald-500/25 dark:bg-slate-800">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400">
            <BellRing size={14} />
          </span>
          <p className="text-[11.5px] font-medium leading-tight text-slate-700 dark:text-slate-200">
            Novo agendamento via WhatsApp <span className="text-slate-400 dark:text-slate-500">· agora</span>
          </p>
        </div>
      </div>

      {/* App card */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-xl shadow-slate-900/10 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-800">
          <div>
            <p className="text-[13px] font-bold text-slate-800 dark:text-slate-100">Agenda · Hoje</p>
            <p className="text-[10.5px] text-slate-500 dark:text-slate-400">Paula — Cabeleireira</p>
          </div>
          <div className="flex gap-1 rounded-lg bg-slate-100 p-0.5 text-[10px] font-semibold dark:bg-slate-700" aria-hidden="true">
            <span className="rounded-md bg-white px-2 py-0.5 text-slate-700 shadow-sm dark:bg-slate-800 dark:text-slate-200">Dia</span>
            <span className="px-2 py-0.5 text-slate-400">Semana</span>
            <span className="px-2 py-0.5 text-slate-400">Mês</span>
          </div>
        </div>

        <div className="space-y-2 px-3 py-3">
          {row('09:00', 'Escova + hidratação', 'Ana Carolina', 'confirmado')}

          {/* New appointment (animated in) */}
          <div
            className={`grid transition-all duration-500 ease-out motion-reduce:transition-none ${
              stage >= 2 ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
            }`}
          >
            <div className="overflow-hidden">
              <div className="flex items-center gap-3 rounded-xl border-2 border-[#1C9DAA]/50 bg-[#1C9DAA]/5 px-3 py-2.5 dark:bg-[#1C9DAA]/10">
                <span className="w-10 shrink-0 text-[12px] font-bold text-[#1C9DAA]">10:30</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-semibold text-slate-800 dark:text-slate-100">Corte feminino</span>
                  <span className="block truncate text-[11px] text-slate-500 dark:text-slate-400">Marina Souza</span>
                </span>
                <span className="flex shrink-0 items-center gap-1 rounded-full bg-gradient-to-r from-[#2CB86E] to-[#1C9DAA] px-2 py-0.5 text-[10px] font-semibold text-white">
                  <Sparkles size={10} /> IA
                </span>
              </div>
            </div>
          </div>

          {row('13:00', 'Corte + barba', 'Rafael Martins', 'confirmado')}
        </div>

        {/* Commission strip */}
        <div
          className={`border-t border-slate-200 bg-white px-4 py-3 transition-all duration-500 ease-out motion-reduce:transition-none dark:border-slate-700 dark:bg-slate-800 ${
            stage >= 3 ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#1D62B5]/10 text-[#1D62B5] dark:bg-[#1D62B5]/20 dark:text-[#7FB1E8]">
              <HandCoins size={15} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] text-slate-500 dark:text-slate-400">Comissão da Paula (40%)</p>
              <p className="text-[13px] font-bold text-slate-800 dark:text-slate-100">+ R$ 26,00 <span className="font-medium text-emerald-600 dark:text-emerald-400">calculada na hora</span></p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
