import * as Google from 'expo-auth-session/providers/google'
import * as WebBrowser from 'expo-web-browser'
import { makeRedirectUri } from 'expo-auth-session'

WebBrowser.maybeCompleteAuthSession()

export const GOOGLE_CONFIG = {
  clientId: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID!,
  iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
  androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
}

// Scopes for login only (openid + profile + email)
export const LOGIN_SCOPES = ['openid', 'profile', 'email']

// Scopes for Google Calendar integration
export const CALENDAR_SCOPES = [
  'openid',
  'profile',
  'email',
  'https://www.googleapis.com/auth/calendar.events',
]

export function useGoogleAuth(scopes = LOGIN_SCOPES) {
  return Google.useIdTokenAuthRequest({
    ...GOOGLE_CONFIG,
    scopes,
  })
}

export function useGoogleCalendarAuth() {
  return Google.useAuthRequest({
    ...GOOGLE_CONFIG,
    scopes: CALENDAR_SCOPES,
    responseType: 'code',
    usePKCE: false,
    redirectUri: makeRedirectUri({ scheme: 'agendabot' }),
    extraParams: { access_type: 'offline', prompt: 'consent' },
  })
}

export function getCalendarRedirectUri() {
  return makeRedirectUri({ scheme: 'agendabot' })
}
