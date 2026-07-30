import { Component, ReactNode } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, font, spacing, radius } from '@/lib/theme'

interface Props {
  children: ReactNode
}
interface State {
  hasError: boolean
  message?: string
}

// App-wide safety net: if any screen crashes while rendering, show a friendly
// fallback instead of a red-screen stack trace. End users must never see raw
// error details — we log them for diagnosis and offer a "try again".
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error?.message }
  }

  componentDidCatch(error: Error, info: unknown) {
    // Log only — never surface to the user.
    console.error('[ErrorBoundary]', error, info)
  }

  reset = () => this.setState({ hasError: false, message: undefined })

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <View style={styles.container}>
        <View style={styles.iconBox}>
          <Ionicons name="alert-circle-outline" size={30} color={colors.primary} />
        </View>
        <Text style={styles.title}>Algo deu errado</Text>
        <Text style={styles.subtitle}>
          Tivemos um problema ao carregar esta tela. Já registramos o ocorrido. Tente novamente.
        </Text>
        <TouchableOpacity style={styles.button} onPress={this.reset} activeOpacity={0.85}>
          <Text style={styles.buttonText}>Tentar novamente</Text>
        </TouchableOpacity>
        {/* DIAGNÓSTICO (build de teste): mensagem do erro para depurar. Remover/gate antes da produção. */}
        {this.state.message ? (
          <Text style={styles.debug} selectable>{this.state.message}</Text>
        ) : null}
      </View>
    )
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background, padding: spacing.xl },
  iconBox: {
    width: 60, height: 60, borderRadius: 18, backgroundColor: colors.primaryLight,
    alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg,
  },
  title: { fontSize: font.xl, fontWeight: '800', color: colors.text, textAlign: 'center' },
  subtitle: { fontSize: font.md, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.sm, lineHeight: 21, maxWidth: 320 },
  button: {
    marginTop: spacing.xl, backgroundColor: colors.primary, paddingHorizontal: spacing.xl,
    height: 50, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center',
  },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: font.md },
  debug: { marginTop: spacing.lg, fontSize: 11, color: colors.textDisabled, textAlign: 'center', maxWidth: 320 },
})
