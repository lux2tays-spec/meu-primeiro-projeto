-- Allow tenant_id to be NULL for root users
-- Add 'root' to the role check constraint

ALTER TABLE user_roles DROP CONSTRAINT IF EXISTS user_roles_pkey;
ALTER TABLE user_roles DROP CONSTRAINT IF EXISTS user_roles_tenant_id_fkey;
ALTER TABLE user_roles DROP CONSTRAINT IF EXISTS user_roles_role_check;

ALTER TABLE user_roles ALTER COLUMN tenant_id DROP NOT NULL;
ALTER TABLE user_roles ADD CONSTRAINT user_roles_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE user_roles ADD CONSTRAINT user_roles_role_check
  CHECK (role IN ('owner', 'admin', 'staff', 'root'));

-- New PK that handles NULL tenant_id using COALESCE
CREATE UNIQUE INDEX user_roles_unique ON user_roles (user_id, COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'));
