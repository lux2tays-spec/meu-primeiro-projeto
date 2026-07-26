// Google Sign-In "Web application" client ID. This is a PUBLIC value — it ships
// in the browser bundle either way and is locked to the authorized JavaScript
// origins in Google Cloud (app.aiconfirma.com.br). So a hardcoded default is
// safe; NEXT_PUBLIC_GOOGLE_CLIENT_ID (Vercel env) overrides it when present.
export const GOOGLE_CLIENT_ID =
  process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ||
  '983019594360-bte8fmjm4nndbdvkur1o5t7p6arbgmim.apps.googleusercontent.com'
