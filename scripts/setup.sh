#!/bin/bash
# First-time setup script for AgendaBot
# Run once: bash scripts/setup.sh
set -e

BOLD="\033[1m"
GREEN="\033[32m"
YELLOW="\033[33m"
RED="\033[31m"
RESET="\033[0m"

ok()   { echo -e "${GREEN}✅ $1${RESET}"; }
warn() { echo -e "${YELLOW}⚠️  $1${RESET}"; }
fail() { echo -e "${RED}❌ $1${RESET}"; exit 1; }
step() { echo -e "\n${BOLD}▶ $1${RESET}"; }

echo -e "${BOLD}"
echo "╔═══════════════════════════════════════╗"
echo "║       AgendaBot — Setup Inicial       ║"
echo "╚═══════════════════════════════════════╝"
echo -e "${RESET}"

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

# ── 1. Node.js ────────────────────────────────────────────────────────────────
step "Verificando Node.js..."
if ! command -v node &>/dev/null; then
  fail "Node.js não encontrado.\n\n  Instale via Homebrew:\n    brew install node\n\n  Ou baixe em: https://nodejs.org"
fi
NODE_VER=$(node --version | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VER" -lt 18 ]; then
  fail "Node.js $NODE_VER encontrado, mas precisa ser v18 ou superior.\n  Atualize: brew upgrade node"
fi
ok "Node.js $(node --version)"

# ── 2. Docker ────────────────────────────────────────────────────────────────
step "Verificando Docker..."
if ! command -v docker &>/dev/null; then
  fail "Docker não encontrado.\n\n  Baixe o Docker Desktop em:\n    https://www.docker.com/products/docker-desktop\n\n  Após instalar, abra o Docker Desktop e tente novamente."
fi
if ! docker info &>/dev/null 2>&1; then
  fail "Docker está instalado mas não está rodando.\n  Abra o Docker Desktop e aguarde o ícone da baleia aparecer na barra de status."
fi
ok "Docker $(docker --version | awk '{print $3}' | tr -d ',')"

# ── 3. npm install ────────────────────────────────────────────────────────────
step "Instalando dependências npm..."
npm install --silent
ok "Dependências instaladas"

# ── 4. Assets do app mobile ───────────────────────────────────────────────────
step "Gerando assets do app mobile (ícone, splash)..."
if [ ! -f "apps/mobile/assets/icon.png" ]; then
  node scripts/generate-assets.js
  ok "Assets gerados"
else
  ok "Assets já existem"
fi

# ── 5. Arquivo .env do backend ────────────────────────────────────────────────
step "Verificando .env do backend..."
if [ ! -f "apps/backend/.env" ]; then
  cp apps/backend/.env.example apps/backend/.env
  warn "Arquivo apps/backend/.env criado a partir do .env.example"
  warn "Edite-o e adicione sua ANTHROPIC_API_KEY antes de continuar"
else
  ok "apps/backend/.env encontrado"
fi

# Verificar se a chave Anthropic foi preenchida
if grep -q "COLOQUE_SUA_CHAVE_AQUI" apps/backend/.env 2>/dev/null; then
  echo ""
  warn "ATENÇÃO: Você ainda não configurou a ANTHROPIC_API_KEY em apps/backend/.env"
  warn "O bot não vai funcionar sem ela. Pegue sua chave em: https://console.anthropic.com"
  echo ""
fi

# ── 6. Docker Compose (Postgres + Redis) ─────────────────────────────────────
step "Iniciando Postgres e Redis..."
docker compose -f infra/docker-compose.yml up -d
sleep 2
ok "Banco de dados e Redis rodando"

# ── 7. Migrations ─────────────────────────────────────────────────────────────
step "Rodando migrations do banco de dados..."
npm run migrate --workspace=apps/backend
ok "Migrations aplicadas"

# ── 8. Usuário root ───────────────────────────────────────────────────────────
step "Criando usuário root (admin da plataforma)..."
node scripts/create-root-user.js

# ── Concluído ─────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}"
echo "╔═══════════════════════════════════════╗"
echo "║         Setup concluído! 🎉           ║"
echo "╚═══════════════════════════════════════╝"
echo -e "${RESET}"
echo "  Para iniciar o projeto rode:"
echo ""
echo -e "    ${BOLD}bash start.sh${RESET}"
echo ""
echo "  Isso sobe o backend, o mobile e o painel admin."
echo ""
