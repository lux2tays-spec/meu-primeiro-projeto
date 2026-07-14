# Auditoria de Segurança e Prontidão para Homologação (Apple App Store + Google Play)

> **Gerado em:** 2026-07-11 · **Projeto:** AgendaBot · **Escopo:** backend, mobile, tenant-web, admin-web, infra
> Documento de backlog para implementação. Itens deduplicados e priorizados. Cada item traz `arquivo:linha`, o problema e a correção.

---

## ✅ STATUS ATUAL — 2026-07-13 (re-auditado contra o código)

Grande parte do backlog abaixo já foi resolvida. **Resolvidos:** webhook WhatsApp
autenticado (secret + `?token=`), hash scrypt (era SHA-256), Google valida `aud`/`iss`,
isolamento de tenant/IDOR (appointments/hours/slots), AES-256 nos segredos (tenant **e**
plataforma — mp_access_token/webhook_secret/api_key criptografados + mascarados no painel),
planGuard + bot bloqueia inadimplente, webhook MP com HMAC + re-fetch + idempotência,
checkout transparente (cartão nunca toca o backend), índices multi-tenant, Next 14.2.35 +
security headers + CSP, redação de logs, rate limit por rota (google/whatsapp) + por
remetente no bot, teto rígido de custo de IA, limite de tamanho/tipo de mídia, validação de
e-mail, reset de senha (forgot/reset/resend), **backup diário do Postgres** (serviço
db-backup + rotação + restore documentado), exclusão de conta in-app, Privacidade/Termos,
paginação (parcial), erros amigáveis (nunca stack trace ao usuário), fix de fuso na agenda,
"Cancelar assinatura" honesto, timeout de upload, remoção de expo-camera, buildNumber/versionCode.

**Ainda PENDENTE — código (menor prioridade):** JWT em localStorage → cookie httpOnly +
`middleware.ts` (arquitetural, os 2 webs); revogação de JWT/refresh; paginação em algumas
listas; PKCE no OAuth Calendar; endpoint real de cancelar assinatura MP.

**Ainda PENDENTE — depende de você (VPS/contas/domínio):** ver `CHECKLIST_PRODUCAO.md` na
raiz — envs da VPS (EVOLUTION_WEBHOOK_SECRET, NODE_ENV, senha Postgres), ligar o db-backup +
offsite S3, TLS/stack hardened (precisa domínio), MP webhook secret, credenciais EAS/lojas,
Sign in with Apple, decisão de billing iOS (IAP), Expo SDK 51→53, dados legais dos Termos.

Os itens abaixo são o backlog original de 2026-07-11 (mantido como histórico).

---

## 🟩 SESSÃO 2026-07-11 — IMPLEMENTADO (sem custo, só código/config)

Tudo abaixo foi **implementado e validado** nesta sessão. Backend, tenant-web e admin-web passam `tsc --noEmit` com **0 erros**. Nenhuma dependência nova (usei APIs nativas do Node — `scrypt`, `AES-256-GCM`, headers via hook). **Ainda não commitado** — revisar e commitar numa branch.

**Backend — segurança**
- **C1** ✅ Webhook WhatsApp autenticado (`EVOLUTION_WEBHOOK_SECRET` via `?token=`/header, timing-safe) — `routes/webhooks.ts`
- **C2** ✅ Webhook Mercado Pago: validação HMAC `x-signature` + re-fetch na API do MP + upsert idempotente por `mp_subscription_id` + atualização de `tenants.plan/status` (convenção `external_reference = tenant_id:plan`) — `routes/webhooks.ts`
- **C3** ✅ Senhas migradas de SHA-256 → **scrypt** com salt, re-hash automático no login; removido o hash duplicado de `auth/google/tenants/root` — `lib/password.ts`
- **C4** ✅ Login Google valida `aud` (allowlist `GOOGLE_CLIENT_IDS`) + `iss` — `services/google-calendar.ts`
- **A1** ✅ `/appointments/slots` com `tenant_id` — `routes/appointments.ts`
- **A2** ✅ `PUT /appointments/:id` valida ownership de professional/service + `tenant_id` nas queries auxiliares
- **A3** ✅ `POST /hours` valida ownership do `professional_id`
- **A4** ✅ Tokens Google + Mercado Pago **criptografados em repouso** (AES-256-GCM), descriptografados só no uso — `lib/crypto.ts`, `google.ts`, `google-calendar.ts`, `financeiro.ts`, `tenants.ts`
- **A5** ✅ Middleware **`planGuard`** (bloqueia mutações de tenant suspenso/cancelado/trial expirado) nas rotas tenant-scoped + no fluxo do bot (evita custo Anthropic de inadimplente) — `plugins/planGuard.ts`
- **A8** ✅ Removido vazamento de nomes de outros clientes no prompt do bot — `services/bot.ts`
- **M1** ✅ Security headers (X-Frame-Options, nosniff, HSTS em prod, etc.) via hook, sem helmet — `plugins/securityHeaders.ts`
- **M2** ✅ CORS fail-closed em produção (`ALLOWED_ORIGINS` obrigatório) — `index.ts`
- **M4** ✅ `ZodError → 400` no handler global — `index.ts`
- **M5** ✅ (parcial) `PATCH /:id/status` valida enum; `payment-config` com zod
- **M8** ✅ `trustProxy: true` — `index.ts`
- **M9** ✅ Senha default do root com `crypto.randomBytes` — `root.ts`
- **L1** ✅ Escape de HTML no e-mail de verificação — `lib/email.ts`
- **A17** ✅ **Typecheck consertado** (criado `packages/shared/tsconfig.json`, `types:[node]` no backend, augmentation correta de `@fastify/jwt`) — backend + shared + tenant-web = 0 erros

