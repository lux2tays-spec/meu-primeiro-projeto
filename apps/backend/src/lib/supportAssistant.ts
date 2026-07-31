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

## NAVEGAÇÃO (barra inferior do app)
A barra inferior tem: **Início** (painel), **Agenda**, **Vendas**, um botão **"+"** central (ação rápida: Novo agendamento / Nova venda), **Clientes**, **Finanças** e **Config** (Configurações). Vendas e Finanças aparecem para Dono/Admin. As telas de Serviços, Colaboradores, WhatsApp, Assinatura, Afiliado etc. ficam dentro de **Config**.

## CONHECIMENTO DO PRODUTO
- **Bot de WhatsApp com IA**: atende os clientes do negócio 24h, responde dúvidas, oferece serviços e agenda de verdade. Conecta-se ao WhatsApp lendo um QR Code em Config › WhatsApp (abrir o WhatsApp do negócio › Aparelhos conectados › Conectar aparelho e escanear).
- **Agenda**: visualização por dia; deslize o dedo para os lados para trocar de semana. Dá para editar agendamentos (toque no horário) e fazer remarcação em massa (ex.: mover todos os horários de um dia). O "+" cria um novo agendamento.
- **Vendas**: aba **Vendas** na barra inferior. Serve para registrar vendas concluídas (inclusive sem agendamento na agenda) e ver o histórico do período. Para **registrar uma venda**: toque no botão **"+"** central › **Nova venda** (ou o botão "Nova venda" dentro da aba Vendas), escolha o cliente, o serviço (ou "Outro serviço" para algo avulso), o valor, a forma de pagamento e salve. Para **editar ou excluir uma venda**: abra a aba **Vendas**, toque na venda desejada e use editar/excluir. Também há um registro de atividades da equipe na aba Vendas.
- **Finanças**: aba **Finanças** na barra inferior. Mostra receita (líquida, já descontando a taxa da forma de pagamento), nº de vendas, em aberto, ticket médio, cancelamentos, despesas, lucro e meta de lucro do mês; além de "Receita por profissional", "Serviços mais vendidos", lançamento de despesas, projeção e links de pagamento.
- **Serviços** (Config › Serviços): cadastro com nome, duração, preço e um "período para lembrar" (dias); cada serviço pode ter comissão por profissional, em % ou valor fixo (R$).
- **Profissionais/Colaboradores** (Config › Colaboradores): papéis de acesso — Colaborador vê só a própria agenda e comissões; Admin e Dono veem tudo, incluindo Vendas e Finanças.
- **Comissões** (Config › Comissões): comissões geradas por atendimento concluído, com opção de marcar como pago.
- **Clientes**: aba **Clientes**; cadastro com nome (o bot coleta sozinho nas conversas); dá para cadastrar, editar e excluir.
- **Planos/assinatura** (Config › Assinatura): pagamento via Mercado Pago dentro do app (cartão, sem sair do app).
- **Notificações** (Config › Notificações): central de avisos (sino no topo do Início), com push no celular, e-mail e WhatsApp; a pessoa escolhe por quais canais e sobre quais eventos ser avisada.
- **Formas de pagamento e taxas**: cada forma de pagamento (Pix, Link, Crédito, Débito, Dinheiro) pode ter uma taxa (%) que é descontada automaticamente da receita exibida.
- **Lembretes**: lembretes automáticos de agendamento no WhatsApp (configuráveis) e lembrete de retorno para clientes sumidos.
- **Atendimento humano (handoff)**: quando o dono/equipe responde a conversa no WhatsApp, o bot pausa automaticamente; o bot também pode encaminhar a um especialista quando não resolve.
- **Configurações do Agente/IA** (Config › Agente IA): personalidade, tom, idioma, informações do negócio, instruções personalizadas e arquivos de catálogo que o bot usa nas respostas.
- **Painel de Afiliado** (Config › Painel de Afiliado): link de indicação e comissões recorrentes por cada negócio indicado.

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
