export function StatCard({
  label, value, sub, icon, color = 'bg-primary-light text-primary',
}: {
  label: string
  value: string | number
  sub?: string
  icon: string
  color?: string
}) {
  return (
    <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
      <div className={`inline-flex w-11 h-11 rounded-xl items-center justify-center text-xl mb-4 ${color}`}>
        {icon}
      </div>
      <div className="text-3xl font-bold text-gray-900">{value}</div>
      <div className="text-sm font-medium text-gray-500 mt-1">{label}</div>
      {sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>}
    </div>
  )
}
