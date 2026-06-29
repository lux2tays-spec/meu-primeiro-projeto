import clsx from 'clsx'

type Variant = 'success' | 'warning' | 'danger' | 'info' | 'default' | 'purple'

const classes: Record<Variant, string> = {
  success: 'bg-green-100 text-green-700',
  warning: 'bg-yellow-100 text-yellow-700',
  danger:  'bg-red-100 text-red-700',
  info:    'bg-blue-100 text-blue-700',
  purple:  'bg-primary-light text-primary-dark',
  default: 'bg-gray-100 text-gray-600',
}

export function Badge({ label, variant = 'default' }: { label: string; variant?: Variant }) {
  return (
    <span className={clsx('inline-flex px-2 py-0.5 rounded-full text-xs font-semibold', classes[variant])}>
      {label}
    </span>
  )
}
