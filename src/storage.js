// The desktop app and Docker write documents into the WKI Data folder.
// A plain browser visit keeps using localStorage.
// Photo files are stored separately in imageStore.js.

import { normalizeDocument } from './model.js'
import { sampleDocuments } from './sampleData.js'

export const STORAGE_KEY = 'wki-builder.documents.v1'

const UNREADABLE =
  'Saved documents were found but could not be read. They were left untouched.'

let fileMode = 'unknown'
let fileStoreInfo = null

export function usesFileStore() {
  if (fileMode === 'file') return true
  if (fileMode === 'browser') return false
  const health = syncJson('GET', '/api/health')
  if (health?.ok && health.fileStore) {
    fileMode = 'file'
    fileStoreInfo = health
    return true
  }
  fileMode = 'browser'
  return false
}

export function fileStoreDataDir() {
  return fileStoreInfo?.dataDir || ''
}

export function storagePlaceLabel() {
  return usesFileStore() ? 'the WKI data folder' : 'this browser'
}

function syncJson(method, url, body) {
  try {
    const xhr = new XMLHttpRequest()
    xhr.open(method, url, false)
    if (body !== undefined) xhr.setRequestHeader('Content-Type', 'application/json')
    xhr.send(body === undefined ? null : body)
    if (xhr.status < 200 || xhr.status >= 300) return null
    return JSON.parse(xhr.responseText)
  } catch {
    return null
  }
}

export function loadDocumentStore() {
  if (usesFileStore()) {
    const payload = syncJson('GET', '/api/documents')
    if (!payload?.ok) {
      return { ok: false, documents: [], warning: UNREADABLE, fileStore: true, dataDir: fileStoreDataDir() }
    }
    const documents =
      payload.documents === null
        ? sampleDocuments().map(normalizeDocument)
        : payload.documents.map(normalizeDocument)
    return { ok: true, documents, warning: '', fileStore: true, dataDir: fileStoreDataDir() }
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) {
      return { ok: true, documents: sampleDocuments().map(normalizeDocument), warning: '', fileStore: false, dataDir: '' }
    }
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return { ok: false, documents: [], warning: UNREADABLE, fileStore: false, dataDir: '' }
    return { ok: true, documents: parsed.map(normalizeDocument), warning: '', fileStore: false, dataDir: '' }
  } catch {
    return { ok: false, documents: [], warning: UNREADABLE, fileStore: false, dataDir: '' }
  }
}

export function loadDocuments() {
  return loadDocumentStore().documents
}

// Returns false when the browser refuses the write. The previous saved copy stays in place.
export function saveDocuments(documents) {
  try {
    if (usesFileStore()) {
      return syncJson('PUT', '/api/documents', JSON.stringify(documents)) !== null
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(documents))
    return true
  } catch {
    return false
  }
}
