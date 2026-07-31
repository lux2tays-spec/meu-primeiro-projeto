-- 044: tipos de forma de pagamento (gerenciados pelo Root Admin) + taxas por
-- método por tenant (abatidas do valor exibido = receita líquida).

-- Solta o CHECK fixo de payment_method: os tipos agora são dinâmicos (tabela
-- abaixo). A validação passa a ser na aplicação (contra os tipos ativos).
ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_payment_method_check;

-- Tipos de forma de pagamento (plataforma). key é o identificador estável.
CREATE TABLE IF NOT EXISTS payment_method_types (
  key        TEXT PRIMARY KEY,
  label      TEXT NOT NULL,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  sort       INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO payment_method_types (key, label, sort)
SELECT * FROM (VALUES
  ('pix', 'Pix', 10),
  ('payment_link', 'Link de Pagamento', 20),
  ('credit_card', 'Cartão Crédito', 30),
  ('debit_card', 'Cartão Débito', 40),
  ('cash', 'Dinheiro', 50)
) AS v(key, label, sort)
WHERE NOT EXISTS (SELECT 1 FROM payment_method_types);

-- Taxa (%) por método por tenant. Abatida do valor da venda ao exibir (líquido).
CREATE TABLE IF NOT EXISTS tenant_payment_fees (
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  method_key TEXT NOT NULL,
  pct        NUMERIC(5,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, method_key)
);
