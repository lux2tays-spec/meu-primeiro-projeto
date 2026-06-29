#!/usr/bin/env node
/**
 * Generates placeholder PNG assets for the mobile app.
 * Run once after installing Node.js: node scripts/generate-assets.js
 */
const fs   = require('fs')
const path = require('path')
const zlib = require('zlib')

// CRC32 table (Node's zlib doesn't expose crc32 directly)
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let crc = 0xFFFFFFFF
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8)
  return (crc ^ 0xFFFFFFFF) >>> 0
}

function u32(n) {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(n >>> 0)
  return b
}

function pngChunk(type, data) {
  const tBuf = Buffer.from(type, 'ascii')
  const crcBuf = Buffer.concat([tBuf, data])
  return Buffer.concat([u32(data.length), tBuf, data, u32(crc32(crcBuf))])
}

function makePng(width, height, bgR, bgG, bgB) {
  const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

  const ihdrData = Buffer.concat([u32(width), u32(height), Buffer.from([8, 2, 0, 0, 0])])
  const ihdr = pngChunk('IHDR', ihdrData)

  // Build raw scanlines: filter byte 0x00 + RGB pixels
  // Use a solid colour for the whole image — fast and valid
  const scanline = Buffer.alloc(1 + width * 3)
  scanline[0] = 0 // filter type: None
  for (let x = 0; x < width; x++) {
    scanline[1 + x * 3]     = bgR
    scanline[1 + x * 3 + 1] = bgG
    scanline[1 + x * 3 + 2] = bgB
  }

  const rows = []
  for (let y = 0; y < height; y++) rows.push(scanline)
  const raw = Buffer.concat(rows)

  const compressed = zlib.deflateSync(raw, { level: 1 }) // fast compression
  const idat = pngChunk('IDAT', compressed)
  const iend = pngChunk('IEND', Buffer.alloc(0))

  return Buffer.concat([PNG_SIG, ihdr, idat, iend])
}

const outDir = path.join(__dirname, '../apps/mobile/assets')
fs.mkdirSync(outDir, { recursive: true })

const files = [
  { name: 'icon.png',          w: 1024, h: 1024 },
  { name: 'adaptive-icon.png', w: 1024, h: 1024 },
  { name: 'splash.png',        w: 1242, h: 2436 },
  { name: 'favicon.png',       w:   48, h:   48 },
]

for (const f of files) {
  const png = makePng(f.w, f.h, 108, 71, 255) // #6C47FF — purple brand
  fs.writeFileSync(path.join(outDir, f.name), png)
  console.log(`✅  ${f.name} (${f.w}×${f.h})`)
}

console.log('\nAssets gerados em apps/mobile/assets/ — substitua depois pelos definitivos.\n')
