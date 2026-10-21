import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { loadHtmlImage } from './composite.js'

const MIN_SIZE = 8

function clampCrop(crop) {
  const w = Math.min(100, Math.max(MIN_SIZE, crop.w))
  const h = Math.min(100, Math.max(MIN_SIZE, crop.h))
  return {
    x: Math.min(100 - w, Math.max(0, crop.x)),
    y: Math.min(100 - h, Math.max(0, crop.y)),
    w,
    h,
  }
}

function coversWholePhoto(crop) {
  return crop.x <= 0.4 && crop.y <= 0.4 && crop.w >= 99.2 && crop.h >= 99.2
}

async function cropToBlob(image, crop) {
  const sx = (crop.x / 100) * image.naturalWidth
  const sy = (crop.y / 100) * image.naturalHeight
  const sw = (crop.w / 100) * image.naturalWidth
  const sh = (crop.h / 100) * image.naturalHeight
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(sw))
  canvas.height = Math.max(1, Math.round(sh))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Could not trim that photo.')
  context.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((result) => {
      if (!result) reject(new Error('Could not trim that photo.'))
      else resolve(result)
    }, 'image/jpeg', 0.92)
  })
  return blob
}

function CropDialog({ src, title, detail, onCancel, onUseWhole, onApply }) {
  const frameRef = useRef(null)
  const dragRef = useRef(null)
  const [image, setImage] = useState(null)
  const [error, setError] = useState('')
  const [crop, setCrop] = useState({ x: 0, y: 0, w: 100, h: 100 })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    loadHtmlImage(src)
      .then((loaded) => {
        if (!cancelled) setImage(loaded)
      })
      .catch((reason) => {
        if (!cancelled) setError(reason.message || 'Could not read the photo.')
      })
    return () => {
      cancelled = true
    }
  }, [src])

  useEffect(() => {
    function onMove(event) {
      const drag = dragRef.current
      const frame = frameRef.current
      if (!drag || !frame) return
      const rect = frame.getBoundingClientRect()
      const dx = ((event.clientX - drag.clientX) / rect.width) * 100
      const dy = ((event.clientY - drag.clientY) / rect.height) * 100
      const next = { ...drag.crop }
      if (drag.mode === 'move') {
        next.x += dx
        next.y += dy
      }
      if (drag.mode === 'left') {
        next.x = drag.crop.x + dx
        next.w = drag.crop.w - dx
      }
      if (drag.mode === 'right') next.w = drag.crop.w + dx
      if (drag.mode === 'top') {
        next.y = drag.crop.y + dy
        next.h = drag.crop.h - dy
      }
      if (drag.mode === 'bottom') next.h = drag.crop.h + dy
      setCrop(clampCrop(next))
    }
    function onUp() {
      dragRef.current = null
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [])

  function beginDrag(mode, event) {
    event.preventDefault()
    event.stopPropagation()
    dragRef.current = { mode, clientX: event.clientX, clientY: event.clientY, crop }
  }

  async function apply() {
    if (!image) return
    if (coversWholePhoto(crop)) {
      onUseWhole()
      return
    }
    setBusy(true)
    setError('')
    try {
      const blob = await cropToBlob(image, crop)
      await onApply(blob, crop)
    } catch (reason) {
      setError(reason.message || 'Could not trim that photo.')
      setBusy(false)
    }
  }

  return createPortal(
    <div className="crop-dialog" role="dialog" aria-modal="true" aria-labelledby="crop-title">
      <div className="crop-dialog-panel">
        <header className="annotation-dialog-header">
          <div>
            <h3 id="crop-title">{title}</h3>
            <p>{detail}</p>
          </div>
          <div className="annotation-dialog-actions">
            <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>
              Skip
            </button>
            <button type="button" className="btn btn-secondary" onClick={onUseWhole} disabled={busy || !image}>
              Use whole photo
            </button>
            <button type="button" className="btn btn-primary" onClick={apply} disabled={busy || !image}>
              {busy ? 'Trimming…' : 'Apply trim'}
            </button>
          </div>
        </header>
        {error ? <p className="field-error">{error}</p> : null}
        {image ? (
          <div className="crop-stage">
            <div className="crop-frame" ref={frameRef}>
              <img src={src} alt="" />
              <div
                className="crop-window"
                style={{ left: `${crop.x}%`, top: `${crop.y}%`, width: `${crop.w}%`, height: `${crop.h}%` }}
                onPointerDown={(event) => beginDrag('move', event)}
              >
                <span className="crop-handle crop-left" onPointerDown={(event) => beginDrag('left', event)} />
                <span className="crop-handle crop-right" onPointerDown={(event) => beginDrag('right', event)} />
                <span className="crop-handle crop-top" onPointerDown={(event) => beginDrag('top', event)} />
                <span className="crop-handle crop-bottom" onPointerDown={(event) => beginDrag('bottom', event)} />
              </div>
            </div>
          </div>
        ) : (
          <p className="markup-note">{error ? '' : 'Loading photo…'}</p>
        )}
      </div>
    </div>,
    document.body,
  )
}

export default CropDialog
