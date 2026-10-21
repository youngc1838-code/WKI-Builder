// The shape of a work instruction or SOP, plus the rules for saving,
// revising, and checking required fields. No network and no database.

import { annotationsFromImage, normalizeAnnotations, roundAnnotation } from './annotations.js'
import { plainText, sanitizeHtml } from './richText.js'

export const DOCUMENT_TYPES = ['Work Instruction', 'SOP']

export const STATUSES = ['Draft', 'In Review', 'Released', 'Obsolete']

const LOCKED_STATUSES = ['Released', 'Obsolete']

export function isLockedStatus(status) {
  return LOCKED_STATUSES.includes(status)
}

export function statusClass(status) {
  const slug = String(status || 'draft').toLowerCase().replace(/\s+/g, '-')
  return `status status-${slug}`
}

function normalizeImage(raw) {
  if (!raw || typeof raw !== 'object' || !raw.id) return null
  const next = {
    ...raw,
    id: String(raw.id),
    attachmentId: String(raw.attachmentId || crypto.randomUUID()),
    caption: String(raw.caption || ''),
    compositeId: raw.compositeId ? String(raw.compositeId) : '',
    annotations: annotationsFromImage(raw),
  }
  delete next.marks
  return next
}

function savedImage(image) {
  if (!image?.id) return null
  const next = {
    ...image,
    id: String(image.id),
    attachmentId: String(image.attachmentId || crypto.randomUUID()),
    caption: String(image.caption ?? '').trim(),
    compositeId: image.compositeId ? String(image.compositeId) : '',
    annotations: normalizeAnnotations(image.annotations).map(roundAnnotation).filter(Boolean),
  }
  delete next.marks
  return next
}

function copyImage(image) {
  const next = savedImage(image)
  if (!next) return null
  return {
    ...next,
    attachmentId: crypto.randomUUID(),
    annotations: (next.annotations || []).map((item) => ({ ...item, id: crypto.randomUUID() })),
  }
}

function imageList(list, legacy) {
  if (Array.isArray(list)) return list.map(normalizeImage).filter(Boolean)
  const single = normalizeImage(legacy)
  return single ? [single] : []
}

function savedImageList(list) {
  return (Array.isArray(list) ? list : []).map(savedImage).filter(Boolean)
}

export function collectImages(doc) {
  return [
    ...(doc.coverImages || []),
    ...(doc.completedImages || []),
    ...(doc.bomImages || []),
    ...(doc.steps || []).flatMap((step) => step.images || []),
  ]
}

function normalizeStep(raw, index) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const images = Array.isArray(source.images)
    ? source.images.map(normalizeImage).filter(Boolean)
    : []
  return {
    ...source,
    id: String(source.id || `step-${index + 1}`),
    title: String(source.title || ''),
    instruction: String(source.instruction || ''),
    toolsOrParts: String(source.toolsOrParts || ''),
    qualityCheck: String(source.qualityCheck || ''),
    safetyNote: String(source.safetyNote || ''),
    imageNote: String(source.imageNote || ''),
    images,
  }
}

export function createStep() {
  return normalizeStep({ id: crypto.randomUUID() }, 0)
}

// Rebuild a document so older or incomplete saved data still has every field.
export function normalizeDocument(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const documentType = source.documentType === 'SOP' ? 'SOP' : 'Work Instruction'
  const status = STATUSES.includes(source.status) ? source.status : 'Draft'
  // Older documents stored tools and materials in one field. Copy that text
  // into tools only when the new field has never been saved.
  const toolsEquipment =
    source.toolsEquipment !== undefined && source.toolsEquipment !== null
      ? String(source.toolsEquipment)
      : String(source.toolsMaterials || '')

  return {
    ...source,
    id: String(source.id || crypto.randomUUID()),
    documentType,
    title: String(source.title || ''),
    documentNumber: String(source.documentNumber || ''),
    partNumber: String(source.partNumber || ''),
    revision: String(source.revision || ''),
    department: String(source.department || ''),
    preparedBy: String(source.preparedBy || ''),
    reviewer: String(source.reviewer || ''),
    effectiveDate: String(source.effectiveDate || ''),
    purpose: String(source.purpose || ''),
    scope: String(source.scope || ''),
    safety: String(source.safety || ''),
    toolsMaterials: String(source.toolsMaterials || ''),
    toolsEquipment,
    materialsParts: String(source.materialsParts || ''),
    references: String(source.references || ''),
    status,
    isSample: Boolean(source.isSample),
    revisesId: String(source.revisesId || ''),
    basedOnRevision: String(source.basedOnRevision || ''),
    updatedAt: String(source.updatedAt || new Date().toISOString()),
    coverImages: imageList(source.coverImages, source.coverImage),
    completedImages: imageList(source.completedImages, source.completedImage),
    bomImages: imageList(source.bomImages),
    coverImage: normalizeImage(source.coverImage),
    completedImage: normalizeImage(source.completedImage),
    steps: Array.isArray(source.steps) ? source.steps.map(normalizeStep) : [],
  }
}

