import { useState, useEffect } from 'react'
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { authApi } from '@/lib/api'
import { useToast } from '@/lib/toast'
import { colors, font, spacing } from '@/lib/theme'

const ROLE_LABELS: Record<string, string> = {
  owner: 'Dono',
  admin: 'Administrador',
  staff: 'Colaborador',
  root: 'Root',
}

export default function PerfilScreen() {
  const queryClient = useQueryClient()
  const toast = useToast()

  const { data: me, isLoading } = useQuery({ queryKey: ['auth-me'], queryFn: authApi.me })

  // (a) Dados pessoais
  const [form, setForm] = useState({ name: '', phone: '' })
  const [nameError, setNameError] = useState<string | undefined>(undefined)

  // (b) Troca de e-mail
  const [showEmailForm, setShowEmailForm] = useState(false)
  const [emailForm, setEmailForm] = useState({ new_email: '', password: '' })

  // (c) Senha
  const [pwForm, setPwForm] = useState({ current_password: '', new_password: '' })

  useEffect(() => {
    if (!me) return
    setForm({ name: me.name ?? '', phone: me.phone ?? '' })
  }, [me])

  const saveProfile = useMutation({
    mutationFn: (data: typeof form) =>
      authApi.updateMe({ name: data.name.trim(), phone: data.phone.trim() || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auth-me'] })
      toast.show('Dados salvos com sucesso!', 'success')
    },
    onError: (err: any) => toast.show(err.message ?? 'Não foi possível salvar.', 'error'),
  })

  const changeEmail = useMutation({
    mutationFn: (data: typeof emailForm) =>
      authApi.changeEmail(data.new_email.trim().toLowerCase(), data.password),
    onSuccess: (res) => {
      toast.show(res.message, res.sent ? 'success' : 'error')
      if (res.sent) {
        setShowEmailForm(false)
        setEmailForm({ new_email: '', password: '' })
      }
    },
    onError: (err: any) => toast.show(err.message ?? 'Não foi possível solicitar a troca.', 'error'),
  })

  const changePassword = useMutation({
    mutationFn: (data: typeof pwForm) =>
      authApi.changePassword(data.current_password, data.new_password),
    onSuccess: () => {
      setPwForm({ current_password: '', new_password: '' })
      toast.show('Senha alterada com sucesso!', 'success')
    },
    onError: (err: any) => toast.show(err.message ?? 'Não foi possível alterar a senha.', 'error'),
  })

  function handleSaveProfile() {
    if (form.name.trim().length < 2) {
      setNameError('Informe seu nome (mín. 2 caracteres)')
      return
    }
    setNameError(undefined)
    saveProfile.mutate(form)
  }

  function handleChangePassword() {
    if (!pwForm.current_password) {
      toast.show('Informe sua senha atual.', 'error')
      return
    }
    if (pwForm.new_password.length < 8) {
      toast.show('A nova senha deve ter pelo menos 8 caracteres.', 'error')
      return
    }
    changePassword.mutate(pwForm)
  }

  if (isLoading) return null

  return (
    <SafeAreaView style={s.container} edges={[]}>
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <Text style={s.hint}>
          Seus dados pessoais de acesso — separados dos dados do negócio.
        </Text>

        {/* (a) Dados pessoais */}
        <Text style={s.section}>Dados pessoais</Text>
        <Card style={s.card}>
          <Input
            label="Nome *"
            value={form.name}
            onChangeText={(v) => { setForm((f) => ({ ...f, name: v })); setNameError(undefined) }}
            placeholder="Seu nome"
            error={nameError}
          />
          <Input
            label="Telefone"
            value={form.phone}
            onChangeText={(v) => setForm((f) => ({ ...f, phone: v }))}
            placeholder="(11) 99999-9999"
            keyboardType="phone-pad"
          />
          <Button label="Salvar" onPress={handleSaveProfile} loading={saveProfile.isPending} />
        </Card>

        {/* (b) E-mail de login */}
        <Text style={s.section}>E-mail de login</Text>
        <Card style={s.card}>
          <View style={s.emailRow}>
            <Text style={s.emailText} numberOfLines={1}>{me?.email}</Text>
            <Badge
              label={me?.email_verified ? 'Verificado' : 'Não verificado'}
              variant={me?.email_verified ? 'success' : 'warning'}
            />
          </View>

          {!showEmailForm ? (
            <Button label="Trocar e-mail" variant="outline" onPress={() => setShowEmailForm(true)} />
          ) : (
            <View style={s.emailForm}>
              <Input
                label="Novo e-mail"
                value={emailForm.new_email}
                onChangeText={(v) => setEmailForm((f) => ({ ...f, new_email: v }))}
                placeholder="novo@email.com"
                keyboardType="email-address"
                autoCapitalize="none"
              />
              <Input
                label="Sua senha (para confirmar)"
                value={emailForm.password}
                onChangeText={(v) => setEmailForm((f) => ({ ...f, password: v }))}
                placeholder="••••••••"
                secureTextEntry
              />
              <Text style={s.emailHint}>
                Enviaremos um link de confirmação para o novo e-mail. A troca só acontece após a confirmação.
              </Text>
              <Button
                label="Enviar link de confirmação"
                onPress={() => changeEmail.mutate(emailForm)}
                loading={changeEmail.isPending}
                disabled={!emailForm.new_email.trim() || !emailForm.password}
              />
              <TouchableOpacity onPress={() => setShowEmailForm(false)} style={s.cancelLink}>
                <Text style={s.cancelText}>Cancelar</Text>
              </TouchableOpacity>
            </View>
          )}
        </Card>

        {/* (c) Senha */}
        <Text style={s.section}>Alterar senha</Text>
        <Card style={s.card}>
          <Input
            label="Senha atual"
            value={pwForm.current_password}
            onChangeText={(v) => setPwForm((f) => ({ ...f, current_password: v }))}
            placeholder="••••••••"
            secureTextEntry
          />
          <Input
            label="Nova senha (mín. 8 caracteres)"
            value={pwForm.new_password}
            onChangeText={(v) => setPwForm((f) => ({ ...f, new_password: v }))}
            placeholder="••••••••"
            secureTextEntry
          />
          <Button label="Alterar senha" onPress={handleChangePassword} loading={changePassword.isPending} />
        </Card>

        {/* (d) Acesso — somente leitura */}
        <Text style={s.section}>Acesso</Text>
        <Card style={s.card}>
          <View style={s.readonlyRow}>
            <Text style={s.readonlyLabel}>Papel</Text>
            <Text style={s.readonlyValue}>{ROLE_LABELS[me?.role ?? ''] ?? me?.role ?? '—'}</Text>
          </View>
          <View style={s.readonlyDivider} />
          <View style={s.readonlyRow}>
            <Text style={s.readonlyLabel}>Negócio</Text>
            <Text style={s.readonlyValue} numberOfLines={1}>{me?.business_name ?? '—'}</Text>
          </View>
        </Card>
      </ScrollView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl },
  hint: { fontSize: font.sm, color: colors.textSecondary, lineHeight: 20 },
  section: { fontSize: font.sm, fontWeight: '700', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.8, marginTop: spacing.sm },
  card: { gap: spacing.md },
  emailRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  emailText: { flex: 1, fontSize: font.md, color: colors.text, fontWeight: '500' },
  emailForm: { gap: spacing.md },
  emailHint: { fontSize: font.sm, color: colors.textSecondary, lineHeight: 18 },
  cancelLink: { alignSelf: 'center', paddingVertical: spacing.xs },
  cancelText: { color: colors.primary, fontSize: font.md, fontWeight: '600' },
  readonlyRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md },
  readonlyLabel: { fontSize: font.sm, fontWeight: '500', color: colors.textSecondary },
  readonlyValue: { flexShrink: 1, fontSize: font.md, color: colors.text, fontWeight: '600' },
  readonlyDivider: { height: 1, backgroundColor: colors.border, marginHorizontal: -spacing.md },
})
