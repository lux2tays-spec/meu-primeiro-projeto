import nodemailer from 'nodemailer'

let _transporter: nodemailer.Transporter | null = null

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
        <h2 style="color:#111">Olá, ${name}!</h2>
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
