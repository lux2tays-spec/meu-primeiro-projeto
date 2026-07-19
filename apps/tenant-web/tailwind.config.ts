import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        primary: 'rgb(var(--brand-primary-rgb) / <alpha-value>)',
        'primary-dark': 'rgb(var(--brand-primary-dark-rgb) / <alpha-value>)',
        'primary-light': '#E7F7EF',
        success: '#22C55E',
        warning: '#F59E0B',
        danger: '#EF4444',
        sidebar: 'rgb(var(--brand-sidebar-rgb) / <alpha-value>)',
        'sidebar-hover': '#274D80',
      },
    },
  },
  plugins: [],
}
export default config
