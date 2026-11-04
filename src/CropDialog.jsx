import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { loadHtmlImage } from './composite.js'
import { STUDIO_BACKDROPS, exportTrimmedPhoto, paintStudio } from './studioBackground.js'

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

function CropDialog({ src, title, detail, onCancel, onUseWhole, onApply }) {
  const stageRef = useRef(null)
  const frameRef = useRef(null)
  const viewRef = useRef(null)
  const dragRef = useRef(null)
  const [image, setImage] = useState(null)
  const [error, setError] = useState('')
  const [crop, setCrop] = useState({ x: 0, y: 0, w: 100, h: 100 })
  const [busy, setBusy] = useState(false)
  const [backdrop, setBackdrop] = useState('keep')
  const [tolerance, setTolerance] = useState(28)
  const [preview, setPreview] = useState(null)
  const [frameMax, setFrameMax] = useState(420)

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
    const node = stageRef.current
    if (!node) return undefined
    const measure = () => {
      const styles = window.getComputedStyle(node)
      const pad = Number.parseFloat(styles.paddingTop) + Number.parseFloat(styles.paddingBottom)
      setFrameMax(Math.max(140, node.clientHeight - pad - 16))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [image])

  useEffect(() => {
    if (!image || backdrop === 'keep') {
      setPreview(null)
      return undefined
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      try {
        const next = paintStudio(image, { backdrop, tolerance, maxEdge: 1200 })
        if (!cancelled) setPreview(next)
      } catch (reason) {
        if (!cancelled) setError(reason.message || 'Could not clean that background.')
      }
    }, 120)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [image, backdrop, tolerance])

  useEffect(() => {
    const canvas = viewRef.current
    if (!canvas || !preview) return
    canvas.width = preview.width
    canvas.height = preview.height
    const context = canvas.getContext('2d')
    context.drawImage(preview, 0, 0)
  }, [preview])

  useEffect(() => {
    function onMove(event) {
      const drag = dragRef.current
      const frame = frameRef.current
      if (!drag || !frame) return
      const rect = frame.getBoundingClientRect()
      if (!rect.width || !rect.height) return
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

  async function apply(whole) {
    if (!image) return
    const full = whole || coversWholePhoto(crop)
    if (full && backdrop === 'keep') {
      onUseWhole()
      return
    }
    setBusy(true)
    setError('')
    try {
      const used = full ? { x: 0, y: 0, w: 100, h: 100 } : crop
      const blob = await exportTrimmedPhoto(image, used, { backdrop, tolerance })
      await onApply(blob, used)
    } catch (reason) {
      setError(reason.message || 'Could not trim that photo.')
      setBusy(false)
    }
  }

  const pictureStyle = { maxHeight: frameMax }

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
            <button type="button" className="btn btn-secondary" onClick={() => apply(true)} disabled={busy || !image}>
              Use whole photo
            </button>
            <button type="button" className="btn btn-primary" onClick={() => apply(false)} disabled={busy || !image}>
              {busy ? 'Working…' : backdrop === 'keep' ? 'Apply trim' : 'Apply photo'}
            </button>
          </div>
        </header>
        <div className="crop-tools">
          <div className="crop-backdrop" role="group" aria-label="Background">
            {STUDIO_BACKDROPS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={backdrop === item.id ? 'is-on' : ''}
                aria-pressed={backdrop === item.id}
                disabled={busy || !image}
                onClick={() => setBackdrop(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          {backdrop === 'keep' ? (
            <p>Keep the bench, or switch to a studio background. Drag any edge of the frame, including the bottom.</p>
          ) : (
            <label className="crop-tolerance">
              <span>Remove bench</span>
              <input
                type="range"
                min="12"
                max="64"
                value={tolerance}
                disabled={busy}
                onChange={(event) => setTolerance(Number(event.target.value))}
              />
              <span>{tolerance < 24 ? 'Less' : tolerance > 42 ? 'More' : 'Medium'}</span>
            </label>
          )}
        </div>
        {error ? <p className="field-error">{error}</p> : null}
        <div className="crop-stage" ref={stageRef}>
          {image ? (
            <div className="crop-frame" ref={frameRef}>
              {preview ? (
                <canvas ref={viewRef} style={pictureStyle} />
              ) : (
                <img src={src} alt="" style={pictureStyle} />
              )}
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
          ) : (
            <p className="markup-note">{error ? '' : 'Loading photo…'}</p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

export default CropDialog
