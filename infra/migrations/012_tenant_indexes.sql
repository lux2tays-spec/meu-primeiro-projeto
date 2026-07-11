-- Missing indexes for multi-tenant load. Every bot webhook and dashboard query
-- filters by tenant_id on these tables; without indexes they seq-scan.
-- Safe/idempotent — CREATE INDEX IF NOT EXISTS.

CREATE INDEX IF NOT EXISTS idx_conversations_tenant_customer ON conversations(tenant_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_services_tenant ON services(tenant_id);
CREATE INDEX IF NOT EXISTS idx_professionals_tenant ON professionals(tenant_id);
CREATE INDEX IF NOT EXISTS idx_working_hours_tenant_prof ON working_hours(tenant_id, professional_id);
CREATE INDEX IF NOT EXISTS idx_working_hours_prof_dow ON working_hours(professional_id, day_of_week);
CREATE INDEX IF NOT EXISTS idx_whatsapp_instances_tenant ON whatsapp_instances(tenant_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_instances_name ON whatsapp_instances(instance_name);
CREATE INDEX IF NOT EXISTS idx_agent_config_tenant ON agent_config(tenant_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_tenant ON subscriptions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_appointments_tenant_customer ON appointments(tenant_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_appointments_prof_starts ON appointments(professional_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_days_off_professional ON days_off(professional_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_referrals_affiliate ON affiliate_referrals(affiliate_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_referrals_tenant ON affiliate_referrals(tenant_id);
