import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#6C47FF',
          dark: '#5233CC',
          light: '#EDE9FF',
        },
        sidebar: '#0F0F23',
        'sidebar-hover': '#1A1A3E',
      },
    },
  },
  plugins: [],
}
export default config
