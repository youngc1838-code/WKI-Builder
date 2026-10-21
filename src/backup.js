// Builds a zip the user can save into OneDrive.
// Reading the browser stores does not change or delete them.

import { getImage, listImageIds, putImage } from './imageStore.js'
import { normalizeDocument } from './model.js'
import { STORAGE_KEY, saveDocuments } from './storage.js'

export const AUTO_BACKUP_MS = 5 * 60 * 1000
export const LATEST_BACKUP_NAME = 'wki-backup-latest.zip'
const MAX_BACKUP_FILES = 5000
const MAX_BACKUP_BYTES = 200 * 1024 * 1024

const textEncoder = new TextEncoder()

function imageIdsInDocument(doc) {
  const ids = []
  const images = [
    ...(doc.coverImages || []),
    ...(doc.completedImages || []),
    ...(doc.bomImages || []),
    doc.coverImage,
    doc.completedImage,
    ...(doc.steps || []).flatMap((step) => step.images || []),
  ]
  for (const image of images) {
    if (!image?.id) continue
    ids.push(String(image.id))
    if (image.compositeId) ids.push(String(image.compositeId))
  }
  return ids
}

function extensionFor(type) {
  if (type === 'image/png') return '.png'
  if (type === 'image/webp') return '.webp'
  if (type === 'image/gif') return '.gif'
  if (type === 'image/jpeg' || type === 'image/jpg') return '.jpg'
  return '.img'
}

function crc32(bytes) {
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i += 1) {
    crc ^= bytes[i]
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function dosTime(date) {
  const time =
    ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | ((date.getSeconds() >> 1) & 0x1f)
  const day =
    (((date.getFullYear() - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0xf) << 5) | (date.getDate() & 0x1f)
  return { time, day }
}

function bytesOf(parts) {
  const length = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function u16(value) {
  const bytes = new Uint8Array(2)
  new DataView(bytes.buffer).setUint16(0, value, true)
  return bytes
}

function u32(value) {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint32(0, value, true)
  return bytes
}

// One zip entry stored without compression, so any unzip tool can open it.
export function createZip(files, date = new Date()) {
  const stamp = dosTime(date)
  const locals = []
  const centrals = []
  let offset = 0

  for (const file of files) {
    const name = textEncoder.encode(file.name)
    const data = file.data
    const crc = crc32(data)
    const local = bytesOf([
      u32(0x04034b50),
      u16(20),
      u16(0x0800),
      u16(0),
      u16(stamp.time),
      u16(stamp.day),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      name,
      data,
    ])
    const central = bytesOf([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0x0800),
      u16(0),
      u16(stamp.time),
      u16(stamp.day),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      name,
    ])
    locals.push(local)
    centrals.push(central)
    offset += local.length
  }

  const centralDir = bytesOf(centrals)
  const end = bytesOf([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(centralDir.length),
    u32(offset),
    u16(0),
  ])
  return new Blob([bytesOf(locals), centralDir, end], { type: 'application/zip' })
}

export async function createBackupBlob(documents) {
  const list = Array.isArray(documents) ? documents : []
  const referenced = new Set(list.flatMap(imageIdsInDocument))
  let storedIds = []
  try {
    storedIds = await listImageIds()
  } catch (error) {
    throw new Error(error?.message || 'Could not read the photos for the backup.')
  }

  const ids = [...new Set([...referenced, ...storedIds])]
  const images = []
  const files = []

  for (const id of ids) {
    const blob = await getImage(id)
    if (!blob) {
      images.push({ id, missing: true, referenced: referenced.has(id) })
      continue
    }
    const data = new Uint8Array(await blob.arrayBuffer())
    const path = `images/${id}${extensionFor(blob.type)}`
    files.push({ name: path, data })
    images.push({
      id,
      path,
      contentType: blob.type || 'application/octet-stream',
      size: data.length,
      referenced: referenced.has(id),
    })
  }

  const manifest = {
    format: 'wki-backup-v1',
    exportedAt: new Date().toISOString(),
    storageKey: STORAGE_KEY,
    imageStore: 'wki-builder-images',
    documentCount: list.length,
    imageCount: images.filter((image) => !image.missing).length,
    images,
  }
  const readme = [
    'WKI Builder backup',
    '',
    'This zip is a copy of the work instructions from this browser.',
    'documents.json is the editable instructions.',
    'The images folder holds the photos.',
    'Put this zip in OneDrive if you want a copy outside the browser.',
    'Downloading it does not remove the copy stored in the browser.',
    '',
  ].join('\r\n')

  files.unshift(
    { name: 'README.txt', data: textEncoder.encode(readme) },
    { name: 'manifest.json', data: textEncoder.encode(JSON.stringify(manifest, null, 2)) },
    { name: 'documents.json', data: textEncoder.encode(JSON.stringify(list)) },
  )

  return { blob: createZip(files), documentCount: list.length, imageCount: manifest.imageCount }
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function readU16(bytes, offset) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, true)
}

function readU32(bytes, offset) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true)
}

