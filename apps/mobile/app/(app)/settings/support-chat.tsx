import { useRef, useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native'
import { router } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useMutation } from '@tanstack/react-query'
import { supportApi, SupportChatTurn } from '@/lib/api'
import { colors, font, radius, spacing } from '@/lib/theme'

const WELCOME =
  'Olá! Sou o assistente de suporte. Posso ajudar com dúvidas sobre agendamentos, WhatsApp, agente IA, pagamentos e configurações. Como posso ajudar?'

// Quantas mensagens recentes enviamos como contexto para a IA
const HISTORY_LIMIT = 10

export default function SupportChatScreen() {
  const [messages, setMessages] = useState<SupportChatTurn[]>([
    { role: 'assistant', content: WELCOME },
  ])
  const [input, setInput] = useState('')
  const [suggestTicket, setSuggestTicket] = useState(false)
  const [lastError, setLastError] = useState<string | null>(null)
  const scrollRef = useRef<ScrollView>(null)

  const askMutation = useMutation({
    mutationFn: ({ message, history }: { message: string; history: SupportChatTurn[] }) =>
      supportApi.ask(message, history),
    onSuccess: (res) => {
      setMessages((prev) => [...prev, { role: 'assistant', content: res.reply }])
      setSuggestTicket(res.suggest_ticket)
    },
    onError: (e: any) => {
      setLastError(e?.message ?? 'Não foi possível enviar sua mensagem. Tente novamente.')
    },
  })

  function scrollToEnd() {
    // Pequeno atraso para o layout renderizar a nova bolha antes do scroll
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80)
  }

  function send() {
    const text = input.trim()
    if (!text || askMutation.isPending) return
    const history = messages.slice(-HISTORY_LIMIT)
    setMessages((prev) => [...prev, { role: 'user', content: text }])
    setInput('')
    setLastError(null)
    setSuggestTicket(false)
    askMutation.mutate({ message: text, history })
    scrollToEnd()
  }

  function openTicketFromChat() {
    // Contexto: últimas mensagens da conversa (sem a saudação inicial)
    const context = messages
      .slice(1)
      .slice(-HISTORY_LIMIT)
      .map((m) => `${m.role === 'user' ? 'Eu' : 'Assistente'}: ${m.content}`)
      .join('\n\n')
    router.push({
      pathname: '/(app)/settings/ticket-new',
      params: { context },
    })
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={styles.messages}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        >
          {messages.map((m, i) => (
            <View
              key={i}
              style={[styles.bubble, m.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant]}
            >
              <Text style={m.role === 'user' ? styles.bubbleUserText : styles.bubbleAssistantText}>
                {m.content}
              </Text>
            </View>
          ))}

          {askMutation.isPending && (
            <View style={[styles.bubble, styles.bubbleAssistant, styles.typingBubble]}>
              <ActivityIndicator size="small" color={colors.textSecondary} />
              <Text style={styles.typingText}>Digitando…</Text>
            </View>
          )}

          {lastError && !askMutation.isPending && (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle-outline" size={16} color={colors.danger} />
              <Text style={styles.errorText}>{lastError}</Text>
            </View>
          )}

          {suggestTicket && !askMutation.isPending && (
            <TouchableOpacity style={styles.ticketCta} activeOpacity={0.85} onPress={openTicketFromChat}>
              <Ionicons name="help-buoy-outline" size={20} color="#fff" />
              <View style={{ flex: 1 }}>
                <Text style={styles.ticketCtaTitle}>Abrir chamado</Text>
                <Text style={styles.ticketCtaSub}>
                  Envie esta conversa para nossa equipe resolver com você
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#fff" />
            </TouchableOpacity>
          )}
        </ScrollView>

        <View style={styles.inputBar}>
          <TextInput
            style={styles.input}
            placeholder="Escreva sua dúvida…"
            placeholderTextColor={colors.textDisabled}
            value={input}
            onChangeText={setInput}
            multiline
            onFocus={scrollToEnd}
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!input.trim() || askMutation.isPending) && styles.sendBtnDisabled]}
            onPress={send}
            disabled={!input.trim() || askMutation.isPending}
            activeOpacity={0.8}
          >
            <Ionicons name="send" size={18} color="#fff" />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  messages: { padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.lg },
  bubble: {
    maxWidth: '82%',
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  bubbleUser: {
    alignSelf: 'flex-end',
    backgroundColor: colors.primary,
    borderBottomRightRadius: radius.sm,
  },
  bubbleAssistant: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderBottomLeftRadius: radius.sm,
  },
  bubbleUserText: { color: '#fff', fontSize: font.md, lineHeight: 21 },
  bubbleAssistantText: { color: colors.text, fontSize: font.md, lineHeight: 21 },
  typingBubble: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  typingText: { color: colors.textSecondary, fontSize: font.sm },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'center',
    paddingVertical: spacing.xs,
  },
  errorText: { color: colors.danger, fontSize: font.sm, flexShrink: 1 },
  ticketCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primaryDark,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.xs,
  },
  ticketCtaTitle: { color: '#fff', fontSize: font.md, fontWeight: '700' },
  ticketCtaSub: { color: 'rgba(255,255,255,0.85)', fontSize: font.sm, marginTop: 2 },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingTop: 11,
    paddingBottom: 11,
    fontSize: font.md,
    color: colors.text,
    backgroundColor: colors.background,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.5 },
})
