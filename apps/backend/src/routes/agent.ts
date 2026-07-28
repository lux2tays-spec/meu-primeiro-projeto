import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { db } from '../lib/db'
import { redis } from '../lib/redis'
import fs from 'fs'
import path from 'path'
import { pipeline } from 'stream/promises'
import crypto from 'crypto'
import { handoffUpdateSchema, invalidateHandoffConfig } from '../lib/handoffConfig'

const UPLOADS_DIR = path.join(process.cwd(), 'uploads', 'catalogs')

const updateSchema = z.object({
  system_prompt:        z.string().optional(),
  tone:                 z.string().max(60).optional(),
  language:             z.string().optional(),
  business_info:        z.string().optional(),
  business_type:        z.string().optional(),
  address:              z.string().optional(),
  neighborhood:         z.string().optional(),
  city:                 z.string().optional(),
  state:                z.string().optional(),
  instagram_url:        z.string().optional(),
  google_maps_url:      z.string().optional(),
  website_url:          z.string().optional(),
  whatsapp_number:      z.string().optional(),
  catalog_files:        z.array(z.object({ name: z.string(), url: z.string() })).optional(),
  custom_instructions:  z.string().optional(),
  return_reminder_days: z.number().int().min(1).max(365).optional(),
  appointment_reminders_enabled: z.boolean().optional(),
  reminder1_minutes:    z.number().int().min(0).optional(),
  reminder2_minutes:    z.number().int().min(0).optional(),
  // Per-tenant bot behaviour (null = inherit global default from bot_config).
  allow_price_list:     z.boolean().nullable().optional(),
  collect_last_name:    z.boolean().nullable().optional(),
  reminder_return_template:      z.string().max(2000).nullable().optional(),
  reminder_appointment_template: z.string().max(2000).nullable().optional(),
}).merge(handoffUpdateSchema)

export const agentRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', (app as any).authenticate)
  app.addHook('preHandler', (app as any).planGuard)

  app.get('/config', async (request, reply) => {
    const { tenant_id } = request.user
    const { rows: [config] } = await db.query(
      'SELECT * FROM agent_config WHERE tenant_id = $1',
      [tenant_id]
    )
    return reply.send(config)
  })

  app.patch('/config', async (request, reply) => {
    const { tenant_id, role } = request.user
    if (!['owner', 'admin', 'root'].includes(role)) return reply.status(403).send({ error: 'Sem permissão' })

    const body = updateSchema.parse(request.body)

    // CFG-15: ao remover um arquivo de catálogo do array, o arquivo físico em
    // uploads/catalogs ficava órfão no disco para sempre. Calcula ANTES do
    // UPDATE quais arquivos deste tenant saíram da lista, e os apaga do disco
    // (best-effort) DEPOIS que o banco confirmar a gravação.
    let removedCatalogPaths: string[] = []
    if (body.catalog_files !== undefined) {
      const { rows: [cur] } = await db.query(
        'SELECT catalog_files FROM agent_config WHERE tenant_id = $1',
        [tenant_id]
      )
      const currentFiles: { name?: string; url?: string }[] = Array.isArray(cur?.catalog_files)
        ? cur.catalog_files
        : []
      const keptUrls = new Set(body.catalog_files.map((f) => f.url))
      const ownPrefix = `/agent/uploads/${tenant_id}/`
      removedCatalogPaths = currentFiles
        .filter((f) => f.url && !keptUrls.has(f.url) && f.url.startsWith(ownPrefix))
        // basename barra path traversal — só nomes de arquivo dentro da pasta do tenant
        .map((f) => path.join(UPLOADS_DIR, tenant_id!, path.basename(f.url!)))
    }

    const sets: string[] = []
    const values: unknown[] = []
    let i = 1

    for (const [key, val] of Object.entries(body)) {
      if (val !== undefined) {
        sets.push(`${key} = $${i++}`)
        values.push(key === 'catalog_files' ? JSON.stringify(val) : val)
      }
    }
    sets.push('updated_at = NOW()')

    if (sets.length === 1) return reply.status(400).send({ error: 'No fields to update' })

    values.push(tenant_id)
    const { rows: [config] } = await db.query(
      `UPDATE agent_config SET ${sets.join(', ')} WHERE tenant_id = $${i} RETURNING *`,
      values
    )

    // CFG-15: banco atualizado com sucesso → remove do disco os arquivos que
    // saíram do catálogo. Falha ao apagar não derruba a resposta (só loga).
    for (const filePath of removedCatalogPaths) {
      try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
      } catch (err) {
        request.log.warn({ err, filePath }, 'catálogo: falha ao remover arquivo do disco')
      }
    }

    await redis.del(`tenant:config:${tenant_id}`)
    // The tenant's own save can change handoff_* fields — drop the handoff cache too.
    await invalidateHandoffConfig(tenant_id!)
    return reply.send(config)
  })

  // Upload a catalog file (PDF or image)
  app.post('/config/upload', async (request, reply) => {
    const { tenant_id, role } = request.user
    if (!['owner', 'admin', 'root'].includes(role)) return reply.status(403).send({ error: 'Sem permissão' })

    const tenantDir = path.join(UPLOADS_DIR, tenant_id!)
    if (!fs.existsSync(tenantDir)) fs.mkdirSync(tenantDir, { recursive: true })

    const data = await request.file()
    if (!data) return reply.status(400).send({ error: 'No file provided' })

    const ext = path.extname(data.filename) || '.bin'
    const allowedExts = ['.pdf', '.jpg', '.jpeg', '.png', '.webp']
    if (!allowedExts.includes(ext.toLowerCase())) {
      return reply.status(400).send({ error: 'Tipo de arquivo não permitido. Use PDF, JPG ou PNG.' })
    }

    const uniqueName = `${crypto.randomUUID()}${ext}`
    const filePath = path.join(tenantDir, uniqueName)

    await pipeline(data.file, fs.createWriteStream(filePath))

    const url = `/agent/uploads/${tenant_id}/${uniqueName}`
    return reply.send({ name: data.filename, url })
  })

  // Serve uploaded catalog files
  app.get<{ Params: { tenantId: string; filename: string } }>(
    '/uploads/:tenantId/:filename',
    async (request, reply) => {
      const { tenant_id } = request.user
      const { tenantId, filename } = request.params

      // Users may only access their own tenant's files
      if (tenant_id !== tenantId) return reply.status(403).send({ error: 'Forbidden' })

      // Prevent path traversal
      const safeName = path.basename(filename)
      const filePath = path.join(UPLOADS_DIR, tenantId, safeName)

      if (!fs.existsSync(filePath)) return reply.status(404).send({ error: 'File not found' })

      const ext = path.extname(safeName).toLowerCase()
      const mimeMap: Record<string, string> = {
        '.pdf': 'application/pdf',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.webp': 'image/webp',
      }
      reply.type(mimeMap[ext] ?? 'application/octet-stream')
      return reply.send(fs.createReadStream(filePath))
    }
  )
}
