import { useState, useEffect } from 'react'
import { View, Text, StyleSheet, Image, ActivityIndicator } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { whatsappApi } from '@/lib/api'
import { useToast } from '@/lib/toast'
import { colors, font, spacing, radius } from '@/lib/theme'

export default function WhatsAppScreen() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [isConnecting, setIsConnecting] = useState(false)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)

  const { data: status, refetch: refetchStatus } = useQuery({
    queryKey: ['whatsapp-status'],
    queryFn: whatsappApi.getStatus,
    refetchInterval: isConnecting ? 3000 : false,
  })

  const { data: qrData } = useQuery({
    queryKey: ['whatsapp-qr'],
    queryFn: whatsappApi.getQR,
    enabled: isConnecting && status?.status === 'qr_pending',
    refetchInterval: 30_000,
  })

  const connectMutation = useMutation({
    mutationFn: whatsappApi.connect,
    onSuccess: () => {
      setIsConnecting(true)
      refetchStatus()
    },
    onError: (err: any) => toast.show(err.message ?? 'Não foi possível iniciar a conexão.', 'error'),
  })

  useEffect(() => {
    if (status?.status === 'connected') {
      setIsConnecting(false)
      queryClient.invalidateQueries({ queryKey: ['whatsapp-status'] })
      toast.show('WhatsApp conectado com sucesso!', 'success')
    }
  }, [status?.status])

  const isConnected = status?.status === 'connected'
  const isPending = status?.status === 'qr_pending'

  return (
    <SafeAreaView style={styles.container} edges={[]}>
      <View style={styles.content}>
        <Card style={styles.statusCard}>
          <View style={styles.statusRow}>
            <View style={[styles.dot, {
              backgroundColor: isConnected ? colors.success : isPending ? colors.warning : colors.danger,
            }]} />
            <Text style={styles.statusLabel}>
              {isConnected ? 'Conectado' : isPending ? 'Aguardando leitura do QR Code...' : 'Desconectado'}
            </Text>
            <Badge
              label={isConnected ? 'Online' : isPending ? 'Aguardando' : 'Offline'}
              variant={isConnected ? 'success' : isPending ? 'warning' : 'danger'}
            />
          </View>
          {isConnected && status?.phone_number && (
            <View style={styles.phoneRow}>
              <Ionicons name="logo-whatsapp" size={18} color={colors.whatsapp} />
              <Text style={styles.phone}>{status.phone_number}</Text>
            </View>
          )}
        </Card>

        {isPending && (
          <Card style={styles.qrCard}>
            <Text style={styles.qrTitle}>Escaneie o QR Code</Text>
            <Text style={styles.qrSub}>
              Abra o WhatsApp no celular do seu negócio → Configurações → Aparelhos conectados → Conectar aparelho
            </Text>
            {qrData?.qrcode ? (
              <Image source={{ uri: qrData.qrcode }} style={styles.qrImage} resizeMode="contain" />
            ) : (
              <View style={styles.qrPlaceholder}>
                <ActivityIndicator color={colors.primary} size="large" />
                <Text style={styles.qrPlaceholderText}>Gerando QR Code...</Text>
              </View>
            )}
            <Text style={styles.qrExpiry}>O código expira em 60 segundos e será renovado automaticamente</Text>
          </Card>
        )}

        {!isConnected && !isPending && (
          <Card style={styles.infoCard}>
            <Text style={styles.infoTitle}>Como funciona</Text>
            {[
              'Clique em "Conectar WhatsApp" abaixo',
              'Um QR Code será gerado para o número do seu negócio',
              'Abra o WhatsApp do estabelecimento e escaneie o código',
              'Pronto! O bot já começa a responder seus clientes',
            ].map((step, i) => (
              <View key={i} style={styles.step}>
                <View style={styles.stepNum}>
                  <Text style={styles.stepNumText}>{i + 1}</Text>
                </View>
                <Text style={styles.stepText}>{step}</Text>
              </View>
            ))}
          </Card>
        )}

        <View style={styles.actions}>
          {!isConnected && (
            <Button
              label={isPending ? 'Cancelar' : 'Conectar WhatsApp'}
              onPress={() => {
                if (isPending) setIsConnecting(false)
                else connectMutation.mutate()
              }}
              loading={connectMutation.isPending}
              variant={isPending ? 'outline' : 'primary'}
            />
          )}
          {isConnected && (
            <Button
              label="Desconectar"
              variant="outline"
              onPress={() => setConfirmDisconnect(true)}
            />
          )}
        </View>
      </View>

      <ConfirmDialog
        visible={confirmDisconnect}
        title="Desconectar WhatsApp"
        message="Tem certeza? O bot parará imediatamente de responder seus clientes até você reconectar."
        confirmLabel="Desconectar"
        onConfirm={() => {
          setConfirmDisconnect(false)
          toast.show('WhatsApp desconectado.', 'info')
        }}
        onCancel={() => setConfirmDisconnect(false)}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { flex: 1, padding: spacing.lg, gap: spacing.lg },
  statusCard: { gap: spacing.sm },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dot: { width: 10, height: 10, borderRadius: 5 },
  statusLabel: { flex: 1, fontSize: font.md, fontWeight: '600', color: colors.text },
  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  phone: { fontSize: font.md, color: colors.textSecondary },
  qrCard: { alignItems: 'center', gap: spacing.md },
  qrTitle: { fontSize: font.lg, fontWeight: '700', color: colors.text },
  qrSub: { fontSize: font.sm, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  qrImage: { width: 240, height: 240, borderRadius: radius.md },
  qrPlaceholder: { width: 240, height: 240, alignItems: 'center', justifyContent: 'center', gap: spacing.md, backgroundColor: colors.surfaceAlt, borderRadius: radius.md },
  qrPlaceholderText: { color: colors.textSecondary, fontSize: font.sm },
  qrExpiry: { fontSize: font.sm, color: colors.textDisabled, textAlign: 'center' },
  infoCard: { gap: spacing.md },
  infoTitle: { fontSize: font.lg, fontWeight: '700', color: colors.text },
  step: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  stepNum: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  stepNumText: { fontSize: font.sm, fontWeight: '700', color: colors.primary },
  stepText: { flex: 1, fontSize: font.md, color: colors.text, lineHeight: 22 },
  actions: { marginTop: 'auto' },
})
