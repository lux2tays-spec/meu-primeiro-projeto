import { useRef, useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/lib/toast'
import { supportApi, SupportTicketMessage } from '@/lib/api'
import { colors, font, radius, spacing } from '@/lib/theme'

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return (
    d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) +
    ' ' +
    d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  )
}

export default function TicketDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const queryClient = useQueryClient()
  const toast = useToast()
  const [reply, setReply] = useState('')
  const scrollRef = useRef<ScrollView>(null)

  const { data: ticket, isLoading, isError, refetch } = useQuery({
    queryKey: ['support', 'ticket', id],
    queryFn: () => supportApi.ticket(id!),
    enabled: !!id,
  })

  const replyMutation = useMutation({
    mutationFn: (body: string) => supportApi.replyTicket(id!, body),
    onSuccess: () => {
      setReply('')
      queryClient.invalidateQueries({ queryKey: ['support', 'ticket', id] })
      queryClient.invalidateQueries({ queryKey: ['support', 'tickets'] })
    },
    onError: (e: any) => {
      toast.show(e?.message ?? 'Não foi possível enviar a resposta. Tente novamente.', 'error')
    },
  })

  function send() {
    const body = reply.trim()
    if (!body || replyMutation.isPending) return
    replyMutation.mutate(body)
  }

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={[]}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    )
  }

  if (isError || !ticket) {
    return (
      <SafeAreaView style={styles.container} edges={[]}>
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={40} color={colors.textDisabled} />
          <Text style={styles.stateTitle}>Não foi possível carregar o chamado</Text>
          <Button label="Tentar novamente" variant="outline" onPress={() => refetch()} style={styles.retryBtn} />
        </View>
      </SafeAreaView>
    )
  }

  const isOpen = ticket.status === 'open'
  const isHigh = ticket.priority === 'high' || (ticket.priority as string) === 'alta'

  function renderMessage(m: SupportTicketMessage) {
    const isUser = m.sender === 'user'
    return (
      <View key={m.id} style={[styles.bubbleWrap, isUser ? styles.bubbleWrapUser : styles.bubbleWrapAdmin]}>
        {!isUser && (
          <View style={styles.adminTag}>
            <Ionicons name="headset-outline" size={12} color={colors.primaryDark} />
            <Text style={styles.adminTagText}>Equipe de suporte</Text>
          </View>
        )}
        <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAdmin]}>
          <Text style={isUser ? styles.bubbleUserText : styles.bubbleAdminText}>{m.body}</Text>
        </View>
        <Text style={styles.bubbleTime}>{formatDateTime(m.created_at)}</Text>
      </View>
    )
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        <View style={styles.header}>
          <Text style={styles.subject} numberOfLines={2}>{ticket.subject}</Text>
          <View style={styles.headerBadges}>
            <Badge label={isOpen ? 'Aberto' : 'Resolvido'} variant={isOpen ? 'warning' : 'success'} />
            {isHigh && <Badge label="Prioridade alta" variant="danger" />}
            <Text style={styles.headerDate}>Criado em {formatDateTime(ticket.created_at)}</Text>
          </View>
        </View>

        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={styles.messages}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
        >
          {ticket.messages.map(renderMessage)}

          {!isOpen && (
            <View style={styles.resolvedBanner}>
              <Ionicons name="checkmark-circle-outline" size={16} color={colors.success} />
              <Text style={styles.resolvedText}>
                Este chamado foi resolvido. Se precisar, responda abaixo para reabrir o assunto.
              </Text>
            </View>
          )}
        </ScrollView>

        <View style={styles.inputBar}>
          <TextInput
            style={styles.input}
            placeholder="Escreva uma resposta…"
            placeholderTextColor={colors.textDisabled}
            value={reply}
            onChangeText={setReply}
            multiline
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!reply.trim() || replyMutation.isPending) && styles.sendBtnDisabled]}
            onPress={send}
            disabled={!reply.trim() || replyMutation.isPending}
            activeOpacity={0.8}
          >
            {replyMutation.isPending ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons name="send" size={18} color="#fff" />
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.lg },
  stateTitle: { fontSize: font.md, fontWeight: '600', color: colors.textSecondary, textAlign: 'center' },
  retryBtn: { marginTop: spacing.sm, alignSelf: 'stretch' },
  header: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.xs,
  },
  subject: { fontSize: font.lg, fontWeight: '700', color: colors.text },
  headerBadges: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  headerDate: { fontSize: font.sm, color: colors.textDisabled },
  messages: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.lg },
  bubbleWrap: { maxWidth: '84%', gap: 3 },
  bubbleWrapUser: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  bubbleWrapAdmin: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  adminTag: { flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 4 },
  adminTagText: { fontSize: font.sm, fontWeight: '600', color: colors.primaryDark },
  bubble: {
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  bubbleUser: { backgroundColor: colors.primary, borderBottomRightRadius: radius.sm },
  bubbleAdmin: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderBottomLeftRadius: radius.sm,
  },
  bubbleUserText: { color: '#fff', fontSize: font.md, lineHeight: 21 },
  bubbleAdminText: { color: colors.text, fontSize: font.md, lineHeight: 21 },
  bubbleTime: { fontSize: 11, color: colors.textDisabled, marginHorizontal: 4 },
  resolvedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: '#DCFCE7',
    borderRadius: radius.md,
    padding: spacing.md,
  },
  resolvedText: { flex: 1, fontSize: font.sm, color: '#166534', lineHeight: 18 },
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
