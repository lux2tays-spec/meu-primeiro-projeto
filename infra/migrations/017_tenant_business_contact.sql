-- 017: business contact fields on tenants (edited via the "Dados do negócio" page)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS contact_email TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS contact_phone TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS responsible_name TEXT;
