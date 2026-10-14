// Attachments: image.attach_bytes, file.attach (data_url), pdf.attach (base64), image.detach, then one prompt.submit.
import { deflateSync } from 'node:zlib'
import { connect } from './lib.mjs'

function png(w, h, [r, g, b]) { // solid-colour RGB PNG
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
  const crc = buf => { let c = 0xffffffff; for (const x of buf) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]) }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3).map((_, i) => [r, g, b][i % 3])])
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(Array(h).fill(row)))), chunk('IEND', Buffer.alloc(0))])
}
function pdf(text) { // minimal one-page PDF
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    null, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
  const stream = `BT /F1 24 Tf 20 70 Td (${text}) Tj ET`
  objs[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
  let out = '%PDF-1.4\n'; const offs = []
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n` })
  const xref = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('')
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

const c = await connect({ label: 'c', maxLog: 900 })
await c.rpc('client.capabilities', { server_requests: true })
const { session_id: sid } = await c.rpc('session.create', {})
const img = await c.rpc('image.attach_bytes', { session_id: sid, content_base64: png(64, 64, [220, 20, 20]).toString('base64'), filename: 'red-square.png' })
const img2 = await c.rpc('image.attach_bytes', { session_id: sid, content_base64: png(32, 32, [20, 20, 220]).toString('base64'), filename: 'blue.png' })
console.log('detach blue ->', await c.rpc('image.detach', { session_id: sid, path: img2.path }))
const file = await c.rpc('file.attach', { session_id: sid, name: 'notes.txt', data_url: 'data:text/plain;base64,' + Buffer.from('The secret word is MANGO-42.\n').toString('base64') })
const pdfRes = await c.rpc('pdf.attach', { session_id: sid, content_base64: pdf('PDF says KIWI-7').toString('base64'), filename: 'tiny.pdf' }).catch(e => e.rpc)
const done = c.waitEvent(e => e.session_id === sid && e.type === 'message.complete', 180000)
// file.attach does NOT auto-include the file: put its ref_text into the prompt (Desktop does the same).
await c.rpc('prompt.submit', { session_id: sid, text: `${file.ref_text}\n\nIn one line each: what colour is the attached image, what is the secret word in the file, and what does the PDF say?` })
console.log('ANSWER:', (await done).payload.text)
const h = await c.rpc('session.history', { session_id: sid })
console.log('HISTORY user row:', JSON.stringify(h.messages[0]).slice(0, 1200))
c.close()
