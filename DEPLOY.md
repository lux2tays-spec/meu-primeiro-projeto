# Deploy Guide — AgendaBot

## Overview

| Service | Platform | Trigger |
|---|---|---|
| Backend API | Railway | Push to `main` |
| Admin Web | Vercel | Push to `main` |
| Mobile App | EAS Build | Manual / CI |
| PostgreSQL | Railway | Managed add-on |
| Redis | Railway | Managed add-on |
| Evolution API | Railway (Docker) | Manual deploy |

---

## 1. Backend — Railway

### First deploy

1. Create a Railway account at railway.app
2. Install the Railway CLI: `npm install -g @railway/cli`
3. Login: `railway login`
4. Create a new project:
   ```bash
   railway init
   # Choose "Empty project" → name it "agendabot"
   ```

5. Add PostgreSQL: **New Service → Database → PostgreSQL**
6. Add Redis: **New Service → Database → Redis**
7. Copy the `DATABASE_URL` and `REDIS_URL` from the service variables panel

8. Deploy the backend service:
   ```bash
   railway up --service agendabot-api
   ```

9. Set all required environment variables (Railway dashboard → service → Variables):
   ```
   DATABASE_URL          (auto-injected from Postgres add-on)
   REDIS_URL             (auto-injected from Redis add-on)
   JWT_SECRET            (generate: openssl rand -hex 32)
   ANTHROPIC_API_KEY
   EVOLUTION_API_URL     (https://your-evolution.railway.app)
   EVOLUTION_API_KEY
   MERCADOPAGO_ACCESS_TOKEN
   S3_BUCKET
   S3_REGION
   S3_ACCESS_KEY_ID
   S3_SECRET_ACCESS_KEY
   GOOGLE_CLIENT_ID
   GOOGLE_CLIENT_SECRET
   PORT                  3000
   NODE_ENV              production
   ```

10. Run migrations:
    ```bash
    DATABASE_URL="<your-url>" npm run migrate --workspace=apps/backend
    ```

### GitHub Actions (CI/CD)

Add these secrets to GitHub → Settings → Secrets and variables → Actions:

```
RAILWAY_TOKEN          (Railway dashboard → Account Settings → Tokens)
RAILWAY_SERVICE_ID     (Railway project → service → Settings → Service ID)
DATABASE_URL           (same as Railway env var)
NEXT_PUBLIC_API_URL    (https://your-backend.railway.app)
VERCEL_TOKEN
VERCEL_ORG_ID
VERCEL_PROJECT_ID
```

---

## 2. Evolution API — Railway

Evolution API provides WhatsApp connectivity via QR code per tenant.

1. In your Railway project: **New Service → Docker Image**
2. Image: `atendai/evolution-api:latest`
3. Set environment variables:
   ```
   AUTHENTICATION_TYPE           apikey
   AUTHENTICATION_API_KEY        (generate a strong secret)
   DATABASE_ENABLED              false
   REDIS_ENABLED                 true
   REDIS_URI                     (same REDIS_URL from Railway)
   REDIS_PREFIX_KEY              evolution
   WEBHOOK_GLOBAL_ENABLED        false
   ```
4. Add a custom domain or use the Railway-generated URL
5. Set `EVOLUTION_API_URL` and `EVOLUTION_API_KEY` in the backend service vars

---

## 3. Admin Web — Vercel

1. Install Vercel CLI: `npm i -g vercel`
2. Link the project:
   ```bash
   cd apps/admin-web
   vercel link
   ```
3. Set environment variable in Vercel dashboard:
   ```
   NEXT_PUBLIC_API_URL   https://your-backend.railway.app
   ```
4. Deploy:
   ```bash
   vercel --prod
   ```

For CI/CD, the GitHub Action handles this automatically on push to `main`.

---

## 4. Mobile App — EAS Build

### Setup

