export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#0B1220] bg-gradient-to-b from-[#0B1220] to-[#0d1730] flex items-center justify-center p-4">
      {children}
    </div>
  )
}
