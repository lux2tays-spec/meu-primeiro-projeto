#!/usr/bin/env node
/**
 * Creates the root admin user in the database.
 * Usage: node scripts/create-root-user.js
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../apps/backend/.env') })

const { Pool } = require('pg')
const crypto = require('crypto')
const readline = require('readline')

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

function hashPassword(password) {
  return crypto.createHash('sha256').update(password + process.env.JWT_SECRET).digest('hex')
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer) }))
}

async function main() {
  console.log('\n🔐 Criar usuário root (administrador da plataforma)\n')

  const { rows: existing } = await pool.query(
    `SELECT u.id, u.email FROM users u
     JOIN user_roles ur ON ur.user_id = u.id
     WHERE ur.role = 'root' LIMIT 1`
  )

  if (existing.length > 0) {
    console.log(`✅ Usuário root já existe: ${existing[0].email}`)
    console.log('   Nenhuma ação necessária.\n')
    await pool.end()
    return
  }

  const name     = await ask('Nome: ')
  const email    = await ask('E-mail: ')
  const password = await ask('Senha (mín. 8 caracteres): ')

  if (password.length < 8) {
    console.error('❌ Senha muito curta')
    process.exit(1)
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows: [user] } = await client.query(
      'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
      [name, email, hashPassword(password)]
    )

    await client.query(
      'INSERT INTO user_roles (user_id, tenant_id, role) VALUES ($1, NULL, $2)',
      [user.id, 'root']
    )

    await client.query('COMMIT')
    console.log(`\n✅ Usuário root criado: ${email}`)
    console.log('   Acesse o painel em http://localhost:3001/login\n')
  } catch (err) {
    await client.query('ROLLBACK')
    if (err.constraint === 'users_email_key') {
      console.error('❌ Este e-mail já está cadastrado')
    } else {
      console.error('❌ Erro:', err.message)
    }
    process.exit(1)
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch((err) => { console.error('Erro:', err.message); process.exit(1) })
