// Renders a reminder template by substituting {placeholders}. Unknown keys
// resolve to empty string. Templates come from agent_config (per-tenant) with a
// fallback to bot_config (global) — see the reminder jobs.
export function renderReminderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => (key in vars ? vars[key] : ''))
}
