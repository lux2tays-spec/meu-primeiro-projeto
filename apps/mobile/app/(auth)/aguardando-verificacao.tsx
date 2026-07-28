import { useEffect, useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
} from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { Button } from '@/components/ui/Button'
import { BrandLogo } from '@/components/BrandLogo'
import { authApi } from '@/lib/api'
import { useToast } from '@/lib/toast'
import { colors, font, spacing } from '@/lib/theme'

const RESEND_COOLDOWN_SECONDS = 30

export default function AguardandoVerificacaoScreen() {
  const { email } = useLocalSearchParams<{ email?: string }>()
  const [sending, setSending] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const toast = useToast()

  // Countdown do cooldown de reenvio (evita spam de e-mails).
  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setInterval(() => setCooldown((s) => (s > 0 ? s - 1 : 0)), 1000)
    return () => clearInterval(timer)
  }, [cooldown > 0])

  async function handleResend() {
    if (!email) {
      toast.show('E-mail não identificado. Volte e faça login para reenviar.', 'error')
      return
    }
    setSending(true)
    try {
      await authApi.resendVerification(email)
      toast.show('Enviamos um novo link de confirmação. Confira sua caixa de entrada e o spam.', 'success')
      setCooldown(RESEND_COOLDOWN_SECONDS)
    } catch {
      // Never surface raw errors to the user — friendly retry message only.
      toast.show('Não foi possível reenviar agora. Tente novamente em instantes.', 'error')
    } finally {
      setSending(false)
    }
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <BrandLogo variant="mark" size={72} />
          <View style={styles.iconWrap}>
            <Ionicons name="mail-outline" size={28} color={colors.primary} />
          </View>
          <Text style={styles.title}>Verifique seu e-mail</Text>
          <Text style={styles.subtitle}>
            Enviamos um link para{' '}
            <Text style={styles.emailText}>{email ?? 'seu e-mail'}</Text>.
            {' '}Confirme para entrar.
          </Text>
        </View>

        <View style={styles.form}>
          <View style={styles.infoBox}>
            <Text style={styles.infoText}>
              Clique no link que enviamos para confirmar seu e-mail e ativar sua conta.
            </Text>
            <Text style={styles.infoHint}>
              Não recebeu? Verifique a pasta de spam ou lixo eletrônico.
            </Text>
          </View>

          <Button
            label={cooldown > 0 ? `Reenviar e-mail (${cooldown}s)` : 'Reenviar e-mail'}
            variant="outline"
            onPress={handleResend}
            loading={sending}
            disabled={sending || cooldown > 0}
          />
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>Já confirmou? </Text>
          <TouchableOpacity onPress={() => router.replace('/(auth)/login')}>
            <Text style={styles.link}>Entrar</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { flexGrow: 1, padding: spacing.lg, justifyContent: 'center', gap: spacing.xl },
  header: { alignItems: 'center', gap: spacing.sm },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: font.title, fontWeight: '800', color: colors.text },
  subtitle: { fontSize: font.md, color: colors.textSecondary, textAlign: 'center', lineHeight: 22 },
  emailText: { color: colors.text, fontWeight: '600' },
  form: { gap: spacing.md },
  infoBox: {
    backgroundColor: '#ECFDF5',
    borderRadius: 12,
    padding: spacing.md,
    gap: spacing.xs,
  },
  infoText: { color: '#047857', fontSize: font.md, lineHeight: 20 },
  infoHint: { color: '#047857', fontSize: font.sm, lineHeight: 18, opacity: 0.85 },
  footer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  footerText: { color: colors.textSecondary, fontSize: font.md },
  link: { color: colors.primary, fontSize: font.md, fontWeight: '600' },
})
