import { useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, KeyboardAvoidingView,
  Platform, TouchableOpacity,
} from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { useAuthStore } from '@/lib/store'
import { authApi, googleApi } from '@/lib/api'
import { useToast } from '@/lib/toast'
import { colors, font, spacing } from '@/lib/theme'

function validateEmail(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
}

type FormErrors = {
  name?: string
  email?: string
  password?: string
  business_name?: string
}

export default function RegisterScreen() {
  const { id_token: googleIdToken } = useLocalSearchParams<{ id_token?: string }>()
  const isGoogleFlow = !!googleIdToken

  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    business_name: '',
    referral_code: '',
  })
  const [errors, setErrors] = useState<FormErrors>({})
  const [loading, setLoading] = useState(false)
  const setAuth = useAuthStore((s) => s.setAuth)
  const toast = useToast()

  function setField(key: keyof typeof form) {
    return (value: string) => {
      setForm((f) => ({ ...f, [key]: value }))
      if (errors[key as keyof FormErrors]) setErrors((e) => ({ ...e, [key]: undefined }))
    }
  }

  function validate() {
    const e: FormErrors = {}
    if (!form.business_name.trim()) e.business_name = 'Informe o nome do estabelecimento'
    if (!isGoogleFlow) {
      if (!form.name.trim()) e.name = 'Informe seu nome'
      if (!form.email.trim()) e.email = 'Informe seu e-mail'
      else if (!validateEmail(form.email)) e.email = 'E-mail inválido'
      if (!form.password) e.password = 'Informe uma senha'
      else if (form.password.length < 8) e.password = 'A senha deve ter pelo menos 8 caracteres'
    }
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function handleRegister() {
    if (!validate()) return
    setLoading(true)
    try {
      let token: string
      if (isGoogleFlow) {
        const res = await googleApi.loginWithIdToken(
          googleIdToken!,
          form.business_name,
          form.referral_code || undefined,
        )
        token = res.token
      } else {
        const res = await authApi.register({
          ...form,
          email: form.email.trim().toLowerCase(),
          referral_code: form.referral_code || undefined,
        })
        token = res.token
      }
      await setAuth(token)
      router.replace('/(app)')
    } catch (err: any) {
      const msg: string = err.message ?? ''
      if (msg.toLowerCase().includes('email') || msg.toLowerCase().includes('e-mail')) {
        setErrors((e) => ({ ...e, email: 'Este e-mail já está em uso' }))
      } else {
        toast.show(msg || 'Não foi possível criar a conta. Tente novamente.', 'error')
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
          <TouchableOpacity onPress={() => router.back()} style={styles.back}>
            <Text style={styles.backText}>← Voltar</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Criar conta</Text>
          <Text style={styles.subtitle}>5 dias grátis, sem cartão de crédito</Text>
        </View>

        <View style={styles.form}>
          {isGoogleFlow && (
            <View style={styles.googleBadge}>
              <Text style={styles.googleBadgeText}>
                ✓ Conta Google vinculada — só precisamos do nome do seu negócio
              </Text>
            </View>
          )}

          {!isGoogleFlow && (
            <Input
              label="Seu nome *"
              value={form.name}
              onChangeText={setField('name')}
              placeholder="Maria Silva"
              autoCapitalize="words"
              error={errors.name}
            />
          )}

          <Input
            label="Nome do estabelecimento *"
            value={form.business_name}
            onChangeText={setField('business_name')}
            placeholder="Clínica Bella, Pet Shop do João..."
            error={errors.business_name}
          />

          {!isGoogleFlow && (
            <>
              <Input
                label="E-mail *"
                value={form.email}
                onChangeText={setField('email')}
                placeholder="seu@email.com"
                keyboardType="email-address"
                autoCapitalize="none"
                error={errors.email}
              />
              <Input
                label="Senha *"
                value={form.password}
                onChangeText={setField('password')}
                placeholder="Mínimo 8 caracteres"
                secureTextEntry
                error={errors.password}
              />
            </>
          )}

          <Input
            label="Código de indicação (opcional)"
            value={form.referral_code}
            onChangeText={setField('referral_code')}
            placeholder="AMIGO123"
            autoCapitalize="characters"
          />

          <Button label="Criar conta grátis" onPress={handleRegister} loading={loading} />

          <Text style={styles.terms}>
            Ao criar sua conta você concorda com nossos Termos de Uso e Política de Privacidade.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { flexGrow: 1, padding: spacing.lg, gap: spacing.xl },
  header: { gap: spacing.xs, paddingTop: spacing.xl },
  back: { alignSelf: 'flex-start', marginBottom: spacing.sm },
  backText: { color: colors.primary, fontSize: font.md },
  title: { fontSize: font.xxl + 4, fontWeight: '800', color: colors.text },
  subtitle: { fontSize: font.md, color: colors.textSecondary },
  form: { gap: spacing.md },
  terms: { fontSize: font.sm, color: colors.textSecondary, textAlign: 'center', lineHeight: 18 },
  googleBadge: { backgroundColor: '#DCFCE7', borderRadius: 10, padding: spacing.md },
  googleBadgeText: { fontSize: font.sm, color: '#166534', lineHeight: 20 },
})
