// Draws the original photo and its annotations at the photo's own pixel size.
// The result is stored beside the document. The editable annotations stay separate.

import Konva from 'konva'
import { contentFrame, geometry, normalizeAnnotations } from './annotations.js'

function addShape(layer, item, width, height) {
  const box = geometry(item, width, height)
  const color = item.color
  if (item.type === 'arrow') {
    const head = Math.max(16, box.stroke * 4)
    layer.add(
      new Konva.Arrow({
        points: [box.x1, box.y1, box.x2, box.y2],
        stroke: '#ffffff',
        fill: '#ffffff',
        strokeWidth: box.stroke + 4,
        pointerLength: head + 2,
        pointerWidth: head + 2,
        lineCap: 'round',
      }),
    )
    layer.add(
      new Konva.Arrow({
        points: [box.x1, box.y1, box.x2, box.y2],
        stroke: color,
        fill: color,
        strokeWidth: box.stroke,
        pointerLength: head,
        pointerWidth: head,
        lineCap: 'round',
      }),
    )
    return
  }
  if (item.type === 'rect') {
    layer.add(
      new Konva.Rect({
        x: box.x,
        y: box.y,
        width: Math.max(1, box.w),
        height: Math.max(1, box.h),
        stroke: '#ffffff',
        strokeWidth: box.stroke + 4,
      }),
    )
    layer.add(
      new Konva.Rect({
        x: box.x,
        y: box.y,
        width: Math.max(1, box.w),
        height: Math.max(1, box.h),
        stroke: color,
        strokeWidth: box.stroke,
      }),
    )
    return
  }
  if (item.type === 'ellipse') {
    layer.add(
      new Konva.Ellipse({
        x: box.x + box.w / 2,
        y: box.y + box.h / 2,
        radiusX: Math.max(1, box.w / 2),
        radiusY: Math.max(1, box.h / 2),
        stroke: '#ffffff',
        strokeWidth: box.stroke + 4,
      }),
    )
    layer.add(
      new Konva.Ellipse({
        x: box.x + box.w / 2,
        y: box.y + box.h / 2,
        radiusX: Math.max(1, box.w / 2),
        radiusY: Math.max(1, box.h / 2),
        stroke: color,
        strokeWidth: box.stroke,
      }),
    )
    return
  }
  if (item.type === 'text') {
    const label = item.text.trim() || 'Label'
    const fontSize = box.fontSize
    const text = new Konva.Text({
      x: box.x + 8,
      y: box.y + 6,
      text: label,
      fontSize,
      fontStyle: 'bold',
      fontFamily: 'Segoe UI, sans-serif',
      fill: '#1b2430',
    })
    layer.add(
      new Konva.Rect({
        x: box.x,
        y: box.y,
        width: text.width() + 16,
        height: text.height() + 12,
        fill: '#ffffff',
        stroke: color,
        strokeWidth: Math.max(1.5, box.stroke * 0.6),
        cornerRadius: 3,
      }),
    )
    layer.add(text)
    return
  }
  const group = new Konva.Group({ x: box.x, y: box.y })
  group.add(new Konva.Circle({ radius: box.radius, fill: color, stroke: '#ffffff', strokeWidth: 3 }))
  group.add(
    new Konva.Text({
      text: String(item.number || ''),
      fontSize: Math.max(12, box.radius),
      fontStyle: 'bold',
      fontFamily: 'Segoe UI, sans-serif',
      fill: '#ffffff',
      width: box.radius * 2,
      offsetX: box.radius,
      offsetY: Math.max(12, box.radius) / 2,
      align: 'center',
    }),
  )
  const note = item.text.trim()
  if (note) {
    const noteSize = Math.max(14, box.radius * 0.85)
    group.add(
      new Konva.Text({
        x: box.radius + 8,
        y: -noteSize / 2,
        text: note,
        fontSize: noteSize,
        fontStyle: 'bold',
        fontFamily: 'Segoe UI, sans-serif',
        fill: '#1b2430',
        stroke: '#ffffff',
        strokeWidth: 4,
        fillAfterStrokeEnabled: true,
      }),
    )
  }
  layer.add(group)
}

export function loadHtmlImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Could not read the photo.'))
    image.src = src
  })
}

export function renderComposite(image, annotations) {
  const width = image.naturalWidth || image.width
  const height = image.naturalHeight || image.height
  const marks = normalizeAnnotations(annotations)
  const frame = contentFrame(marks, width / height || 1)
  const boardW = Math.max(1, Math.round(((frame.maxX - frame.minX) / 100) * width))
  const boardH = Math.max(1, Math.round(((frame.maxY - frame.minY) / 100) * height))
  const photoX = Math.round((-frame.minX / 100) * width)
  const photoY = Math.round((-frame.minY / 100) * height)
  const container = document.createElement('div')
  const stage = new Konva.Stage({ container, width: boardW, height: boardH })
  const layer = new Konva.Layer()
  stage.add(layer)
  layer.add(new Konva.Rect({ x: 0, y: 0, width: boardW, height: boardH, fill: '#ffffff' }))
  layer.add(new Konva.Image({ image, x: photoX, y: photoY, width, height }))
  const marksGroup = new Konva.Group({ x: photoX, y: photoY })
  layer.add(marksGroup)
  for (const item of marks) addShape(marksGroup, item, width, height)
  layer.draw()
  const canvas = stage.toCanvas({ pixelRatio: 1 })
  stage.destroy()
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) reject(new Error('Could not create the annotated image.'))
      else resolve(blob)
    }, 'image/png')
  })
}
