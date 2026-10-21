// Saves the document list in the browser. Closing the page does not erase it.
// Clearing this site's stored data, or using another browser, starts fresh.
// Photo files are stored separately in imageStore.js.

import { normalizeDocument } from './model.js'
import { sampleDocuments } from './sampleData.js'

export const STORAGE_KEY = 'wki-builder.documents.v1'

const UNREADABLE =
  'Saved documents were found but could not be read. They were left untouched.'

export function loadDocumentStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) {
      return { ok: true, documents: sampleDocuments().map(normalizeDocument), warning: '' }
    }
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return { ok: false, documents: [], warning: UNREADABLE }
    return { ok: true, documents: parsed.map(normalizeDocument), warning: '' }
  } catch {
    return { ok: false, documents: [], warning: UNREADABLE }
  }
}

export function loadDocuments() {
  return loadDocumentStore().documents
}

// Returns false when the browser refuses the write. The previous saved copy stays in place.
export function saveDocuments(documents) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(documents))
    return true
  } catch {
    return false
  }
}
