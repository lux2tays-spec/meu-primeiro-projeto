import { useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  KeyboardAvoidingView, Platform,
} from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/lib/toast'
import { supportApi, SupportTicketPriority } from '@/lib/api'
import { colors, font, radius, spacing } from '@/lib/theme'

export default function TicketNewScreen() {
  // `context` chega preenchido quando o chamado é aberto a partir do chat com a IA
  const { context } = useLocalSearchParams<{ context?: string }>()
  const queryClient = useQueryClient()
  const toast = useToast()

  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState(
    context ? `Contexto da conversa com o assistente:\n\n${context}\n\n---\n\n` : ''
  )
  const [priority, setPriority] = useState<SupportTicketPriority>('normal')
  const [errors, setErrors] = useState<{ subject?: string; message?: string }>({})

  const createMutation = useMutation({
    mutationFn: () => supportApi.createTicket({ subject: subject.trim(), message: message.trim(), priority }),
    onSuccess: (ticket) => {
      queryClient.invalidateQueries({ queryKey: ['support', 'tickets'] })
      toast.show('Chamado aberto! Nossa equipe vai responder em breve.', 'success')
      if (ticket?.id) {
        router.replace({ pathname: '/(app)/settings/ticket/[id]', params: { id: ticket.id } })
      } else {
        router.back()
      }
    },
    onError: (e: any) => {
      toast.show(e?.message ?? 'Não foi possível abrir o chamado. Tente novamente.', 'error')
    },
  })

  function submit() {
    const nextErrors: typeof errors = {}
    if (!subject.trim()) nextErrors.subject = 'Informe o assunto do chamado'
    if (!message.trim()) nextErrors.message = 'Descreva o que está acontecendo'
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return
    createMutation.mutate()
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Input
            label="Assunto"
            placeholder="Ex: WhatsApp não conecta"
            value={subject}
            onChangeText={(v) => { setSubject(v); if (errors.subject) setErrors((e) => ({ ...e, subject: undefined })) }}
            error={errors.subject}
            maxLength={120}
          />

          <Input
            label="Mensagem"
            placeholder="Descreva o problema ou a dúvida com detalhes"
            value={message}
            onChangeText={(v) => { setMessage(v); if (errors.message) setErrors((e) => ({ ...e, message: undefined })) }}
            error={errors.message}
            multiline
            textAlignVertical="top"
            style={styles.messageInput}
          />

          <View style={styles.priorityBlock}>
            <Text style={styles.priorityLabel}>Prioridade</Text>
            <View style={styles.priorityRow}>
              <TouchableOpacity
                style={[styles.priorityChip, priority === 'normal' && styles.priorityChipActive]}
                onPress={() => setPriority('normal')}
                activeOpacity={0.7}
              >
                <Text style={[styles.priorityChipText, priority === 'normal' && styles.priorityChipTextActive]}>
                  Normal
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.priorityChip, priority === 'high' && styles.priorityChipActiveHigh]}
                onPress={() => setPriority('high')}
                activeOpacity={0.7}
              >
                <Text style={[styles.priorityChipText, priority === 'high' && styles.priorityChipTextActiveHigh]}>
                  Alta
                </Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.priorityHint}>
              Use "Alta" apenas quando o atendimento aos seus clientes estiver parado.
            </Text>
          </View>

          <Button label="Abrir chamado" onPress={submit} loading={createMutation.isPending} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.lg },
  messageInput: { height: 160, paddingTop: 14 },
  priorityBlock: { gap: spacing.xs },
  priorityLabel: { fontSize: font.sm, fontWeight: '500', color: colors.text },
  priorityRow: { flexDirection: 'row', gap: spacing.sm },
  priorityChip: {
    flex: 1,
    height: 44,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  priorityChipActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  priorityChipActiveHigh: { borderColor: colors.warning, backgroundColor: '#FEF3C7' },
  priorityChipText: { fontSize: font.md, fontWeight: '600', color: colors.textSecondary },
  priorityChipTextActive: { color: colors.primary },
  priorityChipTextActiveHigh: { color: colors.warning },
  priorityHint: { fontSize: font.sm, color: colors.textDisabled, lineHeight: 18 },
})
