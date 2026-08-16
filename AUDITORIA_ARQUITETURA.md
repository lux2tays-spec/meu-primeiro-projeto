# Auditoria de Arquitetura — AiConfirma

> Auditoria multi-agente (7 especialistas seniores, Fable) de 2026-08-16.
> Este documento é o **plano de execução vivo** + **log**. Relatório executivo visual:
> artifact "AiConfirma — Auditoria Sênior (7 eixos)".
>
> Legenda de status: `[ ]` pendente · `[~]` em andamento · `[x]` feito · `[⏸]` adiado (pós-tração)
> Prioridade: **A** alta · **M** média. Esforço: **P/M/G**.

## Contexto e estratégia

Produto ainda **pré-produção** (vai entrar em teste fechado da Play). Isso é a **melhor janela** para mudanças estruturais (schema/segurança são baratos sem tenants reais). Estratégia: implementar todas as recomendações **altas e médias**, em **blocos verificados** (typecheck + commit por bloco), sem lote cego. Deploy só após ok do dono.

**3 riscos existenciais (fechar primeiro):**
1. Backup só local no mesmo VPS → perda total se o host falhar.
2. Teto de gasto de IA por tenant ilimitado por padrão → fatura aberta no Sonnet 5.
3. App "mostra" a compra da assinatura (preços + "Assinar") → risco de comissão 15–30% Apple/Google.

**Sequência:** Bloco A (blindagem+conformidade+custo) → Bloco B (persona do bot+UX) → Bloco C (observabilidade+locks) → build de loja → teste fechado. Bloco D (infra gerenciada/RLS) fica **pós-tração** (VPS único aguenta os testadores; backup offsite já remove o risco de dados).

---

## BLOCO A — Blindagem, conformidade e custo de IA

### A1 · Segurança / configuração
- [ ] **(A/P)** `ENCRYPTION_KEY` dedicada: suporte já existe (crypto.ts usa `ENCRYPTION_KEY || JWT_SECRET`). Adicionar ao `.env.example`, aviso no boot se ausente/igual ao JWT, e script one-shot de re-encrypt dos segredos legados. *(setar a env no servidor é ação do dono)*
- [ ] **(A/P)** Webhook do WhatsApp **fail-closed** em produção: exigir secret válido; rejeitar POST sem assinatura; rate limit por instância (hoje `rateLimit:false`).
- [ ] **(A/P)** `POSTGRES_PASSWORD`: remover fallback fraco `agendabot_prod_pass` do compose (`${POSTGRES_PASSWORD:?}`).
- [ ] **(A/P)** `ALLOWED_ORIGINS`: promover warn → erro de boot em produção (hoje reflete qualquer origem).
- [ ] **(M/P)** Hash nos tokens de verificação/troca de e-mail (hoje em claro).
- [ ] **(A/P)** Backup offsite (R2/B2) + backup do volume `uploads` + alerta se backup > 36h. *(bucket/env = ação do dono; script e alerta = código)*

### A2 · Conformidade Apple/Google
- [ ] **(A/M)** Tela de assinatura "somente status" nos builds de loja: sem preços/toggle/"Assinar"; botão → "Gerenciar conta" abrindo o dashboard (não o checkout).
- [ ] **(A/P)** Cancelar assinatura MP no `DELETE /auth/account` (com job de retry) — hoje cobra pós-exclusão.
- [ ] **(M/P)** Varredura anti-steering: trocar "assinar/pagamento/R$" por "gerenciar plano/conta" no app e nos pushes de trial.
- [ ] **(M/P)** Exclusão de conta com carência (soft-delete 7 dias) + exigir senha.

### A3 · Custo de IA
- [ ] **(A/P)** Cache incremental: `cache_control` no último bloco das `messages` a cada chamada (2º breakpoint).
- [ ] **(A/P)** Híbrido "sticky" por conversa como default: começa no Haiku, promove ao modelo forte no 1º sinal/tool e mantém (Redis, TTL 30min); nunca rebaixa no meio; proteger a 1ª impressão (conversa nova → modelo forte).
- [ ] **(A/P)** Caps de custo default por plano (free 1 / básico 3 / premium 8 / prof. 20 USD/mês) + rate limit de execuções por tenant/hora.
- [ ] **(M/P)** Registrar uso do `supportBot` (recordUsage) + cache no system.

