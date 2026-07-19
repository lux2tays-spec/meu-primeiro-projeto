# Configurabilidade & Governança — o que vai (e o que NÃO vai) para o Root Admin

Objetivo: tirar valores "cravados em código/env" e centralizar no Root Admin **o que faz sentido**,
mantendo **segurança e governança**. A regra central: **uma tela web atrás de login não pode
editar segredos que dão acesso à infraestrutura** — se aquele login for comprometido, tudo que ele
edita é comprometido junto.

---

## 🔑 Modelo de 3 camadas (a decisão de segurança)

| Camada | O que é | Onde fica | Controles |
|--------|---------|-----------|-----------|
| **1 — Marca & Negócio** | nome, logo, cores, textos, contatos, planos | **Root Admin (UI)** | RBAC root, validação, audit log |
| **2 — Integrações/Segredos de app** | chaves de API (IA, MP, Evolution, SMTP) | **Root Admin (UI)** — porém **criptografado, mascarado, com audit log e 2FA** | precisam ser rotacionáveis pelo dono → UI justificada, mas blindada |
| **3 — Infra/Fundacional** | DB, Redis, JWT_SECRET, ENCRYPTION_KEY, VPS/SSH | **NUNCA na UI** — env / secrets manager | fora do alcance de sessão web |

