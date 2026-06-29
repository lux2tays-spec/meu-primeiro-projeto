import { useState, useEffect } from 'react'
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Alert } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { paymentConfigApi } from '@/lib/api'
import { colors, font, spacing, radius } from '@/lib/theme'

export default function PaymentsScreen() {
  const qc = useQueryClient()
  const { data: cfg } = useQuery({ queryKey: ['payment-config'], queryFn: paymentConfigApi.get })

  const [accessToken, setAccessToken] = useState('')
  const [publicKey, setPublicKey] = useState('')

  useEffect(() => {
    if (cfg) setPublicKey(cfg.mp_public_key ?? '')
  }, [cfg])

  const saveMutation = useMutation({
    mutationFn: () => paymentConfigApi.save({
      mp_access_token: accessToken || undefined,
      mp_public_key:   publicKey   || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payment-config'] })
      setAccessToken('')
      Alert.alert('Salvo!', 'Configurações de pagamento atualizadas.')
    },
    onError: (e: any) => Alert.alert('Erro', e.message),
  })

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={s.title}>Meios de Pagamento</Text>
      </View>

      <ScrollView contentContainerStyle={s.content}>
        {/* Status */}
        <View style={[s.statusCard, cfg?.configured ? s.statusOk : s.statusPending]}>
          <Ionicons
            name={cfg?.configured ? 'checkmark-circle' : 'alert-circle-outline'}
            size={20}
            color={cfg?.configured ? colors.success : colors.warning}
          />
          <Text style={[s.statusText, { color: cfg?.configured ? colors.success : colors.warning }]}>
            {cfg?.configured ? 'Mercado Pago conectado' : 'Mercado Pago não configurado'}
          </Text>
        </View>

        {/* Info */}
        <View style={s.infoCard}>
          <Text style={s.infoTitle}>Como obter suas credenciais</Text>
          <Text style={s.infoText}>
            1. Acesse <Text style={s.bold}>mercadopago.com.br</Text> e faça login{'\n'}
            2. Vá em <Text style={s.bold}>Seu negócio → Configurações → Credenciais</Text>{'\n'}
            3. Copie o <Text style={s.bold}>Access Token</Text> e a <Text style={s.bold}>Public Key</Text>
          </Text>
        </View>

        {/* Form */}
        <View style={s.form}>
          <View>
            <Text style={s.label}>
              Access Token
              {cfg?.mp_access_token ? (
                <Text style={s.currentValue}> (atual: {cfg.mp_access_token})</Text>
              ) : null}
            </Text>
            <TextInput
              style={s.input}
              value={accessToken}
              onChangeText={setAccessToken}
              placeholder={cfg?.configured ? 'Digite para substituir' : 'APP_USR-...'}
              placeholderTextColor={colors.textDisabled}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={s.hint}>Deixe em branco para não alterar.</Text>
          </View>

          <View>
            <Text style={s.label}>Public Key</Text>
            <TextInput
              style={s.input}
              value={publicKey}
              onChangeText={setPublicKey}
              placeholder="APP_USR-..."
              placeholderTextColor={colors.textDisabled}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          <TouchableOpacity
            style={[s.btn, saveMutation.isPending && { opacity: 0.6 }]}
            onPress={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
          >
            <Text style={s.btnText}>{saveMutation.isPending ? 'Salvando...' : 'Salvar configurações'}</Text>
          </TouchableOpacity>

          {cfg?.configured && (
            <TouchableOpacity
              style={s.removeBtn}
              onPress={() => Alert.alert('Remover integração', 'Deseja remover a conexão com Mercado Pago?', [
                { text: 'Cancelar', style: 'cancel' },
                {
                  text: 'Remover', style: 'destructive',
                  onPress: () => paymentConfigApi.save({ mp_access_token: '', mp_public_key: '' })
                    .then(() => { qc.invalidateQueries({ queryKey: ['payment-config'] }); setPublicKey('') })
                    .catch((e: any) => Alert.alert('Erro', e.message))
                },
              ])}
            >
              <Text style={s.removeBtnText}>Remover integração</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, paddingBottom: spacing.md },
  backBtn: { padding: 4 },
  title: { fontSize: font.xl, fontWeight: '700', color: colors.text },
  content: { padding: spacing.lg, gap: spacing.lg },
  statusCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    padding: spacing.md, borderRadius: radius.lg, borderWidth: 1,
  },
  statusOk: { backgroundColor: '#ECFDF5', borderColor: colors.success + '40' },
  statusPending: { backgroundColor: '#FFFBEB', borderColor: colors.warning + '40' },
  statusText: { fontSize: font.md, fontWeight: '600' },
  infoCard: {
    backgroundColor: '#EFF6FF', borderRadius: radius.lg,
    padding: spacing.md, borderWidth: 1, borderColor: '#BFDBFE', gap: spacing.xs,
  },
  infoTitle: { fontSize: font.sm, fontWeight: '700', color: '#1D4ED8' },
  infoText: { fontSize: font.sm, color: '#1E40AF', lineHeight: 20 },
  bold: { fontWeight: '700' },
  form: { gap: spacing.lg },
  label: { fontSize: font.sm, fontWeight: '600', color: colors.textSecondary, marginBottom: spacing.xs },
  currentValue: { fontWeight: '400', color: colors.textDisabled },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    padding: spacing.md, fontSize: font.md, color: colors.text,
    backgroundColor: colors.surface, fontFamily: 'monospace',
  },
  hint: { fontSize: 12, color: colors.textDisabled, marginTop: spacing.xs },
  btn: {
    backgroundColor: colors.primary, borderRadius: radius.lg,
    padding: spacing.md + 2, alignItems: 'center',
  },
  btnText: { color: '#fff', fontWeight: '700', fontSize: font.md },
  removeBtn: {
    borderWidth: 1, borderColor: colors.danger + '60', borderRadius: radius.lg,
    padding: spacing.md, alignItems: 'center',
  },
  removeBtnText: { color: colors.danger, fontWeight: '600', fontSize: font.md },
})
