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
- [~] **(A/P)** `ENCRYPTION_KEY` dedicada: feito o `.env.example` + aviso no boot (não-fatal) se ausente/igual ao JWT. *Pendente: script de re-encrypt + setar a env no servidor (ação do dono).*
- [x] **(A/P)** Webhook do WhatsApp **fail-closed** quando há secret configurado (rejeita sem token). *Rate limit por instância: follow-up (rateLimit:false tem motivo — Evolution manda tudo de 1 IP).* **Ação do dono:** definir EVOLUTION_WEBHOOK_SECRET + reconectar instâncias.
- [ ] **(A/P)** `POSTGRES_PASSWORD`: **ação do dono** (trocar a senha no VPS + DATABASE_URL) — não altero remoto para não travar o DB atual.
- [~] **(A/P)** `ALLOWED_ORIGINS`: adicionado ao `.env.example` + aviso de boot mantido. **Ação do dono:** definir a env em produção.
- [ ] **(M/P)** Hash nos tokens de verificação/troca de e-mail (hoje em claro). *(follow-up)*
- [ ] **(A/P)** Backup offsite (R2/B2) + backup do volume `uploads` + alerta se backup > 36h. *(script/alerta = código pendente; bucket/env = ação do dono)*

### A2 · Conformidade Apple/Google
- [ ] **(A/M)** Tela de assinatura "somente status" nos builds de loja: sem preços/toggle/"Assinar"; botão → "Gerenciar conta" abrindo o dashboard (não o checkout).
- [ ] **(A/P)** Cancelar assinatura MP no `DELETE /auth/account` (com job de retry) — hoje cobra pós-exclusão.
- [ ] **(M/P)** Varredura anti-steering: trocar "assinar/pagamento/R$" por "gerenciar plano/conta" no app e nos pushes de trial.
- [x] **(M/P)** Exclusão de conta com carência (soft-delete, janela de reativação de **30 dias**) — migration 056, reativa no login, job `tenantPurge` apaga depois; textos do app e da página `/excluir-conta` atualizados. *(exigir senha: follow-up)*

### A5 · Win-back / Prospecção (novo — pedido do dono)
- [x] **(A/M)** Base retida (trial expirado / free sem upgrade / cancelado) prospectável: endpoint `/root/reports/prospects` (contadores + lista com contato do dono), broadcast segmentado (`trial_expired`/`free`/`cancelled`) e tela **Win-back** no Root Admin (segmentos + WhatsApp 1:1 + comunicado). Quem excluiu a conta NÃO aparece (LGPD).

### A3 · Custo de IA
- [x] **(A/P)** Cache incremental: `cache_control` no último bloco das `messages` a cada chamada (2º breakpoint).
- [x] **(A/P)** Híbrido "sticky" por conversa como default: começa no Haiku, promove ao modelo forte no 1º sinal/tool e mantém (Redis, TTL 30min); nunca rebaixa no meio; proteger a 1ª impressão (conversa nova → modelo forte).
- [x] **(A/P)** Caps de custo default por plano (free 1 / básico 3 / premium 8 / prof. 20 USD/mês). *(rate limit por tenant/hora: pendente, follow-up)*
- [x] **(M/P)** Registrar uso do `supportBot` (recordUsage) + cache no system.

### A4 · Resiliência de IA (novo — pedido do dono)
- [x] **(A/M)** Fallback de IA no Root Admin: se a chamada principal falhar (Claude fora/instável), o bot usa automaticamente um 2º provedor/rota compatível com a API Anthropic (2ª conta, proxy, OpenRouter, Bedrock/Vertex). Campos `fallback_api_key`/`base_url`/`model`/`model_simple` (chave cifrada), failover no `bot.ts` (só em erro de disponibilidade: 5xx/429/529/rede), log `ai_failover`. Cliente no WhatsApp nunca fica sem resposta.

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

### 2026-08-16 — Bloco A implementado (código)
- **A2 conformidade:** assinatura "somente status" em build de loja (EXPO_PUBLIC_STORE_BUILD), botão → dashboard, textos neutros; promptUpgrade neutro; cancelamento MP na exclusão de conta + fila de retry (migration 055 + job mpCancellationRetry). ✅ commit
- **A3 custo de IA:** cache incremental nas messages, híbrido sticky por conversa (default), caps default por plano, supportBot com recordUsage+cache. ✅ commit
- **A4 (novo) fallback de IA:** campo no Root Admin + failover no bot.ts. ✅
- **A1 segurança (parcial):** webhook fail-closed com secret; ENCRYPTION_KEY/ALLOWED_ORIGINS no .env.example + avisos de boot. Itens de OPS (senha do Postgres, backup offsite bucket, setar envs, reconectar instâncias) ficam como **ação do dono** — listados acima.
- Typecheck backend + mobile + admin-web limpos. **Ainda não deployado** (aguardando ok do dono).
- Próximo: Bloco B (persona do bot + UX anti-suporte) e Bloco C (observabilidade + locks).

### 2026-08-16 — Início
- Auditoria concluída (7 agentes Fable, 713k tokens). Documento e plano criados.
