import { create } from 'zustand'
import { getToken, setToken, deleteToken } from './storage'

interface AuthState {
  token: string | null
  tenantId: string | null
  userId: string | null
  role: string | null
  isLoaded: boolean
  setAuth: (token: string) => void
  clearAuth: () => void
  loadAuth: () => Promise<void>
}

function parseJwt(token: string) {
  try {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(base64))
  } catch {
    return null
  }
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  tenantId: null,
  userId: null,
  role: null,
  isLoaded: false,

  setAuth: async (token) => {
    await setToken(token)
    const payload = parseJwt(token)
    set({
      token,
      tenantId: payload?.tenant_id ?? null,
      userId: payload?.user_id ?? null,
      role: payload?.role ?? null,
    })
  },

  clearAuth: async () => {
    await deleteToken()
    set({ token: null, tenantId: null, userId: null, role: null })
  },

  loadAuth: async () => {
    try {
      const token = await getToken()
      if (token) {
        const payload = parseJwt(token)
        if (payload?.exp && payload.exp * 1000 > Date.now()) {
          set({ token, tenantId: payload.tenant_id, userId: payload.user_id, role: payload.role })
        } else {
          await SecureStore.deleteItemAsync('token')
        }
      }
    } catch (e) {
      console.warn('loadAuth error:', e)
    } finally {
      set({ isLoaded: true })
    }
  },
}))
