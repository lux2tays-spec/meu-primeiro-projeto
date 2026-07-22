'use client'
import { useEffect, useRef, useState } from 'react'

export interface ChatMessage {
  /** 'out' = customer (green, right) · 'in' = AI assistant (white, left) · 'sys' = centered pill */
  from: 'in' | 'out' | 'sys'
  text: string
  time?: string
}

interface PhoneChatProps {
  /** Business name shown in the WhatsApp header. */
  contactName: string
  messages: ChatMessage[]
  className?: string
  /** Accessible label describing the demo. */
  label?: string
}

/**
 * Animated WhatsApp-style conversation inside a phone frame.
 *
 * How it plays:
 * - Server-render / no-JS / prefers-reduced-motion: the FULL thread is shown
 *   statically (initial state renders every message; reduced-motion users
 *   never see the loop start).
 * - Otherwise, on mount the thread resets and an IntersectionObserver starts
 *   the loop when ~35% of the phone is visible (and pauses it off-screen):
 *   for each message a typing indicator shows on the sender's side, then the
 *   bubble pops in; after the last message it holds ~4s and loops.
 */
export default function PhoneChat({ contactName, messages, className = '', label }: PhoneChatProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [count, setCount] = useState(messages.length)
  const [typingFrom, setTypingFrom] = useState<'in' | 'out' | null>(null)
  const [running, setRunning] = useState(false)
  const idxRef = useRef(0)
  const reducedRef = useRef(false)

  // Decide once whether we animate at all; then observe visibility.
  useEffect(() => {
    reducedRef.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reducedRef.current) return // keep the full static thread
    idxRef.current = 0
    setCount(0)
    const el = rootRef.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => setRunning(Boolean(entries[0]?.isIntersecting)),
      { threshold: 0.35 }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  // Timed sequence (resumes from idxRef when scrolled back into view).
  useEffect(() => {
    if (!running || reducedRef.current) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>

    const step = () => {
      if (cancelled) return
      const i = idxRef.current
      if (i >= messages.length) {
        timer = setTimeout(() => {
          if (cancelled) return
          idxRef.current = 0
          setCount(0)
          step()
        }, 4200)
        return
      }
      const msg = messages[i]
      timer = setTimeout(() => {
        if (cancelled) return
        if (msg.from === 'sys') {
          idxRef.current = i + 1
          setCount(i + 1)
          step()
          return
        }
        setTypingFrom(msg.from)
        timer = setTimeout(
          () => {
            if (cancelled) return
            setTypingFrom(null)
            idxRef.current = i + 1
            setCount(i + 1)
            step()
          },
          msg.from === 'in' ? 1250 : 900
        )
      }, i === 0 ? 650 : 500)
    }

    step()
    return () => {
      cancelled = true
      clearTimeout(timer)
      setTypingFrom(null)
    }
  }, [running, messages])

  // Keep the newest bubble in view.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: reducedRef.current ? 'auto' : 'smooth' })
  }, [count, typingFrom])

  const visible = messages.slice(0, count)

  return (
    <div
      ref={rootRef}
      role="img"
      aria-label={label ?? `Demonstração de conversa no WhatsApp com ${contactName}`}
      className={`mx-auto w-[286px] sm:w-[312px] select-none ${className}`.trim()}
    >
      {/* Phone frame */}
      <div className="rounded-[2.4rem] bg-slate-900 p-[10px] shadow-2xl shadow-slate-900/25 ring-1 ring-black/10 dark:ring-white/10">
        <div className="overflow-hidden rounded-[1.9rem] bg-[#EFE7DC] dark:bg-[#0B141A]">
          {/* WhatsApp header */}
          <div className="flex items-center gap-2.5 bg-[#075E54] px-3.5 pb-2.5 pt-4 dark:bg-[#1F2C34]">
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-bold text-white"
              style={{ background: 'linear-gradient(135deg,#2CB86E,#1C9DAA 55%,#1D62B5)' }}
              aria-hidden="true"
            >
              {contactName.charAt(0)}
            </div>
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold leading-tight text-white">{contactName}</p>
              <p className="text-[10.5px] leading-tight text-white/75">
                {typingFrom === 'in' ? 'digitando…' : 'online'}
              </p>
            </div>
            <span className="ml-auto flex items-center gap-3 text-white/80" aria-hidden="true">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M23 7l-7 5 7 5V7z" /><rect x="1" y="5" width="15" height="14" rx="2" /></svg>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.8 19.8 0 01-8.63-3.07 19.5 19.5 0 01-6-6A19.8 19.8 0 012.12 4.2 2 2 0 014.1 2h3a2 2 0 012 1.72c.13.96.36 1.9.7 2.8a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.28-1.27a2 2 0 012.11-.45c.9.34 1.84.57 2.8.7A2 2 0 0122 16.92z" /></svg>
            </span>
          </div>

          {/* Conversation */}
          <div ref={scrollRef} className="h-[380px] space-y-1.5 overflow-y-auto px-3 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div className="flex justify-center pb-1">
              <span className="rounded-md bg-white/80 px-2 py-0.5 text-[10px] font-medium text-slate-500 shadow-sm dark:bg-[#1F2C34] dark:text-slate-400">
                Hoje
              </span>
            </div>

            {visible.map((m, i) =>
              m.from === 'sys' ? (
                <div key={i} className="lp-msg flex justify-center py-1">
                  <span className="rounded-md bg-[#FDF3C7] px-2.5 py-1 text-center text-[10.5px] font-medium text-[#6B5B1E] shadow-sm dark:bg-[#22303A] dark:text-[#F5D67B]">
                    {m.text}
                  </span>
                </div>
              ) : (
                <div key={i} className={`lp-msg flex ${m.from === 'out' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[82%] rounded-xl px-2.5 py-1.5 text-[12.5px] leading-snug shadow-sm ${
                      m.from === 'out'
                        ? 'rounded-br-sm bg-[#DCF8C6] text-slate-800 dark:bg-[#005C4B] dark:text-slate-50'
                        : 'rounded-bl-sm bg-white text-slate-800 dark:bg-[#1F2C34] dark:text-slate-100'
                    }`}
                  >
                    <p className="whitespace-pre-line">{m.text}</p>
                    <p className={`mt-0.5 flex items-center justify-end gap-1 text-[9.5px] ${m.from === 'out' ? 'text-slate-500 dark:text-slate-300/70' : 'text-slate-400 dark:text-slate-400'}`}>
                      {m.time ?? ''}
                      {m.from === 'out' && (
                        <svg width="13" height="10" viewBox="0 0 18 12" fill="none" stroke="#53BDEB" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M1 6.5L4.5 10 11 2" />
                          <path d="M7.5 6.5L11 10 17.5 2" />
                        </svg>
                      )}
                    </p>
                  </div>
                </div>
              )
            )}

            {typingFrom && (
              <div className={`flex ${typingFrom === 'out' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`flex items-center gap-1 rounded-xl px-3 py-2.5 shadow-sm ${
                    typingFrom === 'out'
                      ? 'rounded-br-sm bg-[#DCF8C6] dark:bg-[#005C4B]'
                      : 'rounded-bl-sm bg-white dark:bg-[#1F2C34]'
                  }`}
                  aria-hidden="true"
                >
                  <span className="lp-dot h-1.5 w-1.5 rounded-full bg-slate-400" />
                  <span className="lp-dot h-1.5 w-1.5 rounded-full bg-slate-400" style={{ animationDelay: '0.15s' }} />
                  <span className="lp-dot h-1.5 w-1.5 rounded-full bg-slate-400" style={{ animationDelay: '0.3s' }} />
                </div>
              </div>
            )}
          </div>

          {/* Input bar (decorative) */}
          <div className="flex items-center gap-2 px-3 pb-3 pt-1" aria-hidden="true">
            <div className="flex h-8 flex-1 items-center rounded-full bg-white px-3 text-[11px] text-slate-400 dark:bg-[#1F2C34] dark:text-slate-500">
              Mensagem
            </div>
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#00A884] text-white">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" /></svg>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
