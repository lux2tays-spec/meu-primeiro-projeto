# Checklist de Produção — ações na VPS/contas (dependem de você)

O código já está pronto. Os itens abaixo são configurações que **só você** aplica
(envs na VPS, contas de loja, domínio). Não commite segredos no repositório.

> Gere segredos fortes com: `openssl rand -hex 24`

---

## 🔴 FAÇA AGORA (não precisa de domínio)

### 1. Autenticar o webhook do WhatsApp (fecha buraco crítico)
Hoje o webhook aceita qualquer requisição se `EVOLUTION_WEBHOOK_SECRET` não estiver setado.

1. No `.env.vps` da VPS, adicione:
   ```
   EVOLUTION_WEBHOOK_SECRET=<gere com: openssl rand -hex 24>
   ```
2. Redeploy do backend (git push já faz) **ou** `docker compose -f docker-compose.vps.yml up -d --no-deps backend`.
3. **Reconecte cada WhatsApp** (Configurações → WhatsApp → reconectar) para o webhook
   passar a enviar o `?token=`. Sem reconectar, as instâncias antigas continuam sem token.

### 2. Ligar o backup automático do banco (crítico — hoje não existe backup)
Na VPS, no diretório do repo:
```
docker compose -f docker-compose.vps.yml up -d
```
Isso sobe o novo serviço `db-backup` (dump diário + rotação de 14 dias em volume `pg_backups`).
Detalhes e restauração: `infra/BACKUP.md`. **Configure o offsite** (S3/rclone) definindo
`BACKUP_S3_BUCKET`/creds — sem isso, o backup fica só no mesmo servidor (ainda é ponto único).

### 3. Rotacionar a senha do Postgres (hoje usa a default commitada)
O `docker-compose.vps.yml` tem fallback `agendabot_prod_pass`. Como o volume já existe,
mudar só o env NÃO troca a senha do banco — precisa alterar dentro do banco:
```
docker exec -it agendabot-postgres-1 psql -U agendabot -d agendabot \
  -c "ALTER USER agendabot PASSWORD '<nova senha forte>';"
```
Depois adicione `POSTGRES_PASSWORD=<nova senha>` no `.env.vps` e redeploy.

### 4. NODE_ENV
Adicione `NODE_ENV=production` no `.env.vps` (ativa mensagens sem stack trace, HSTS, etc.).

---

## 🟠 QUANDO TIVER O DOMÍNIO

### 5. TLS + stack endurecido
Hoje o backend roda em **HTTP:3000 público** e o Redis sem senha. Troque para o
`docker-compose.vps.hardened.yml` (Caddy com HTTPS automático, Redis com senha,
senhas obrigatórias):
```
API_DOMAIN=api.seudominio.com.br
POSTGRES_PASSWORD=<...>
REDIS_PASSWORD=<gere com openssl rand -hex 20>
```
e suba com `docker compose -f docker-compose.vps.hardened.yml up -d`.

### 6. CORS + apps web
Ao publicar tenant-web/admin-web, defina no `.env.vps`:
```
ALLOWED_ORIGINS=https://app.seudominio.com.br,https://admin.seudominio.com.br
```

### 7. Webhook do Mercado Pago (assinatura)
No painel MP → Webhooks: URL `https://api.seudominio.com.br/webhook/mercadopago`,
evento **Assinaturas (preapproval)**, copie a **chave secreta** para o Root Admin →
Pagamentos (campo Segredo do Webhook). Sem isso, o webhook do MP não valida assinatura.

### 8. Apps nas lojas
- `EXPO_PUBLIC_API_URL=https://api.seudominio.com.br` no `eas.json` (profile production)
- Credenciais EAS (Apple $99/ano + Google Play) + `eas init` (projectId)
- Preencher dados da empresa nos Termos/Privacidade (`[RAZÃO SOCIAL]`/`[CNPJ]`/DPO)
- Decisão de billing iOS (IAP via RevenueCat **ou** remover preço/CTA de compra do build iOS)
- Sign in with Apple (obrigatório porque há login Google)

---

## ⚠️ NÃO faça
- **Não** defina `ENCRYPTION_KEY` agora. Os segredos já criptografados usam uma chave
  derivada do `JWT_SECRET`; setar `ENCRYPTION_KEY` depois quebraria a descriptografia
  (você teria que reinserir todos os tokens de MP/Google). Só use `ENCRYPTION_KEY` numa
  instalação nova, antes de salvar qualquer segredo.
