-- 041: histórico de comunicados (broadcasts) enviados pelo Root Admin.
-- Cada linha registra um envio: público-alvo, canais, quantos destinatários e quem enviou.
CREATE TABLE IF NOT EXISTS broadcasts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title            TEXT NOT NULL,
  body             TEXT NOT NULL,
  link             TEXT,
  target           TEXT NOT NULL,          -- owners | all
  channels         TEXT[] NOT NULL,        -- ex.: {inapp,email,whatsapp}
  recipients_count INTEGER NOT NULL DEFAULT 0,
  created_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_broadcasts_created ON broadcasts (created_at DESC);
