# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Product Overview

SaaS multi-tenant platform that provides AI-powered WhatsApp chatbots for small businesses (aesthetic clinics, pet shops, etc.). Business owners configure their account via a mobile app; their customers interact only via WhatsApp. A separate web-only root admin panel gives the platform owner full control over all tenants.

## Monorepo Structure

```
apps/
  mobile/      # React Native + Expo — business owners & staff
  admin-web/   # Next.js — root admin panel (platform owner only)
  backend/     # Node.js + Fastify + TypeScript — single API + bot webhooks
packages/
  shared/      # Shared TypeScript types used by all apps
infra/
  docker-compose.yml   # Local Postgres + Redis
  migrations/          # SQL migration files (numbered, e.g. 001_init.sql)
```

## Commands

### Root
```bash
npm install          # Install all workspaces
npm run dev          # Start all apps in parallel (turbo)
npm run build        # Build all apps
npm run typecheck    # Run tsc --noEmit across all packages
```

### Backend (`apps/backend`)
```bash
npm run dev          # Fastify dev server with hot reload
npm run migrate      # Run pending SQL migrations
npm run migrate:new  # Create a new migration file
npm test             # Vitest unit tests
npm run test:watch   # Watch mode
```

### Mobile (`apps/mobile`)
```bash
npx expo start       # Start Expo dev server
npx expo run:ios     # Run on iOS simulator
npx expo run:android # Run on Android emulator
```

### Admin Web (`apps/admin-web`)
```bash
npm run dev          # Next.js dev server
npm run build && npm start  # Production build
```

## Architecture

### Multi-tenancy
Every table in Postgres includes a `tenant_id UUID` column. All backend queries must filter by `tenant_id` derived from the authenticated JWT. Never trust tenant_id from the request body — always read it from the JWT payload.

### Auth & Roles
JWT-based auth. Role hierarchy: `root` > `owner` > `admin` > `staff`. The `root` role is only issued to platform owner accounts and grants cross-tenant access. Store role in JWT claims as `{ tenant_id, user_id, role }`.

### Bot Flow
1. Evolution API fires a POST webhook to `/webhook/whatsapp/:instanceId`
2. Backend resolves `tenant_id` from the instance record
3. Conversation context loaded from Redis (TTL 30min); on miss, load last 20 messages from DB
4. Call `claude-haiku-4-5` with system prompt built from `agent_config` + business context
5. Parse AI response: plain text reply, or structured action (`SCHEDULE`, `CANCEL`, `LIST_SERVICES`, etc.)
6. Send reply via Evolution API REST call
7. Persist message to `messages` table; archive to S3 after 30 days

### AI Models
- **Bot responses**: `claude-haiku-4-5` — cheapest per token, used for all customer-facing chatbot messages
- **Root admin analysis/reports**: `claude-sonnet-4-6` — higher quality for internal use only

### Plans & Limits
| Plan | Max agendas | Max users | Trial |
|------|-------------|-----------|-------|
| free | 1 | 1 | 5 days |
| basico | 1 | 1 | — |
| premium | 3 | 3 | — |
| profissional | 10 | 10 | — |

Enforce limits in a single `planGuard` middleware that reads `tenant.plan` and counts current usage. Never enforce limits in feature code directly.

### Payments (Mercado Pago)
Use Mercado Pago Subscriptions API for recurring billing. Webhook endpoint: `/webhook/mercadopago`. On subscription events (`authorized`, `cancelled`, `paused`), update `subscriptions` table and `tenants.plan` accordingly.

### WhatsApp (Evolution API)
Each tenant has one row in `whatsapp_instances`. Connection is established via QR code flow: mobile app polls `GET /whatsapp/qr/:tenantId` which proxies Evolution API's QR endpoint. Store instance credentials encrypted in DB. Never log Evolution API tokens.

### Key Database Tables
```
tenants              plan, status, trial_ends_at, tenant settings
users                platform accounts (owners + staff)
user_roles           role per user per tenant
professionals        bookable staff members (different from system users)
services             services with duration, price, per tenant
working_hours        weekly schedule per professional
days_off             specific blocked dates per professional
appointments         status: pending | confirmed | completed | cancelled
customers            end-customers (WhatsApp contacts) per tenant
whatsapp_instances   Evolution API instance per tenant
agent_config         bot system prompt, tone, language per tenant
conversations        WhatsApp thread (customer + tenant)
messages             individual messages, archived to S3 after 30d
subscriptions        Mercado Pago subscription data per tenant
affiliates           affiliate accounts with referral codes
affiliate_referrals  referral → tenant mapping with commission status
```

### Redis Keys
- `bot:context:{conversationId}` — last N messages, TTL 30min
- `tenant:config:{tenantId}` — cached agent_config + business info, TTL 5min
- `whatsapp:qr:{tenantId}` — QR code data, TTL 60s

### S3 / Storage
Message history older than 30 days is archived to S3 as JSON (one file per conversation per day). Use signed URLs for retrieval. Never expose raw S3 URLs in API responses.

## Mobile App Modules
Dashboard → Reports, Calendar, Customers, Agent Config, Services, Staff (with roles), Working Hours, Days Off, WhatsApp Connection, Payment Links, Subscription, General Settings, Affiliate Panel, Support.

## Environment Variables
Each app has its own `.env`. See `.env.example` in each app directory. Never commit `.env` files. Backend requires: `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `ANTHROPIC_API_KEY`, `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `MERCADOPAGO_ACCESS_TOKEN`, `S3_BUCKET`, `S3_REGION`.
