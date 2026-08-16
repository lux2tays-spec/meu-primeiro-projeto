import { View, Text, StyleSheet, ScrollView, Linking, Alert } from 'react-native'
import { router } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Card } from '@/components/ui/Card'
import { SettingsRow } from '@/components/ui/SettingsRow'
import { colors, font, spacing } from '@/lib/theme'
import { useBrandingStore } from '@/lib/branding'

// Número de suporte vem do branding (Root Admin). Fallback só como último recurso.
function buildSupportWa(phone: string, appName: string) {
  const digits = (phone || '').replace(/\D/g, '')
  const msg = encodeURIComponent(`Oi! Preciso de suporte no ${appName}.`)
  return digits ? `https://wa.me/${digits}?text=${msg}` : ''
}

export default function SupportScreen() {
  const appName = useBrandingStore((s) => s.appName)
  const supportWhatsapp = useBrandingStore((s) => s.supportWhatsapp)
  const supportWaUrl = buildSupportWa(supportWhatsapp, appName)
  return (
    <SafeAreaView style={styles.container} edges={[]}>
      <ScrollView contentContainerStyle={styles.content}>

        <Card style={styles.heroCard}>
          <Text style={styles.heroTitle}>Como podemos ajudar?</Text>
          <Text style={styles.heroSub}>Nossa equipe está disponível de segunda a sexta, das 9h às 18h.</Text>
        </Card>

        <Text style={styles.section}>Atendimento</Text>
        <Card style={styles.group}>
          <SettingsRow
            icon="sparkles-outline"
            iconColor={colors.primary}
            label="Assistente de suporte (IA)"
            subtitle="Tire dúvidas agora, resposta imediata"
            onPress={() => router.push('/(app)/settings/support-chat')}
          />
          <View style={styles.divider} />
          <SettingsRow
            icon="file-tray-full-outline"
            label="Meus chamados"
            subtitle="Acompanhe e abra solicitações para a equipe"
            onPress={() => router.push('/(app)/settings/tickets')}
          />
        </Card>

        <Text style={styles.section}>Fale conosco</Text>
        <Card style={styles.group}>
          {supportWaUrl ? (
            <>
              <SettingsRow
                icon="logo-whatsapp"
                iconColor={colors.whatsapp}
                label="WhatsApp"
                subtitle="Resposta em até 2 horas"
                onPress={() => Linking.openURL(supportWaUrl)}
              />
              <View style={styles.divider} />
            </>
          ) : null}
          <SettingsRow
            icon="mail-outline"
            label="E-mail"
            subtitle="suporte@aiconfirma.com.br"
            onPress={() => Linking.openURL('mailto:suporte@aiconfirma.com.br')}
          />
        </Card>

        <Text style={styles.section}>Recursos</Text>
        <Card style={styles.group}>
          <SettingsRow
            icon="book-outline"
            label="Central de ajuda"
            subtitle="Tutoriais e perguntas frequentes"
            onPress={() => Alert.alert('Em breve', 'Central de ajuda em construção')}
          />
          <View style={styles.divider} />
          <SettingsRow
            icon="videocam-outline"
            label="Vídeos tutoriais"
            subtitle="Como configurar e usar o AiConfirma"
            onPress={() => Alert.alert('Em breve', 'Biblioteca de vídeos em construção')}
          />
        </Card>

        <Card style={styles.versionCard}>
          <Text style={styles.versionText}>{`${appName} v1.0.0`}</Text>
          <Text style={styles.versionSub}>Feito com ❤️ para o Brasil</Text>
        </Card>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.lg },
  heroCard: { gap: spacing.xs },
  heroTitle: { fontSize: font.xl, fontWeight: '700', color: colors.text },
  heroSub: { fontSize: font.md, color: colors.textSecondary, lineHeight: 22 },
  section: { fontSize: font.sm, fontWeight: '700', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.8 },
  group: { gap: 0 },
  divider: { height: 1, backgroundColor: colors.border, marginHorizontal: -spacing.md },
  versionCard: { alignItems: 'center', gap: 4 },
  versionText: { fontSize: font.sm, color: colors.textSecondary },
  versionSub: { fontSize: font.sm, color: colors.textDisabled },
})
