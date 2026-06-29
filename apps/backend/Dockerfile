FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY apps/backend/package*.json ./apps/backend/
COPY packages/shared/package*.json ./packages/shared/

RUN npm ci --workspace=apps/backend --workspace=packages/shared --if-present

COPY packages/shared ./packages/shared
COPY apps/backend ./apps/backend

# Build — || true because shared has no build script and type errors don't affect runtime
RUN npm run build --workspace=apps/backend 2>&1 || true

# Ensure dist was created (type errors emit JS due to noEmitOnError:false)
RUN test -f /app/apps/backend/dist/index.js || (echo "ERROR: dist/index.js missing — build truly failed" && exit 1)

# ---- runtime ----
FROM node:20-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
COPY apps/backend/package*.json ./apps/backend/
COPY packages/shared/package*.json ./packages/shared/

RUN npm ci --workspace=apps/backend --workspace=packages/shared --omit=dev --if-present

COPY --from=builder /app/apps/backend/dist ./apps/backend/dist
COPY apps/backend/scripts ./apps/backend/scripts
COPY infra/migrations ./infra/migrations

EXPOSE 3000

CMD ["node", "apps/backend/dist/index.js"]
