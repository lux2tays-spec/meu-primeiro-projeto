'use client'
import Link from 'next/link'
import { Lock } from 'lucide-react'

// #10 — Tela de "recurso do plano" (bloqueado + fazer upgrade) para páginas
// inteiras que exigem uma capability que o plano atual não tem.
export default function UpgradeGate({ feature }: { feature: string }) {
  return (
    <div className="max-w-lg mx-auto text-center py-16 px-4">
      <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
        <Lock className="text-primary" />
      </div>
      <h1 className="text-xl font-bold text-gray-900">{feature} não está no seu plano</h1>
      <p className="text-gray-500 text-sm mt-2">Faça upgrade do seu plano para desbloquear este recurso.</p>
      <Link href="/settings/subscription" className="inline-block mt-5 h-10 px-6 bg-primary text-white rounded-xl text-sm font-semibold leading-10 hover:bg-primary-dark transition-colors">
        Ver planos
      </Link>
    </div>
  )
}
