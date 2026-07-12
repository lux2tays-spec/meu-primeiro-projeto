import { useState, useEffect } from 'react'
import { View, Text, StyleSheet, ScrollView } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { tenantApi } from '@/lib/api'
import { useAuthStore } from '@/lib/store'
import { useToast } from '@/lib/toast'
import { colors, font, spacing } from '@/lib/theme'

const BLANK = { name: '', contact_email: '', contact_phone: '', responsible_name: '' }

export default function BusinessScreen() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const role = useAuthStore((s) => s.role)
  const canEdit = ['owner', 'admin', 'root'].includes(role ?? '')

  const { data: tenant, isLoading } = useQuery({ queryKey: ['tenant'], queryFn: tenantApi.me })
  const [form, setForm] = useState(BLANK)
  const [nameError, setNameError] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (!tenant) return
    setForm({
      name: tenant.name ?? '',
      contact_email: tenant.contact_email ?? '',
      contact_phone: tenant.contact_phone ?? '',
      responsible_name: tenant.responsible_name ?? '',
    })
  }, [tenant])

  const set = (key: keyof typeof BLANK) => (v: string) => {
    setForm((f) => ({ ...f, [key]: v }))
    if (key === 'name') setNameError(undefined)
  }

  const saveMutation = useMutation({
    mutationFn: (data: typeof BLANK) =>
      tenantApi.updateBusiness({
        name: data.name.trim(),
        contact_email: data.contact_email.trim() || null,
        contact_phone: data.contact_phone.trim() || null,
        responsible_name: data.responsible_name.trim() || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenant'] })
      toast.show('Dados do negócio salvos com sucesso!', 'success')
    },
    onError: (err: any) => toast.show(err.message ?? 'Não foi possível salvar.', 'error'),
  })

  function handleSave() {
    if (!form.name.trim()) {
      setNameError('Informe o nome da empresa')
      return
    }
    saveMutation.mutate(form)
  }

  if (!canEdit) {
    return (
      <SafeAreaView style={s.container} edges={[]}>
        <View style={s.content}>
          <Card>
            <Text style={s.noAccess}>
              Apenas o proprietário ou administradores podem editar os dados do negócio.
            </Text>
          </Card>
        </View>
      </SafeAreaView>
    )
  }

  if (isLoading) return null

  return (
    <SafeAreaView style={s.container} edges={[]}>
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <Text style={s.hint}>
          Nome da empresa e informações de contato exibidas na plataforma.
        </Text>

        <Input
          label="Nome da empresa *"
          value={form.name}
          onChangeText={set('name')}
          placeholder="Minha Empresa"
          error={nameError}
        />
        <Input
          label="E-mail de contato"
          value={form.contact_email}
          onChangeText={set('contact_email')}
          placeholder="contato@empresa.com"
          keyboardType="email-address"
          autoCapitalize="none"
        />
        <Input
          label="Telefone"
          value={form.contact_phone}
          onChangeText={set('contact_phone')}
          placeholder="(11) 99999-9999"
          keyboardType="phone-pad"
        />
        <Input
          label="Nome do responsável"
          value={form.responsible_name}
          onChangeText={set('responsible_name')}
          placeholder="Maria Silva"
        />

        <Button label="Salvar" onPress={handleSave} loading={saveMutation.isPending} />
      </ScrollView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.md },
  hint: { fontSize: font.sm, color: colors.textSecondary, lineHeight: 20 },
  noAccess: { fontSize: font.md, color: colors.textSecondary, lineHeight: 22 },
})