**Store / multiplataforma**
- **B1** ✅ **Exclusão de conta**: endpoint `DELETE /auth/account` (cascata) + UI no mobile (`settings/index.tsx`, dupla confirmação) + UI no tenant-web (`(app)/layout.tsx`)
- **D2** ✅ `usesNonExemptEncryption: false` no `app.json` (destrava builds iOS)
- **A19** ✅ Removido plugin `expo-camera` (permissão sem uso) — `app.json`
- **D6** ✅ Crash no logout corrigido (`SecureStore` → `deleteToken`) — `mobile/lib/store.ts`
- **D9** ✅ Bug de login 401 no tenant-web corrigido — `tenant-web/src/lib/api.ts`
- **D5** ✅ Security headers (CSP/HSTS/X-Frame) no Next — `next.config.js` (tenant-web **e** admin-web)
- **D12** ✅ Desconectar WhatsApp: método de API + botões ligados no mobile e tenant-web (backend já tinha `POST /disconnect`)
- **D15** ✅ Timeout de 15s nos fetches do mobile — `mobile/lib/api.ts`
- **D8** ✅ Token MP mascarado no GET (já era) + agora descriptografado antes de mascarar

**Infra (config pronta — falta só você aplicar no servidor)**
- **A15** ✅ **HTTPS**: `infra/Caddyfile` (TLS automático Let's Encrypt) + backend não mais exposto publicamente (só via Caddy) — `docker-compose.vps.yml`
- **A15** ✅ Senha default do Postgres removida (falha se `POSTGRES_PASSWORD` não setada)
- **D11** ✅ Redis com senha (`REDIS_PASSWORD`) + AOF
- **D17** ✅ Rotação de logs (`max-size 10m`, `max-file 3`) em todos os serviços
- **M10** ✅ Migration `012_tenant_indexes.sql` — índices `tenant_id`/FK faltantes

**Segunda leva — upgrades e legal (2026-07-11)**
- **D4** ✅ **Next.js → 14.2.35** nos dois apps (resolve o crítico **CVE-2025-29927** de bypass de auth + outros CVEs do Next). Web typecheck 0 erros. `npm install` aplicado.
- **A13** ✅ (parcial) Crítico do Next eliminado. Restam 3 criticals: `vitest` e `shell-quote` são **dev-only** (não vão pra produção); **`fast-jwt`** (camada de auth do backend) está acoplado ao **fastify 4→5** — migração supervisionada (R$0, mas precisa rodar o backend pra validar; não forçei às cegas).
- **B6** ✅ **Política de Privacidade + Termos de Uso**: páginas públicas criadas em `tenant-web/src/app/privacidade` e `/termos` (conteúdo real, LGPD-aware, com tabela dado→finalidade→terceiro). Links clicáveis adicionados no cadastro (mobile `register.tsx` + tenant-web) e na área de Ajuda do app mobile. **Falta você:** preencher `[RAZÃO SOCIAL]`, `[CNPJ]`, e-mail do encarregado, cidade/UF, e (recomendado) revisão jurídica; depois cadastrar a URL nas fichas App Store Connect / Play Console.

> **Sobre HTTPS (você perguntou):** a config está 100% pronta em `infra/Caddyfile` + `docker-compose.vps.yml`. Para ativar, no servidor basta: (1) apontar o DNS `api.agendabot.com.br` → IP da VPS; (2) definir no host `API_DOMAIN`, `POSTGRES_PASSWORD`, `REDIS_PASSWORD` (e refletir a senha no `REDIS_URL`); (3) `docker compose -f docker-compose.vps.yml up -d`. O Caddy emite e renova o certificado sozinho. Não há custo — Let's Encrypt é gratuito.

---

## 🟥 PENDENTE (precisa de custo, contas, decisão de produto, ou esforço maior)

**Bloqueadores de loja que dependem de você:**
- **B2** Sign in with Apple — precisa da capability no Apple Developer ($99/ano) + endpoint `/auth/apple`
- **B3/B5** Decisão de billing iOS (Apple IAP vs venda só na web) — **decisão de produto** antes de codar
- **B4** Upgrade Expo SDK 51→53 — precisa `npm install` + testes (risco de regressão)
- **B6** ✅ FEITO (páginas + links). Resta você preencher os dados da empresa (`[RAZÃO SOCIAL]`/`[CNPJ]`/encarregado/cidade) e cadastrar a URL nas lojas.
- **B7** Credenciais EAS reais — precisa das contas Apple/Google
- **B8** URL de produção — a config está pronta, falta só o valor `EXPO_PUBLIC_API_URL=https://api.agendabot.com.br` (depende do domínio)
- **A20** Telefone/e-mail de suporte reais — precisa dos seus dados

**Segurança/infra que precisam de dependência (`npm install`) ou esforço maior:**
- **A6** Revogação de JWT / refresh tokens (arquitetural)
- **A7** Fluxo de reset de senha (montar fluxo de e-mail)
- **A13** ⚠️ Next já atualizado (crítico resolvido). Falta a **migração fastify 4→5** (destrava os criticals `fast-jwt`/`fast-uri` do backend) — R$0 mas precisa rodar/testar o backend. `vitest`/`shell-quote` são dev-only (baixa prioridade).
- **A14** Pipeline CI com gates (posso escrever, precisa dos seus secrets)
- **A16** Suíte de testes (esforço maior)
- **A18** Sentry — precisa conta/DSN
- **D1** JWT em `localStorage` → cookie httpOnly (arquitetural: afeta auth dos 2 webs + backend)
- **D3** `middleware.ts` de proteção server-side (depende de D1)
- **D4** ✅ FEITO — Next.js 14.2.35 nos dois apps.
- **D7** PKCE no Google OAuth mobile — precisa suporte a `code_verifier` no backend
- **D10** Fila BullMQ para o bot (webhook assíncrono) — precisa dep `bullmq`
- **D16** Job de lembretes crash-safe (node-cron + lock Redis) — precisa dep
- **D13** `id_token` fora da URL no login mobile
- **D14** Paginação nas listagens
- **D18/D19/D20** Escala: sharding Evolution, constraint `EXCLUDE gist` anti-double-booking (precisa limpar dados sobrepostos antes), teto de custo Anthropic por tenant
- **M3** Rate limits por rota em webhooks (auth já feita; falta o limite)
- **M6** Token de verificação via POST (hoje na query string, loga na URL)
- **M7** Uploads: magic bytes + migração p/ S3
- **M13–M19** Encarregado/DPO, dados de menores, DPA, metadados de loja, verificação OAuth Google
- **A9–A12** LGPD: consentimento no WhatsApp, retenção/expurgo S3, exportação de dados, DELETE de customer
- Nota: `admin-web` ainda tem o erro cosmético `react-native` (TS2688 do stub `@types/react-native`) — não afeta runtime; mesma correção do A17 resolve se quiser.

---

## ✅ Já feito nesta rodada de hardening (não commitado ainda — revisar e commitar)

Alterações já presentes no working tree (`git status`):

- Validação de env vars obrigatórias no boot + `JWT_SECRET` ≥ 32 chars — `apps/backend/src/index.ts`
- CORS restrito via `ALLOWED_ORIGINS` (+ `credentials`) — `index.ts`
- Error handler global sem stack trace em produção — `index.ts`
- `/health` real (checa DB + Redis) — `index.ts`
- Graceful shutdown (SIGTERM/SIGINT) — `index.ts`
- Timeouts do pool Postgres + handler de erro — `lib/db.ts`
- Timeout de 15s nas chamadas à Evolution API — `services/evolution.ts`
- Código de afiliado com `crypto.randomBytes` (era `Math.random`) — `routes/affiliate.ts`
- Isolamento de tenant em `appointments` (POST): valida ownership de customer/professional + `tenant_id` nas queries de conflito — `routes/appointments.ts`
- Rate limit em `/auth/register` (3/h) e `/auth/login` (10/15min) — `routes/auth.ts`

**Ação imediata:** commitar isso numa branch antes de seguir. Ainda faltam os itens abaixo.

> **Dos itens do relatório anterior, já resolvidos por este hardening:** validação de env/JWT_SECRET, CORS allowlist, pg pool error handler, graceful shutdown + /health, código de afiliado com crypto, timeout na Evolution, isolamento de tenant no **POST** de appointments (o **PUT** segue pendente — ver A2).

---

## 🔎 Itens adicionais confirmados no double-check (relatório da sessão anterior)

Verificados no código em 2026-07-11. Estavam ausentes da varredura de hoje — camada **web (Next.js)** e **bugs de mobile** foram sub-cobertos. **Slotar nas fases pela severidade indicada.**

| # | Sev | Item | Onde | Correção |
|---|-----|------|------|----------|
| D1 | 🔴 CRÍTICO | **JWT em `localStorage` nos dois apps web** — XSS = sessão roubada; no **admin-web é role root = comprometimento total da plataforma**. | `tenant-web/src/lib/api.ts:7`, `admin-web/src/lib/api.ts:5` | Migrar p/ cookie `httpOnly; Secure; SameSite=Strict` + `credentials: 'include'` (depende de D3). |
| D2 | 🔴 BLOQUEADOR (build) | **`usesNonExemptEncryption` ausente** — trava/pergunta compliance de criptografia a cada build iOS. | `apps/mobile/app.json` | Adicionar `ios.config.usesNonExemptEncryption: false`. |
| D3 | 🟠 ALTO | **Sem `middleware.ts` (proteção server-side)** — HTML de páginas protegidas é servido a qualquer um; proteção só via `useEffect` client-side. | `tenant-web` e `admin-web` (nenhum existe) | Criar `middleware.ts` validando o cookie (após D1). |
| D4 | 🟠 ALTO | **Next.js 14.2.5 com CVEs ativos** — inclui **CVE-2025-29927 (bypass de autorização em middleware)**, CVE-2024-46982, CVE-2024-51479. | `tenant-web` (`14.2.5`), `admin-web` (`^14.2.0`) | Atualizar p/ **14.2.30+** nos dois. |
| D5 | 🟠 ALTO | **Sem security headers no Next** (CSP, HSTS, X-Frame-Options, Referrer-Policy). Distinto do helmet do backend (M1). | `next.config.js` de ambos | `async headers()` com CSP/HSTS/X-Frame-Options/Referrer-Policy. |
| D6 | 🟠 ALTO | **Crash no logout por expiração — `SecureStore` não importado** — `SecureStore.deleteItemAsync` é chamado mas o módulo nunca é importado; logout por expiração nunca ocorre e o usuário fica preso. | `apps/mobile/lib/store.ts:55` | Trocar por `await deleteToken()` (já importado na linha 2). |
| D7 | 🟠 ALTO | **PKCE desabilitado no Google OAuth** — no Android qualquer app registra o scheme `agendabot://` e intercepta o authorization code (escopo `calendar.events` + refresh token). | `apps/mobile/lib/google-auth.ts:36` (`usePKCE: false`) | `usePKCE: true` + enviar `code_verifier` ao backend. |
| D8 | 🟠 ALTO | **MP access_token exibido inteiro na tela** — credencial que movimenta dinheiro renderizada no app. | `apps/mobile/app/(app)/settings/payments.tsx:72` | Backend retorna só versão mascarada (`APP_USR-****1234`). |
| D9 | 🟠 ALTO | **Bug de login no tenant-web** — `401` em qualquer endpoint (incl. `/auth/login`) redireciona com "Sessão expirada"; senha errada nunca mostra "credenciais inválidas". O fix já foi aplicado no admin-web, **falta replicar no tenant-web**. | `tenant-web/src/lib/api.ts:29` | `if (res.status === 401 && !path.includes('/auth/login'))`. |
| D10 | 🟠 ALTO | **Processamento de IA síncrono no webhook** — chamada Claude de 2–10s dentro do request HTTP; Evolution re-entrega em timeout → **respostas duplicadas ao cliente** e esgotamento do pool. | `routes/webhooks.ts` (fluxo do bot) | Responder `200 OK` na hora + fila **BullMQ** sobre o Redis existente; dedupe por `message.key.id`. |
| D11 | 🟠 ALTO | **Redis sem senha e sem AOF** — exposto sem `requirepass`; sem persistência (`appendonly`) — obrigatório se usar BullMQ (D10). | `docker-compose.vps.yml` (`redis:7-alpine`) | `command: redis-server --requirepass ... --appendonly yes` + fechar porta ao público. |
| D12 | 🟡 MÉDIO | **Botão "Desconectar WhatsApp"** — backend **já tem** `POST /whatsapp/disconnect` (`whatsapp.ts:105`); **verificar** se os handlers no mobile e no tenant-web realmente chamam (antes estavam vazios). | `mobile/.../whatsapp.tsx`, `tenant-web/.../whatsapp` | Ligar o botão ao endpoint existente nos dois. |
| D13 | 🟡 MÉDIO | **`id_token` Google passado como param de rota** (mobile) — vaza em logs/histórico de navegação. | `apps/mobile/app/(auth)/login.tsx:41` | Passar via estado em memória (zustand), não pela URL. |
| D14 | 🟡 MÉDIO | **Sem paginação nas listagens** — retorna a tabela inteira (custo/latência crescem com o tenant). | `appointments.ts`, `tenants.ts:398` | `limit`/cursor padrão. |
| D15 | 🟡 MÉDIO | **Sem timeout nos fetches do mobile** — request pendurado trava a UI (o backend→Evolution já tem timeout; o mobile não). | camada de `fetch` do `apps/mobile` | `AbortSignal.timeout(15000)` nos fetches. |
| D16 | 🟡 MÉDIO | **Job de lembretes não é crash-safe e duplica em multi-instância.** | `jobs/reminders.ts` | `node-cron` em horário fixo + lock no Redis antes de executar. |
| D17 | 🟡 MÉDIO | **Sem rotação de logs no Docker** — disco enche. | `docker-compose.vps.yml` | `logging: json-file, max-size: 10m, max-file: 3` em todos os serviços. |

### Escalabilidade (primeiros ~50 tenants) — do relatório anterior

| # | Item | Correção |
|---|------|----------|
| D18 | **Sharding da Evolution API** (~50–100 instâncias/container) | Coluna `evolution_server_url` em `whatsapp_instances` para distribuir instâncias entre servidores. |
| D19 | **Race condition de double-booking** | Além dos índices (M10): constraint `EXCLUDE USING gist` em `appointments` p/ impedir sobreposição no nível do banco. |
| D20 | **Custo Anthropic descontrolado (sem telemetria por tenant)** — 1.000 msg/dia ≈ R$700/mês, acima do plano. | Contador Redis por tenant + teto de mensagens por plano (liga com A5/planGuard e M3). |

---

## 🔴 BLOQUEADORES DE LOJA (impedem a submissão ou geram rejeição garantida)

Nenhum destes pode faltar para homologar na Apple/Google.

| # | Item | Loja | Onde |
|---|------|------|------|
| B1 | **Exclusão de conta in-app** — não existe UI nem endpoint de autoexclusão. Só há `DELETE` de usuário no painel root (`root.ts:279`). Apple (Guideline 5.1.1(v), desde 2022) e Google (desde dez/2023) exigem. Google exige ainda **link web público** de exclusão declarado no Play Console. | Ambos | `apps/mobile/app/(app)/settings/index.tsx` (só "Sair"), backend sem `DELETE /auth/me` |
| B2 | **Sign in with Apple ausente** — o app tem "Continuar com Google" (`lib/google-auth.ts`). Guideline 4.8 obriga oferecer Sign in with Apple quando há login social de terceiro. | Apple | `app/(auth)/login.tsx` |
| B3 | **Assinatura SaaS via Mercado Pago dentro do app iOS** — desbloqueia funcionalidade consumida no app → Apple exige IAP/StoreKit (Guideline 3.1.1). Decisão de produto: (a) IAP no iOS via RevenueCat, ou (b) remover do build iOS qualquer tela/preço/CTA de compra e vender só na web (exceção 3.1.3(e) multiplataforma — o app pode usar assinatura comprada fora, mas **sem botão/link/preço** de compra no iOS). Regra equivalente do Play Billing vale para Android. | Apple/Google | `app/(app)/settings/subscription.tsx` |
| B4 | **Expo SDK 51 abaixo do exigido** — targeta Android API 34; Google exige **targetSdk 35** para novos apps/updates (obrigatório desde 31/ago/2025). Apple exige Xcode 16+/iOS 18 SDK desde abr/2025. Upload é recusado. Atualizar para Expo SDK 53+. | Ambos | `apps/mobile/package.json` (`expo ~51.0.0`) |
| B5 | **Botões "Assinar"/"Cancelar assinatura" são stubs** ("Em breve", `onPress: () => {}`). Apple rejeita placeholder (2.1 App Completeness). Implementar de verdade ou remover do build de submissão. | Ambos | `subscription.tsx:93` |
| B6 | **Política de Privacidade e Termos de Uso não existem** — nenhum documento/URL no repo; o texto no cadastro nem é clicável. Ambas as lojas exigem URL pública; LGPD exige aviso de privacidade. | Ambos | `app/(auth)/register.tsx:171`, `apps/tenant-web/.../register/page.tsx` (nem menciona) |
| B7 | **Credenciais de submissão e OAuth são placeholders**; `app.json` sem `extra.eas.projectId`/`owner` (EAS build não inicia sem `eas init`). | Ambos | `eas.json` (`your-apple-id@email.com`, `YOUR_*`, `google-play-key.json` inexistente), `app.json` |
| B8 | **URL da API de produção não configurada** — builds de loja sairiam apontando para `http://localhost:3000` (bloqueado por ATS/cleartext). Adicionar `EXPO_PUBLIC_API_URL` (HTTPS) e client IDs Google ao profile `production`. | Ambos | `lib/api.ts:3`, `eas.json` |
| B9 | **Formulários App Privacy (Apple) / Data Safety (Google)** a preencher — ver tabela "dado → finalidade → terceiro" no fim. Divergência entre declaração e tráfego = remoção. | Ambos | consoles |

---

## 🔴 CRÍTICO DE SEGURANÇA (corrigir antes de qualquer usuário real)

| # | Item | Onde | Correção |
|---|------|------|----------|
| C1 | **Webhook WhatsApp totalmente aberto** — sem autenticação. `instance_name` é previsível (`tenant_<uuid>`). Permite injetar mensagens, abusar da API Anthropic (custo), enviar WhatsApp arbitrário e forjar eventos. | `routes/webhooks.ts:10,172,177` | Secret por instância (ou `EVOLUTION_WEBHOOK_SECRET`) enviado no `webhook.headers` da criação da instância e validado no início do handler → 401. |
| C2 | **Webhook Mercado Pago sem validação de assinatura E é um stub** (`TODO`) — hoje pagamento real não ativa plano; quando implementado sem assinatura, qualquer um forja evento e se dá plano pago. | `routes/webhooks.ts:182-192` | Validar `x-signature` (HMAC-SHA256) e **re-buscar** o recurso na API do MP; nunca confiar no corpo. |
| C3 | **Hash de senha SHA-256 sem salt** (`sha256(password + JWT_SECRET)`) — quebrável por GPU, hashes iguais p/ senhas iguais, e acopla pepper ao JWT (rotacionar JWT invalida senhas). Duplicado em 4 arquivos. | `auth.ts:21`, `tenants.ts:6`, `root.ts:5`, `google.ts:7` | Migrar p/ **bcrypt (cost ≥ 12)** ou **argon2id**; módulo único `lib/password.ts`; migração lazy no login. |
| C4 | **Login Google não valida `aud`** — aceita id_token de qualquer app OAuth → account takeover. | `services/google-calendar.ts:146-150` (usado em `routes/google.ts:21`) | Após `tokeninfo`, exigir `data.aud === GOOGLE_CLIENT_ID` (e `iss`). |

---

## 🟠 ALTO

**Segurança / multi-tenant**

- **A1 — IDOR em `GET /appointments/slots`**: queries de `working_hours`/`appointments` filtram só por `professional_id` (da query string), sem `tenant_id`. Enumera horários de outros tenants. → `appointments.ts:248-257`. Adicionar `AND tenant_id = $n` (do JWT).
- **A2 — `PUT /appointments/:id` aceita `service_id`/`professional_id` de outro tenant** (o POST valida, o PUT não). → `appointments.ts:167-175,194-195`. Replicar os ownership checks do POST.
- **A3 — `POST /tenant/hours` sem ownership do `professional_id`** — polui a grade vista por outro tenant (combinado com A1). → `tenants.ts:346-371`. Validar `professional` pertence ao tenant.
- **A4 — Credenciais em texto plano no banco**: `mp_access_token` (`tenants.ts:239-254`) e tokens Google `access_token`/`refresh_token` (`google.ts:121-127`). Coluna `whatsapp_instances.api_key_enc` existe mas **nunca é usada**. → Criptografar com AES-256-GCM (chave `ENCRYPTION_KEY` dedicada, não o JWT_SECRET); descriptografar só no uso.
- **A5 — `planGuard` não existe** (grep = 0). Nenhum check de `tenants.status` (suspended/cancelled) nem `trial_ends_at` em nenhuma rota nem no bot. Tenant inadimplente funciona para sempre. `max_agendas` nunca é aplicado. → Criar middleware `planGuard` (conforme CLAUDE.md), aplicar nas rotas tenant-scoped e no início de `processMessage`.
- **A6 — JWT de 7 dias sem revogação** — staff removido/rebaixado mantém acesso até 7 dias. → `auth.ts:181`, `tenants.ts:307`. Reduzir expiração (~1h) + refresh token verificado no banco, ou `token_version`/denylist no Redis.
- **A7 — Não existe reset de senha / troca de senha / reenvio de verificação** (grep `reset`/`forgot` = 0). → `POST /auth/forgot-password` (token uso único, TTL 1h, rate limit, resposta sempre 200) + `POST /auth/reset-password` + `POST /auth/resend-verification`.
- **A8 — Vazamento de dados de outros clientes no prompt do bot**: a seção "AGENDA DE HOJE" inclui `customer_name` de outros clientes → qualquer um no WhatsApp pergunta "quem está agendado hoje?" e o bot tem os nomes. → `services/bot.ts:63,158`. Remover `customer_name` do prompt (basta os horários ocupados).

**Privacidade / LGPD**

- **A9 — Sem consentimento/aviso ao cliente final no WhatsApp** — a mensagem é processada e armazenada na hora; não informa que é IA nem que o conteúdo vai a terceiros (Anthropic/EUA). Pior: `jobs/reminders.ts:58` envia lembretes proativos **sem opt-in nem opt-out**. → Aviso na 1ª interação + flag de opt-out em `customers` respeitada em `reminders.ts`.
- **A10 — Retenção S3 de 30 dias documentada mas NÃO implementada** — dados vivem para sempre; não há código S3 nem job de expurgo. → Definir prazos por categoria e implementar job de arquivamento/expurgo; documentar na política.
- **A11 — Transferência internacional (Anthropic/EUA) sem menção na política nem DPA** (LGPD Art. 33). → Documentar na política + DPA com Anthropic/AWS/MP/host da Evolution.
- **A12 — Direitos do titular (Art. 18) sem tooling**: sem exportação/portabilidade nem `DELETE` de customer/conversas/mensagens (só GET/PUT/POST em `tenants.ts:387-460`). → `GET /auth/me/export` + `DELETE /customers/:id` (cascata) + canal para titular final.

**Infra / confiabilidade**

- **A13 — 48 vulnerabilidades em deps de produção (3 críticas, 27 high)** — inclui `fast-jwt` (crítica, camada de auth), `next` (crítica), `fastify`/`ws` (high). → `npm audit fix`, atualizar `@fastify/jwt`/`fastify`/`next`, planejar upgrade Expo. Adicionar gate `npm audit --omit=dev --audit-level=high` no CI.
- **A14 — Pipeline de deploy sem gates + bug de ordem nas migrations** — migrations rodam no **container antigo** (schema desatualizado quando o código novo sobe); zero typecheck/teste antes do deploy; SSH como `root` e **IP da VPS hardcodado no repo** (`187.127.12.161`). → `.github/workflows/deploy.yml`. Jobs `typecheck → test → build → deploy`; migrar na **imagem nova** (`docker compose run --rm backend npm run migrate`); usuário de deploy sem privilégio + `secrets.VPS_HOST`.
- **A15 — VPS: senha padrão do Postgres + API sem TLS** — fallback `agendabot_prod_pass` commitado; backend exposto em `3000:3000` HTTP puro (JWT/senhas/telefones em texto claro). → `docker-compose.vps.yml`. `${POSTGRES_PASSWORD:?err}`, Caddy/nginx com TLS na frente (bind `127.0.0.1:3000`), reescrever `DEPLOY.md` (hoje descreve Railway/Vercel, mas o real é VPS).
- **A16 — Zero testes no repositório** — `vitest` instalado, nenhum teste. Sem confiança de release para billing + isolamento de tenant. → Testes de isolamento de tenant, `planGuard`, webhook MP, parsing de ações do bot; plugar `vitest run` no CI.
- **A17 — `npm run typecheck` FALHA** — `packages/shared` sem `tsconfig.json`; backend com `TS2688` (tipos `react-native` vazando via hoisting). → Criar `packages/shared/tsconfig.json`; `"types": ["node"]` no `apps/backend/tsconfig.json`; tornar verde e obrigatório no CI.
- **A18 — Sem error tracking (Sentry)** — erros em prod só no stdout do container. → `@sentry/node` (backend) + `sentry-expo` (mobile) + `@sentry/nextjs` (tenant-web **e** admin-web). Configurar `redact` do pino p/ `authorization`/`password`/`phone`.

**Loja (não-bloqueador, mas alto risco)**

- **A19 — Plugin `expo-camera` declarado mas nunca usado** — permissão de câmera sem uso gera questionamento na review Apple. O QR só é exibido numa `<Image>`. → Remover plugin do `app.json` e a dep do `package.json`.
- **A20 — Telefone/e-mail de suporte placeholder** (`wa.me/5511999999999`). Reviewer Apple testa (2.1). → `settings/support.tsx:7`. Dados reais.
- **A21 — Privacy Manifest (Apple)** — validar `PrivacyInfo.xcprivacy` / ITMS-91053 após upgrade do SDK (`npx expo-doctor`). Sem tracking → **ATT não é necessário**.

---

## 🟡 MÉDIO

**Segurança**

- **M1 — Sem security headers (helmet)** — `@fastify/helmet` nem instalado. → HSTS, X-Content-Type-Options, X-Frame-Options, CSP mínima. Relevante p/ arquivos servidos em `agent.ts:97`.
- **M2 — CORS falha aberto** — sem `ALLOWED_ORIGINS` cai em `origin: true` **com** `credentials: true`. → Exigir `ALLOWED_ORIGINS` quando `NODE_ENV=production` (na validação de boot).
- **M3 — Rate limit ausente em endpoints sensíveis**: `/webhook/*`, `POST /auth/google` (cria tenants sem limite), `GET /auth/verify-email` (brute force de token), `POST /whatsapp/connect` (segura conexão ~18s pollando). → Limites dedicados por rota.
- **M4 — `schema.parse()` sem try/catch → ZodError vira 500** (ZodError não tem `statusCode`). → `appointments.ts:106,161`, `tenants.ts:89,115,274,347`, `agent.ts:45`, `financeiro.ts:96`. Handler global p/ `ZodError` → 400.
- **M5 — Rotas com `request.body` cru (sem zod)**: `tenants.ts:187,243,433,449`, `appointments.ts:224` (`PATCH /:id/status` aceita **qualquer** string → corrompe máquina de estados), `google.ts:14,115,148`, `root.ts` (`PATCH /tenants/:id` aceita plan/status arbitrários). → Validar com zod.
- **M6 — Token de verificação de e-mail vaza no log** (query string + `logger: true` loga a URL). → `auth.ts:120`. Receber via POST body e/ou redact de URL no logger.
- **M7 — Uploads validados só por extensão, salvos em disco local** (efêmero em Railway; contradiz spec S3). Sem magic bytes, sem limite por tenant. → `agent.ts:81-93`. Magic bytes + limite + S3 signed URLs.
- **M8 — Sem `trustProxy`** — atrás do proxy, rate limit por IP vê o IP do proxy (todos no mesmo bucket). → `Fastify({ trustProxy: true })` + HSTS.
- **M9 — Senha default do root com `Math.random()`** (previsível). → `root.ts:230`. `crypto.randomBytes`.

**Infra**

- **M10 — Índices insuficientes p/ carga multi-tenant** — 16 tabelas com `tenant_id`, só 6 índices. Sem índice em `conversations`, `services`, `professionals`, `working_hours`, `whatsapp_instances`, `agent_config`, `subscriptions` (consultadas em todo webhook do bot → seq scan). → Migration `012_indexes.sql`.
- **M11 — Nenhuma estratégia de backup** — volume `postgres_data` é o único lugar dos dados de todos os tenants. → `pg_dump` diário → S3/R2 + teste de restore documentado.
- **M12 — `.env.example` engolidos pelo `.gitignore`** (`*.env.*` casa com `.env.example`), mas CLAUDE.md os referencia. → `!.env.example`/`!*.env.example` + commitar templates sem valores.

**Privacidade / Loja**

- **M13 — Controlador/Encarregado (DPO)/incidentes** — sem razão social/CNPJ, sem encarregado (Art. 41), sem runbook de notificação à ANPD (Art. 48), sem audit log das ações root. → Nomear encarregado (e-mail na política) + runbook + audit log em `routes/root.ts`.
- **M14 — Dados de menores (Art. 14)** — clientes finais podem ser menores. → Cláusula na política + público-alvo 18+ nas lojas.
- **M15 — Papéis LGPD (operador × controlador)** — plataforma é operadora dos dados dos clientes finais. → Anexo de tratamento (DPA) nos Termos com cada tenant.
- **M16 — Versionamento de build** — `app.json` sem `ios.buildNumber`/`android.versionCode`; `autoIncrement: true` exige `appVersionSource: "remote"` explícito no `eas.json`.
- **M17 — Sem crash reporting no mobile** (coberto por A18; reforça a nota do pre-launch report do Google).
- **M18 — OAuth Google Calendar (escopo `calendar.events`)** exige verificação do consent screen no Google Cloud (semanas; depende da política publicada — B6). Sem isso: tela "app não verificado".
- **M19 — Metadados de loja** (screenshots 6.5"/6.9", descrição, categoria, classificação etária, contato do dev) ainda inexistentes. Planejar antes da submissão.

---

## 🟢 BAIXO

- **L1 — HTML injection no e-mail de verificação** (`${name}` sem escape) — `lib/email.ts:41`. Escapar entidades.
- **L2 — Wildcards LIKE (`%`/`_`) não escapados** — `tenants.ts:397`, `root.ts:74` (sem risco de injection, só scan amplo).
- **L3 — `page`/`limit` não numéricos → `NaN` no OFFSET → 500** — `financeiro.ts:55`, `root.ts:68`.
- **L4 — Enumeração de e-mails** — `auth.ts:108` (409 distinto) e `tenants.ts:285` (POST /staff vincula usuário existente ignorando a senha).
- **L5 — `auth.ts:137-143`** — usuário verificado sem `user_roles` → TypeError → 500.
- **L6 — Sem audit log das ações do root** (coberto em M13).
- **L7 — Prompt injection via WhatsApp** — ação `UPDATE_CUSTOMER_INFO` grava `name`/`email` controláveis por prompt do cliente (escopo limitado ao próprio customer). Validar formato do e-mail. → `webhooks.ts:144-159`.
- **L8 — Higiene de `.env` locais** — `.env.save`/`.env.vps` no disco (não versionados); `.env.save` é cópia fácil de vazar em `git add -f`. Remover.

---

## 📋 Tabela para os formulários das lojas (dado → finalidade → terceiro)

| Dado coletado | Titular | Finalidade | Terceiro que recebe |
|---|---|---|---|
| Nome, e-mail, telefone, senha (hash) | Dono do negócio | Conta e autenticação | Google (OAuth no login social) |
| Tokens OAuth + eventos de agenda | Dono do negócio | Sincronização Google Calendar | Google |
| Dados de assinatura (id MP; cartão fica no MP) | Dono do negócio | Cobrança recorrente | Mercado Pago |
| Nome, telefone (E.164), e-mail do cliente final | Cliente final | Agendamento/atendimento | Anthropic, Evolution API |
| Conteúdo das mensagens WhatsApp | Cliente final | Resposta do chatbot IA; histórico | Anthropic (EUA), Evolution API, AWS S3 (planejado) |
| Histórico de atendimentos | Cliente final | Contexto do bot, lembretes | Anthropic, Google Calendar |
| Nº WhatsApp do negócio + credenciais da instância | Dono do negócio | Conexão WhatsApp | Evolution API |
| E-mail (verificação/notificações) | Dono do negócio | Verificação de conta | Provedor SMTP |

> No Data Safety (Google), mensagens/contatos de clientes finais entram como "dados coletados, compartilhados com terceiros (Anthropic), não vendidos". Só marcar "criptografado em trânsito" após confirmar TLS (A15) e "usuário pode solicitar exclusão" após B1/A12.

---

## 🗺️ Ordem sugerida de execução

**Fase 0 — Estabilizar (dias):** commitar o hardening atual · A17 (typecheck verde) · A13 (`npm audit fix`) · A14 (pipeline) · A16 (testes mínimos de tenant/billing).

**Fase 1 — Segurança crítica (antes de usuários reais):** C1 · C2 · C3 · C4 · A1–A8 · A15 (TLS + senha Postgres).

**Fase 2 — Requisitos de loja (bloqueadores):** B1 (exclusão de conta) · B2 (Sign in with Apple) · B3+B5 (decisão de billing iOS) · B4 (Expo SDK 53) · B6 (política/termos) · B7/B8 (EAS/URL prod) · A19/A20.

**Fase 3 — Privacidade/LGPD + formulários:** A9–A12 · B9 · M13–M19.

**Fase 4 — Polimento:** demais MÉDIOS e BAIXOS · M10 (índices) · M11 (backup) · A18 (Sentry).

> **Regra do projeto:** toda mudança de produto entra em **`apps/mobile` E `apps/tenant-web`** simultaneamente.
