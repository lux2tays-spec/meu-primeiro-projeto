import nodemailer from 'nodemailer'
import { buildAppointmentIcs } from './ics'

let _transporter: nodemailer.Transporter | null = null

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string)
  )
}

async function getTransporter(): Promise<nodemailer.Transporter> {
  if (_transporter) return _transporter

  if (process.env.SMTP_HOST) {
    _transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
  } else {
    // Dev: Ethereal — cria conta de teste, e-mails visíveis em ethereal.email
    const testAccount = await nodemailer.createTestAccount()
    console.log('[EMAIL DEV] Conta Ethereal criada:', testAccount.user)
    _transporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: { user: testAccount.user, pass: testAccount.pass },
    })
  }

  return _transporter
}

export async function sendVerificationEmail(to: string, name: string, token: string) {
  const baseUrl = process.env.TENANT_WEB_URL ?? 'http://localhost:3002'
  const link = `${baseUrl}/confirmar-email?token=${token}`

  const transporter = await getTransporter()
  const info = await transporter.sendMail({
    from: process.env.EMAIL_FROM ?? 'AgendaBot <noreply@agendabot.com.br>',
    to,
    subject: 'Confirme seu e-mail — AgendaBot',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
        <h2 style="color:#111">Olá, ${escapeHtml(name)}!</h2>
        <p>Obrigado por criar sua conta no <strong>AgendaBot</strong>.</p>
        <p>Clique no botão abaixo para confirmar seu e-mail e ativar sua conta:</p>
        <a href="${link}"
           style="display:inline-block;margin:16px 0;padding:14px 28px;background:#6366f1;color:#fff;border-radius:10px;text-decoration:none;font-weight:700;font-size:16px">
          Confirmar e-mail
        </a>
        <p style="color:#666;font-size:13px">O link expira em 24 horas. Se você não criou uma conta, ignore este e-mail.</p>
      </div>
    `,
  })

  if (!process.env.SMTP_HOST) {
    console.log('[EMAIL DEV] Preview URL:', nodemailer.getTestMessageUrl(info))
  }
}

export interface AppointmentInvite {
  to: string
  customerName: string
  businessName: string
  serviceName: string
  professionalName: string
  start: Date
  end: Date
  location: string
  uid: string
}

/**
 * Sends a calendar invite (.ics attached, method=REQUEST) for a booked
 * appointment so the customer can add it to their own calendar in one click.
 * Returns true if the email was accepted by the transport.
 */
export async function sendAppointmentInvite(inv: AppointmentInvite): Promise<boolean> {
  const dateFmt = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', weekday: 'long', day: '2-digit', month: 'long',
  }).format(inv.start)
  const timeFmt = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit',
  }).format(inv.start)

  const title = `${inv.serviceName} — ${inv.businessName}`
  const description = `Agendamento de ${inv.serviceName} com ${inv.professionalName} na ${inv.businessName}.`

  const ics = buildAppointmentIcs({
    uid: inv.uid,
    start: inv.start,
    end: inv.end,
    now: new Date(),
    title,
    description,
    location: inv.location,
    organizerName: inv.businessName,
    organizerEmail: (process.env.EMAIL_FROM ?? 'noreply@agendabot.com.br').replace(/.*<|>.*/g, '') || 'noreply@agendabot.com.br',
  })

  const transporter = await getTransporter()
  const info = await transporter.sendMail({
    from: process.env.EMAIL_FROM ?? 'AgendaBot <noreply@agendabot.com.br>',
    to: inv.to,
    subject: `Seu agendamento: ${inv.serviceName} — ${dateFmt} às ${timeFmt}`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
        <h2 style="color:#111">Olá, ${escapeHtml(inv.customerName)}!</h2>
        <p>Seu agendamento na <strong>${escapeHtml(inv.businessName)}</strong> está confirmado:</p>
        <div style="background:#f4f4f8;border-radius:12px;padding:16px;margin:16px 0">
          <p style="margin:4px 0"><strong>Serviço:</strong> ${escapeHtml(inv.serviceName)}</p>
          <p style="margin:4px 0"><strong>Profissional:</strong> ${escapeHtml(inv.professionalName)}</p>
          <p style="margin:4px 0"><strong>Quando:</strong> ${escapeHtml(dateFmt)} às ${escapeHtml(timeFmt)}</p>
          ${inv.location ? `<p style="margin:4px 0"><strong>Local:</strong> ${escapeHtml(inv.location)}</p>` : ''}
        </div>
        <p style="color:#666;font-size:13px">O convite de calendário está anexado — abra para adicionar à sua agenda. 📅</p>
      </div>
    `,
    icalEvent: { method: 'REQUEST', content: ics },
    attachments: [{ filename: 'agendamento.ics', content: ics, contentType: 'text/calendar; method=REQUEST' }],
  })

  if (!process.env.SMTP_HOST) {
    console.log('[EMAIL DEV] Invite preview URL:', nodemailer.getTestMessageUrl(info))
  }
  return !!info?.accepted?.length || !process.env.SMTP_HOST
}
