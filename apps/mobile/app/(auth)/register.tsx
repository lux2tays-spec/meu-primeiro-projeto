import { useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, KeyboardAvoidingView,
  Platform, TouchableOpacity, Linking,
} from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { useAuthStore } from '@/lib/store'
import { authApi, googleApi } from '@/lib/api'
import { useToast } from '@/lib/toast'
import { colors, font, spacing } from '@/lib/theme'

const WEB_URL = process.env.EXPO_PUBLIC_WEB_URL ?? 'https://aiconfirma.com.br'

function validateEmail(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
}

/** Máscara BR enquanto digita: (11) 99999-9999. Aceita colar com +55 na frente. */
function maskPhoneBR(v: string) {
  let d = v.replace(/\D/g, '')
  // Colou com DDI 55 → remove para exibir no formato local
  if (d.startsWith('55') && d.length > 11) d = d.slice(2)
  d = d.slice(0, 11)
  if (d.length <= 2) return d
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
}

/** Normaliza para o formato do backend/WhatsApp: 55 + DDD + número (só dígitos). */
function normalizePhoneBR(v: string) {
  const d = v.replace(/\D/g, '')
  if (d.startsWith('55') && d.length > 11) return d
  return `55${d}`
}

type FormErrors = {
  name?: string
  email?: string
  password?: string
  password_confirm?: string
  phone?: string
  business_name?: string
}

export default function RegisterScreen() {
  const { id_token: googleIdToken } = useLocalSearchParams<{ id_token?: string }>()
  const isGoogleFlow = !!googleIdToken

  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    password_confirm: '',
    phone: '',
    business_name: '',
    referral_code: '',
  })
  const [errors, setErrors] = useState<FormErrors>({})
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showPasswordConfirm, setShowPasswordConfirm] = useState(false)
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
    // Phone (WhatsApp) is required in BOTH flows (Google and e-mail).
    const phoneDigits = form.phone.replace(/\D/g, '')
    if (!phoneDigits) e.phone = 'Informe seu telefone (WhatsApp)'
    else if (phoneDigits.length < 10) e.phone = 'Telefone inválido. Informe o DDD e o número.'
    if (!isGoogleFlow) {
      if (!form.name.trim()) e.name = 'Informe seu nome'
      if (!form.email.trim()) e.email = 'Informe seu e-mail'
      else if (!validateEmail(form.email)) e.email = 'E-mail inválido'
      if (!form.password) e.password = 'Informe uma senha'
      else if (form.password.length < 8) e.password = 'A senha deve ter pelo menos 8 caracteres'
      if (!form.password_confirm) e.password_confirm = 'Confirme sua senha'
      else if (form.password && form.password_confirm !== form.password) {
        e.password_confirm = 'As senhas não coincidem'
      }
    }
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function handleRegister() {
    if (!validate()) return
    setLoading(true)
    const normalizedPhone = normalizePhoneBR(form.phone)
    try {
      if (isGoogleFlow) {
        const res = await googleApi.loginWithIdToken(
          googleIdToken!,
          form.business_name,
          normalizedPhone,
          form.referral_code || undefined,
        )
        await setAuth(res.token)
        router.replace('/(app)')
      } else {
        const email = form.email.trim().toLowerCase()
        const res = await authApi.register({
          name: form.name,
          business_name: form.business_name,
          password: form.password,
          phone: normalizedPhone,
          email,
          referral_code: form.referral_code || undefined,
        })
        if (res.token) {
          // Auto-login only when the backend actually issued a token.
          await setAuth(res.token)
          router.replace('/(app)')
        } else {
          // 201 { needs_verification: true } — no token: the user must confirm
          // the e-mail before logging in.
          router.replace({ pathname: '/(auth)/aguardando-verificacao', params: { email } })
        }
      }
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
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.back}
            accessibilityRole="button"
            accessibilityLabel="Voltar"
          >
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

          <Input
            label="Telefone (WhatsApp) *"
            value={form.phone}
            onChangeText={(v) => setField('phone')(maskPhoneBR(v))}
            placeholder="(11) 99999-9999"
            keyboardType="phone-pad"
            maxLength={16}
            error={errors.phone}
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
                secureTextEntry={!showPassword}
                error={errors.password}
                rightElement={
                  <TouchableOpacity
                    onPress={() => setShowPassword((v) => !v)}
                    accessibilityRole="button"
                    accessibilityLabel={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons
                      name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                      size={22}
                      color={colors.textSecondary}
                    />
                  </TouchableOpacity>
                }
              />
              <Input
                label="Confirmar senha *"
                value={form.password_confirm}
                onChangeText={setField('password_confirm')}
                placeholder="Repita a senha"
                secureTextEntry={!showPasswordConfirm}
                error={errors.password_confirm}
                rightElement={
                  <TouchableOpacity
                    onPress={() => setShowPasswordConfirm((v) => !v)}
                    accessibilityRole="button"
                    accessibilityLabel={showPasswordConfirm ? 'Ocultar confirmação de senha' : 'Mostrar confirmação de senha'}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons
                      name={showPasswordConfirm ? 'eye-off-outline' : 'eye-outline'}
                      size={22}
                      color={colors.textSecondary}
                    />
                  </TouchableOpacity>
                }
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
            Ao criar sua conta você concorda com nossos{' '}
            <Text style={styles.termsLink} onPress={() => Linking.openURL(`${WEB_URL}/termos`)}>
              Termos de Uso
            </Text>{' '}e a{' '}
            <Text style={styles.termsLink} onPress={() => Linking.openURL(`${WEB_URL}/privacidade`)}>
              Política de Privacidade
            </Text>.
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
  termsLink: { color: colors.primary, fontWeight: '600' },
  googleBadge: { backgroundColor: '#DCFCE7', borderRadius: 10, padding: spacing.md },
  googleBadgeText: { fontSize: font.sm, color: '#166534', lineHeight: 20 },
})
