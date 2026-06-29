import { View, Text, StyleSheet, ScrollView, Share, Alert } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useQuery } from '@tanstack/react-query'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { api } from '@/lib/api'
import { colors, font, spacing, radius } from '@/lib/theme'

export default function AffiliateScreen() {
  const { data: affiliate } = useQuery({
    queryKey: ['affiliate'],
    queryFn: () => api.get<any>('/affiliate/me'),
  })

  const referralLink = `https://agendabot.com.br/r/${affiliate?.referral_code ?? '...'}`

  async function handleShare() {
    try {
      await Share.share({
        message: `🤖 Automatize o atendimento do seu negócio com IA no WhatsApp!\n\nCrie sua conta grátis no AgendaBot: ${referralLink}`,
        url: referralLink,
      })
    } catch {}
  }

  const pending = ((affiliate?.pending_earnings ?? 0) / 100).toFixed(2).replace('.', ',')
  const paid = ((affiliate?.paid_earnings ?? 0) / 100).toFixed(2).replace('.', ',')

  return (
    <SafeAreaView style={styles.container} edges={[]}>
      <ScrollView contentContainerStyle={styles.content}>

        <Card style={styles.heroBanner}>
          <Ionicons name="gift-outline" size={32} color={colors.primary} />
          <Text style={styles.heroTitle}>Indique e ganhe!</Text>
          <Text style={styles.heroSub}>
            Ganhe comissão recorrente para cada negócio que assinar usando seu link. Enquanto o cliente ficar ativo, você recebe.
          </Text>
        </Card>

        {/* Stats */}
        <View style={styles.statsRow}>
          <Card style={styles.statCard}>
            <Text style={styles.statValue}>{affiliate?.total_referrals ?? 0}</Text>
            <Text style={styles.statLabel}>Indicações</Text>
          </Card>
          <Card style={styles.statCard}>
            <Text style={[styles.statValue, { color: colors.warning }]}>R$ {pending}</Text>
            <Text style={styles.statLabel}>A receber</Text>
          </Card>
          <Card style={styles.statCard}>
            <Text style={[styles.statValue, { color: colors.success }]}>R$ {paid}</Text>
            <Text style={styles.statLabel}>Recebido</Text>
          </Card>
        </View>

        {/* Referral link */}
        <Card style={styles.linkCard}>
          <Text style={styles.linkTitle}>Seu link de indicação</Text>
          <View style={styles.linkBox}>
            <Text style={styles.linkText} numberOfLines={1}>{referralLink}</Text>
          </View>
          <Button label="Compartilhar link" onPress={handleShare} />
        </Card>

        {/* How it works */}
        <Card style={styles.howCard}>
          <Text style={styles.howTitle}>Como funciona</Text>
          {[
            { icon: 'share-outline', text: 'Compartilhe seu link com donos de negócio' },
            { icon: 'person-add-outline', text: 'Eles criam uma conta e assinam um plano' },
            { icon: 'cash-outline', text: 'Você recebe comissão mensalmente enquanto o cliente estiver ativo' },
          ].map((item, i) => (
            <View key={i} style={styles.howStep}>
              <View style={styles.howIcon}>
                <Ionicons name={item.icon as any} size={18} color={colors.primary} />
              </View>
              <Text style={styles.howText}>{item.text}</Text>
            </View>
          ))}
        </Card>

      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.lg },
  heroBanner: { alignItems: 'center', gap: spacing.sm, backgroundColor: colors.primaryLight },
  heroTitle: { fontSize: font.xl, fontWeight: '800', color: colors.primaryDark },
  heroSub: { fontSize: font.md, color: colors.primaryDark, textAlign: 'center', lineHeight: 22 },
  statsRow: { flexDirection: 'row', gap: spacing.md },
  statCard: { flex: 1, alignItems: 'center', gap: 4 },
  statValue: { fontSize: font.xl, fontWeight: '800', color: colors.text },
  statLabel: { fontSize: font.sm, color: colors.textSecondary },
  linkCard: { gap: spacing.md },
  linkTitle: { fontSize: font.md, fontWeight: '700', color: colors.text },
  linkBox: { backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.md },
  linkText: { fontSize: font.sm, color: colors.textSecondary, fontFamily: 'monospace' },
  howCard: { gap: spacing.md },
  howTitle: { fontSize: font.lg, fontWeight: '700', color: colors.text },
  howStep: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  howIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  howText: { flex: 1, fontSize: font.md, color: colors.text, lineHeight: 22 },
})
