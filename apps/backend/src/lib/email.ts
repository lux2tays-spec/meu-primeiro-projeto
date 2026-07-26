import nodemailer from 'nodemailer'
import { buildAppointmentIcs } from './ics'
import { getEmailConfig, getSmtpConfig } from './integrationConfig'

let _transporter: nodemailer.Transporter | null = null
let _transporterSig = '' // config signature — rebuild when Root Admin changes SMTP

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string)
  )
}

const DEFAULT_FROM = 'AiConfirma <noreply@aiconfirma.com.br>'

type Mailer = { transporter: nodemailer.Transporter; hasSmtp: boolean; from: string }

async function getMailer(): Promise<Mailer> {
  // SMTP settings come from the Root Admin panel with SMTP_* env fallback.
  const cfg = await getSmtpConfig()
  const sig = JSON.stringify([cfg.host, cfg.port, cfg.user, cfg.pass, cfg.secure])

  if (!_transporter || _transporterSig !== sig) {
    if (cfg.host) {
      _transporter = nodemailer.createTransport({
        host: cfg.host,
        port: cfg.port,
        secure: cfg.secure,
        auth: { user: cfg.user, pass: cfg.pass },
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
    _transporterSig = sig
  }

  return { transporter: _transporter, hasSmtp: !!cfg.host, from: cfg.from || DEFAULT_FROM }
}

// ── Remetentes por finalidade ────────────────────────────────────────────────

type FromKind = 'contato' | 'agenda' | 'suporte'

/**
 * Resolves the "from" address for a given purpose. Falls back to the SMTP
 * from / DEFAULT_FROM when the specific sender is not configured.
 */
async function resolveFrom(kind: FromKind): Promise<string> {
  const cfg = await getEmailConfig()
  const specific =
    kind === 'contato' ? cfg.from_contato :
    kind === 'agenda' ? cfg.from_agenda :
    cfg.from_suporte
  if (specific) return specific
  const smtp = await getSmtpConfig()
  return smtp.from || DEFAULT_FROM
}

/** Extracts the bare address from 'Name <email@x>' (or returns the input as-is). */
function extractEmailAddress(from: string): string {
  return from.replace(/.*<|>.*/g, '').trim()
}

// ── Envio central (Resend API com fallback SMTP) ─────────────────────────────

export interface SendEmailParams {
  from: string
  to: string
  subject: string
  html: string
  /** iCalendar content — attached as convite.ics (method=REQUEST) when present. */
  ics?: string
}

/**
 * Central email dispatcher. When the Root Admin selects the Resend provider
 * (and an API key is configured) the email goes out via Resend's HTTP API;
 * otherwise it uses the existing SMTP/nodemailer path.
 * Returns true when the email was accepted by the transport.
 */
export async function sendEmail(p: SendEmailParams): Promise<boolean> {
  const cfg = await getEmailConfig()
  if (cfg.provider === 'resend' && cfg.resend_api_key) {
    return sendViaResend(cfg.resend_api_key, p)
  }
  return sendViaSmtp(p)
}

async function sendViaResend(apiKey: string, p: SendEmailParams): Promise<boolean> {
  try {
    const body: Record<string, unknown> = {
      from: p.from,
      to: p.to,
      subject: p.subject,
      html: p.html,
    }
    if (p.ics) {
      body.attachments = [
        { filename: 'convite.ics', content: Buffer.from(p.ics, 'utf8').toString('base64') },
      ]
    }
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      console.error(`[EMAIL] Resend retornou erro ${res.status}:`, errText)
      return false
    }
    return true
  } catch (err) {
    // Never let an email failure break the caller's flow.
    console.error('[EMAIL] Falha ao enviar via Resend:', err)
    return false
  }
}

async function sendViaSmtp(p: SendEmailParams): Promise<boolean> {
  const { transporter, hasSmtp, from: defaultFrom } = await getMailer()
  const mail: nodemailer.SendMailOptions = {
    from: p.from || defaultFrom,
    to: p.to,
    subject: p.subject,
    html: p.html,
  }
  if (p.ics) {
    ;(mail as any).icalEvent = { method: 'REQUEST', content: p.ics }
    mail.attachments = [
      { filename: 'convite.ics', content: p.ics, contentType: 'text/calendar; method=REQUEST' },
    ]
  }
  const info = await transporter.sendMail(mail)
  if (!hasSmtp) {
    console.log('[EMAIL DEV] Preview URL:', nodemailer.getTestMessageUrl(info))
  }
  return !!info?.accepted?.length || !hasSmtp
}

// ── E-mails transacionais (remetente: contato) ───────────────────────────────

export async function sendVerificationEmail(to: string, name: string, token: string) {
  const baseUrl = process.env.TENANT_WEB_URL ?? 'http://localhost:3002'
  const link = `${baseUrl}/confirmar-email?token=${token}`

  await sendEmail({
    from: await resolveFrom('contato'),
    to,
    subject: 'Confirme seu e-mail — AiConfirma',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
        <h2 style="color:#111">Olá, ${escapeHtml(name)}!</h2>
        <p>Obrigado por criar sua conta no <strong>AiConfirma</strong>.</p>
        <p>Clique no botão abaixo para confirmar seu e-mail e ativar sua conta:</p>
        <a href="${link}"
           style="display:inline-block;margin:16px 0;padding:14px 28px;background:#6366f1;color:#fff;border-radius:10px;text-decoration:none;font-weight:700;font-size:16px">
          Confirmar e-mail
        </a>
        <p style="color:#666;font-size:13px">O link expira em 24 horas. Se você não criou uma conta, ignore este e-mail.</p>
      </div>
    `,
  })
}

export async function sendPasswordResetEmail(to: string, name: string, link: string) {
  await sendEmail({
    from: await resolveFrom('contato'),
    to,
    subject: 'Redefinição de senha — AiConfirma',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
        <h2 style="color:#111">Olá, ${escapeHtml(name)}!</h2>
        <p>Recebemos um pedido para redefinir a senha da sua conta no <strong>AiConfirma</strong>.</p>
        <p>Clique no botão abaixo para criar uma nova senha:</p>
        <a href="${link}"
           style="display:inline-block;margin:16px 0;padding:14px 28px;background:#6366f1;color:#fff;border-radius:10px;text-decoration:none;font-weight:700;font-size:16px">
          Redefinir senha
        </a>
        <p style="color:#666;font-size:13px">O link expira em 1 hora. Se você não pediu a redefinição, ignore este e-mail — sua senha continuará a mesma.</p>
      </div>
    `,
  })
}

export async function sendEmailChangeEmail(to: string, name: string, token: string) {
  const baseUrl = process.env.TENANT_WEB_URL ?? 'http://localhost:3002'
  const link = `${baseUrl}/confirmar-troca-email?token=${token}`

  await sendEmail({
    from: await resolveFrom('contato'),
    to,
    subject: 'Confirme seu novo e-mail — AiConfirma',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
        <h2 style="color:#111">Olá, ${escapeHtml(name)}!</h2>
        <p>Recebemos um pedido para alterar o e-mail de login da sua conta no <strong>AiConfirma</strong> para este endereço.</p>
        <p>Clique no botão abaixo para confirmar a troca:</p>
        <a href="${link}"
           style="display:inline-block;margin:16px 0;padding:14px 28px;background:#6366f1;color:#fff;border-radius:10px;text-decoration:none;font-weight:700;font-size:16px">
          Confirmar novo e-mail
        </a>
        <p style="color:#666;font-size:13px">O link expira em 24 horas. Se você não pediu esta alteração, ignore este e-mail — seu e-mail de login continuará o mesmo.</p>
      </div>
    `,
  })
}

// ── Convite de agendamento (remetente: agenda) ───────────────────────────────

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

  const from = await resolveFrom('agenda')
  const organizerEmail = extractEmailAddress(from) || 'noreply@aiconfirma.com.br'

  const title = `${inv.serviceName} — ${inv.businessName}`
  const description = [
    `Estabelecimento: ${inv.businessName}`,
    `Serviço: ${inv.serviceName}`,
    ...(inv.professionalName ? [`Profissional: ${inv.professionalName}`] : []),
    `Quando: ${dateFmt} às ${timeFmt}`,
    ...(inv.location ? [`Endereço: ${inv.location}`] : []),
  ].join('\n')

  const ics = buildAppointmentIcs({
    uid: inv.uid,
    start: inv.start,
    end: inv.end,
    now: new Date(),
    title,
    description,
    location: inv.location,
    organizerName: inv.businessName,
    organizerEmail,
  })

  return sendEmail({
    from,
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
    ics,
  })
}
