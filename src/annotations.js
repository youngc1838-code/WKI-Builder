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
// Balloons are sized for a photo printed on letter paper, not for the camera pixel size.
export const CALLOUT_BLUE = '#0e4d7b'
const LETTER_PHOTO_IN = { w: 7.4, h: 5.2 }
const BALLOON_DIAMETER_IN = 0.28
const LABEL_PT = 8
const DETAIL_PT = 6.5
const LABEL_MIN_PT = 5.5

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
    item.size = clamp(raw.size, 1, 30, 3.2)
    item.bomLineId = raw.bomLineId ? String(raw.bomLineId) : ''
    if (raw.tipX !== undefined && raw.tipX !== null && raw.tipX !== '') {
      item.tipX = clamp(raw.tipX, 0, 100, item.x)
      item.tipY = clamp(raw.tipY, 0, 100, item.y)
    }
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
  for (const key of ['x', 'y', 'w', 'h', 'x2', 'y2', 'r', 'stroke', 'fontSize', 'size', 'tipX', 'tipY']) {
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

function sourcePixelsPerInch(imageWidth, imageHeight) {
  const width = Math.max(1, imageWidth)
  const height = Math.max(1, imageHeight)
  const inchesPerPixel = Math.min(LETTER_PHOTO_IN.w / width, LETTER_PHOTO_IN.h / height)
  return 1 / inchesPerPixel
}

let measureCanvas = null

function textWidth(text, fontSize, weight) {
  if (!text) return 0
  if (typeof document === 'undefined') return text.length * fontSize * 0.56
  if (!measureCanvas) measureCanvas = document.createElement('canvas')
  const context = measureCanvas.getContext('2d')
  context.font = `${weight} ${fontSize}px "Segoe UI", sans-serif`
  return context.measureText(text).width
}

function labelParts(text) {
  const raw = String(text || '').trim()
  if (!raw) return { title: '', detail: '' }
  const pieces = raw.split(' · ')
  return { title: pieces[0], detail: pieces.slice(1).join(' · ') }
}

export function calloutMetrics(imageWidth, imageHeight) {
  const pxPerIn = sourcePixelsPerInch(imageWidth, imageHeight)
  return { pxPerIn, radius: (BALLOON_DIAMETER_IN / 2) * pxPerIn }
}

// Click is the part. The balloon sits beside it so the leader can reach the click.
export function placeBalloonAnchor(point, imageWidth, imageHeight) {
  const width = Math.max(1, imageWidth)
  const height = Math.max(1, imageHeight)
  const { radius, pxPerIn } = calloutMetrics(width, height)
  const tipX = clamp((point.x / 100) * width, 0, width, width / 2)
  const tipY = clamp((point.y / 100) * height, 0, height, height / 2)
  const gap = radius + 0.42 * pxPerIn
  const spots = [
    { x: tipX + gap, y: tipY },
    { x: tipX - gap, y: tipY },
    { x: tipX, y: tipY - gap },
    { x: tipX, y: tipY + gap },
  ]
  const fits = (spot) =>
    spot.x >= radius && spot.x <= width - radius && spot.y >= radius && spot.y <= height - radius
  const ranked = spots
    .filter(fits)
    .map((spot) => {
      const room = tipX >= spot.x ? spot.x - radius : width - spot.x - radius
      return { ...spot, room }
    })
    .sort((a, b) => b.room - a.room)
  const chosen = ranked[0] || {
    x: clamp(tipX, radius, width - radius, width / 2),
    y: clamp(tipY, radius, height - radius, height / 2),
  }
  return {
    x: (chosen.x / width) * 100,
    y: (chosen.y / height) * 100,
    tipX: (tipX / width) * 100,
    tipY: (tipY / height) * 100,
  }
}

function fitCalloutLabel(title, detail, cx, cy, radius, tipX, imageWidth, imageHeight, pxPerIn) {
  if (!title) return null
  const margin = Math.max(3, 0.04 * pxPerIn)
  const gap = Math.max(4, 0.05 * pxPerIn)
  const titleSize = (LABEL_PT / 72) * pxPerIn
  const detailSize = detail ? (DETAIL_PT / 72) * pxPerIn : 0
  const minTitle = (LABEL_MIN_PT / 72) * pxPerIn
  const sides = [-1, 1]
    .map((dir) => {
      const room = dir === 1 ? imageWidth - margin - (cx + radius + gap) : cx - radius - gap - margin
      const opposite = (tipX - cx) * dir < 0
      return { dir, room: Math.max(0, room), score: room + (opposite ? imageWidth * 0.25 : 0) }
    })
    .sort((a, b) => b.score - a.score)

  for (const side of sides) {
    if (side.room < 10 && side !== sides[sides.length - 1]) continue
    const widthAt = (scale) =>
      Math.max(textWidth(title, titleSize * scale, '700'), detail ? textWidth(detail, detailSize * scale, '400') : 0)
    let scale = 1
    const natural = widthAt(1)
    if (natural > side.room && side.room > 0) scale = side.room / natural
    let usedTitle = titleSize * scale
    if (usedTitle < minTitle && side !== sides[sides.length - 1]) continue
    usedTitle = Math.max(side === sides[sides.length - 1] ? 1 : minTitle, usedTitle)
    const usedScale = usedTitle / titleSize
    let width = widthAt(usedScale)
    if (width > side.room) {
      const fitRoom = Math.max(8, side.room)
      if (fitRoom < width && side !== sides[sides.length - 1] && usedTitle < minTitle) continue
      usedTitle *= fitRoom / Math.max(width, 1)
      width = fitRoom
    }
    const usedDetail = detail ? detailSize * (usedTitle / titleSize) : 0
    const lineGap = usedDetail ? usedTitle * 0.2 : 0
    const height = usedTitle + lineGap + usedDetail
    const y = clamp(cy - height / 2, margin, Math.max(margin, imageHeight - margin - height), margin)
    const x = side.dir === 1 ? cx + radius + gap : cx - radius - gap - width
    if (x < margin - 1 && side !== sides[sides.length - 1]) continue
    return {
      x: clamp(x, margin, Math.max(margin, imageWidth - margin - width), margin),
      y,
      width,
      title,
      detail,
      titleSize: usedTitle,
      detailSize: usedDetail,
      lineGap,
    }
  }
  return null
}

export function calloutLayout(item, imageWidth, imageHeight, stroke) {
  const width = Math.max(1, imageWidth)
  const height = Math.max(1, imageHeight)
  const { pxPerIn, radius } = calloutMetrics(width, height)
  const cx = clamp((item.x / 100) * width, radius, width - radius, width / 2)
  const cy = clamp((item.y / 100) * height, radius, height - radius, height / 2)
  let tipX = item.tipX === undefined ? null : (item.tipX / 100) * width
  let tipY = item.tipY === undefined ? null : (item.tipY / 100) * height
  if (tipX === null || tipY === null) {
    const reach = 0.45 * pxPerIn
    const dx = width / 2 - cx
    const dy = height / 2 - cy
    const mag = Math.hypot(dx, dy) || 1
    tipX = cx + (dx / mag) * reach
    tipY = cy + (dy / mag) * reach
  }
  tipX = clamp(tipX, 0, width, cx)
  tipY = clamp(tipY, 0, height, cy)
  const dx = tipX - cx
  const dy = tipY - cy
  const length = Math.hypot(dx, dy) || 1
  const showLeader = length > radius + 4
  const edgeX = cx + (dx / length) * radius
  const edgeY = cy + (dy / length) * radius
  const leaderPt = Math.min(1.75, 0.9 + Number(item.stroke || stroke || DEFAULT_STROKE) * 0.45)
  const leaderWidth = (leaderPt / 72) * pxPerIn
  return {
    x: cx,
    y: cy,
    radius,
    tipX,
    tipY,
    edgeX,
    edgeY,
    showLeader,
    leaderWidth,
    head: 0.09 * pxPerIn,
    numberSize: Math.min((8.5 / 72) * pxPerIn, radius * 0.95),
    label: null,
    stroke,
  }
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
  return calloutLayout(item, imageWidth, imageHeight, stroke)
}

export function createPlacedAnnotation(type, point, items, style, extra = {}) {
  const base = {
    id: crypto.randomUUID(),
    type,
    x: point.x,
    y: point.y,
    text: type === 'text' ? 'Text' : String(extra.text || ''),
    color: style.color,
    stroke: style.stroke,
  }
  if (type === 'callout') {
    return normalizeAnnotation({
      ...base,
      color: style.color || CALLOUT_BLUE,
      number: extra.number || nextCalloutNumber(items),
      size: 3.2,
      bomLineId: extra.bomLineId || '',
      tipX: extra.tipX,
      tipY: extra.tipY,
    })
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

// The printed picture is the photo. The frame grows only when a mark sits outside it.
export function contentFrame(items, aspect = 1) {
  let minX = 0
  let minY = 0
  let maxX = 100
  let maxY = 100
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
      if (item.tipX !== undefined) add(item.tipX, item.tipY)
    }
  }
  return {
    minX: Math.max(-200, minX < 0 ? minX - 2 : 0),
    minY: Math.max(-200, minY < 0 ? minY - 2 : 0),
    maxX: Math.min(300, maxX > 100 ? maxX + 2 : 100),
    maxY: Math.min(300, maxY > 100 ? maxY + 2 : 100),
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
      if (item.tipX !== undefined) next.tipX = (item.tipX - crop.x) * scaleX
      if (item.tipY !== undefined) next.tipY = (item.tipY - crop.y) * scaleY
      return next
    }),
  )
}
