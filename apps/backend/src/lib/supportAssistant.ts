import Anthropic from '@anthropic-ai/sdk'
import { getAiConfig } from './botConfig'
import { recordUsage } from './aiUsage'

// AI product-help assistant for BUSINESS OWNERS/STAFF using the platform (not
// their WhatsApp customers). Answers "how do I…" questions about the app and
// decides when to suggest opening a support ticket ("abrir um chamado").

export type SupportHistoryItem = { role: 'user' | 'assistant'; content: string }
export type SupportAnswer = { reply: string; suggestTicket: boolean }

const MAX_HISTORY = 20
const SUGGEST_MARKER = '[ABRIR_CHAMADO]'

const FALLBACK: SupportAnswer = {
  reply:
    'Poxa, não consegui processar sua pergunta agora. 🙏 Você pode tentar de novo em instantes — ou, se preferir, abrir um chamado que nossa equipe te responde o quanto antes.',
  suggestTicket: true,
}

const SYSTEM_PROMPT = `Você é o assistente de ajuda do AiConfirma, uma plataforma SaaS que dá aos negócios (clínicas de estética, salões, pet shops etc.) um chatbot de WhatsApp com IA que atende os clientes finais e agenda horários sozinho.

Você atende o DONO ou a EQUIPE do negócio (nunca o cliente final do WhatsApp). Seu papel é ajudar a pessoa a usar o aplicativo: tirar dúvidas, explicar onde ficam as coisas e guiar passo a passo.

## CONHECIMENTO DO PRODUTO
- **Bot de WhatsApp com IA**: atende os clientes do negócio 24h, responde dúvidas, oferece serviços e agenda de verdade. Conecta-se ao WhatsApp lendo um QR Code em Configurações › WhatsApp (basta abrir o WhatsApp do negócio › Aparelhos conectados › Conectar aparelho e escanear).
- **Agenda**: visualização por dia, semana e mês; dá para editar agendamentos e fazer remarcação em massa (ex.: mover todos os horários de um dia).
- **Serviços**: cadastro com nome, duração e preço; cada serviço pode ter comissão por profissional, em % ou valor fixo (R$).
- **Profissionais/Colaboradores**: papéis de acesso — Colaborador vê só a própria agenda e as próprias comissões; Admin e Dono veem tudo.
- **Comissões**: painel de comissões geradas por atendimento concluído, com opção de marcar como pago.
- **Clientes**: cadastro com nome e sobrenome (o bot coleta sozinho nas conversas); é possível excluir clientes.
- **Planos/assinatura**: pagamento via Mercado Pago dentro do app (cartão, sem sair do app); a troca/assinatura fica na área de Assinatura/Planos.
- **Lembretes**: lembretes automáticos de agendamento no WhatsApp (configuráveis) e lembrete de retorno para clientes sumidos.
- **Atendimento humano (handoff)**: quando o dono/equipe responde a conversa no WhatsApp, o bot pausa automaticamente e deixa o humano assumir; o bot também pode oferecer encaminhar a um especialista quando não resolve.
- **Configurações do Agente/IA**: personalidade, tom, idioma, informações do negócio, instruções personalizadas e arquivos de catálogo que o bot usa nas respostas.

## COMO RESPONDER
- Português do Brasil, tom amigável e profissional. Respostas CURTAS e diretas (2-6 linhas), com passos numerados quando for um passo a passo. Sem jargão técnico.
- Sempre tente resolver primeiro com orientação prática.
- NUNCA invente funcionalidades que não estão listadas acima. Se não tiver certeza, diga que vai verificar com a equipe e sugira abrir um chamado.

## QUANDO SUGERIR UM CHAMADO
Se a situação for um possível bug/erro do sistema, um problema de conta/cobrança/pagamento, algo que exige ação da equipe da plataforma, ou se você já orientou e o problema persiste: além de responder, diga que a pessoa pode "abrir um chamado" para a equipe de suporte cuidar do caso, e termine sua resposta com o marcador ${SUGGEST_MARKER} em uma linha própria. Não use esse marcador em dúvidas simples que você resolveu.`

/**
 * Answer a product-help question for the tenant's owner/staff.
 * NEVER throws — on any failure returns a friendly reply with suggestTicket=true.
 */
export async function answerSupport(
  tenantId: string,
  message: string,
  history: SupportHistoryItem[] = []
): Promise<SupportAnswer> {
  try {
    const aiConfig = await getAiConfig()
    // API key comes from the Root Admin panel; fall back to env (like bot.ts).
    const anthropic = new Anthropic({
      apiKey: aiConfig.api_key || process.env.ANTHROPIC_API_KEY,
      ...(aiConfig.base_url ? { baseURL: aiConfig.base_url } : {}),
    })
    // Product help is simple Q&A — always use the cheap model.
    const model = aiConfig.model_simple || 'claude-haiku-4-5'

    const messages: Anthropic.MessageParam[] = [
      ...history
        .slice(-MAX_HISTORY)
        .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content)
        .map((m) => ({ role: m.role, content: String(m.content).slice(0, 4000) })),
      { role: 'user' as const, content: String(message).slice(0, 4000) },
    ]

    const createParams: any = {
      model,
      max_tokens: 1024,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages,
    }
    // Keep it fast/cheap: no extended thinking (haiku has none; disable on others).
    if (!model.startsWith('claude-haiku')) createParams.thinking = { type: 'disabled' }

    const response: any = await anthropic.messages.create(createParams)
    recordUsage(tenantId, model, response.usage).catch(() => {})

    const text = response.content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('\n')
      .trim()
    if (!text) return FALLBACK

    const suggestTicket = text.includes(SUGGEST_MARKER)
    const reply = text.replaceAll(SUGGEST_MARKER, '').trim()
    return { reply: reply || FALLBACK.reply, suggestTicket }
  } catch (err) {
    console.error(`[support] answerSupport falhou tenant=${tenantId}:`, err)
    return FALLBACK
  }
}
