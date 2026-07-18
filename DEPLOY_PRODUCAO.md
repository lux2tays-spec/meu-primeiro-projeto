# Ir ao ar — aiconfirma.com.br (DNS + backend HTTPS)

VPS: **187.127.12.161** · Backend HTTPS via Caddy (Let's Encrypt automático).

---

## PASSO 1 — DNS no Registro.br (faça primeiro)

No painel do domínio → **Editar Zona / DNS**, adicione:

| Host (nome) | Tipo | Valor | Pra quê |
|-------------|------|-------|---------|
| `api` | **A** | `187.127.12.161` | backend (API) — Caddy pega o TLS aqui |
| `app` | **CNAME** | `cname.vercel-dns.com` | tenant-web (Vercel) |
| `admin` | **CNAME** | `cname.vercel-dns.com` | admin-web (Vercel) |

> O valor CNAME **exato** a Vercel confirma quando você adicionar o domínio no projeto (Settings → Domains). `cname.vercel-dns.com` é o padrão.

**Depois de adicionar `api`, espere propagar** (10 min a algumas horas). Teste:
`ping api.aiconfirma.com.br` deve responder `187.127.12.161`.

---

## PASSO 2 — Domínios custom na Vercel

Em cada projeto → **Settings → Domains → Add**:
- `aiconfirma-app` → **`app.aiconfirma.com.br`**
- `aiconfirma-admin` → **`admin.aiconfirma.com.br`**

A Vercel valida via o CNAME do passo 1 e emite HTTPS sozinha.

---

## PASSO 3 — Backend HTTPS na VPS (só depois que `api` propagar)

> ⚠️ Sequência com um assistente ajuda — chame que a gente faz junto, comando a comando.

### 3a. Ajustar `apps/backend/.env.vps` (na VPS)
Trocar/adicionar:
```
NODE_ENV=production
ALLOWED_ORIGINS=https://app.aiconfirma.com.br,https://admin.aiconfirma.com.br
WEBHOOK_BASE_URL=https://api.aiconfirma.com.br
TENANT_WEB_URL=https://app.aiconfirma.com.br
EVOLUTION_WEBHOOK_SECRET=<segredo gerado>
REDIS_URL=redis://:<REDIS_PASSWORD>@redis:6379      # ← agora COM senha
DATABASE_URL=postgres://agendabot:<POSTGRES_PASSWORD>@postgres:5432/agendabot
```
NÃO defina `ENCRYPTION_KEY` (quebraria segredos já criptografados).

### 3b. Criar `.env` na RAIZ do repo (na VPS) — usado pelo docker compose
```
API_DOMAIN=api.aiconfirma.com.br
POSTGRES_PASSWORD=<POSTGRES_PASSWORD>
REDIS_PASSWORD=<REDIS_PASSWORD>
```

### 3c. Rotacionar a senha do Postgres (o volume já existe com a senha antiga)
```
docker exec agendabot-postgres-1 psql -U agendabot -d agendabot \
  -c "ALTER USER agendabot PASSWORD '<POSTGRES_PASSWORD>';"
```
(use o MESMO valor do `.env` e do `DATABASE_URL`.)

### 3d. Subir o stack endurecido
```
cd <pasta do repo na VPS>
git pull
docker compose -f docker-compose.vps.yml down
docker compose -f docker-compose.vps.hardened.yml up -d --build
docker compose -f docker-compose.vps.hardened.yml exec backend npm run migrate
```

### 3e. Validar
```
curl https://api.aiconfirma.com.br/health   # → {"ok":true} com cadeado válido
```

### 3f. Reconectar o WhatsApp
Como o `WEBHOOK_BASE_URL` mudou pra produção, reconecte cada instância
(Configurações → WhatsApp) para o webhook passar a apontar pra
`https://api.aiconfirma.com.br/...?token=<secret>`.

---

## PASSO 4 — Mercado Pago (produção)
- Root Admin → Pagamentos: `back_url = https://app.aiconfirma.com.br/settings/subscription`
- MP → Webhooks: `https://api.aiconfirma.com.br/webhook/mercadopago` (evento preapproval) → cole o segredo no painel.

---

## Depois (eu faço)
- Atualizo o workflow de deploy (`.github/workflows/deploy.yml`) para usar o compose
  **hardened** e rodar a migração na imagem nova (hoje roda no container antigo).
