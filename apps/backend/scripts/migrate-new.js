#!/usr/bin/env node
/**
 * Creates a new timestamped migration file in infra/migrations/.
 * Usage: npm run migrate:new --workspace=apps/backend -- create_users_table
 */
const fs   = require('fs')
const path = require('path')

const name = process.argv[2]
if (!name) {
  console.error('Usage: npm run migrate:new -- <migration_name>')
  console.error('Example: npm run migrate:new -- add_notifications_table')
  process.exit(1)
}

const migrationsDir = path.resolve(__dirname, '../../../infra/migrations')
const existing = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort()
const lastNum = existing.length > 0
  ? parseInt(existing[existing.length - 1].split('_')[0], 10)
  : 0

const num  = String(lastNum + 1).padStart(3, '0')
const slug = name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
const filename = `${num}_${slug}.sql`
const filepath = path.join(migrationsDir, filename)

fs.writeFileSync(filepath, `-- Migration: ${slug}\n-- Created: ${new Date().toISOString()}\n\n`)

console.log(`✅ Migration criada: infra/migrations/${filename}`)
