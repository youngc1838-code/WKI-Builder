import fs from 'node:fs'
import path from 'node:path'

const IMAGE_ID = /^[A-Za-z0-9_-]{1,80}$/
const BACKUP_NAME = /^[\w.-]+\.zip$/

const README = `WKI Builder data

This folder is the live copy of everything entered in the desktop app.

library.json
  The full document list the app opens.

work-orders\\
  One JSON file per work instruction or SOP, plus _index.json.

images\\
  Photos attached to those documents.

backups\\
  A zip copy written while the app is open.
`

export function ensureDataLayout(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true })
  for (const folder of ['work-orders', 'images', 'backups']) {
    fs.mkdirSync(path.join(dataDir, folder), { recursive: true })
  }
  const readme = path.join(dataDir, 'README.txt')
  if (!fs.existsSync(readme)) fs.writeFileSync(readme, README, 'utf8')
}

export function readLibrary(dataDir) {
  const file = path.join(dataDir, 'library.json')
  if (!fs.existsSync(file)) return null
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (!Array.isArray(parsed)) throw new Error('library.json is not a list of documents.')
  return parsed
}

export function writeLibrary(dataDir, documents) {
  if (!Array.isArray(documents)) throw new Error('Documents must be a list.')
  ensureDataLayout(dataDir)
  atomicWrite(path.join(dataDir, 'library.json'), JSON.stringify(documents, null, 2))
  writeWorkOrders(dataDir, documents)
}

export function writeImage(dataDir, id, buffer, mime) {
  if (!IMAGE_ID.test(id)) throw new Error('Invalid image id.')
  ensureDataLayout(dataDir)
  const safeMime = String(mime || 'application/octet-stream').split(';')[0].trim().slice(0, 80)
  const base = path.join(dataDir, 'images', id)
  fs.writeFileSync(`${base}.bin`, buffer)
  fs.writeFileSync(`${base}.mime`, safeMime || 'application/octet-stream', 'utf8')
}

export function readImage(dataDir, id) {
  if (!IMAGE_ID.test(id)) return null
  const base = path.join(dataDir, 'images', id)
  if (!fs.existsSync(`${base}.bin`)) return null
  const mime = fs.existsSync(`${base}.mime`)
    ? fs.readFileSync(`${base}.mime`, 'utf8').trim()
    : 'application/octet-stream'
  return { buffer: fs.readFileSync(`${base}.bin`), mime: mime || 'application/octet-stream' }
}

export function listImageIds(dataDir) {
  const dir = path.join(dataDir, 'images')
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.bin'))
    .map((name) => name.slice(0, -4))
}

export function writeBackup(dataDir, name, buffer) {
  if (!BACKUP_NAME.test(name)) throw new Error('Invalid backup name.')
  ensureDataLayout(dataDir)
  fs.writeFileSync(path.join(dataDir, 'backups', name), buffer)
}

function writeWorkOrders(dataDir, documents) {
  const dir = path.join(dataDir, 'work-orders')
  const names = new Set()
  const index = []
  for (const doc of documents) {
    if (!doc || typeof doc !== 'object') continue
    const name = workOrderName(doc)
    names.add(name)
    atomicWrite(path.join(dir, name), JSON.stringify(doc, null, 2))
    index.push({
      id: String(doc.id || ''),
      documentNumber: String(doc.documentNumber || ''),
      title: String(doc.title || ''),
      revision: String(doc.revision || ''),
      status: String(doc.status || ''),
      documentType: String(doc.documentType || ''),
      updatedAt: String(doc.updatedAt || ''),
      file: name,
    })
  }
  atomicWrite(path.join(dir, '_index.json'), JSON.stringify(index, null, 2))
  for (const entry of fs.readdirSync(dir)) {
    if (entry === '_index.json' || !entry.endsWith('.json')) continue
    if (!names.has(entry)) fs.unlinkSync(path.join(dir, entry))
  }
}

function workOrderName(doc) {
  const id = slug(doc.id || 'document')
  return `${slug(doc.documentNumber)}__rev-${slug(doc.revision || 'none')}__${id}.json`
}

function slug(value) {
  const cleaned = String(value || '')
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^\.+/, '')
    .slice(0, 80)
  return cleaned || 'untitled'
}

function atomicWrite(file, text) {
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, text, 'utf8')
  fs.renameSync(tmp, file)
}
