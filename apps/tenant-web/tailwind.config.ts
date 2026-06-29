import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        primary: '#6C47FF',
        'primary-dark': '#5233CC',
        'primary-light': '#EDE9FF',
        success: '#22C55E',
        warning: '#F59E0B',
        danger: '#EF4444',
        sidebar: '#1A1035',
        'sidebar-hover': '#2D1E5A',
      },
    },
  },
  plugins: [],
}
export default config
