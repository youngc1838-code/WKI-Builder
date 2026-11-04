// Replace a bench backdrop with a plain studio sweep. The part stays; pixels
// close to the colors along the photo edge become the new background.

export const STUDIO_BACKDROPS = [
  { id: 'keep', label: 'Keep photo' },
  { id: 'white', label: 'White studio' },
  { id: 'gray', label: 'Gray studio' },
]

function fitSize(width, height, maxEdge) {
  const scale = Math.min(1, maxEdge / Math.max(width, height, 1))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

function borderColors(data, width, height) {
  const buckets = new Map()
  const add = (x, y) => {
    const offset = (y * width + x) * 4
    const key = `${data[offset] >> 4},${data[offset + 1] >> 4},${data[offset + 2] >> 4}`
    buckets.set(key, (buckets.get(key) || 0) + 1)
  }
  for (let x = 0; x < width; x += 1) {
    add(x, 0)
    if (height > 1) add(x, height - 1)
  }
  for (let y = 1; y < height - 1; y += 1) {
    add(0, y)
    if (width > 1) add(width - 1, y)
  }
  const ranked = [...buckets.entries()].sort((a, b) => b[1] - a[1])
  const total = ranked.reduce((sum, entry) => sum + entry[1], 0) || 1
  const picked = ranked.filter((entry, index) => index < 3 && entry[1] / total >= 0.08)
  const used = picked.length ? picked : ranked.slice(0, 1)
  return used.map(([key]) => {
    const [r, g, b] = key.split(',').map((part) => Number(part) * 16 + 8)
    return [r, g, b]
  })
}

function matchesBackdrop(r, g, b, colors, tolerance) {
  const limit = tolerance * tolerance
  return colors.some(([cr, cg, cb]) => {
    const dr = r - cr
    const dg = g - cg
    const db = b - cb
    return dr * dr + dg * dg + db * db <= limit
  })
}

function soften(mask, width, height) {
  const next = new Float32Array(mask.length)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0
      let count = 0
      for (let dy = -2; dy <= 2; dy += 1) {
        const ny = y + dy
        if (ny < 0 || ny >= height) continue
        for (let dx = -2; dx <= 2; dx += 1) {
          const nx = x + dx
          if (nx < 0 || nx >= width) continue
          sum += mask[ny * width + nx]
          count += 1
        }
      }
      next[y * width + x] = sum / count
    }
  }
  return next
}

function sweepColor(y, height, backdrop) {
  const t = height <= 1 ? 0 : y / (height - 1)
  if (backdrop === 'white') {
    const value = 250 - t * 10
    return [value, value, value - 1]
  }
  const value = 232 - t * 22
  return [value - 6, value - 3, value]
}

export function paintStudio(image, { backdrop = 'keep', tolerance = 28, maxEdge = 1400 } = {}) {
  const width = image.naturalWidth || image.width
  const height = image.naturalHeight || image.height
  const fitted = fitSize(width, height, maxEdge)
  const canvas = document.createElement('canvas')
  canvas.width = fitted.width
  canvas.height = fitted.height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Could not prepare that photo.')
  context.drawImage(image, 0, 0, fitted.width, fitted.height)
  if (backdrop === 'keep') return canvas

  const photo = context.getImageData(0, 0, fitted.width, fitted.height)
  const colors = borderColors(photo.data, fitted.width, fitted.height)
  const hard = new Uint8Array(fitted.width * fitted.height)
  for (let index = 0; index < hard.length; index += 1) {
    const offset = index * 4
    hard[index] = matchesBackdrop(
      photo.data[offset],
      photo.data[offset + 1],
      photo.data[offset + 2],
      colors,
      tolerance,
    )
      ? 1
      : 0
  }
  const mask = soften(hard, fitted.width, fitted.height)
  const output = context.createImageData(fitted.width, fitted.height)
  for (let y = 0; y < fitted.height; y += 1) {
    const [br, bg, bb] = sweepColor(y, fitted.height, backdrop)
    for (let x = 0; x < fitted.width; x += 1) {
      const index = y * fitted.width + x
      const offset = index * 4
      const amount = mask[index]
      const keep = 1 - amount
      output.data[offset] = photo.data[offset] * keep + br * amount
      output.data[offset + 1] = photo.data[offset + 1] * keep + bg * amount
      output.data[offset + 2] = photo.data[offset + 2] * keep + bb * amount
      output.data[offset + 3] = 255
    }
  }
  context.putImageData(output, 0, 0)
  return canvas
}

function canvasToJpeg(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((result) => {
      if (!result) reject(new Error('Could not save that photo.'))
      else resolve(result)
    }, 'image/jpeg', 0.92)
  })
}

export async function exportTrimmedPhoto(image, crop, options) {
  const painted = paintStudio(image, { ...options, maxEdge: options.backdrop === 'keep' ? 8000 : 2800 })
  const sx = (crop.x / 100) * painted.width
  const sy = (crop.y / 100) * painted.height
  const sw = (crop.w / 100) * painted.width
  const sh = (crop.h / 100) * painted.height
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(sw))
  canvas.height = Math.max(1, Math.round(sh))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Could not trim that photo.')
  context.drawImage(painted, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
  return canvasToJpeg(canvas)
}
