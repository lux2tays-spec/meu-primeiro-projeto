import { db } from '../lib/db'
import { notifyAllTenantUsers } from '../lib/notifications'
import { createAdminAlert } from '../lib/adminAlerts'

// #10 (soft-cap de mensagens): o bot NUNCA para. Mas quando o tenant atinge o
// limite de mensagens/mês do plano, avisamos TODOS os usuários do tenant por
// push/in-app pedindo upgrade, e criamos um alerta no Root Admin. Roda 1x/dia e
// dedup por dia (tenants.plan_limit_warned_on) → "fique avisando" = diário.

const OVER_LIMIT_QUERY = `
  SELECT
    t.id   AS tenant_id,
    t.name AS tenant_name,
    p.name AS plan_name,
    COALESCE((p.capabilities->>'max_messages_month')::int, 0) AS msg_limit,
    (SELECT COUNT(*) FROM messages m
       WHERE m.tenant_id = t.id AND m.role = 'assistant'
         AND m.created_at >= date_trunc('month', NOW())) AS used
  FROM tenants t
  JOIN platform_plans p ON p.slug = t.plan
  WHERE t.status IN ('active', 'trial')
    AND COALESCE((p.capabilities->>'max_messages_month')::int, 0) > 0
    AND (t.plan_limit_warned_on IS NULL OR t.plan_limit_warned_on < CURRENT_DATE)
`

export async function runMessageLimitWarner() {
  const { rows } = await db.query(OVER_LIMIT_QUERY)
  let warned = 0

  for (const r of rows) {
    const used = Number(r.used)
    const limit = Number(r.msg_limit)
    if (used < limit) continue // ainda dentro do limite

    const title = 'Limite de mensagens atingido'
    const body = `Seu plano ${r.plan_name} inclui ${limit.toLocaleString('pt-BR')} mensagens/mês e você já usou ${used.toLocaleString('pt-BR')}. O atendimento continua funcionando — faça upgrade para não correr risco de interrupção.`

    // 1) Avisa todos os usuários do tenant (push forçado + in-app).
    await notifyAllTenantUsers(r.tenant_id, {
      type: 'plan_limit',
      title,
      body,
      link: '/settings/subscription',
      channelsOverride: ['push'],
    }).catch((e) => console.error('[msg-limit] notify tenant falhou:', e))

    // 2) Avisa o Root Admin.
    await createAdminAlert({
      type: 'plan_limit',
      tenantId: r.tenant_id,
      message: `${r.tenant_name} atingiu o limite de mensagens do plano ${r.plan_name} (${used}/${limit}).`,
      data: { used, limit, plan: r.plan_name },
    })

    // 3) Marca para não repetir hoje.
    await db.query('UPDATE tenants SET plan_limit_warned_on = CURRENT_DATE WHERE id = $1', [r.tenant_id])
    warned++
  }

  if (warned > 0) console.log(`[msg-limit] ${warned} tenant(s) avisados`)
}

// Roda 15s após o boot e depois a cada 12h (pega quem estourou durante o dia).
export function startMessageLimitWarner() {
  setTimeout(() => {
    runMessageLimitWarner().catch((err) => console.error('[msg-limit] startup run error:', err))
    setInterval(() => {
      runMessageLimitWarner().catch((err) => console.error('[msg-limit] scheduled run error:', err))
    }, 12 * 60 * 60 * 1000)
  }, 15_000)
}
