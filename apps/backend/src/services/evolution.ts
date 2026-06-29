const EVOLUTION_URL = process.env.EVOLUTION_API_URL!
const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY!

async function evolutionRequest(path: string, body?: unknown, method = body ? 'POST' : 'GET') {
  const res = await fetch(`${EVOLUTION_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      apikey: EVOLUTION_KEY,
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  const text = await res.text()
  let json: any
  try { json = JSON.parse(text) } catch { json = { raw: text } }

  if (!res.ok) {
    const msg = json?.response?.message?.[0] ?? json?.error ?? json?.message ?? `Evolution API error: ${res.status}`
    throw new Error(msg)
  }
  return json
}

export async function evolutionCreateInstance(instanceName: string, webhookUrl: string) {
  try {
    return await evolutionRequest('/instance/create', {
      instanceName,
      integration: 'WHATSAPP-BAILEYS',
      qrcode: true,
      webhook: {
        url: webhookUrl,
        byEvents: false,   // all events to one URL; event type is in body.event
        base64: true,
        events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE', 'QRCODE_UPDATED'],
      },
    })
  } catch (err: any) {
    // If the instance already exists, that's fine — we'll just get a fresh QR
    const msg: string = err?.message ?? ''
    if (msg.toLowerCase().includes('already') || msg.toLowerCase().includes('exists')) {
      return null
    }
    throw err
  }
}

function extractQR(data: any): string | null {
  if (!data) return null
  // v2.3.x: { qrcode: { base64: "data:image/png;base64,..." } }
  if (data?.qrcode?.base64) return data.qrcode.base64
  // v2.x: { base64: "..." }
  if (data?.base64) return data.base64
  // fallback string
  if (typeof data?.qrcode === 'string') return data.qrcode
  return null
}

// Polls Evolution API until QR is available (max ~18s)
export async function evolutionGetQR(instanceName: string): Promise<{ qrcode: string } | null> {
  for (let attempt = 0; attempt < 10; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 2000))
    try {
      const data = await evolutionRequest(`/instance/connect/${instanceName}`)
      const qr = extractQR(data)
      if (qr) return { qrcode: qr }
    } catch {
      // not ready yet
    }
  }
  return null
}

export async function evolutionGetStatus(instanceName: string) {
  try {
    return await evolutionRequest(`/instance/connectionState/${instanceName}`)
  } catch {
    return { state: 'unknown' }
  }
}

export async function evolutionSend(instanceName: string, to: string, text: string) {
  return evolutionRequest(`/message/sendText/${instanceName}`, { number: to, text })
}

export async function evolutionDeleteInstance(instanceName: string) {
  try {
    return await evolutionRequest(`/instance/delete/${instanceName}`, {}, 'DELETE')
  } catch { /* ignore */ }
}
