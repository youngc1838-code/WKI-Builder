// Annotations are stored as percentages of the photo, so they stay aligned
// when the editor is resized or the photo is shown at another size.
// The original photo file is never changed.

export const ANNOTATION_COLORS = [
  { id: 'red', label: 'Red', value: '#8d2f2f' },
  { id: 'blue', label: 'Blue', value: '#0e4d7b' },
  { id: 'green', label: 'Green', value: '#1f7a3a' },
  { id: 'black', label: 'Black', value: '#1b2430' },
  { id: 'amber', label: 'Amber', value: '#a56b00' },
  { id: 'white', label: 'White', value: '#ffffff' },
]

export const LINE_THICKNESS = [
  { id: 'thin', label: 'Thin', value: 0.28 },
  { id: 'medium', label: 'Medium', value: 0.5 },
  { id: 'thick', label: 'Thick', value: 0.85 },
  { id: 'heavy', label: 'Heavy', value: 1.25 },
]

const TYPES = ['arrow', 'rect', 'ellipse', 'text', 'callout']
const DEFAULT_COLOR = '#8d2f2f'
const DEFAULT_STROKE = 0.5

function clamp(value, min, max, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, number))
}

function round(value) {
  return Math.round(Number(value) * 100) / 100
}

function colorOf(value) {
  const text = String(value || '').trim()
  return /^#[0-9a-fA-F]{6}$/.test(text) ? text.toLowerCase() : DEFAULT_COLOR
}

function legacyMark(raw) {
  if (!raw || typeof raw !== 'object') return null
  const shared = {
    id: raw.id,
    color: raw.color,
    stroke: raw.stroke,
    text: raw.text,
  }
  if (raw.type === 'arrow') return { ...shared, type: 'arrow', x: raw.x, y: raw.y, x2: raw.x2, y2: raw.y2 }
  if (raw.type === 'label') return { ...shared, type: 'text', x: raw.x, y: raw.y, text: raw.text || 'Label' }
  if (raw.type === 'callout') {
    return { ...shared, type: 'callout', x: raw.x, y: raw.y, number: raw.number, text: raw.text, size: raw.r }
  }
  if (raw.type === 'circle') {
    return { ...shared, type: 'ellipse', x: raw.x, y: raw.y, r: raw.r, circular: true }
  }
  return raw
}

export function normalizeAnnotation(raw) {
  if (!raw || typeof raw !== 'object' || !TYPES.includes(raw.type)) return null
  const item = {
    id: String(raw.id || crypto.randomUUID()),
    type: raw.type,
    x: clamp(raw.x, -200, 300, 0),
    y: clamp(raw.y, -200, 300, 0),
    text: String(raw.text || ''),
    color: colorOf(raw.color),
    stroke: clamp(raw.stroke, 0.1, 12, DEFAULT_STROKE),
  }
  if (raw.type === 'arrow') {
    item.x2 = clamp(raw.x2, -200, 300, item.x)
    item.y2 = clamp(raw.y2, -200, 300, item.y)
  }
  if (raw.type === 'rect' || raw.type === 'ellipse') {
    item.w = clamp(raw.w, 0, 400, 0)
    item.h = clamp(raw.h, 0, 400, 0)
  }
  if (raw.type === 'ellipse' && raw.circular) {
    item.circular = true
    item.r = clamp(raw.r, 0.4, 100, 8)
  }
  if (raw.type === 'text') item.fontSize = clamp(raw.fontSize, 0.8, 24, 2.4)
  if (raw.type === 'callout') {
    const number = Number(raw.number)
    item.number = Number.isInteger(number) && number > 0 && number < 1000 ? number : 1
    item.size = clamp(raw.size, 1, 30, 2.4)
  }
  return item
}

export function normalizeAnnotations(raw) {
  if (!Array.isArray(raw)) return []
  return raw.map(normalizeAnnotation).filter(Boolean)
}

export function annotationsFromImage(raw) {
  if (!raw || typeof raw !== 'object') return []
  const hasMarks = Array.isArray(raw.marks) && raw.marks.length > 0
  if (Array.isArray(raw.annotations) && (raw.annotations.length > 0 || !hasMarks)) {
    return normalizeAnnotations(raw.annotations)
  }
  if (hasMarks) return normalizeAnnotations(raw.marks.map(legacyMark).filter(Boolean))
  return []
}

export function roundAnnotation(item) {
  const next = normalizeAnnotation(item)
  if (!next) return null
  for (const key of ['x', 'y', 'w', 'h', 'x2', 'y2', 'r', 'stroke', 'fontSize', 'size']) {
    if (next[key] !== undefined) next[key] = round(next[key])
  }
  next.text = String(next.text || '').trim()
  return next
}

export function nextCalloutNumber(items) {
  const numbers = (items || [])
    .filter((item) => item.type === 'callout')
    .map((item) => Number(item.number) || 0)
  if (!numbers.length) return 1
  return Math.max(...numbers) + 1
}

export function strokePixels(item, imageWidth) {
  return Math.max(1.5, ((Number(item.stroke) || DEFAULT_STROKE) / 100) * imageWidth)
}

function percent(pixel, size) {
  if (!size) return 0
  return (pixel / size) * 100
}

// Turn a legacy circle into a normal ellipse once the photo size is known.
export function resolveAnnotations(items, imageWidth, imageHeight) {
  return normalizeAnnotations(items).map((item) => {
    if (item.type !== 'ellipse' || !item.circular || !imageWidth || !imageHeight) return item
    const radius = (item.r / 100) * imageWidth
    const centerX = (item.x / 100) * imageWidth
    const centerY = (item.y / 100) * imageHeight
    return normalizeAnnotation({
      ...item,
      circular: false,
      r: undefined,
      x: percent(centerX - radius, imageWidth),
      y: percent(centerY - radius, imageHeight),
      w: percent(radius * 2, imageWidth),
      h: percent(radius * 2, imageHeight),
    })
  })
}

