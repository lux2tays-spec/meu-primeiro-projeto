/**
 * Flag de sessão para o onboarding: quando o usuário toca em "Pular por agora",
 * paramos de redirecionar para o wizard até o próximo cold start do app
 * (equivalente ao sessionStorage usado na versão web).
 * Intencionalmente NÃO persiste em AsyncStorage — queremos re-oferecer o
 * onboarding na próxima abertura do app.
 */
export const onboardingSession = {
  skipped: false,
}
