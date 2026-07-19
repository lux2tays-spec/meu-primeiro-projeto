# Subir pra testar — web + mobile (caminho rápido, baixo risco)

Objetivo: backend com **HTTPS público** em `api.aiconfirma.com.br` (a peça que faltava),
frontends na Vercel e app testável no celular. **Sem** trocar senha de Postgres/Redis
(isso fica pro endurecimento final, `docker-compose.vps.hardened.yml`).

VPS: **187.127.12.161** · domínio: **aiconfirma.com.br**

---

## 1. DNS (no painel do domínio — Hostinger/Registro.br)
Adicione **1 registro** (os outros são opcionais pra teste):

| Nome | Tipo | Valor |
|------|------|-------|
| `api` | **A** | `187.127.12.161` |

Espere propagar. Teste: `ping api.aiconfirma.com.br` → deve responder `187.127.12.161`.

---

## 2. Backend HTTPS na VPS (terminal Docker do Hostinger)
Na pasta do repositório na VPS:

```sh
# a) .env na raiz do repo (usado pelo docker compose)
echo 'API_DOMAIN=api.aiconfirma.com.br' >> .env

# b) liberar as origens dos frontends no backend (CORS)
#    troque pelos domínios/URLs onde você abrir o site e o admin
cat >> apps/backend/.env.vps <<'EOF'
ALLOWED_ORIGINS=https://app.aiconfirma.com.br,https://admin.aiconfirma.com.br
WEBHOOK_BASE_URL=https://api.aiconfirma.com.br
TENANT_WEB_URL=https://app.aiconfirma.com.br
EOF

# c) puxar o código novo e subir o Caddy (HTTPS) na frente do stack atual
git pull
docker compose -f docker-compose.vps.yml -f docker-compose.vps.tls.yml up -d

# d) validar (aguarde ~30s pro Caddy emitir o certificado)
curl https://api.aiconfirma.com.br/health   # → {"ok":true} com cadeado válido
```

> Se você for usar as URLs `*.vercel.app` em vez dos domínios custom, coloque essas
> URLs no `ALLOWED_ORIGINS` (separadas por vírgula, sem barra no final).

---

## 3. Frontends na Vercel
Nos **dois** projetos (site e admin) → **Settings → Environment Variables**:

| Nome | Valor |
|------|-------|
| `NEXT_PUBLIC_API_URL` | `https://api.aiconfirma.com.br` |

Depois **Deployments → Redeploy** (ou faça um push). Opcional: em **Settings → Domains**
adicione `app.aiconfirma.com.br` (site) e `admin.aiconfirma.com.br` (admin).

---

## 4. Mobile (testar sem publicar na loja)
O `eas.json` já aponta os builds pra `https://api.aiconfirma.com.br`.

**Opção A — APK instalável (recomendado):**
```sh
cd apps/mobile
npx eas login           # sua conta Expo
npx eas build -p android --profile preview
```
Ao terminar, a Expo dá um link pra baixar o **APK** e instalar no Android.

**Opção B — Expo Go (mais rápido, no seu computador):**
```sh
cd apps/mobile
EXPO_PUBLIC_API_URL=https://api.aiconfirma.com.br npx expo start
```
Escaneie o QR com o app **Expo Go**.

---

## 5. Reconectar o WhatsApp
Como o `WEBHOOK_BASE_URL` passou a ser `https://api.aiconfirma.com.br`, reconecte a
instância do tenant (tela WhatsApp → gerar QR de novo) pra os webhooks chegarem no
endereço novo.
