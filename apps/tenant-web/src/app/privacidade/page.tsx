import Link from 'next/link'

export const metadata = {
  title: 'Política de Privacidade — AiConfirma',
  description: 'Como o AiConfirma coleta, usa, compartilha e protege dados pessoais, conforme a LGPD.',
}

// NOTA: preencha os campos entre colchetes com os dados reais da empresa
// controladora ([RAZÃO SOCIAL], [CNPJ], e-mail do encarregado) antes de publicar.
// Recomenda-se revisão jurídica. Última atualização: 11 de julho de 2026.

export default function PrivacidadePage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 text-gray-800">
      <Link href="/" className="text-sm text-primary hover:underline">← Voltar</Link>
      <h1 className="mt-4 text-3xl font-bold text-gray-900">Política de Privacidade</h1>
      <p className="mt-2 text-sm text-gray-500">Última atualização: 11 de julho de 2026</p>

      <div className="prose prose-sm mt-8 max-w-none space-y-6 leading-relaxed">
        <section>
          <h2 className="text-xl font-semibold">1. Quem somos</h2>
          <p>
            O AiConfirma é uma plataforma que oferece assistentes de atendimento por WhatsApp com
            inteligência artificial para pequenos negócios. O controlador dos dados tratados nesta
            plataforma é <strong>[RAZÃO SOCIAL], CNPJ [CNPJ]</strong> (&quot;AiConfirma&quot;, &quot;nós&quot;).
            Dúvidas sobre privacidade e exercício de direitos: <strong>[encarregado@aiconfirma.com.br]</strong>.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">2. Papéis (LGPD)</h2>
          <p>
            Em relação aos dados dos <strong>donos de negócio</strong> (nossos clientes/usuários do app),
            atuamos como <strong>controlador</strong>. Em relação aos dados dos <strong>clientes finais</strong>
            que conversam com o negócio pelo WhatsApp, o dono do negócio é o <strong>controlador</strong> e o
            AiConfirma atua como <strong>operador</strong>, tratando os dados conforme as instruções dele e desta
            política.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">3. Dados que coletamos e finalidades</h2>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-2 pr-4">Dado</th>
                  <th className="py-2 pr-4">Titular</th>
                  <th className="py-2 pr-4">Finalidade</th>
                  <th className="py-2">Base legal</th>
                </tr>
              </thead>
              <tbody className="align-top">
                <tr className="border-b"><td className="py-2 pr-4">Nome, e-mail, telefone, senha (hash)</td><td className="py-2 pr-4">Dono do negócio</td><td className="py-2 pr-4">Criar e autenticar a conta</td><td className="py-2">Execução de contrato</td></tr>
                <tr className="border-b"><td className="py-2 pr-4">Dados de assinatura (identificador de pagamento)</td><td className="py-2 pr-4">Dono do negócio</td><td className="py-2 pr-4">Cobrança recorrente</td><td className="py-2">Execução de contrato</td></tr>
                <tr className="border-b"><td className="py-2 pr-4">Nome, telefone, e-mail do cliente final</td><td className="py-2 pr-4">Cliente final</td><td className="py-2 pr-4">Agendamento e atendimento</td><td className="py-2">Legítimo interesse do negócio</td></tr>
                <tr className="border-b"><td className="py-2 pr-4">Conteúdo das mensagens de WhatsApp</td><td className="py-2 pr-4">Cliente final</td><td className="py-2 pr-4">Responder via IA e manter histórico</td><td className="py-2">Legítimo interesse do negócio</td></tr>
                <tr className="border-b"><td className="py-2 pr-4">Tokens do Google Calendar</td><td className="py-2 pr-4">Dono do negócio</td><td className="py-2 pr-4">Sincronizar agendamentos</td><td className="py-2">Consentimento</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 className="text-xl font-semibold">4. Com quem compartilhamos</h2>
          <p>Compartilhamos dados apenas com operadores necessários à prestação do serviço:</p>
          <ul className="list-disc pl-6">
            <li><strong>Anthropic (Claude)</strong> — processamento das mensagens pela IA (transferência internacional, EUA).</li>
            <li><strong>Evolution API</strong> — envio e recebimento de mensagens de WhatsApp.</li>
            <li><strong>Mercado Pago</strong> — processamento de pagamentos e assinaturas.</li>
            <li><strong>Google</strong> — sincronização de agenda (quando ativada pelo usuário).</li>
            <li><strong>Provedor de nuvem/armazenamento</strong> — hospedagem e arquivamento do histórico.</li>
          </ul>
          <p>Não vendemos dados pessoais. Há transferência internacional para os EUA (Anthropic), com salvaguardas contratuais.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">5. Retenção</h2>
          <p>
            Mantemos os dados enquanto a conta estiver ativa. Mensagens e histórico de atendimento são
            mantidos pelo período necessário à finalidade e depois anonimizados ou eliminados. Após o
            encerramento da conta, os dados são eliminados em até 90 dias, salvo obrigação legal de guarda.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">6. Segurança</h2>
          <p>
            Adotamos medidas técnicas e organizacionais: criptografia em trânsito (HTTPS/TLS), senhas
            armazenadas com hash forte (scrypt), criptografia de tokens sensíveis em repouso, isolamento
            de dados por cliente e controle de acesso por função.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">7. Seus direitos (LGPD, art. 18)</h2>
          <p>
            Você pode solicitar acesso, correção, portabilidade, anonimização e eliminação dos seus dados,
            além de revogar consentimentos. Donos de negócio podem excluir a conta e todos os dados
            diretamente no aplicativo (Configurações → Excluir conta). Para solicitações de clientes finais
            ou outras requisições, escreva para <strong>[encarregado@aiconfirma.com.br]</strong> — responderemos
            no prazo legal.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">8. Dados de menores</h2>
          <p>
            O aplicativo destina-se a maiores de 18 anos (donos de negócio). Não coletamos intencionalmente
            dados de menores; caso o negócio atenda menores via WhatsApp, cabe a ele obter o consentimento
            adequado dos responsáveis.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">9. Alterações e contato</h2>
          <p>
            Podemos atualizar esta política; a data acima indica a última revisão. Encarregado de Proteção de
            Dados (DPO): <strong>[Nome do Encarregado]</strong> — <strong>[encarregado@aiconfirma.com.br]</strong>.
          </p>
          <p className="mt-4">
            Veja também nossos <Link href="/termos" className="text-primary hover:underline">Termos de Uso</Link>.
          </p>
        </section>
      </div>
    </main>
  )
}