> Por que a Camada 3 fica fora: `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `ENCRYPTION_KEY` e endereços de
> servidor **dão acesso total**. Colocar num formulário web significa que um XSS, phishing ou sessão roubada
> = tomada completa da plataforma. Esses ficam no `.env`/secrets, com **um painel só de LEITURA** no Root
> Admin ("conectado? saudável?") sem expor os valores. Você "altera qualquer coisa", mas cada coisa no lugar
> seguro certo.

---

## ✅ Já configurável hoje (não refazer)
- **IA & Custos**: provedor, modelo, chave Anthropic, transcrição (provider+chave), tetos de custo por plano — `ai_config`
- **Pagamentos**: MP access token, public key, webhook secret, back_url — `payment_config`
- **Planos**: preço, limites, trial, `media_enabled` — tabela `platform_plans`
- **Templates de IA por tipo de negócio** — tabela `business_type_templates`
- (Parcial) **E-mail**: `email_smtp` e `email_templates` existem em `platform_settings` mas o mailer ainda lê de env

---

## 🆕 CAMADA 1 — Marca & Negócio (adicionar; baixo risco)

### Identidade visual / white-label
- **Nome do app/plataforma** (hoje "AíConfirma" cravado em ~27 lugares)
- **Logo** — completo, **fundo claro**, **fundo escuro/preto**, **transparente**, **monocromático**
- **Favicon**
- **Ícone do app mobile** (iOS/Android)
- **Cores** — primária, gradiente (verde→azul), navy do texto
- **Tagline** ("Agendamento Inteligente")
- **Fonte da marca** (opcional)

### Contato & Legal (hoje placeholders)
- **E-mail e WhatsApp de suporte** (`wa.me/5511999999999` está fixo)
- **Nome do remetente e e-mail** (`EMAIL_FROM`)
- **Razão social, CNPJ, Encarregado/DPO** (placeholders `[RAZÃO SOCIAL]`/`[CNPJ]` nos Termos)
- **URLs de Privacidade e Termos**
- **Textos das telas de login/onboarding** (opcional)

### Negócio / operação
- **% de comissão de afiliado**
- **Dias de trial padrão** (hoje por plano, ok — mas o "grátis" pode ter default global)
- **Templates de e-mail** (assuntos/corpos — já existe `email_templates`, falta ligar no mailer)
- **Defaults de lembrete** (3h/30min — hoje por-tenant; um default global no Root Admin ajuda novos tenants)

---

## 🔒 CAMADA 2 — Integrações/Segredos (adicionar na UI, mas **blindado**)

Todos: **criptografados em repouso (AES)**, **mascarados na tela**, **audit log**, **só role root**, idealmente **2FA/re-auth** para salvar.

### WhatsApp / Evolution API (hoje 100% em env)
- **Evolution API URL** (`EVOLUTION_API_URL`)
- **Evolution API Key** (`EVOLUTION_API_KEY`)
- **Webhook Base URL** (`WEBHOOK_BASE_URL`)
- **Evolution Webhook Secret** (`EVOLUTION_WEBHOOK_SECRET`)
- **Múltiplos servidores Evolution** (escala/sharding): uma **lista** de servidores {url, key, capacidade}, e o tenant é alocado a um. Coluna `evolution_server_url` em `whatsapp_instances`. (Item D18 da auditoria.)

### IA (ampliar o que já existe)
- Chave Anthropic ✅ (já) · **base_url** (proxy/compatível) · roteamento hybrid (palavras-chave)
- Chave de transcrição ✅ (já)

### E-mail / SMTP (hoje em env)
- **SMTP host/port/user/pass/secure** → mover de env para `email_smtp` (já existe a chave; falta o mailer ler dela)

### Google OAuth
- **GOOGLE_CLIENT_ID / CLIENT_IDS / CLIENT_SECRET** (login social + Calendar)

### Mercado Pago ✅ (já) — token, public key, webhook secret, back_url

---

## 🚫 CAMADA 3 — Infra (NÃO colocar na UI; só painel de status read-only)

Esses **permanecem em env/secrets** (governança). Motivo entre parênteses:
- **DATABASE_URL / credenciais do Postgres** (acesso total aos dados de todos os tenants)
- **REDIS_URL / senha** (sessões, cache, filas)
- **JWT_SECRET** (forja qualquer sessão se vazar; rotacionar quebra logins → operação controlada)
- **ENCRYPTION_KEY** (decifra todos os segredos criptografados)
- **Endereço/SSH da VPS, IPs de servidor** (acesso à máquina)
- **NODE_ENV, PORT, ALLOWED_ORIGINS** (config de boot/infra)

➡️ **Alternativa segura:** um painel **"Infraestrutura"** no Root Admin **somente leitura**: mostra
*"Banco: conectado ✅ · Redis: conectado ✅ · Evolution: 1 servidor, 12 instâncias · Backup: último há 6h"*
— **sem expor valor nenhum**. Você monitora tudo, mas altera via secrets manager (com trilha de auditoria de infra).

---

## 🛡️ Governança transversal (para TODAS as camadas 1 e 2)

1. **RBAC**: só `role = root` acessa/edita. (já existe o papel root)
2. **Audit log**: tabela `admin_audit_log (actor, action, key, before_hash, after_hash, ip, at)` — registra **quem mudou o quê e quando**. (hoje não existe — item M13 da auditoria)
3. **Criptografia em repouso** (AES-256-GCM) para todo segredo — ✅ já feito para IA/MP; estender a Evolution/SMTP/Google.
4. **Mascaramento na leitura** (`****1234`) — ✅ já feito para IA/MP; estender.
5. **Validação** no save (formato de URL, chave não-vazia, etc.).
6. **2FA / re-autenticação** para salvar segredos da Camada 2.
7. **Histórico/rollback** das configs críticas (versão anterior recuperável).
8. **Invalidação de cache** ao salvar (Redis) — ✅ já feito para IA/MP.
9. **Segregação por ambiente** (config de QA ≠ produção).

---

## ⚙️ Nota de implementação (branding dinâmico)

Tornar **logo/nome/cores** configuráveis exige que os apps **leiam a config em runtime** (endpoint público
`GET /branding` → nome, logo URLs, cores) em vez de assets/strings fixos no bundle. Isso muda:
- upload de logo/favicon (armazenar em S3/disco + servir URL)
- os 2 webs e o mobile passam a buscar `/branding` e aplicar (com fallback embutido)
- favicon/manifest dinâmicos

É um recurso próprio (médio esforço). Os itens de **texto/legal/contato** são mais simples (leem de
`platform_settings`).

---

## 📌 Ordem sugerida de implementação
1. **Governança base**: `admin_audit_log` + estender cripto/máscara para Evolution/SMTP/Google (fundação p/ o resto)
2. **Camada 2 fácil**: Evolution + SMTP + Google saírem de env → Root Admin (blindados)
3. **Painel Infra (read-only)**: status de DB/Redis/Evolution/Backup
4. **Marca/Legal/Contato** (texto) → Root Admin
5. **Branding dinâmico** (logo/favicon/cores/nome) → endpoint `/branding` + upload + apps lendo em runtime
6. **Sharding Evolution** (multi-servidor) quando escalar
