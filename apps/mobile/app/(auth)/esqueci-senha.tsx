import { useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, KeyboardAvoidingView,
  Platform, TouchableOpacity,
} from 'react-native'
import { router } from 'expo-router'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { BrandLogo } from '@/components/BrandLogo'
import { authApi } from '@/lib/api'
import { useToast } from '@/lib/toast'
import { colors, font, spacing } from '@/lib/theme'

function validateEmail(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
}

export default function EsqueciSenhaScreen() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const toast = useToast()

  async function handleSubmit() {
    if (!email) { setError('Informe seu e-mail'); return }
    if (!validateEmail(email)) { setError('E-mail inválido'); return }
    setError(undefined)
    setLoading(true)
    try {
      await authApi.forgotPassword(email.trim().toLowerCase())
      setSent(true)
    } catch {
      // Never surface raw errors to the user — friendly retry message only.
      toast.show('Não foi possível enviar agora. Verifique sua internet e tente novamente.', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <BrandLogo variant="mark" size={72} />
          <Text style={styles.title}>Esqueci minha senha</Text>
          <Text style={styles.subtitle}>
            Informe seu e-mail e enviaremos um link para redefinir a senha
          </Text>
        </View>

        {sent ? (
          <View style={styles.form}>
            <View style={styles.successBox}>
              <Text style={styles.successText}>
                Se o e-mail existir, enviamos um link para redefinir a senha. Confira sua caixa de entrada.
              </Text>
            </View>
            <Button label="Voltar para o login" onPress={() => router.back()} />
          </View>
        ) : (
          <View style={styles.form}>
            <Input
              label="E-mail"
              value={email}
              onChangeText={(v) => { setEmail(v); if (error) setError(undefined) }}
              placeholder="seu@email.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              error={error}
            />
            <Button label="Enviar link" onPress={handleSubmit} loading={loading} />
          </View>
        )}

        <View style={styles.footer}>
          <Text style={styles.footerText}>Lembrou a senha? </Text>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={styles.link}>Fazer login</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { flexGrow: 1, padding: spacing.lg, justifyContent: 'center', gap: spacing.xl },
  header: { alignItems: 'center', gap: spacing.sm },
  title: { fontSize: font.title, fontWeight: '800', color: colors.text },
  subtitle: { fontSize: font.md, color: colors.textSecondary, textAlign: 'center' },
  form: { gap: spacing.md },
  successBox: {
    backgroundColor: '#ECFDF5',
    borderRadius: 12,
    padding: spacing.md,
  },
  successText: { color: '#047857', fontSize: font.md, lineHeight: 20 },
  footer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  footerText: { color: colors.textSecondary, fontSize: font.md },
  link: { color: colors.primary, fontSize: font.md, fontWeight: '600' },
})
