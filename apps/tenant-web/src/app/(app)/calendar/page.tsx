'use client'
import { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { appointmentsApi, tenantApi, getToken, type AppointmentListParams } from '@/lib/api'
import { getTokenPayload } from '@/lib/auth'
import {
  ChevronLeft, ChevronRight, Search, X, AlertTriangle, MessageCircle, CheckCircle2, Loader2,
} from 'lucide-react'

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

interface Appointment {
  id: string
  starts_at: string
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled'
  customer_name: string
  customer_last_name: string | null
  customer_phone: string
  professional_name: string
  service_name: string
  duration_minutes: number
  price: number
  professional_id: string
  service_id: string
  customer_id: string
  notes: string | null
}

type ViewMode = 'day' | 'week' | 'month'

const DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']

const START_HOUR = 7
const END_HOUR = 21
const HOUR_PX = 56

// Block styles (week/day time-grid) — color by status
const BLOCK_CLS: Record<Appointment['status'], string> = {
  pending: 'border-l-amber-400 bg-amber-50 hover:bg-amber-100',
  confirmed: 'border-l-green-500 bg-green-50 hover:bg-green-100',
  completed: 'border-l-blue-400 bg-blue-50 hover:bg-blue-100',
  cancelled: 'border-l-red-400 bg-red-50 hover:bg-red-100 opacity-60',
}
// Chip styles (month view)
const CHIP_CLS: Record<Appointment['status'], string> = {
  pending: 'bg-amber-100 text-amber-800',
  confirmed: 'bg-green-100 text-green-800',
  completed: 'bg-blue-100 text-blue-700',
  cancelled: 'bg-red-50 text-red-600 line-through opacity-70',
}
const STATUS_LABEL: Record<Appointment['status'], string> = {
  pending: 'Pendente', confirmed: 'Confirmado', completed: 'Realizado', cancelled: 'Cancelado',
}

const selectCls = 'h-9 px-3 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary'
const inputCls = 'w-full h-10 px-3 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary'
const labelCls = 'block text-xs font-semibold text-gray-500 mb-1'

// ---------------------------------------------------------------------------
// Date helpers — always LOCAL components; toISOString() only for API instants
// ---------------------------------------------------------------------------

function toISODate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}
function addDays(d: Date, n: number) {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}
function startOfWeek(d: Date) {
  return addDays(startOfDay(d), -d.getDay())
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}
function fmtBRL(v: number) {
  return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
function fullName(a: Appointment) {
  return [a.customer_name, a.customer_last_name].filter(Boolean).join(' ')
}
function endsAt(a: Appointment) {
  return new Date(new Date(a.starts_at).getTime() + Math.max(a.duration_minutes || 30, 5) * 60000)
}

// Overlap layout: assign side-by-side lanes to overlapping appointments
function layoutLanes(appts: Appointment[]) {
  const sorted = [...appts].sort((x, y) => +new Date(x.starts_at) - +new Date(y.starts_at))
  const laneEnds: number[] = []
  const placed = sorted.map((a) => {
    const start = +new Date(a.starts_at)
    const end = +endsAt(a)
    let lane = laneEnds.findIndex((e) => e <= start)
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(end) } else { laneEnds[lane] = end }
    return { a, lane }
  })
  return { placed, lanes: Math.max(laneEnds.length, 1) }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function CalendarPage() {
  const qc = useQueryClient()

  // Role from the JWT — only readable on the client
  const [role, setRole] = useState<string | null>(null)
  useEffect(() => { setRole(getTokenPayload(getToken())?.role ?? null) }, [])
  const isManager = role === 'owner' || role === 'admin' || role === 'root'

  const [view, setView] = useState<ViewMode>('week')
  const [anchor, setAnchor] = useState(() => new Date())

  // Filters / search (search debounced to avoid a request per keystroke)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 350)
    return () => clearTimeout(t)
  }, [searchInput])
  const [proFilter, setProFilter] = useState('')
  const [svcFilter, setSvcFilter] = useState('')

  const [editing, setEditing] = useState<Appointment | null>(null)
  const [bulkOpen, setBulkOpen] = useState(false)

  const { data: professionals = [] } = useQuery({ queryKey: ['professionals'], queryFn: tenantApi.professionals })
  const { data: services = [] } = useQuery({ queryKey: ['services'], queryFn: tenantApi.services })

  // Fetch window per view: day → ?date=YYYY-MM-DD; week → from/to = week bounds;
  // month → from/to = visible grid bounds (so leading/trailing cells fill too)
  const range = useMemo(() => {
    if (view === 'day') {
      const date = toISODate(anchor)
      return { key: date, params: { date } as AppointmentListParams }
    }
    if (view === 'week') {
      const ws = startOfWeek(anchor)
      return { key: toISODate(ws), params: { from: ws.toISOString(), to: addDays(ws, 7).toISOString() } as AppointmentListParams }
    }
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
    const gridStart = startOfWeek(first)
    return { key: toISODate(gridStart), params: { from: gridStart.toISOString(), to: addDays(gridStart, 42).toISOString() } as AppointmentListParams }
  }, [view, anchor])

  const { data: appointments = [], isLoading, isError } = useQuery({
    queryKey: ['appointments', view, range.key, search, proFilter, svcFilter],
    queryFn: () => appointmentsApi.list({
      ...range.params,
      ...(search ? { search } : {}),
      ...(proFilter ? { professional_id: proFilter } : {}),
      ...(svcFilter ? { service_id: svcFilter } : {}),
    }) as Promise<Appointment[]>,
  })

  const byDay = useMemo(() => {
    const map: Record<string, Appointment[]> = {}
    for (const a of appointments) {
      const k = toISODate(new Date(a.starts_at))
      ;(map[k] ??= []).push(a)
    }
    for (const k of Object.keys(map)) map[k].sort((x, y) => +new Date(x.starts_at) - +new Date(y.starts_at))
    return map
  }, [appointments])

  function navigate(dir: -1 | 1) {
    if (view === 'day') setAnchor(addDays(anchor, dir))
    else if (view === 'week') setAnchor(addDays(anchor, dir * 7))
    else setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1))
  }

  const periodLabel = useMemo(() => {
    if (view === 'day') {
      return anchor.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    }
    if (view === 'week') {
      const ws = startOfWeek(anchor)
      const we = addDays(ws, 6)
      const f = (d: Date) => d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })
      return `${f(ws)} – ${f(we)} ${we.getFullYear()}`
    }
    return `${MONTHS[anchor.getMonth()]} ${anchor.getFullYear()}`
  }, [view, anchor])

  function openDay(d: Date) {
    setAnchor(d)
    setView('day')
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-gray-900">Agenda</h1>
        <div className="flex flex-wrap gap-2">
          {isManager && (
            <button
              onClick={() => setBulkOpen(true)}
              className="border border-red-200 text-red-600 hover:bg-red-50 text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors flex items-center gap-1.5"
            >
              <AlertTriangle size={15} strokeWidth={2} />
              Remarcar em massa
            </button>
          )}
          <Link href="/appointments/new" className="bg-primary hover:bg-primary-dark text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors">
            + Novo
          </Link>
        </div>
      </div>

      {/* Toolbar: view switcher + navigation + search + filters */}
      <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* View switcher */}
          <div className="inline-flex rounded-xl bg-gray-100 p-1">
            {(['day', 'week', 'month'] as ViewMode[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3.5 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
                  view === v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                {v === 'day' ? 'Dia' : v === 'week' ? 'Semana' : 'Mês'}
              </button>
            ))}
          </div>

          {/* Navigation */}
          <div className="flex items-center gap-1.5">
            <button onClick={() => navigate(-1)} aria-label="Período anterior" className="p-2 hover:bg-gray-100 rounded-xl text-gray-600">
              <ChevronLeft size={18} strokeWidth={2} />
            </button>
            <button
              onClick={() => setAnchor(new Date())}
              className="px-3 py-1.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Hoje
            </button>
            <button onClick={() => navigate(1)} aria-label="Próximo período" className="p-2 hover:bg-gray-100 rounded-xl text-gray-600">
              <ChevronRight size={18} strokeWidth={2} />
            </button>
            <span className="ml-2 font-semibold text-gray-900 text-sm capitalize">{periodLabel}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search size={15} strokeWidth={2} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Buscar cliente por nome ou telefone"
              className="w-full h-9 pl-9 pr-8 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary"
            />
            {searchInput && (
              <button onClick={() => setSearchInput('')} aria-label="Limpar busca" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X size={14} strokeWidth={2} />
              </button>
            )}
          </div>
          <select value={proFilter} onChange={(e) => setProFilter(e.target.value)} className={selectCls} aria-label="Filtrar por profissional">
            <option value="">Todos os profissionais</option>
            {(professionals as any[]).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select value={svcFilter} onChange={(e) => setSvcFilter(e.target.value)} className={selectCls} aria-label="Filtrar por serviço">
            <option value="">Todos os serviços</option>
            {(services as any[]).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      </div>

      {/* Calendar body */}
      {isError ? (
        <div className="bg-white rounded-2xl p-8 text-center border border-gray-100">
          <p className="text-gray-400 text-sm">Não foi possível carregar a agenda. Tente novamente em instantes.</p>
        </div>
      ) : isLoading ? (
        <div className="bg-white rounded-2xl p-10 flex items-center justify-center border border-gray-100">
          <Loader2 size={20} className="animate-spin text-gray-300" />
          <span className="ml-2 text-gray-400 text-sm">Carregando...</span>
        </div>
      ) : (
        <>
          {appointments.length === 0 && (
            <p className="text-gray-400 text-sm text-center">Nenhum agendamento neste período.</p>
          )}
          {view === 'month' && <MonthView anchor={anchor} byDay={byDay} onOpen={setEditing} onOpenDay={openDay} />}
          {view === 'week' && <WeekView anchor={anchor} byDay={byDay} onOpen={setEditing} onOpenDay={openDay} />}
          {view === 'day' && <DayView anchor={anchor} byDay={byDay} onOpen={setEditing} />}
        </>
      )}

      {editing && (
        <EditModal
          appointment={editing}
          services={services as any[]}
          professionals={professionals as any[]}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); qc.invalidateQueries({ queryKey: ['appointments'] }) }}
        />
      )}
      {bulkOpen && isManager && (
        <BulkRescheduleModal
          professionals={professionals as any[]}
          onClose={() => setBulkOpen(false)}
          onDone={() => qc.invalidateQueries({ queryKey: ['appointments'] })}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Hover tooltip (shared by chips and blocks)
// ---------------------------------------------------------------------------

function HoverCard({ a }: { a: Appointment }) {
  return (
    <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-full mb-1.5 z-40 hidden group-hover:block w-60">
      <div className="bg-gray-900 text-white rounded-xl px-3.5 py-3 shadow-xl text-left space-y-1">
        <p className="font-semibold text-sm leading-tight">{a.service_name}</p>
        <p className="text-xs text-gray-300">Cliente: <span className="text-white">{fullName(a)}</span></p>
        <p className="text-xs text-gray-300">Profissional: <span className="text-white">{a.professional_name}</span></p>
        <p className="text-xs text-gray-300">Valor: <span className="text-white">{fmtBRL(Number(a.price))}</span></p>
        <p className="text-xs text-gray-300">
          Horário: <span className="text-white">{fmtTime(a.starts_at)} – {endsAt(a).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
        </p>
        <p className="text-[11px] text-gray-400 pt-0.5">{STATUS_LABEL[a.status]} · clique para editar</p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Month view
// ---------------------------------------------------------------------------

function MonthView({ anchor, byDay, onOpen, onOpenDay }: {
  anchor: Date
  byDay: Record<string, Appointment[]>
  onOpen: (a: Appointment) => void
  onOpenDay: (d: Date) => void
}) {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
  const gridStart = startOfWeek(first)
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i))
  const todayISO = toISODate(new Date())
  const MAX_CHIPS = 3

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-x-auto">
      <div className="min-w-[680px]">
        <div className="grid grid-cols-7 border-b border-gray-100">
          {DAYS.map((d) => (
            <div key={d} className="px-2 py-2 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((d, i) => {
            const iso = toISODate(d)
            const inMonth = d.getMonth() === anchor.getMonth()
            const isToday = iso === todayISO
            const dayAppts = byDay[iso] ?? []
            return (
              <div
                key={iso}
                className={`min-h-[104px] border-b border-r border-gray-50 p-1.5 ${i % 7 === 0 ? 'border-l-0' : ''} ${inMonth ? '' : 'bg-gray-50/60'}`}
              >
                <button
                  onClick={() => onOpenDay(d)}
                  title="Abrir dia"
                  className={`w-7 h-7 rounded-full text-xs font-bold flex items-center justify-center mb-1 transition-colors ${
                    isToday ? 'bg-primary text-white' : inMonth ? 'text-gray-700 hover:bg-gray-100' : 'text-gray-400 hover:bg-gray-100'
                  }`}
                >
                  {d.getDate()}
                </button>
                <div className="space-y-1">
                  {dayAppts.slice(0, MAX_CHIPS).map((a) => (
                    <button
                      key={a.id}
                      onClick={() => onOpen(a)}
                      className={`group relative w-full text-left rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-tight truncate block ${CHIP_CLS[a.status]}`}
                    >
                      {fmtTime(a.starts_at)} {a.customer_name}
                      <HoverCard a={a} />
                    </button>
                  ))}
                  {dayAppts.length > MAX_CHIPS && (
                    <button onClick={() => onOpenDay(d)} className="w-full text-left text-[11px] font-semibold text-primary hover:underline px-1.5">
                      +{dayAppts.length - MAX_CHIPS} mais
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Time-grid views (week / day)
// ---------------------------------------------------------------------------

function TimeAxis() {
  const hours = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i)
  return (
    <div className="relative w-12 shrink-0 select-none" style={{ height: (END_HOUR - START_HOUR) * HOUR_PX }}>
      {hours.map((h) => (
        <span
          key={h}
          className="absolute right-2 -translate-y-1/2 text-[11px] text-gray-400 font-medium"
          style={{ top: (h - START_HOUR) * HOUR_PX }}
        >
          {String(h).padStart(2, '0')}:00
        </span>
      ))}
    </div>
  )
}

function DayColumn({ appts, onOpen }: { appts: Appointment[]; onOpen: (a: Appointment) => void }) {
  const { placed, lanes } = layoutLanes(appts)
  const totalH = (END_HOUR - START_HOUR) * HOUR_PX
  return (
    <div className="relative flex-1 border-l border-gray-100" style={{ height: totalH }}>
      {/* hour lines */}
      {Array.from({ length: END_HOUR - START_HOUR }, (_, i) => (
        <div key={i} className="absolute inset-x-0 border-t border-gray-50" style={{ top: i * HOUR_PX }} />
      ))}
      {placed.map(({ a, lane }) => {
        const start = new Date(a.starts_at)
        const minutes = (start.getHours() - START_HOUR) * 60 + start.getMinutes()
        const top = Math.max((minutes / 60) * HOUR_PX, 0)
        const rawH = (Math.max(a.duration_minutes || 30, 15) / 60) * HOUR_PX
        const height = Math.min(Math.max(rawH, 26), totalH - top)
        const width = 100 / lanes
        return (
          <button
            key={a.id}
            onClick={() => onOpen(a)}
            className={`group absolute rounded-lg border-l-4 px-1.5 py-1 text-left overflow-hidden shadow-sm transition-colors ${BLOCK_CLS[a.status]}`}
            style={{ top, height, left: `calc(${lane * width}% + 2px)`, width: `calc(${width}% - 4px)` }}
          >
            <p className={`text-[11px] font-semibold text-gray-900 leading-tight truncate ${a.status === 'cancelled' ? 'line-through' : ''}`}>
              {fmtTime(a.starts_at)} · {a.customer_name}
            </p>
            <p className="text-[11px] text-gray-500 leading-tight truncate">{a.service_name}</p>
            <HoverCard a={a} />
          </button>
        )
      })}
    </div>
  )
}

function WeekView({ anchor, byDay, onOpen, onOpenDay }: {
  anchor: Date
  byDay: Record<string, Appointment[]>
  onOpen: (a: Appointment) => void
  onOpenDay: (d: Date) => void
}) {
  const ws = startOfWeek(anchor)
  const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i))
  const todayISO = toISODate(new Date())
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-x-auto">
      <div className="min-w-[860px]">
        {/* header */}
        <div className="flex border-b border-gray-100 sticky top-0 bg-white z-10">
          <div className="w-12 shrink-0" />
          {days.map((d) => {
            const iso = toISODate(d)
            const isToday = iso === todayISO
            return (
              <button key={iso} onClick={() => onOpenDay(d)} className="flex-1 py-2.5 text-center hover:bg-gray-50 transition-colors" title="Abrir dia">
                <span className="text-xs font-medium text-gray-500 uppercase">{DAYS[d.getDay()]}</span>{' '}
                <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-sm font-bold ${isToday ? 'bg-primary text-white' : 'text-gray-800'}`}>
                  {d.getDate()}
                </span>
              </button>
            )
          })}
        </div>
        {/* grid */}
        <div className="flex py-2">
          <TimeAxis />
          {days.map((d) => (
            <DayColumn key={toISODate(d)} appts={byDay[toISODate(d)] ?? []} onOpen={onOpen} />
          ))}
        </div>
      </div>
    </div>
  )
}

function DayView({ anchor, byDay, onOpen }: {
  anchor: Date
  byDay: Record<string, Appointment[]>
  onOpen: (a: Appointment) => void
}) {
  const iso = toISODate(anchor)
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-x-auto">
      <div className="min-w-[420px] flex py-2 pr-3">
        <TimeAxis />
        <DayColumn appts={byDay[iso] ?? []} onOpen={onOpen} />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Edit modal
// ---------------------------------------------------------------------------

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h2 className="text-lg font-bold text-gray-900">{title}</h2>
          <button onClick={onClose} aria-label="Fechar" className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600">
            <X size={18} strokeWidth={2} />
          </button>
        </div>
        <div className="px-5 pb-5">{children}</div>
      </div>
    </div>
  )
}

function EditModal({ appointment: a, services, professionals, onClose, onSaved }: {
  appointment: Appointment
  services: any[]
  professionals: any[]
  onClose: () => void
  onSaved: () => void
}) {
  const start = new Date(a.starts_at)
  const [form, setForm] = useState({
    service_id: a.service_id,
    professional_id: a.professional_id,
    date: toISODate(start),
    time: `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`,
    status: a.status as string,
    notes: a.notes ?? '',
  })
  const [error, setError] = useState('')

  const selectedService = services.find((s) => s.id === form.service_id)
  const price = form.service_id === a.service_id ? Number(a.price) : Number(selectedService?.price ?? a.price)
  const waLink = `https://wa.me/${String(a.customer_phone ?? '').replace(/\D/g, '')}`

  function buildStartsAt() {
    const [y, m, d] = form.date.split('-').map(Number)
    const [hh, mm] = form.time.split(':').map(Number)
    return new Date(y, m - 1, d, hh, mm).toISOString()
  }

  const saveMutation = useMutation({
    mutationFn: (data: any) => appointmentsApi.update(a.id, data),
    onSuccess: onSaved,
    onError: (e: any) => setError(e?.message ?? 'Não foi possível salvar. Tente novamente.'),
  })

  function save() {
    setError('')
    if (!form.date || !form.time) { setError('Informe data e horário.'); return }
    saveMutation.mutate({
      service_id: form.service_id,
      professional_id: form.professional_id,
      starts_at: buildStartsAt(),
      status: form.status,
      notes: form.notes || null,
    })
  }

  function markCompleted() {
    setError('')
    saveMutation.mutate({ status: 'completed' })
  }

  return (
    <ModalShell title="Editar agendamento" onClose={onClose}>
      <div className="space-y-3.5">
        {/* Cliente (read-only) */}
        <div className="bg-gray-50 rounded-xl p-3.5 space-y-1">
          <Link href={`/appointments/${a.id}`} className="font-semibold text-gray-900 text-sm hover:text-primary hover:underline underline-offset-2">
            {fullName(a)}
          </Link>
          <a
            href={waLink}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-sm text-green-600 hover:text-green-700 font-medium"
            title="Abrir conversa no WhatsApp"
          >
            <MessageCircle size={14} strokeWidth={2} />
            {a.customer_phone}
          </a>
        </div>

        <div>
          <label className={labelCls}>Serviço</label>
          <select value={form.service_id} onChange={(e) => setForm({ ...form, service_id: e.target.value })} className={inputCls}>
            {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        <div>
          <label className={labelCls}>Profissional</label>
          <select value={form.professional_id} onChange={(e) => setForm({ ...form, professional_id: e.target.value })} className={inputCls}>
            {professionals.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Data</label>
            <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Horário</label>
            <input type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} className={inputCls} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Status</label>
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className={inputCls}>
              <option value="pending">Pendente</option>
              <option value="confirmed">Confirmado</option>
              <option value="completed">Realizado</option>
              <option value="cancelled">Cancelado</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Valor</label>
            <div className="h-10 px-3 rounded-xl border border-gray-100 bg-gray-50 text-sm flex items-center font-semibold text-gray-700">
              {fmtBRL(price)}
            </div>
          </div>
        </div>

        <div>
          <label className={labelCls}>Observações</label>
          <textarea
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            rows={2}
            className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary resize-none"
            placeholder="Observações internas (opcional)"
          />
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-3.5 py-2.5 text-red-600 text-sm">{error}</div>
        )}

        <div className="flex items-center gap-2 pt-1">
          {a.status !== 'completed' && a.status !== 'cancelled' && (
            <button
              onClick={markCompleted}
              disabled={saveMutation.isPending}
              className="flex items-center gap-1.5 border border-blue-200 text-blue-600 hover:bg-blue-50 text-sm font-semibold px-3.5 py-2.5 rounded-xl transition-colors disabled:opacity-50"
              title="Marca como realizado e gera a comissão"
            >
              <CheckCircle2 size={15} strokeWidth={2} />
              Marcar como realizado
            </button>
          )}
          <button
            onClick={save}
            disabled={saveMutation.isPending}
            className="flex-1 bg-primary hover:bg-primary-dark text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors disabled:opacity-50"
          >
            {saveMutation.isPending ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </ModalShell>
  )
}

// ---------------------------------------------------------------------------
// Bulk reschedule modal (owner/admin only)
// ---------------------------------------------------------------------------

function BulkRescheduleModal({ professionals, onClose, onDone }: {
  professionals: any[]
  onClose: () => void
  onDone: () => void
}) {
  const todayISO = toISODate(new Date())
  const [fromDate, setFromDate] = useState(todayISO)
  const [toDate, setToDate] = useState(todayISO)
  const [fromTime, setFromTime] = useState('00:00')
  const [toTime, setToTime] = useState('23:59')
  const [professionalId, setProfessionalId] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ affected: number; notified: number } | null>(null)

  const mutation = useMutation({
    mutationFn: () => {
      // Horários digitados são horário de São Paulo (UTC−03) → converter para UTC "Z"
      const from = new Date(`${fromDate}T${fromTime}:00-03:00`)
      const to = new Date(`${toDate}T${toTime}:59-03:00`) // inclusivo até o fim do minuto final
      return appointmentsApi.bulkReschedule({
        from: from.toISOString(),
        to: to.toISOString(),
        ...(professionalId ? { professional_id: professionalId } : {}),
        ...(message.trim() ? { message: message.trim() } : {}),
      })
    },
    onSuccess: (res) => { setResult(res); onDone() },
    onError: (e: any) => setError(e?.message ?? 'Não foi possível remarcar. Tente novamente.'),
  })

  function confirm() {
    setError('')
    if (!fromDate || !toDate) { setError('Informe o período.'); return }
    if (!fromTime || !toTime) { setError('Informe os horários de início e fim.'); return }
    if (fromDate > toDate) { setError('A data inicial deve ser anterior à final.'); return }
    if (`${toDate}T${toTime}` <= `${fromDate}T${fromTime}`) { setError('O horário final deve ser depois do horário inicial.'); return }
    if (!window.confirm('Tem certeza? Os agendamentos do período serão CANCELADOS e os clientes receberão um WhatsApp para remarcar.')) return
    mutation.mutate()
  }

  if (result) {
    return (
      <ModalShell title="Remarcação enviada" onClose={onClose}>
        <div className="space-y-4">
          <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-green-700 text-sm font-medium">
            {result.notified} cliente(s) avisado(s) · {result.affected} agendamento(s) cancelado(s).
          </div>
          <button onClick={onClose} className="w-full bg-primary hover:bg-primary-dark text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors">
            Fechar
          </button>
        </div>
      </ModalShell>
    )
  }

  return (
    <ModalShell title="Remarcar em massa" onClose={onClose}>
      <div className="space-y-3.5">
        <div className="bg-red-50 border border-red-200 rounded-xl px-3.5 py-3 flex gap-2.5">
          <AlertTriangle size={17} strokeWidth={2} className="text-red-500 shrink-0 mt-0.5" />
          <p className="text-red-700 text-sm leading-snug">
            Isso vai <strong>CANCELAR</strong> os horários do período e enviar um WhatsApp pedindo para remarcar. Use em urgências.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>De</label>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Até</label>
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Hora início</label>
            <input type="time" value={fromTime} onChange={(e) => setFromTime(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Hora fim</label>
            <input type="time" value={toTime} onChange={(e) => setToTime(e.target.value)} className={inputCls} />
          </div>
        </div>

        <div>
          <label className={labelCls}>Profissional (opcional)</label>
          <select value={professionalId} onChange={(e) => setProfessionalId(e.target.value)} className={inputCls}>
            <option value="">Todos os profissionais</option>
            {professionals.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>

        <div>
          <label className={labelCls}>Mensagem personalizada (opcional)</label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary resize-none"
            placeholder={'Ex.: Olá! Precisei cancelar seu horário de {quando}. Pode remarcar comigo?'}
          />
          <p className="text-[11px] text-gray-400 mt-1">
            Use <code className="bg-gray-100 px-1 rounded">{'{quando}'}</code> para inserir a data/hora do agendamento na mensagem.
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-3.5 py-2.5 text-red-600 text-sm">{error}</div>
        )}

        <button
          onClick={confirm}
          disabled={mutation.isPending}
          className="w-full bg-red-600 hover:bg-red-700 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors disabled:opacity-50"
        >
          {mutation.isPending ? 'Enviando...' : 'Cancelar horários e avisar clientes'}
        </button>
      </div>
    </ModalShell>
  )
}