export function createBlankDocument() {
  return normalizeDocument({
    id: crypto.randomUUID(),
    revision: 'A',
    status: 'Draft',
    steps: [createStep()],
    updatedAt: new Date().toISOString(),
  })
}

function blankText(value) {
  return !plainText(value)
}

// Drafts only need a title and document number, so people can save unfinished work.
// In Review and Released need the identifying fields and complete steps.
// Released also needs a reviewer and an effective date.
export function validateDocument(doc) {
  const fieldErrors = {}
  const messages = []

  function add(field, message) {
    fieldErrors[field] = message
    messages.push(message)
  }

  if (blankText(doc.title)) add('title', 'Title is required.')
  if (blankText(doc.documentNumber)) add('documentNumber', 'Document number is required.')

  const reviewing = doc.status === 'In Review' || doc.status === 'Released'
  if (reviewing) {
    if (blankText(doc.revision)) {
      add('revision', 'Revision is required before review or release.')
    }
    if (blankText(doc.partNumber)) {
      add('partNumber', 'Assembly number is required before review or release.')
    }
    if (blankText(doc.department)) {
      add('department', 'Department is required before review or release.')
    }
    if (blankText(doc.preparedBy)) {
      add('preparedBy', 'Prepared by is required before review or release.')
    }
    if (blankText(doc.purpose)) {
      add('purpose', 'Purpose is required before review or release.')
    }
    const steps = Array.isArray(doc.steps) ? doc.steps : []
    const missingInstruction = steps.length === 0 || steps.some((step) => blankText(step.instruction))
    if (missingInstruction) {
      add(
        'steps',
        'Add at least one step, and give every step instruction text, before review or release.',
      )
    }
  }

  if (doc.status === 'Released') {
    if (blankText(doc.reviewer)) add('reviewer', 'Reviewer is required to release a document.')
    if (blankText(doc.effectiveDate)) {
      add('effectiveDate', 'Effective date is required to release a document.')
    }
  }

  return { fieldErrors, messages }
}

const TEXT_FIELDS = [
  'title',
  'documentNumber',
  'partNumber',
  'revision',
  'department',
  'preparedBy',
  'reviewer',
  'purpose',
  'scope',
  'safety',
  'toolsMaterials',
  'toolsEquipment',
  'materialsParts',
  'references',
]

const RICH_FIELDS = new Set([
  'purpose',
  'scope',
  'safety',
  'toolsEquipment',
  'materialsParts',
  'references',
])

function storedText(value, rich) {
  const text = String(value ?? '').trim()
  return rich ? sanitizeHtml(text) : text
}

export function prepareForSave(doc) {
  const next = { ...doc, updatedAt: new Date().toISOString() }
  for (const field of TEXT_FIELDS) {
    next[field] = storedText(doc[field], RICH_FIELDS.has(field))
  }
  next.effectiveDate = String(doc.effectiveDate ?? '').trim()
  next.steps = (doc.steps || []).map((step) => ({
    ...step,
    title: String(step.title ?? '').trim(),
    instruction: storedText(step.instruction, true),
    toolsOrParts: storedText(step.toolsOrParts, true),
    qualityCheck: storedText(step.qualityCheck, true),
    safetyNote: storedText(step.safetyNote, true),
    imageNote: storedText(step.imageNote, true),
    images: (step.images || []).map(savedImage).filter(Boolean),
  }))
  next.coverImages = savedImageList(doc.coverImages)
  next.completedImages = savedImageList(doc.completedImages)
  next.bomImages = savedImageList(doc.bomImages)
  next.coverImage = next.coverImages[0] || null
  next.completedImage = next.completedImages[0] || null
  return next
}

// A, B, C ... Z, then AA. Numbers such as 01 become 02.
export function nextRevision(revision) {
  const value = String(revision || '').trim()
  if (/^[A-Z]$/i.test(value)) {
    const upper = value.toUpperCase()
    if (upper === 'Z') return 'AA'
    return String.fromCharCode(upper.charCodeAt(0) + 1)
  }
  if (/^\d+$/.test(value)) {
    return String(Number(value) + 1).padStart(value.length, '0')
  }
  return value ? `${value}-1` : 'A'
}

// Copy a locked revision into a new draft. The original object is not modified.
export function createRevisionFrom(doc) {
  const source = normalizeDocument(doc)
  return normalizeDocument({
    ...source,
    id: crypto.randomUUID(),
    status: 'Draft',
    revision: nextRevision(source.revision),
    revisesId: source.id,
    basedOnRevision: source.revision,
    effectiveDate: '',
    updatedAt: new Date().toISOString(),
    coverImages: (source.coverImages || []).map(copyImage).filter(Boolean),
    completedImages: (source.completedImages || []).map(copyImage).filter(Boolean),
    bomImages: (source.bomImages || []).map(copyImage).filter(Boolean),
    coverImage: null,
    completedImage: null,
    steps: source.steps.map((step) => ({
      ...step,
      id: crypto.randomUUID(),
      images: (step.images || []).map(copyImage).filter(Boolean),
    })),
  })
}

export function formatWhen(iso) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}
