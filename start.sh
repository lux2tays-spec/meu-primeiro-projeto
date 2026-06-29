#!/bin/bash
# Daily start script — sobe todos os serviços do AgendaBot
# Uso: bash start.sh

BOLD="\033[1m"
GREEN="\033[32m"
YELLOW="\033[33m"
CYAN="\033[36m"
RESET="\033[0m"

ok()   { echo -e "${GREEN}✅ $1${RESET}"; }
warn() { echo -e "${YELLOW}⚠️  $1${RESET}"; }
info() { echo -e "${CYAN}ℹ  $1${RESET}"; }

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

echo -e "${BOLD}"
echo "╔═══════════════════════════════════════╗"
echo "║         AgendaBot — Iniciando         ║"
echo "╚═══════════════════════════════════════╝"
echo -e "${RESET}"

# ── Verificações rápidas ──────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo -e "\033[31m❌ Node.js não encontrado. Rode primeiro: bash scripts/setup.sh\033[0m"
  exit 1
fi

if ! docker info &>/dev/null 2>&1; then
  echo -e "\033[31m❌ Docker não está rodando. Abra o Docker Desktop e tente novamente.\033[0m"
  exit 1
fi

# ── Banco de dados ────────────────────────────────────────────────────────────
echo -e "\n${BOLD}▶ Banco de dados e Redis${RESET}"
docker compose -f infra/docker-compose.yml up -d
ok "Postgres + Redis rodando"

# ── Detectar IP local (para o mobile acessar o backend) ──────────────────────
LOCAL_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "localhost")

# Atualizar EXPO_PUBLIC_API_URL com o IP local se não for localhost
if [ -f "apps/mobile/.env" ] && [ "$LOCAL_IP" != "localhost" ]; then
  sed -i '' "s|EXPO_PUBLIC_API_URL=http://[^:]*:3000|EXPO_PUBLIC_API_URL=http://$LOCAL_IP:3000|g" apps/mobile/.env 2>/dev/null || true
fi

# ── Backend ───────────────────────────────────────────────────────────────────
echo -e "\n${BOLD}▶ Backend (porta 3000)${RESET}"

LOG_BACKEND="$ROOT_DIR/.logs/backend.log"
mkdir -p "$ROOT_DIR/.logs"

# Matar processo anterior se existir
pkill -f "tsx watch src/index.ts" 2>/dev/null || true
sleep 0.5

npm run dev --workspace=apps/backend > "$LOG_BACKEND" 2>&1 &
BACKEND_PID=$!

# Aguardar backend subir
echo -n "   Aguardando backend..."
for i in $(seq 1 20); do
  sleep 1
  if curl -sf http://localhost:3000/health >/dev/null 2>&1; then
    echo ""
    ok "Backend pronto em http://localhost:3000"
    break
  fi
  echo -n "."
  if [ $i -eq 20 ]; then
    echo ""
    warn "Backend demorou mais que o esperado. Veja o log em .logs/backend.log"
    warn "Continuando mesmo assim..."
  fi
done

# ── Admin Web ────────────────────────────────────────────────────────────────
echo -e "\n${BOLD}▶ Painel Admin (porta 3001)${RESET}"

LOG_ADMIN="$ROOT_DIR/.logs/admin.log"
pkill -f "next dev" 2>/dev/null || true
sleep 0.5

npm run dev --workspace=apps/admin-web > "$LOG_ADMIN" 2>&1 &
ADMIN_PID=$!
ok "Admin iniciando em http://localhost:3001 (leva ~10s para compilar)"

# ── Tenant Web ───────────────────────────────────────────────────────────────
echo -e "\n${BOLD}▶ Painel Tenant (porta 3002)${RESET}"

LOG_TENANT="$ROOT_DIR/.logs/tenant.log"
npm run dev --workspace=apps/tenant-web > "$LOG_TENANT" 2>&1 &
TENANT_PID=$!
ok "Tenant web iniciando em http://localhost:3002 (leva ~10s para compilar)"

# ── Mobile / Expo ────────────────────────────────────────────────────────────
echo -e "\n${BOLD}▶ App Mobile (Expo)${RESET}"
echo ""
info "IP local detectado: $LOCAL_IP"
info "API do mobile aponta para: http://$LOCAL_IP:3000"
echo ""
info "Certifique-se que o celular está na mesma rede Wi-Fi que este Mac."
echo ""

echo -e "${BOLD}URLs:${RESET}"
echo -e "  Backend:     ${CYAN}http://localhost:3000${RESET}"
echo -e "  Admin root:  ${CYAN}http://localhost:3001${RESET}"
echo -e "  Tenant web:  ${CYAN}http://localhost:3002${RESET}"
echo -e "  Health:      ${CYAN}http://localhost:3000/health${RESET}"
echo ""
echo -e "${YELLOW}Logs:${RESET}"
echo -e "  backend:     .logs/backend.log"
echo -e "  admin web:   .logs/admin.log"
echo -e "  tenant web:  .logs/tenant.log"
echo ""
echo -e "${BOLD}Pressione Ctrl+C para parar tudo.${RESET}"
echo ""

# Limpeza ao encerrar
cleanup() {
  echo -e "\n\n${BOLD}Encerrando serviços...${RESET}"
  kill $BACKEND_PID 2>/dev/null || true
  kill $ADMIN_PID 2>/dev/null || true
  kill $TENANT_PID 2>/dev/null || true
  docker compose -f infra/docker-compose.yml stop 2>/dev/null || true
  echo "Até mais! 👋"
}
trap cleanup EXIT INT TERM

# Mobile em foreground (QR code visível)
cd apps/mobile
npx expo start --clear
