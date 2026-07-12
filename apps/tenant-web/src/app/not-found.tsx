// Friendly 404 — shown when a route doesn't exist. No technical noise for users.
export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto w-14 h-14 rounded-2xl bg-primary-light flex items-center justify-center mb-5">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#6C47FF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </div>
        <h1 className="text-lg font-bold text-gray-900">Página não encontrada</h1>
        <p className="text-sm text-gray-500 mt-2">
          O endereço que você tentou acessar não existe ou foi movido.
        </p>
        <a
          href="/dashboard"
          className="inline-block mt-6 bg-primary hover:bg-primary-dark text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors"
        >
          Voltar ao início
        </a>
      </div>
    </div>
  )
}
