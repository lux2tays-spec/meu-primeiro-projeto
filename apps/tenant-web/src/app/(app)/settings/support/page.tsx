export default function SupportPage() {
  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Suporte</h1>

      <div className="grid gap-4">
        {[
          {
            icon: '💬',
            title: 'WhatsApp',
            desc: 'Fale diretamente com nossa equipe de suporte',
            action: 'Abrir WhatsApp',
            href: 'https://wa.me/5511999999999?text=Olá, preciso de ajuda com o AgendaBot',
            color: 'bg-green-50 border-green-200 hover:border-green-300',
          },
          {
            icon: '📧',
            title: 'E-mail',
            desc: 'suporte@agendabot.com.br — respondemos em até 24h',
            action: 'Enviar e-mail',
            href: 'mailto:suporte@agendabot.com.br',
            color: 'bg-blue-50 border-blue-200 hover:border-blue-300',
          },
          {
            icon: '📚',
            title: 'Central de ajuda',
            desc: 'Artigos e tutoriais para tirar suas dúvidas',
            action: 'Acessar',
            href: '#',
            color: 'bg-purple-50 border-purple-200 hover:border-purple-300',
          },
        ].map((item) => (
          <a
            key={item.title}
            href={item.href}
            target="_blank"
            rel="noopener noreferrer"
            className={`flex items-center gap-4 p-5 rounded-2xl border-2 transition-colors ${item.color}`}
          >
            <span className="text-3xl">{item.icon}</span>
            <div className="flex-1">
              <p className="font-bold text-gray-900">{item.title}</p>
              <p className="text-gray-500 text-sm mt-0.5">{item.desc}</p>
            </div>
            <span className="text-primary text-sm font-medium">{item.action} →</span>
          </a>
        ))}
      </div>

      <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
        <p className="font-semibold text-gray-900 mb-1">Horário de atendimento</p>
        <p className="text-gray-500 text-sm">Segunda a sexta, das 9h às 18h (horário de Brasília)</p>
      </div>
    </div>
  )
}
