import Link from 'next/link'

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000'

export type LegalData = {
  privacy: string
  privacy_updated_at: string | null
  terms: string
  terms_updated_at: string | null
}

// Busca os textos legais colados no Root Admin. Retorna null em falha (as
// páginas então usam o conteúdo estático de fallback).
export async function getLegal(): Promise<LegalData | null> {
  try {
    const r = await fetch(`${API}/legal`, { next: { revalidate: 60 } })
    if (!r.ok) return null
    return (await r.json()) as LegalData
  } catch {
    return null
  }
}

// Renderiza um documento legal a partir do texto salvo (preserva quebras de linha).
export function LegalText({ title, text, updatedAt }: { title: string; text: string; updatedAt?: string | null }) {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 text-gray-800">
      <Link href="/" className="text-sm text-primary hover:underline">← Voltar</Link>
      <h1 className="mt-4 text-3xl font-bold text-gray-900">{title}</h1>
      {updatedAt && (
        <p className="mt-2 text-sm text-gray-500">
          Última atualização: {new Date(updatedAt).toLocaleDateString('pt-BR')}
        </p>
      )}
      <div className="mt-8 whitespace-pre-wrap leading-relaxed text-[15px]">{text}</div>
    </main>
  )
}