1. Install EAS CLI: `npm install -g eas-cli`
2. Login: `eas login`
3. Link to Expo account:
   ```bash
   cd apps/mobile
   eas init
   ```

4. Create `apps/mobile/.env.production`:
   ```
   EXPO_PUBLIC_API_URL=https://your-backend.railway.app
   EXPO_PUBLIC_GOOGLE_CLIENT_ID=<web-client-id>.apps.googleusercontent.com
   EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=<ios-client-id>.apps.googleusercontent.com
   EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID=<android-client-id>.apps.googleusercontent.com
   ```

### Build

```bash
# Internal testing (APK for Android, simulator for iOS)
eas build --platform all --profile preview

# Production stores
eas build --platform all --profile production
```

### Submit to stores

Fill in `eas.json` submit section with your Apple/Google credentials, then:

```bash
eas submit --platform ios --profile production
eas submit --platform android --profile production
```

---

## 5. Google Cloud Console — OAuth Setup

1. Go to console.cloud.google.com → Create project "AgendaBot"
2. Enable APIs: **Google Calendar API**, **Google People API**
3. Configure OAuth consent screen:
   - App name: AgendaBot
   - Scopes: `openid`, `email`, `profile`, `https://www.googleapis.com/auth/calendar.events`
4. Create credentials → OAuth 2.0 Client IDs:

   | Type | Use |
   |---|---|
   | Web application | Backend token verification + Calendar OAuth |
   | iOS | Expo iOS build (bundle ID: `com.agendabot.app`) |
   | Android | Expo Android build (package: `com.agendabot.app`) |

5. Add authorized redirect URIs for the web client:
   - `https://your-backend.railway.app/auth/google/callback`
   - `https://auth.expo.io/@your-expo-username/agendabot` (Expo Go)
   - `agendabot://` (deep link for production builds)

6. Set in backend env vars: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
7. Set in mobile `.env`: `EXPO_PUBLIC_GOOGLE_CLIENT_ID`, `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`, `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID`

---

## 6. Mercado Pago

1. Create a Mercado Pago developer account
2. Create an application at developers.mercadopago.com
3. Get the production `access_token` → set `MERCADOPAGO_ACCESS_TOKEN`
4. Set the subscription webhook URL in the Mercado Pago dashboard:
   `https://your-backend.railway.app/webhook/mercadopago`

---

## 7. S3 / Storage

Any S3-compatible storage works (AWS S3, Cloudflare R2, etc.).

1. Create a bucket (e.g., `agendabot-messages`)
2. Create an IAM user with `s3:PutObject`, `s3:GetObject` on that bucket
3. Set: `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`

For Cloudflare R2: set `S3_ENDPOINT` to your R2 endpoint and use `us-east-1` as region.

---

## 8. First-run checklist

- [ ] Railway project created with Postgres + Redis add-ons
- [ ] Backend deployed and environment variables set
- [ ] `npm run migrate` executed successfully
- [ ] Root user created manually in the database:
  ```sql
  INSERT INTO users (id, name, email, password_hash, created_at)
  VALUES (gen_random_uuid(), 'Fabio', 'your@email.com', '<bcrypt-hash>', NOW());

  INSERT INTO user_roles (user_id, tenant_id, role)
  VALUES ('<user-id>', NULL, 'root');
  ```
- [ ] Evolution API running and `EVOLUTION_API_URL` / `EVOLUTION_API_KEY` set
- [ ] Admin web deployed on Vercel and accessible
- [ ] Admin web login works with root credentials
- [ ] Mobile app builds successfully with `eas build --profile preview`
- [ ] Google OAuth consent screen published
- [ ] Mercado Pago webhook URL registered
- [ ] S3 bucket accessible

---

## Local development

```bash
# Start Postgres + Redis
docker compose -f infra/docker-compose.yml up -d

# Run migrations
npm run migrate --workspace=apps/backend

# Start all apps
npm run dev
```

Copy each app's `.env.example` to `.env` and fill in local values.
