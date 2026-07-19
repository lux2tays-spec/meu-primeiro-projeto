import { useState, useEffect } from 'react'
import {
  View, Text, StyleSheet, ScrollView, KeyboardAvoidingView,
  Platform, TouchableOpacity,
} from 'react-native'
import { router } from 'expo-router'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { BrandLogo } from '@/components/BrandLogo'
import { useAuthStore } from '@/lib/store'
import { authApi, googleApi } from '@/lib/api'
import { useGoogleAuth } from '@/lib/google-auth'
import { useToast } from '@/lib/toast'
import { colors, font, spacing } from '@/lib/theme'

function validateEmail(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
}

export default function LoginScreen() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({})
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const setAuth = useAuthStore((s) => s.setAuth)
  const toast = useToast()

  const [googleRequest, googleResponse, googlePromptAsync] = useGoogleAuth()

  useEffect(() => {
    if (googleResponse?.type !== 'success') return
    const idToken = googleResponse.params?.id_token ?? (googleResponse as any).authentication?.idToken
    if (!idToken) {
      toast.show('Não foi possível obter token do Google', 'error')
      return
    }
    setGoogleLoading(true)
    googleApi.loginWithIdToken(idToken)
      .then(async (res) => {
        if (res.is_new) {
          router.push({ pathname: '/(auth)/register', params: { id_token: idToken } })
          return
        }
        await setAuth(res.token)
        router.replace('/(app)')
      })
      .catch((err) => {
        // Backend returns 422 business_name_required for new Google users — route to
        // the register step so they can name their business (api.post throws on non-2xx).
        if (err?.message === 'business_name_required') {
          router.push({ pathname: '/(auth)/register', params: { id_token: idToken } })
          return
        }
        toast.show(err.message ?? 'Erro ao entrar com Google', 'error')
      })
      .finally(() => setGoogleLoading(false))
  }, [googleResponse])

  function validate() {
    const e: typeof errors = {}
    if (!email) e.email = 'Informe seu e-mail'
    else if (!validateEmail(email)) e.email = 'E-mail inválido'
    if (!password) e.password = 'Informe sua senha'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function handleLogin() {
    if (!validate()) return
    setLoading(true)
    try {
      const { token } = await authApi.login(email.trim().toLowerCase(), password)
      await setAuth(token)
      router.replace('/(app)')
    } catch (err: any) {
      const msg = err.message ?? ''
      if (msg.toLowerCase().includes('senha') || msg.toLowerCase().includes('credencial') || msg.toLowerCase().includes('invalid')) {
        setErrors({ password: 'E-mail ou senha incorretos' })
      } else {
        toast.show(msg || 'Não foi possível entrar. Tente novamente.', 'error')
      }
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
          <BrandLogo variant="full" />
        </View>

        <View style={styles.form}>
          <Button
            label="Continuar com Google"
            onPress={() => googlePromptAsync()}
            loading={googleLoading}
            disabled={!googleRequest}
            variant="outline"
            style={styles.googleBtn}
          />

          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>ou</Text>
            <View style={styles.dividerLine} />
          </View>

          <Input
            label="E-mail"
            value={email}
            onChangeText={(v) => { setEmail(v); if (errors.email) setErrors((e) => ({ ...e, email: undefined })) }}
            placeholder="seu@email.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            error={errors.email}
          />
          <Input
            label="Senha"
            value={password}
            onChangeText={(v) => { setPassword(v); if (errors.password) setErrors((e) => ({ ...e, password: undefined })) }}
            placeholder="••••••••"
            secureTextEntry
            autoComplete="password"
            error={errors.password}
          />
          <TouchableOpacity
            style={styles.forgotLink}
            onPress={() => router.push('/(auth)/esqueci-senha')}
          >
            <Text style={styles.link}>Esqueci minha senha</Text>
          </TouchableOpacity>
          <Button label="Entrar" onPress={handleLogin} loading={loading} />
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>Ainda não tem conta? </Text>
          <TouchableOpacity onPress={() => router.push('/(auth)/register')}>
            <Text style={styles.link}>Criar conta grátis</Text>
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
  form: { gap: spacing.md },
  footer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  footerText: { color: colors.textSecondary, fontSize: font.md },
  link: { color: colors.primary, fontSize: font.md, fontWeight: '600' },
  googleBtn: { borderColor: colors.border },
  forgotLink: { alignSelf: 'flex-end' },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { color: colors.textSecondary, fontSize: font.sm },
})
