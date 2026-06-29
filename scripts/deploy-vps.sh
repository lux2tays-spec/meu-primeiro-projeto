#!/bin/bash
set -e

VPS_IP="187.127.12.161"
VPS_USER="root"
REMOTE_DIR="/opt/agendabot"

echo "==> Sincronizando arquivos para VPS..."
rsync -avz --progress \
  --exclude=node_modules \
  --exclude='.env' \
  --exclude='*.env' \
  --exclude='.env.*' \
  --exclude='!.env.vps.example' \
  --exclude=dist \
  --exclude='.expo' \
  --exclude='.next' \
  --exclude='android' \
  --exclude='ios' \
  . ${VPS_USER}@${VPS_IP}:${REMOTE_DIR}/

echo ""
echo "==> Verificando .env.vps na VPS..."
ssh ${VPS_USER}@${VPS_IP} "
  if [ ! -f ${REMOTE_DIR}/apps/backend/.env.vps ]; then
    echo 'ATENÇÃO: .env.vps não encontrado!'
    echo 'Crie o arquivo em: ${REMOTE_DIR}/apps/backend/.env.vps'
    echo 'Use o exemplo: ${REMOTE_DIR}/apps/backend/.env.vps.example'
    exit 1
  fi
"

echo ""
echo "==> Build e inicializando containers..."
ssh ${VPS_USER}@${VPS_IP} "
  cd ${REMOTE_DIR}
  docker compose -f docker-compose.vps.yml up -d --build
"

echo ""
echo "==> Aguardando banco de dados ficar pronto..."
ssh ${VPS_USER}@${VPS_IP} "
  cd ${REMOTE_DIR}
  sleep 5
  docker compose -f docker-compose.vps.yml exec postgres pg_isready -U agendabot
"

echo ""
echo "==> Rodando migrations..."
ssh ${VPS_USER}@${VPS_IP} "
  cd ${REMOTE_DIR}
  docker compose -f docker-compose.vps.yml exec backend node apps/backend/scripts/migrate.js
"

echo ""
echo "==> Configurando webhook no Evolution API..."
curl -s -X POST \
  -H "apikey: PeSQTF72wYfqtRNpQBFT7fYZ8yB73q0s" \
  -H "Content-Type: application/json" \
  -d "{
    \"url\": \"http://${VPS_IP}:3000/webhook/whatsapp/Agendabot\",
    \"byEvents\": false,
    \"base64\": true,
    \"events\": [\"MESSAGES_UPSERT\", \"CONNECTION_UPDATE\", \"QRCODE_UPDATED\"]
  }" \
  http://${VPS_IP}:32768/webhook/set/Agendabot

echo ""
echo "======================================"
echo " Deploy concluído!"
echo " Backend: http://${VPS_IP}:3000"
echo " Webhook: http://${VPS_IP}:3000/webhook/whatsapp/Agendabot"
echo "======================================"