export function geometry(item, imageWidth, imageHeight) {
  const x = (item.x / 100) * imageWidth
  const y = (item.y / 100) * imageHeight
  const stroke = strokePixels(item, imageWidth)
  if (item.type === 'arrow') {
    return {
      x1: x,
      y1: y,
      x2: (item.x2 / 100) * imageWidth,
      y2: (item.y2 / 100) * imageHeight,
      stroke,
    }
  }
  if (item.type === 'rect' || (item.type === 'ellipse' && !item.circular)) {
    return {
      x,
      y,
      w: (item.w / 100) * imageWidth,
      h: (item.h / 100) * imageHeight,
      stroke,
    }
  }
  if (item.type === 'ellipse' && item.circular) {
    const radius = (item.r / 100) * imageWidth
    return { x: x - radius, y: y - radius, w: radius * 2, h: radius * 2, stroke }
  }
  if (item.type === 'text') {
    return { x, y, fontSize: Math.max(12, ((item.fontSize || 2.4) / 100) * imageWidth), stroke }
  }
  const radius = ((item.size || 2.4) / 100) * imageWidth
  return { x, y, radius: Math.max(12, radius), stroke }
}

export function createPlacedAnnotation(type, point, items, style) {
  const base = {
    id: crypto.randomUUID(),
    type,
    x: point.x,
    y: point.y,
    text: type === 'text' ? 'Label' : '',
    color: style.color,
    stroke: style.stroke,
  }
  if (type === 'callout') {
    return normalizeAnnotation({ ...base, number: nextCalloutNumber(items), size: 2.4 })
  }
  if (type === 'text') return normalizeAnnotation({ ...base, fontSize: 2.4 })
  return null
}

export function annotationFromDrag(draft) {
  if (!draft) return null
  if (draft.type === 'arrow') {
    const length = Math.hypot(draft.x2 - draft.x, draft.y2 - draft.y)
    if (length < 1) return null
    return normalizeAnnotation({
      id: crypto.randomUUID(),
      type: 'arrow',
      x: draft.x,
      y: draft.y,
      x2: draft.x2,
      y2: draft.y2,
      color: draft.color,
      stroke: draft.stroke,
      text: '',
    })
  }
  const w = Math.abs(draft.w)
  const h = Math.abs(draft.h)
  if (w < 1 || h < 1) return null
  const x = draft.w < 0 ? draft.x + draft.w : draft.x
  const y = draft.h < 0 ? draft.y + draft.h : draft.y
  return normalizeAnnotation({
    id: crypto.randomUUID(),
    type: draft.type,
    x,
    y,
    w,
    h,
    color: draft.color,
    stroke: draft.stroke,
    text: '',
  })
}

// The photo sits on a blank sheet. Marks may sit on that sheet, past the photo edges.
const SHEET_PAD = 22

export function contentFrame(items, aspect = 1) {
  let minX = -SHEET_PAD
  let minY = -SHEET_PAD
  let maxX = 100 + SHEET_PAD
  let maxY = 100 + SHEET_PAD
  const add = (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  for (const item of normalizeAnnotations(items)) {
    add(item.x, item.y)
    if (item.type === 'arrow') add(item.x2, item.y2)
    if (item.type === 'rect' || (item.type === 'ellipse' && !item.circular)) {
      add(item.x + item.w, item.y + item.h)
    }
    if (item.type === 'ellipse' && item.circular) {
      add(item.x - item.r, item.y - item.r * aspect)
      add(item.x + item.r, item.y + item.r * aspect)
    }
    if (item.type === 'text') {
      const font = item.fontSize || 2.4
      const label = item.text.trim() || 'Label'
      add(item.x + Math.min(60, label.length * font * 0.55), item.y + font * aspect + 4)
    }
    if (item.type === 'callout') {
      const pad = item.size || 2.4
      const extra = item.text.trim() ? Math.min(46, item.text.trim().length * 1.6) : 0
      add(item.x - pad, item.y - pad * aspect)
      add(item.x + pad + extra, item.y + pad * aspect)
    }
  }
  return {
    minX: Math.max(-200, minX - 4),
    minY: Math.max(-200, minY - 4),
    maxX: Math.min(300, maxX + 4),
    maxY: Math.min(300, maxY + 4),
  }
}

// Keep marks on the same part of the photo after a trim. Crop values are percentages.
export function remapAnnotations(items, crop) {
  const width = Number(crop?.w)
  const height = Number(crop?.h)
  if (!width || !height) return normalizeAnnotations(items)
  const scaleX = 100 / width
  const scaleY = 100 / height
  return normalizeAnnotations(
    normalizeAnnotations(items).map((item) => {
      const next = {
        ...item,
        x: (item.x - crop.x) * scaleX,
        y: (item.y - crop.y) * scaleY,
        stroke: item.stroke * scaleX,
      }
      if (item.x2 !== undefined) next.x2 = (item.x2 - crop.x) * scaleX
      if (item.y2 !== undefined) next.y2 = (item.y2 - crop.y) * scaleY
      if (item.w !== undefined) next.w = item.w * scaleX
      if (item.h !== undefined) next.h = item.h * scaleY
      if (item.r !== undefined) next.r = item.r * scaleX
      if (item.fontSize !== undefined) next.fontSize = item.fontSize * scaleX
      if (item.size !== undefined) next.size = item.size * scaleX
      return next
    }),
  )
}
