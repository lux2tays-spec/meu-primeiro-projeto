# Auditoria pós-implementação — AiConfirma (2026-07-22)

Síntese de 5 auditorias (regressões, segurança, escalabilidade, governança, Apple/Google)
sobre a leva nova (handoff, comissões, papéis, agenda, clientes, suporte+IA, LP, Root Admin #10).
Base geral: **nada estruturalmente quebrado** — fiação completa, paridade app/site, tsc limpo,
migrações 027–029 idempotentes e seguras, isolamento por tenant e SQL injection OK.

---

## 🔴 P0 — corrigir ANTES de subir (quebra funcionalidade ou crítico + barato)

1. **Ordem migração → código no deploy.** O código novo referencia colunas/tabelas das 027/028/029;
   se o backend novo subir ANTES das migrações, o webhook do WhatsApp cai em 500 (bot morto) e as telas
   de serviços/agenda/clientes/comissões/suporte dão 500. → No deploy, rodar `npm run migrate` ANTES de
   trocar o tráfego (entrypoint `migrate && node dist` ou passo de pipeline). *(regressões #1)*
2. **Bug do "tom de voz" (#10).** UI do Root Admin manda `tone` como texto livre, mas backend exige
   `z.enum(['formal','friendly','casual'])` e o banco tem CHECK — salvar tom dá 400, e aplicar template
   de negócio dá 500. Quebra o ajuste remoto que você mais vai usar. → Aceitar texto livre (dropar enum +
   CHECK) OU mapear templates ao enum. *(governança)*
3. **handoff desligado envia botão que não funciona.** Com `handoff_enabled=false`, o bot ainda oferece
   "especialista"; cliente clica e nada acontece. → No dispatcher, respeitar `cfg.enabled`. *(regressões #2)*
4. **Webhook isento do rate limit global.** O limite de 100 req/min por IP atinge o webhook (Evolution =
   1 IP p/ todos os tenants) → sob carga o bot fica mudo. → `config: { rateLimit: false }` em `/webhook/*`. *(escalabilidade)*
5. **Webhook "fail-open" sem segredo.** Sem `EVOLUTION_WEBHOOK_SECRET` a rota aceita qualquer chamada
   (injetar mensagens, forjar `fromMe`, derrubar status). → Falhar fechado em produção + confirmar que o
   segredo está setado na VPS. *(segurança)*
6. **IDOR do colaborador.** `GET /appointments/:id` não aplica o filtro de staff → colaborador vê
   agendamento/telefone de clientes de outros profissionais. → Aplicar a mesma cláusula do list. *(segurança)*
7. **Suporte bloqueado p/ tenant inadimplente.** `/support` está sob `planGuard` → tenant com trial
   expirado/suspenso não consegue abrir chamado (justo o canal de cobrança/reativação). → Tirar planGuard
   do `/support` (como `/subscription`) + rate limit por tenant no `/ask`. *(regressões #4 + segurança)*
8. **`/support/ask` e `bulk-reschedule` sem limites.** LLM sem teto de custo/rate por tenant; remarcação
   em massa sem cap de janela nem de quantidade (risco de cancelamento em massa + ban do WhatsApp).
   → Rate limit + cap (janela ≤ 31d, ≤ 200 itens) + cap de custo reusando `monthlySpend`. *(segurança + escalabilidade)*

## 🟠 P1 — logo depois (robustez, governança, suporte remoto)

9. **Cachear `getHandoffConfig`** (Redis 60s + invalidar no save) — hoje é query crua a cada mensagem. *(escala)*
10. **Auditar as 15 mutações do root** sem log (plano/status do tenant, troca de senha de usuário,
    pagamento de afiliado, planos, templates). *(governança)*
11. **bulk-reschedule:** remover evento do Google Calendar ao cancelar; enviar em background/chunk. *(regressões #3 + escala)*
12. **PUT cliente não limpa sobrenome/e-mail** (COALESCE) — montar SET dinâmico. *(regressões #5)*
13. **Root staff:** validar role (`z.enum` sem 'root') e não editar `users` global sem checar vínculo. *(segurança/governança)*
14. **Agenda "dia":** trocar `DATE(starts_at AT TIME ZONE)` por range (usa índice). *(escala)*
15. **Root Admin "enxergar" o tenant (o que falta pra você resolver problemas de IA remotamente):**
    - Ver **conversas/mensagens** do WhatsApp do tenant (hoje edita o prompt às cegas). *(alta)*
    - Ver **erros do bot** por tenant (hoje só no console) — persistir + expor. *(alta)*
    - **Ações no WhatsApp do tenant** (reconectar/QR/logout) pelo painel root. *(alta)*
    - **Testar o bot** como root (dry-run com a config do tenant) + **limpar cache** de conversa travada. *(média)*
    - Ver **gasto de IA vs cap** por tenant (saber se bateu o hard-stop e "parece quebrado"). *(média)*

## 🔵 P2 — backlog
Paginação nas listas (comissões/agenda/tickets); `redis.keys()` → SCAN no PATCH de plano; bounds no
extend-trial; excluir cliente preserva comissões PAGAS (SET NULL); dedup no caminho `fromMe`; diretórios
fantasma no admin-web; filtros/snapshot no audit-log.

---

## 📱 Trilha de LOJAS (Apple/Google) — para quando for submeter o app (não bloqueia o deploy web/backend)
- **Bloqueia:** Expo SDK 51 → subir p/ **53+** (Google exige targetSdk 35; Apple, Xcode 16). *(ambas)*
- **Bloqueia:** `eas.json` com placeholders + sem `projectId`; **Google Client IDs** placeholders (botão morto). *(ambas)*
- **Bloqueia:** páginas de Privacidade/Termos com `[RAZÃO SOCIAL]`/`[CNPJ]`; telefone de suporte fake. *(ambas)*
- **Bloqueia iOS:** **Sign in with Apple** obrigatório (há login Google); **assinatura com cartão no app**
  (Apple exige IAP ou remover UI de compra no iOS). *(iOS)*
- **Alto:** declarar App Privacy (Apple) / Data Safety (Google); conta demo p/ revisão; PKCE no OAuth.
- **Decidir agora:** bundleId/scheme ainda `com.agendabot.app`/`agendabot` (imutável após 1ª publicação).
- **Médio:** ícone 1024 sem alpha (RGB opaco).
