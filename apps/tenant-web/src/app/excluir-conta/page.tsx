import Link from 'next/link'

export const metadata = {
  title: 'Excluir conta — AiConfirma',
  description: 'Como excluir sua conta AiConfirma e quais dados são removidos.',
}

// Página pública exigida pela Google Play (Data Safety → URL de exclusão de
// conta). Explica como excluir a conta pelo app ou por solicitação, e o que é
// removido. A exclusão in-app já existe (Ajustes → Excluir minha conta).
const CONTACT_EMAIL = 'contato.aiconfirma@gmail.com'

export default function ExcluirContaPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 text-gray-800">
      <Link href="/" className="text-sm text-primary hover:underline">← Voltar</Link>
      <h1 className="mt-4 text-3xl font-bold text-gray-900">Excluir sua conta</h1>
      <p className="mt-2 text-sm text-gray-500">Aplicativo: AiConfirma · Pacote: com.aiconfirma.app</p>

      <div className="prose prose-sm mt-8 max-w-none space-y-6 leading-relaxed">
        <section>
          <h2 className="text-xl font-semibold">1. Excluir direto no aplicativo (recomendado)</h2>
          <p>Você pode excluir sua conta e todos os dados associados diretamente no app, a qualquer momento:</p>
          <ol className="list-decimal pl-6">
            <li>Abra o aplicativo <strong>AiConfirma</strong> e faça login.</li>
            <li>Vá em <strong>Ajustes</strong> (menu de configurações).</li>
            <li>Toque em <strong>“Excluir minha conta”</strong> (no rodapé da tela).</li>
            <li>Confirme. A exclusão é <strong>permanente e imediata</strong>.</li>
          </ol>
        </section>

        <section>
          <h2 className="text-xl font-semibold">2. Excluir por solicitação</h2>
          <p>
            Se você não tiver mais acesso ao app, envie um e-mail para{' '}
            <strong>{CONTACT_EMAIL}</strong> a partir do e-mail cadastrado na conta, com o assunto
            <strong> “Excluir minha conta”</strong>. Concluímos a exclusão em até <strong>7 dias úteis</strong>
            após confirmarmos a titularidade.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">3. Quais dados são excluídos</h2>
          <p>São eliminados os dados vinculados à sua conta, incluindo:</p>
          <ul className="list-disc pl-6">
            <li>Dados de cadastro (nome, e-mail, telefone e credenciais).</li>
            <li>Agendamentos, clientes e serviços cadastrados.</li>
            <li>Histórico de conversas e mensagens do WhatsApp.</li>
            <li>Configurações do assistente e integrações (ex.: Google Calendar, WhatsApp).</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold">4. Dados retidos por obrigação legal</h2>
          <p>
            Registros exigidos por lei (por exemplo, dados fiscais e de pagamento de assinaturas já realizadas)
            podem ser mantidos pelo prazo legal aplicável, de forma segregada, e depois eliminados. Os demais
            dados são apagados em até <strong>90 dias</strong>, conforme a{' '}
            <Link href="/privacidade" className="text-primary hover:underline">Política de Privacidade</Link>.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">5. Dúvidas</h2>
          <p>
            Fale com a gente em <strong>{CONTACT_EMAIL}</strong>. Veja também os{' '}
            <Link href="/termos" className="text-primary hover:underline">Termos de Uso</Link> e a{' '}
            <Link href="/privacidade" className="text-primary hover:underline">Política de Privacidade</Link>.
          </p>
        </section>
      </div>
    </main>
  )
}