function findEocd(bytes) {
  const start = Math.max(0, bytes.length - 22 - 65535)
  for (let offset = bytes.length - 22; offset >= start; offset -= 1) {
    if (readU32(bytes, offset) === 0x06054b50) return offset
  }
  throw new Error('That file is not a zip backup.')
}

async function inflateRaw(data) {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('This browser cannot open a compressed backup. Download a new backup from this app and use that file.')
  }
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function unzip(bytes) {
  if (bytes.length > MAX_BACKUP_BYTES) throw new Error('That backup is too large to load.')
  const eocd = findEocd(bytes)
  const count = readU16(bytes, eocd + 10)
  if (count > MAX_BACKUP_FILES) throw new Error('That backup has too many files to load.')
  let cursor = readU32(bytes, eocd + 16)
  const entries = []
  let total = 0

  for (let index = 0; index < count; index += 1) {
    if (readU32(bytes, cursor) !== 0x02014b50) throw new Error('That backup file is damaged.')
    const method = readU16(bytes, cursor + 10)
    const expectedCrc = readU32(bytes, cursor + 16)
    const compressedSize = readU32(bytes, cursor + 20)
    const nameLength = readU16(bytes, cursor + 28)
    const extraLength = readU16(bytes, cursor + 30)
    const commentLength = readU16(bytes, cursor + 32)
    const localOffset = readU32(bytes, cursor + 42)
    const name = new TextDecoder().decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength))
    cursor += 46 + nameLength + extraLength + commentLength
    if (name.endsWith('/')) continue

    const localNameLength = readU16(bytes, localOffset + 26)
    const localExtraLength = readU16(bytes, localOffset + 28)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const compressed = bytes.subarray(dataStart, dataStart + compressedSize)
    let data = compressed
    if (method === 8) data = await inflateRaw(compressed)
    else if (method !== 0) throw new Error('That backup uses a zip format this app cannot read.')
    if (crc32(data) !== expectedCrc) throw new Error('That backup file is damaged.')
    total += data.length
    if (total > MAX_BACKUP_BYTES) throw new Error('That backup is too large to load.')
    entries.push({ name: name.replaceAll('\\', '/'), data })
  }

  return entries
}

function contentTypeFor(name, manifestType) {
  if (manifestType) return manifestType
  const lower = name.toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  return 'application/octet-stream'
}

function imageIdFromName(name) {
  const base = name.split('/').pop()
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(0, dot) : base
}

export async function readBackupBytes(bytes) {
  const entries = await unzip(bytes)
  const documentsEntry = entries.find((entry) => entry.name === 'documents.json' || entry.name.endsWith('/documents.json'))
  if (!documentsEntry) throw new Error('That file is not a WKI backup. It needs documents.json.')
  let parsed
  try {
    parsed = JSON.parse(new TextDecoder().decode(documentsEntry.data))
  } catch {
    throw new Error('The backup documents could not be read.')
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('That backup has no work instructions, so nothing was changed.')
  }

  const manifestEntry = entries.find((entry) => entry.name === 'manifest.json' || entry.name.endsWith('/manifest.json'))
  const typeById = new Map()
  if (manifestEntry) {
    try {
      const manifest = JSON.parse(new TextDecoder().decode(manifestEntry.data))
      for (const image of manifest.images || []) {
        if (image?.id && image.contentType) typeById.set(String(image.id), image.contentType)
      }
    } catch {
      // The photo list can still be read from the images folder.
    }
  }

  const images = entries
    .filter((entry) => /(^|\/)images\/[^/]+$/.test(entry.name))
    .map((entry) => {
      const id = imageIdFromName(entry.name)
      return {
        id,
        blob: new Blob([entry.data], { type: contentTypeFor(entry.name, typeById.get(id)) }),
      }
    })

  return {
    documents: parsed.map((doc) => normalizeDocument(doc)),
    images,
  }
}

export async function readBackupFile(file) {
  return readBackupBytes(new Uint8Array(await file.arrayBuffer()))
}

// Photos are stored first. The document list is replaced only after every photo write succeeds.
export async function restoreBackup(backup) {
  for (const image of backup.images) {
    await putImage(image.id, image.blob)
  }
  const ok = saveDocuments(backup.documents)
  if (!ok) {
    throw new Error('The photos were copied, but the document list could not be saved. The previous document list was kept.')
  }
  return backup.documents
}
