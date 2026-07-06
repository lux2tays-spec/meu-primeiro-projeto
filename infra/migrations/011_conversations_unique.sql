-- Fix: conversations had no unique constraint on (tenant_id, customer_id).
-- ON CONFLICT DO NOTHING in webhooks.ts never triggered, creating a new
-- conversation per message — bot lost all context on every message.

-- Remove duplicate conversations keeping the oldest per customer
DELETE FROM conversations
WHERE id NOT IN (
  SELECT DISTINCT ON (tenant_id, customer_id) id
  FROM conversations
  ORDER BY tenant_id, customer_id, started_at ASC
);

-- Enforce one active conversation per customer per tenant
ALTER TABLE conversations
  ADD CONSTRAINT conversations_tenant_customer_unique UNIQUE (tenant_id, customer_id);
