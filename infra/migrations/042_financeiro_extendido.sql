-- 042: Extensão do módulo financeiro — despesas, outras receitas, meta de lucro,
-- venda rápida (venda avulsa) e taxonomia de subtipos gerenciada pelo Root Admin.

-- ── Venda rápida / forma de pagamento em appointments ────────────────────────
-- Venda avulsa = agendamento já 'completed' com source='quick_sale' e intervalo
-- vazio (ends_at = starts_at) para NÃO ocupar horário na agenda. Profissional é
-- opcional nessas vendas → professional_id passa a aceitar NULL.
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS payment_method TEXT
    CHECK (payment_method IS NULL OR payment_method IN ('pix','payment_link','credit_card','debit_card','cash')),
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'appointment'
    CHECK (source IN ('appointment','quick_sale'));
ALTER TABLE appointments ALTER COLUMN professional_id DROP NOT NULL;

-- ── Meta de lucro mensal por tenant ──────────────────────────────────────────
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS meta_lucro_mensal NUMERIC(12,2);

-- ── Taxonomia de subtipos de despesa (gerenciada pelo Root Admin) ────────────
-- is_percent = subtipo cobrado como % sobre as vendas (Taxa de Cartão, Comissão).
CREATE TABLE IF NOT EXISTS expense_subtypes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo       TEXT NOT NULL CHECK (tipo IN ('Fixa','Variável')),
  nome       TEXT NOT NULL,
  is_percent BOOLEAN NOT NULL DEFAULT FALSE,
  color      TEXT NOT NULL DEFAULT '#6B7280',
  icon       TEXT,
  sort       INTEGER NOT NULL DEFAULT 0,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tipo, nome)
);

-- Subtipos customizados por tenant (quando o usuário escolhe "Outro" e digita um novo).
CREATE TABLE IF NOT EXISTS tenant_expense_subtypes (
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tipo       TEXT NOT NULL CHECK (tipo IN ('Fixa','Variável')),
  nome       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, tipo, nome)
);

-- ── Despesas ─────────────────────────────────────────────────────────────────
-- valor: obrigatório para subtipos comuns. pct: usado nos subtipos percentuais
-- (valor em R$ é derivado no runtime: receitaVendas * pct/100).
CREATE TABLE IF NOT EXISTS despesas (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  descricao  TEXT NOT NULL,
  tipo       TEXT NOT NULL CHECK (tipo IN ('Fixa','Variável')),
  subtipo    TEXT NOT NULL,
  valor      NUMERIC(12,2),
  pct        NUMERIC(5,2),
  data       DATE NOT NULL,
  recorrente BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_despesas_tenant_data ON despesas (tenant_id, data);
CREATE INDEX IF NOT EXISTS idx_despesas_tenant_recorrente ON despesas (tenant_id) WHERE recorrente;

-- Override de uma OCORRÊNCIA específica de despesa recorrente (por ano/mês):
-- editar o valor, o pct, ou pular (skip) aquele mês sem afetar as demais.
CREATE TABLE IF NOT EXISTS despesa_ocorrencia_override (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  despesa_id UUID NOT NULL REFERENCES despesas(id) ON DELETE CASCADE,
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ano        INTEGER NOT NULL,
  mes        INTEGER NOT NULL CHECK (mes BETWEEN 1 AND 12),
  valor      NUMERIC(12,2),
  pct        NUMERIC(5,2),
  skip       BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (despesa_id, ano, mes)
);

-- ── Outras receitas (não-vendas: aporte, reembolso, rendimento, venda avulsa) ─
CREATE TABLE IF NOT EXISTS outras_receitas (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  descricao  TEXT NOT NULL,
  categoria  TEXT NOT NULL,
  valor      NUMERIC(12,2) NOT NULL,
  data       DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_outras_receitas_tenant_data ON outras_receitas (tenant_id, data);

-- ── Seed dos subtipos padrão (só se a tabela estiver vazia) ───────────────────
INSERT INTO expense_subtypes (tipo, nome, is_percent, color, icon, sort)
SELECT * FROM (VALUES
  ('Fixa','Luz',                 FALSE, '#22C55E', 'flash',        10),
  ('Fixa','Água',                FALSE, '#06B6D4', 'water',        20),
  ('Fixa','Internet',            FALSE, '#6366F1', 'wifi',         30),
  ('Fixa','Aluguel/IPTU',        FALSE, '#8B5CF6', 'home',         40),
  ('Fixa','Equipe/Salário',      FALSE, '#F59E0B', 'people',       50),
  ('Fixa','Pró-labore',          FALSE, '#EC4899', 'wallet',       60),
  ('Fixa','Encargos',            FALSE, '#84CC16', 'business',     70),
  ('Fixa','Contabilidade',       FALSE, '#14B8A6', 'calculator',   80),
  ('Fixa','Assinaturas',         FALSE, '#3B82F6', 'albums',       90),
  ('Fixa','Marketing',           FALSE, '#F43F5E', 'megaphone',   100),
  ('Fixa','Parcelas/Empréstimo', FALSE, '#A16207', 'card',        110),
  ('Fixa','Outro',               FALSE, '#6B7280', 'ellipsis-horizontal', 120),
  ('Variável','Insumos',              FALSE, '#16A34A', 'cube',        10),
  ('Variável','Produtos p/ revenda',  FALSE, '#65A30D', 'pricetags',   20),
  ('Variável','Logística/Frete',      FALSE, '#0891B2', 'car',         30),
  ('Variável','Manutenção',           FALSE, '#CA8A04', 'construct',    40),
  ('Variável','Taxa de Cartão',       TRUE,  '#DC2626', 'card',        50),
  ('Variável','Comissão',             TRUE,  '#EA580C', 'pie-chart',   60),
  ('Variável','Outro',                FALSE, '#6B7280', 'ellipsis-horizontal', 70)
) AS v(tipo, nome, is_percent, color, icon, sort)
WHERE NOT EXISTS (SELECT 1 FROM expense_subtypes);
