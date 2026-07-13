// Minimal iCalendar (.ics) builder for appointment invites. The file is attached
// to the email as text/calendar; method=REQUEST so mail clients offer "Add to
// calendar". Times are emitted in UTC (…Z), which every calendar app understands.

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** Format a Date as an iCalendar UTC timestamp: YYYYMMDDTHHMMSSZ */
function toIcsUtc(d: Date): string {
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    'T' +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    'Z'
  )
}

/** Escape a TEXT value per RFC 5545 (backslash, comma, semicolon, newline). */
function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

/** Fold lines longer than 75 octets (RFC 5545) — keeps strict parsers happy. */
function fold(line: string): string {
  if (line.length <= 75) return line
  const chunks: string[] = []
  let rest = line
  chunks.push(rest.slice(0, 75))
  rest = rest.slice(75)
  while (rest.length > 74) {
    chunks.push(' ' + rest.slice(0, 74))
    rest = rest.slice(74)
  }
  if (rest.length) chunks.push(' ' + rest)
  return chunks.join('\r\n')
}

export interface IcsParams {
  uid: string
  start: Date
  end: Date
  now: Date
  title: string
  description: string
  location: string
  organizerName: string
  organizerEmail: string
}

export function buildAppointmentIcs(p: IcsParams): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//AgendaBot//Agendamentos//PT-BR',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${p.uid}`,
    `DTSTAMP:${toIcsUtc(p.now)}`,
    `DTSTART:${toIcsUtc(p.start)}`,
    `DTEND:${toIcsUtc(p.end)}`,
    `SUMMARY:${esc(p.title)}`,
    `DESCRIPTION:${esc(p.description)}`,
    `LOCATION:${esc(p.location)}`,
    `ORGANIZER;CN=${esc(p.organizerName)}:mailto:${p.organizerEmail}`,
    'STATUS:CONFIRMED',
    'SEQUENCE:0',
    'BEGIN:VALARM',
    'TRIGGER:-PT2H',
    'ACTION:DISPLAY',
    `DESCRIPTION:${esc(p.title)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return lines.map(fold).join('\r\n')
}
