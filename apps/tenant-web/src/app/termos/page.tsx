import Link from 'next/link'

export const metadata = {
  title: 'Termos de Uso — AgendaBot',
  description: 'Termos e condições de uso da plataforma AgendaBot.',
}

// NOTA: preencha [RAZÃO SOCIAL]/[CNPJ] e revise juridicamente antes de publicar.
// Última atualização: 11 de julho de 2026.

export default function TermosPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 text-gray-800">
      <Link href="/" className="text-sm text-primary hover:underline">← Voltar</Link>
      <h1 className="mt-4 text-3xl font-bold text-gray-900">Termos de Uso</h1>
      <p className="mt-2 text-sm text-gray-500">Última atualização: 11 de julho de 2026</p>

      <div className="prose prose-sm mt-8 max-w-none space-y-6 leading-relaxed">
        <section>
          <h2 className="text-xl font-semibold">1. Aceitação</h2>
          <p>
            Ao criar uma conta ou usar o AgendaBot, operado por <strong>[RAZÃO SOCIAL], CNPJ [CNPJ]</strong>,
            você concorda com estes Termos e com a{' '}
            <Link href="/privacidade" className="text-primary hover:underline">Política de Privacidade</Link>.
            Se não concordar, não utilize o serviço.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">2. O serviço</h2>
          <p>
            O AgendaBot fornece um assistente de atendimento por WhatsApp com IA para agendamentos e
            comunicação com clientes. O serviço é oferecido &quot;como está&quot;, podendo evoluir, sofrer
            manutenções e ter recursos alterados.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">3. Conta e responsabilidades do usuário</h2>
          <ul className="list-disc pl-6">
            <li>Você é responsável pela veracidade dos dados informados e pela guarda das suas credenciais.</li>
            <li>Você é o controlador dos dados dos seus clientes finais e deve tratá-los conforme a lei, obtendo consentimentos quando aplicável.</li>
            <li>É proibido usar o serviço para spam, mensagens ilícitas, conteúdo enganoso ou qualquer violação das políticas do WhatsApp.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold">4. Planos, teste e pagamento</h2>
          <p>
            Oferecemos um período de teste gratuito e planos pagos com cobrança recorrente via Mercado Pago.
            Os valores e limites de cada plano são exibidos no aplicativo. A falta de pagamento pode suspender
            o acesso às funcionalidades. Você pode cancelar a assinatura a qualquer momento; o cancelamento
            interrompe renovações futuras.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">5. Uso de IA</h2>
          <p>
            As respostas são geradas por modelos de inteligência artificial e podem conter imprecisões. O dono
            do negócio é responsável por revisar e validar informações críticas (preços, disponibilidade,
            condições). O AgendaBot não se responsabiliza por decisões tomadas com base exclusivamente nas
            respostas automáticas.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">6. Cancelamento e exclusão</h2>
          <p>
            Você pode excluir sua conta e todos os dados associados diretamente no aplicativo
            (Configurações → Excluir conta). A exclusão é permanente e irreversível.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">7. Limitação de responsabilidade</h2>
          <p>
            Na máxima extensão permitida em lei, o AgendaBot não responde por danos indiretos, lucros cessantes
            ou indisponibilidades decorrentes de serviços de terceiros (WhatsApp/Evolution, Mercado Pago, Google,
            provedores de IA e nuvem).
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">8. Alterações e foro</h2>
          <p>
            Podemos atualizar estes Termos; a data acima indica a última revisão. Fica eleito o foro da comarca
            de <strong>[CIDADE/UF]</strong> para dirimir controvérsias. Contato:
            <strong> [contato@agendabot.com.br]</strong>.
          </p>
        </section>
      </div>
    </main>
  )
}