---

## BLOCO B — Persona do bot + UX anti-suporte

### B1 · Conversa do bot (diferencial)
- [ ] **(A/P)** Reescrever os 7 `template_system_prompt` (migration 010) removendo "atendente virtual".
- [ ] **(A/M)** Persona nomeada por tenant (`agent_config.persona_name`/`persona_style`) + bloco "QUEM É VOCÊ"; sugerir nome no onboarding.
- [ ] **(A/P)** Anti-formulaicidade: remover frases-script e 😊 do prompt; banir tells ("Como posso ajudá-lo", "Fico à disposição"); variar aberturas.
- [ ] **(A/M)** Entrega humana: `evolutionSendHuman` com "digitando" (presence) + quebra em bolhas + delay proporcional.
- [ ] **(A/M)** Few-shot (4-6 mini-diálogos) no prefixo estável cacheado.
- [ ] **(A/M)** Uma só voz: helper `systemVoice` para lembretes/fallbacks/confirmações respeitarem persona+tom+emoji; reescrever templates de lembrete.
- [ ] **(M/P)** Roteamento híbrido que protege a 1ª impressão (config sinais + histórico).

### B2 · UX / redução de suporte
- [ ] **(A/P)** Notificar toda transição crítica: WhatsApp caiu, handoff humano, suspensão por cobrança (reusa push).
- [ ] **(A/P)** Health strip no dashboard (app + web): status WhatsApp + assinatura sempre visíveis.
- [ ] **(A/P)** Número de suporte real (branding.support_whatsapp) no lugar do placeholder.
- [ ] **(A/P)** Validar credenciais MP no save (GET /users/me).
- [ ] **(A/M)** Playground "Testar meu bot" (dry-run com cap diário).
- [ ] **(M/M)** FAQ estática na tenant-web + linkar do app; esconder "em breve".
- [ ] **(M/P)** Fluxo de convite de equipe (aceite por e-mail) em vez de vincular direto.

---

## BLOCO C — Observabilidade + resiliência barata

- [ ] **(A/M)** Sentry (backend + mobile + webs) ou GlitchTip no VPS.
- [ ] **(A/P)** Logger único (matar 124 `console.*`, fecha vazamento de telefone/LGPD) + lint no-console.
- [ ] **(A/P)** Alertas ativos por e-mail (adminAlerts) + UptimeRobot no /health.
- [ ] **(A/P)** Lock distribuído nos 8 jobs (pré-requisito de escala; ~30 linhas).
- [ ] **(A/M)** Relatório de funil da IA (conversão) no Root Admin + painel do tenant.
- [ ] **(M/P)** Latência + conversation_id no ai_usage; heartbeat de jobs no /infra-status.
- [ ] **(M/M)** Expandir tenant_activity_log para ações sensíveis + tela "Atividades".
- [ ] **(M/P)** Request-id no corpo do erro 500.

---

## BLOCO D — Estrutural (pós-tração, adiado)

- [⏸] **(M/G)** Migração para infra gerenciada: uploads→R2, Postgres→Neon, Redis→Upstash, backend→Fly.io; deploy via GHCR com health-gate/rollback.
- [⏸] **(M/M)** Arquivamento de `messages` >30d + retenção/rollup das tabelas de telemetria.
- [⏸] **(M/M)** Teste automatizado de isolamento multi-tenant no CI; depois RLS no Postgres.
- [⏸] **(baixa/M)** Memória de conversa (resumo rolante além de 20 msgs); time pickers de horário.

---

## Registro de execução

<!-- Novas entradas no topo. -->

### 2026-08-16 — Início
- Auditoria concluída (7 agentes Fable, 713k tokens). Documento e plano criados.
- Próximo: implementar Bloco A em sub-lotes verificados (A2 conformidade → A3 custo → A1 segurança).
