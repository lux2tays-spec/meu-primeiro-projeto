import { create } from 'zustand'

export type ToastVariant = 'success' | 'error' | 'warning' | 'info'

export interface ToastAction {
  label: string
  onPress: () => void
}

interface ToastState {
  visible: boolean
  message: string
  variant: ToastVariant
  /** CTA opcional (ex.: "Ver planos" ao atingir limite do plano). */
  action?: ToastAction
  show: (message: string, variant?: ToastVariant, action?: ToastAction) => void
  hide: () => void
}

export const useToast = create<ToastState>((set) => ({
  visible: false,
  message: '',
  variant: 'info',
  action: undefined,
  show: (message, variant = 'info', action) => set({ visible: true, message, variant, action }),
  hide: () => set({ visible: false }),
}))
