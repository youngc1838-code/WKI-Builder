// The shape of a work instruction or SOP, plus the rules for saving,
// revising, and checking required fields. No network and no database.

import { annotationsFromImage, normalizeAnnotations, roundAnnotation } from './annotations.js'
import { CALLOUT_BLUE, TOOL_BALLOON } from './annotations.js'
import { plainText, refreshReferenceHtml, remapReferenceHtml, sanitizeHtml } from './richText.js'

export const DOCUMENT_TYPES = ['Work Instruction', 'SOP']

export const STATUSES = ['Draft', 'In Review', 'Released', 'Obsolete']

export const TOOL_KINDS = ['Tool', 'Fixture', 'Gage', 'Consumable', 'Part']

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

function copyImage(image, bomMap, toolMap) {
  const next = savedImage(image)
  if (!next) return null
  return {
    ...next,
    attachmentId: crypto.randomUUID(),
    annotations: (next.annotations || []).map((item) => {
      const copy = { ...item, id: crypto.randomUUID() }
      if (copy.bomLineId && bomMap) copy.bomLineId = bomMap.get(copy.bomLineId) || ''
      if (copy.toolId && toolMap) copy.toolId = toolMap.get(copy.toolId) || ''
      return copy
    }),
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

function normalizeTool(raw) {
  if (!raw || typeof raw !== 'object') return null
  return {
    id: String(raw.id || crypto.randomUUID()),
    kind: TOOL_KINDS.includes(raw.kind) ? raw.kind : 'Tool',
    identifier: String(raw.identifier || ''),
    description: String(raw.description || ''),
    balloon: storedBalloon(raw.balloon),
  }
}

function savedTool(tool) {
  const next = normalizeTool(tool)
  if (!next) return null
  next.identifier = next.identifier.trim()
  next.description = next.description.trim()
  if (!next.identifier && !next.description) return null
  return next
}

function storedBalloon(value) {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 && number < 10000 ? number : 0
}

function normalizeBomLine(raw) {
  if (!raw || typeof raw !== 'object') return null
  return {
    id: String(raw.id || crypto.randomUUID()),
    partNumber: String(raw.partNumber || ''),
    description: String(raw.description || ''),
    quantity: String(raw.quantity ?? ''),
    lineNo: String(raw.lineNo ?? ''),
    sequence: String(raw.sequence ?? ''),
    balloon: storedBalloon(raw.balloon),
  }
}

// Keep a part's balloon number. A missing number gets the next unused one
// and is never rewritten when the list is reordered or another part is removed.
export function assignBalloons(lines) {
  const used = new Set()
  const prepared = (lines || []).map((line) => {
    if (line.balloon && !used.has(line.balloon)) {
      used.add(line.balloon)
      return line
    }
    return { ...line, balloon: 0 }
  })
  let next = used.size ? Math.max(...used) + 1 : 1
  return prepared.map((line) => {
    if (line.balloon) return line
    const balloon = next
    next += 1
    return { ...line, balloon }
  })
}

export function nextBalloonNumber(lines) {
  const numbers = (lines || []).map((line) => storedBalloon(line.balloon)).filter(Boolean)
  return numbers.length ? Math.max(...numbers) + 1 : 1
}

export function assignToolBalloons(tools) {
  return assignBalloons(tools || [])
}

function tieBalloonImages(images, partsById, toolsById) {
  return (images || []).map((image) => {
    if (!image) return image
    return {
      ...image,
      annotations: (image.annotations || []).map((item) => {
        if (item.type !== 'callout') return item
        if (item.bomLineId) {
          const line = partsById.get(item.bomLineId)
          if (!line) return item
          return { ...item, number: line.balloon, text: '', color: CALLOUT_BLUE }
        }
        if (item.toolId) {
          const tool = toolsById.get(item.toolId)
          if (!tool) return item
          return { ...item, number: tool.balloon, text: '', color: TOOL_BALLOON }
        }
        return item
      }),
    }
  })
}

function tieDocumentBalloons(doc) {
  const partsById = new Map((doc.bomLines || []).map((line) => [line.id, line]))
  const toolsById = new Map((doc.equipment || []).map((tool) => [tool.id, tool]))
  const coverImages = tieBalloonImages(doc.coverImages, partsById, toolsById)
  const completedImages = tieBalloonImages(doc.completedImages, partsById, toolsById)
  const bomImages = tieBalloonImages(doc.bomImages, partsById, toolsById)
  return {
    ...doc,
    coverImages,
    completedImages,
    bomImages,
    coverImage: coverImages[0] || doc.coverImage || null,
    completedImage: completedImages[0] || doc.completedImage || null,
    steps: (doc.steps || []).map((step) => ({
      ...step,
      images: tieBalloonImages(step.images, partsById, toolsById),
    })),
  }
}

function sameKey(value) {
  return String(value || '').trim().toLowerCase()
}

export function mergeImportedBom(existing, parsed) {
  const pool = (existing || []).map((line) => ({ ...line, used: false }))
  function take(match) {
    if (!match || match.used) return null
    match.used = true
    return match
  }
  const lines = (parsed || []).map((row) => {
    const partKey = sameKey(row.partNumber)
    let match = partKey
      ? take(pool.find((line) => !line.used && sameKey(line.partNumber) === partKey))
      : null
    if (!match && row.description) {
      const description = sameKey(row.description)
      const candidates = pool.filter((line) => !line.used && sameKey(line.description) === description)
      if (candidates.length === 1) match = take(candidates[0])
    }
    if (!match && row.lineNo) {
      const lineKey = sameKey(row.lineNo)
      match = take(
        pool.find(
          (line) => !line.used && (sameKey(line.lineNo) === lineKey || sameKey(line.partNumber) === lineKey),
        ),
      )
    }
    if (match) {
      return {
        ...match,
        partNumber: row.partNumber || match.partNumber,
        description: row.description,
        quantity: row.quantity,
        lineNo: row.lineNo,
        sequence: row.sequence,
        balloon: match.balloon,
        id: match.id,
      }
    }
    return createBomLine(row)
  })
  return assignBalloons(lines)
}

export function toolsForStep(step, equipment) {
  if (Array.isArray(step?.toolIds)) {
    const byId = new Map((equipment || []).map((tool) => [tool.id, tool]))
    return step.toolIds.map((id) => byId.get(id)).filter(Boolean)
  }
  return step?.tools || []
}

function referenceLookups(doc) {
  return {
    parts: new Map((doc.bomLines || []).map((line) => [line.id, line])),
    tools: new Map((doc.equipment || []).map((tool) => [tool.id, tool])),
  }
}

export function refreshDocumentReferences(doc) {
  const { parts, tools } = referenceLookups(doc)
  const keepPart = (id) => parts.has(id)
  function keepMark(item) {
    if (item.type !== 'callout') return true
    if (item.bomLineId && !keepPart(item.bomLineId)) return false
    if (item.toolId && !tools.has(item.toolId)) return false
    return true
  }
  const next = {
    ...doc,
    steps: (doc.steps || []).map((step) => ({
      ...step,
      instruction: refreshReferenceHtml(step.instruction, parts, tools),
      qualityCheck: refreshReferenceHtml(step.qualityCheck, parts, tools),
      bomLineIds: (step.bomLineIds || []).filter(keepPart),
      toolIds: Array.isArray(step.toolIds) ? step.toolIds.filter((id) => tools.has(id)) : step.toolIds,
      images: (step.images || []).map((image) => ({
        ...image,
        annotations: (image.annotations || []).filter(keepMark),
      })),
    })),
    coverImages: (doc.coverImages || []).map((image) => ({
      ...image,
      annotations: (image.annotations || []).filter(keepMark),
    })),
    completedImages: (doc.completedImages || []).map((image) => ({
      ...image,
      annotations: (image.annotations || []).filter(keepMark),
    })),
  }
  return tieDocumentBalloons(next)
}

export function applyImportedBom(doc, parsed) {
  return refreshDocumentReferences({
    ...doc,
    bomLines: mergeImportedBom(doc.bomLines || [], parsed),
  })
}

export function renumberDocumentBom(doc) {
  return refreshDocumentReferences({
    ...doc,
    bomLines: (doc.bomLines || []).map((line, index) => ({ ...line, balloon: index + 1 })),
  })
}

function savedBomLine(line) {
  const next = normalizeBomLine(line)
  if (!next) return null
  next.partNumber = next.partNumber.trim()
  next.description = next.description.trim()
  next.quantity = next.quantity.trim()
  next.lineNo = next.lineNo.trim()
  next.sequence = next.sequence.trim()
  if (!next.partNumber && !next.description) return null
  return next
}

function normalizeStep(raw, index) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const images = Array.isArray(source.images)
    ? source.images.map(normalizeImage).filter(Boolean)
    : []
  const tools = Array.isArray(source.tools) ? source.tools.map(normalizeTool).filter(Boolean) : []
  return {
    ...source,
    id: String(source.id || `step-${index + 1}`),
    title: String(source.title || ''),
    instruction: String(source.instruction || ''),
    tools,
    ...(Array.isArray(source.toolIds) ? { toolIds: source.toolIds.map(String) } : {}),
    bomLineIds: Array.isArray(source.bomLineIds) ? source.bomLineIds.map(String) : [],
    toolsOrParts: String(source.toolsOrParts || ''),
    qualityCheck: String(source.qualityCheck || ''),
    safetyNote: String(source.safetyNote || ''),
    imageNote: String(source.imageNote || ''),
    images,
  }
}

export function createToolItem() {
  return normalizeTool({ id: crypto.randomUUID(), kind: 'Tool' })
}

export function createBomLine(fields = {}) {
  return normalizeBomLine({ id: crypto.randomUUID(), ...fields })
}

export function createStep() {
  return normalizeStep({ id: crypto.randomUUID(), tools: [], toolIds: [] }, 0)
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

  return tieDocumentBalloons({
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
    equipment: assignToolBalloons(
      Array.isArray(source.equipment) ? source.equipment.map(normalizeTool).filter(Boolean) : [],
    ),
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
    bomLines: assignBalloons(
      Array.isArray(source.bomLines) ? source.bomLines.map(normalizeBomLine).filter(Boolean) : [],
    ),
    coverImage: normalizeImage(source.coverImage),
    completedImage: normalizeImage(source.completedImage),
    steps: Array.isArray(source.steps) ? source.steps.map(normalizeStep) : [],
  })
}

export function createBlankDocument() {
  return normalizeDocument({
    id: crypto.randomUUID(),
    revision: 'A',
    status: 'Draft',
    equipment: [createToolItem()],
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
  next.equipment = assignToolBalloons((doc.equipment || []).map(savedTool).filter(Boolean))
  next.bomLines = assignBalloons((doc.bomLines || []).map(savedBomLine).filter(Boolean))
  const bomIds = new Set(next.bomLines.map((line) => line.id))
  const equipmentIds = new Set(next.equipment.map((tool) => tool.id))
  next.steps = (doc.steps || []).map((step) => ({
    ...step,
    title: String(step.title ?? '').trim(),
    instruction: storedText(step.instruction, true),
    tools: (step.tools || []).map(savedTool).filter(Boolean),
    ...(Array.isArray(step.toolIds)
      ? { toolIds: step.toolIds.map(String).filter((id) => equipmentIds.has(id)) }
      : {}),
    bomLineIds: (step.bomLineIds || []).map(String).filter((id) => bomIds.has(id)),
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
  return refreshDocumentReferences(next)
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
  const bomLines = (source.bomLines || []).map((line) => {
    const id = crypto.randomUUID()
    return { from: line.id, line: { ...line, id } }
  })
  const bomMap = new Map(bomLines.map((item) => [item.from, item.line.id]))
  const equipment = (source.equipment || []).map((tool) => {
    const id = crypto.randomUUID()
    return { from: tool.id, tool: { ...tool, id } }
  })
  const toolMap = new Map(equipment.map((item) => [item.from, item.tool.id]))
  return normalizeDocument({
    ...source,
    id: crypto.randomUUID(),
    status: 'Draft',
    revision: nextRevision(source.revision),
    revisesId: source.id,
    basedOnRevision: source.revision,
    effectiveDate: '',
    updatedAt: new Date().toISOString(),
    coverImages: (source.coverImages || []).map((image) => copyImage(image, bomMap, toolMap)).filter(Boolean),
    completedImages: (source.completedImages || []).map((image) => copyImage(image, bomMap, toolMap)).filter(Boolean),
    bomImages: (source.bomImages || []).map((image) => copyImage(image, bomMap, toolMap)).filter(Boolean),
    coverImage: null,
    completedImage: null,
    equipment: equipment.map((item) => item.tool),
    bomLines: bomLines.map((item) => item.line),
    steps: source.steps.map((step) => ({
      ...step,
      id: crypto.randomUUID(),
      instruction: remapReferenceHtml(step.instruction, bomMap, toolMap),
      qualityCheck: remapReferenceHtml(step.qualityCheck, bomMap, toolMap),
      tools: (step.tools || []).map((tool) => ({ ...tool, id: crypto.randomUUID() })),
      ...(Array.isArray(step.toolIds)
        ? { toolIds: step.toolIds.map((id) => toolMap.get(id)).filter(Boolean) }
        : {}),
      bomLineIds: (step.bomLineIds || []).map((id) => bomMap.get(id)).filter(Boolean),
      images: (step.images || []).map((image) => copyImage(image, bomMap, toolMap)).filter(Boolean),
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
