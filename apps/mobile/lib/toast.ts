import { create } from 'zustand'

export type ToastVariant = 'success' | 'error' | 'warning' | 'info'

interface ToastState {
  visible: boolean
  message: string
  variant: ToastVariant
  show: (message: string, variant?: ToastVariant) => void
  hide: () => void
}

export const useToast = create<ToastState>((set) => ({
  visible: false,
  message: '',
  variant: 'info',
  show: (message, variant = 'info') => set({ visible: true, message, variant }),
  hide: () => set({ visible: false }),
}))
