import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Arrow, Circle, Ellipse, Group, Image as KonvaImage, Layer, Rect, Stage, Text, Transformer } from 'react-konva'
import {
  ANNOTATION_COLORS,
  LINE_THICKNESS,
  annotationFromDrag,
  CALLOUT_BLUE,
  calloutMetrics,
  contentFrame,
  createPlacedAnnotation,
  geometry,
  normalizeAnnotations,
  placeBalloonAnchor,
  remapAnnotations,
  resolveAnnotations,
} from './annotations.js'
import { loadHtmlImage, renderComposite } from './composite.js'
import CropDialog from './CropDialog.jsx'
import { capitalizeSentences } from './textCase.js'

const TOOLS = [
  { id: 'select', label: 'Select' },
  { id: 'arrow', label: 'Arrow' },
  { id: 'rect', label: 'Rectangle' },
  { id: 'ellipse', label: 'Circle' },
  { id: 'text', label: 'Text' },
  { id: 'callout', label: 'Callout' },
  { id: 'balloon', label: 'Balloon' },
]

function clone(value) {
  return structuredClone(value)
}

function balloonPartNote(item, bomLines) {
  const part = (bomLines || []).find((line) => line.id === item.bomLineId)
  const name = part?.partNumber ? ` stays with ${part.partNumber}.` : ' stays with that part.'
  return `Balloon ${item.number}${name} It shows the number only. Use Text to write on the photo.`
}

function withBomNumbers(items, bomLines) {
  const byId = new Map((bomLines || []).map((line) => [line.id, line]))
  return items.map((item) => {
    if (item.type !== 'callout' || !item.bomLineId) return item
    const line = byId.get(item.bomLineId)
    if (!line) return item
    return { ...item, number: line.balloon, text: '' }
  })
}

function annotationIdFrom(node) {
  let current = node
  while (current && current.getClassName && current.getClassName() !== 'Stage') {
    if (current.name() === 'annotation') return current.id()
    current = current.getParent()
  }
  return null
}

function isHandle(node) {
  let current = node
  while (current && current.getClassName && current.getClassName() !== 'Stage') {
    if (current.name() === 'handle' || current.getClassName() === 'Transformer') return true
    current = current.getParent()
  }
  return false
}

function ImageEditor({ src, annotations, bomLines = [], onCancel, onSave, onTrimmed }) {
  const frameRef = useRef(null)
  const transformerRef = useRef(null)
  const nodeRefs = useRef({})
  const annotationsRef = useRef([])
  const pastRef = useRef([])
  const futureRef = useRef([])
  const dragBeforeRef = useRef(null)
  const initialJsonRef = useRef('[]')
  const drawingRef = useRef(null)
  const draftRef = useRef(null)
  const [htmlImage, setHtmlImage] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [items, setItems] = useState([])
  const [tool, setTool] = useState('select')
  const [balloonId, setBalloonId] = useState('')
  const [color, setColor] = useState(CALLOUT_BLUE)
  const [stroke, setStroke] = useState(LINE_THICKNESS[1].value)
  const [selectedId, setSelectedId] = useState(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [view, setView] = useState({ w: 800, h: 560 })
  const [draft, setDraft] = useState(null)
  const [historyTick, setHistoryTick] = useState(0)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [menu, setMenu] = useState(null)
  const [trimming, setTrimming] = useState(false)

  useEffect(() => {
    let cancelled = false
    loadHtmlImage(src)
      .then((image) => {
        if (cancelled) return
        const resolved = withBomNumbers(
          resolveAnnotations(annotations, image.naturalWidth, image.naturalHeight),
          bomLines,
        )
        annotationsRef.current = resolved
        initialJsonRef.current = JSON.stringify(resolved)
        setItems(resolved)
        setHtmlImage(image)
      })
      .catch((error) => {
        if (!cancelled) setLoadError(error.message || 'Could not read the photo.')
      })
    return () => {
      cancelled = true
    }
  }, [src, annotations])

  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return undefined
    const measure = () => {
      const w = frame.clientWidth
      const h = frame.clientHeight
      setView((current) => (current.w === w && current.h === h ? current : { w, h }))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(frame)
    return () => observer.disconnect()
  }, [htmlImage])

  useEffect(() => {
    const transformer = transformerRef.current
    if (!transformer) return
    const selected = items.find((item) => item.id === selectedId)
    const node = selectedId ? nodeRefs.current[selectedId] : null
    const canSize = selected && node && tool === 'select' && ['rect', 'ellipse', 'text'].includes(selected.type)
    transformer.nodes(canSize ? [node] : [])
    transformer.getLayer()?.batchDraw()
  }, [items, selectedId, tool, historyTick, zoom])

  useEffect(() => {
    function onKey(event) {
      const tag = event.target?.tagName
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || event.target?.isContentEditable
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault()
        redo()
        return
      }
      if (event.key === 'Escape' && menu) {
        event.preventDefault()
        setMenu(null)
        return
      }
      if (typing) return
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        removeSelected()
      }
      if (event.key === 'Escape') cancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  function remember(previous) {
    pastRef.current.push(clone(previous))
    if (pastRef.current.length > 50) pastRef.current.shift()
    futureRef.current = []
    setHistoryTick((value) => value + 1)
  }

  function replace(next, previous = annotationsRef.current) {
    remember(previous)
    annotationsRef.current = next
    setItems(next)
  }

  function undo() {
    const previous = pastRef.current.pop()
    if (!previous) return
    futureRef.current.push(clone(annotationsRef.current))
    annotationsRef.current = previous
    setItems(previous)
    setHistoryTick((value) => value + 1)
  }

  function redo() {
    const next = futureRef.current.pop()
    if (!next) return
    pastRef.current.push(clone(annotationsRef.current))
    annotationsRef.current = next
    setItems(next)
    setHistoryTick((value) => value + 1)
  }

  function removeSelected() {
    if (!selectedId) return
    replace(annotationsRef.current.filter((item) => item.id !== selectedId))
    setSelectedId(null)
  }

  function resetAll() {
    if (!annotationsRef.current.length) return
    const confirmed = window.confirm(
      'Remove all annotations from this photo? The original photo stays. This is not kept until you click Save.',
    )
    if (!confirmed) return
    replace([])
    setSelectedId(null)
  }

  function patchSelected(patch, record) {
    if (!selectedId) return
    const previous = annotationsRef.current
    const next = previous.map((item) => (item.id === selectedId ? { ...item, ...patch } : item))
    if (record) replace(next, previous)
    else {
      annotationsRef.current = next
      setItems(next)
    }
  }

  function cancel() {
    const dirty = JSON.stringify(annotationsRef.current) !== initialJsonRef.current
    if (dirty) {
      const confirmed = window.confirm('Discard these annotation changes and keep the photo as it was?')
      if (!confirmed) return
    }
    onCancel()
  }

  async function save() {
    setSaving(true)
    setMessage('')
    try {
      const result = await onSave(normalizeAnnotations(annotationsRef.current))
      if (!result?.ok) setMessage(result?.message || 'Could not save these annotations.')
    } catch (error) {
      setMessage(error.message || 'Could not save these annotations.')
    } finally {
      setSaving(false)
    }
  }

  if (loadError) {
    return portal(
      <EditorShell onCancel={onCancel} onSave={() => {}} saving={false} disabled>
        <p className="field-error">{loadError}</p>
      </EditorShell>,
    )
  }

  if (!htmlImage) {
    return portal(
      <EditorShell onCancel={onCancel} onSave={() => {}} saving={false} disabled>
        <p className="markup-note">Loading photo…</p>
      </EditorShell>,
    )
  }

  const imageWidth = htmlImage.naturalWidth || htmlImage.width
  const imageHeight = htmlImage.naturalHeight || htmlImage.height
  const selected = items.find((item) => item.id === selectedId) || null
  const shown = draft ? [...items, { ...draft, id: 'draft' }] : items
  const frame = contentFrame(items, imageWidth / imageHeight || 1)
  const boardX = (frame.minX / 100) * imageWidth
  const boardY = (frame.minY / 100) * imageHeight
  const boardW = ((frame.maxX - frame.minX) / 100) * imageWidth
  const boardH = ((frame.maxY - frame.minY) / 100) * imageHeight
  const fit = Math.min(view.w / boardW, view.h / boardH) || 1
  const scale = fit * zoom
  const offsetX = (view.w - boardW * scale) / 2 + pan.x - boardX * scale
  const offsetY = (view.h - boardH * scale) / 2 + pan.y - boardY * scale

  function pointerPercent(stage) {
    const pointer = stage.getPointerPosition()
    if (!pointer) return null
    return {
      x: ((pointer.x - offsetX) / scale / imageWidth) * 100,
      y: ((pointer.y - offsetY) / scale / imageHeight) * 100,
    }
  }

  function makeCallout(point, extra = {}) {
    const anchor = placeBalloonAnchor(point, imageWidth, imageHeight)
    return createPlacedAnnotation(
      'callout',
      { x: anchor.x, y: anchor.y },
      annotationsRef.current,
      { color: CALLOUT_BLUE, stroke },
      { ...extra, tipX: anchor.tipX, tipY: anchor.tipY },
    )
  }

  function placeBalloon(point, lineId) {
    const line = (bomLines || []).find((item) => item.id === lineId)
    if (!line || !point) return
    const created = makeCallout(point, {
      number: line.balloon,
      text: '',
      bomLineId: line.id,
    })
    if (!created) return
    replace([...annotationsRef.current, created])
    setSelectedId(created.id)
  }

  function onPointerDown(event) {
    setMenu(null)
    if (event.evt && event.evt.button !== 0) return
    if (isHandle(event.target)) return
    const hitId = annotationIdFrom(event.target)
    if (hitId && hitId !== 'draft') {
      setSelectedId(hitId)
      setTool('select')
      return
    }
    const stage = event.target.getStage()
    const point = pointerPercent(stage)
    if (!point) return
    if (tool === 'select') {
      setSelectedId(null)
      drawingRef.current = { kind: 'pan', startX: event.evt.clientX, startY: event.evt.clientY, pan: { ...pan } }
      return
    }
    if (tool === 'balloon') {
      placeBalloon(point, balloonId)
      return
    }
    if (tool === 'callout' || tool === 'text') {
      const created =
        tool === 'callout'
          ? makeCallout(point)
          : createPlacedAnnotation(tool, point, annotationsRef.current, { color, stroke })
      if (!created) return
      replace([...annotationsRef.current, created])
      setSelectedId(created.id)
      setTool('select')
      return
    }
    const next = { type: tool, x: point.x, y: point.y, x2: point.x, y2: point.y, w: 0, h: 0, color, stroke }
    drawingRef.current = { kind: 'draw' }
    draftRef.current = next
    setDraft(next)
    setSelectedId(null)
  }

  function onPointerMove(event) {
    const drawing = drawingRef.current
    if (!drawing) return
    if (drawing.kind === 'pan') {
      setPan({
        x: drawing.pan.x + (event.evt.clientX - drawing.startX),
        y: drawing.pan.y + (event.evt.clientY - drawing.startY),
      })
      return
    }
    const point = pointerPercent(event.target.getStage())
    if (!point) return
    const current = draftRef.current
    if (!current) return
    const next = {
      ...current,
      x2: point.x,
      y2: point.y,
      w: point.x - current.x,
      h: point.y - current.y,
    }
    draftRef.current = next
    setDraft(next)
  }

  function onPointerUp() {
    const drawing = drawingRef.current
    drawingRef.current = null
    if (!drawing || drawing.kind !== 'draw') return
    const created = annotationFromDrag(draftRef.current)
    draftRef.current = null
    setDraft(null)
    if (!created) return
    replace([...annotationsRef.current, created])
    setSelectedId(created.id)
    setTool('select')
  }

  function openMenu(event) {
    const native = event.evt || event
    native.preventDefault?.()
    const target = event.target?.getStage ? event.target : null
    const hitId = target ? annotationIdFrom(target) : null
    const point = target ? pointerPercent(target.getStage()) : null
    if (hitId && hitId !== 'draft') setSelectedId(hitId)
    setMenu({
      x: native.clientX,
      y: native.clientY,
      id: hitId && hitId !== 'draft' ? hitId : null,
      point,
    })
  }

  function formatTargetId() {
    return menu?.id || selectedId
  }

  function applyFormat(patch) {
    const id = formatTargetId()
    if (!id) return
    const previous = annotationsRef.current
    const next = previous.map((item) => (item.id === id ? { ...item, ...patch } : item))
    replace(next, previous)
    setSelectedId(id)
  }

  async function applyTrim(blob, crop) {
    setTrimming(false)
    if (!onTrimmed) return
    const next = remapAnnotations(annotationsRef.current, crop)
    await onTrimmed(blob, next)
  }

  function beginDrag() {
    dragBeforeRef.current = clone(annotationsRef.current)
  }

  function moveArrow(id, dx, dy, record) {
    const previous = dragBeforeRef.current || annotationsRef.current
    const origin = previous.find((item) => item.id === id)
    if (!origin) return
    const next = annotationsRef.current.map((item) =>
      item.id === id
        ? {
            ...item,
            x: origin.x + (dx / imageWidth) * 100,
            y: origin.y + (dy / imageHeight) * 100,
            x2: origin.x2 + (dx / imageWidth) * 100,
            y2: origin.y2 + (dy / imageHeight) * 100,
          }
        : item,
    )
    if (record) replace(next, previous)
    else {
      annotationsRef.current = next
      setItems(next)
    }
  }

  function moveCenter(id, x, y, record) {
    const previous = dragBeforeRef.current || annotationsRef.current
    const origin = previous.find((item) => item.id === id)
    const { radius } = origin?.type === 'callout' ? calloutMetrics(imageWidth, imageHeight) : { radius: 0 }
    const nextX = origin?.type === 'callout' ? Math.min(imageWidth - radius, Math.max(radius, x)) : x
    const nextY = origin?.type === 'callout' ? Math.min(imageHeight - radius, Math.max(radius, y)) : y
    const next = annotationsRef.current.map((item) =>
      item.id === id
        ? { ...item, x: (nextX / imageWidth) * 100, y: (nextY / imageHeight) * 100 }
        : item,
    )
    if (record) replace(next, previous)
    else {
      annotationsRef.current = next
      setItems(next)
    }
  }

  function moveTip(id, x, y, record) {
    const previous = dragBeforeRef.current || annotationsRef.current
    const tipX = Math.min(imageWidth, Math.max(0, x))
    const tipY = Math.min(imageHeight, Math.max(0, y))
    const next = annotationsRef.current.map((item) =>
      item.id === id
        ? { ...item, tipX: (tipX / imageWidth) * 100, tipY: (tipY / imageHeight) * 100 }
        : item,
    )
    if (record) replace(next, previous)
    else {
      annotationsRef.current = next
      setItems(next)
    }
  }

  function moveBox(id, x, y, record) {
    const previous = dragBeforeRef.current || annotationsRef.current
    const next = annotationsRef.current.map((item) =>
      item.id === id
        ? { ...item, x: (x / imageWidth) * 100, y: (y / imageHeight) * 100 }
        : item,
    )
    if (record) replace(next, previous)
    else {
      annotationsRef.current = next
      setItems(next)
    }
  }

  return portal(
    <EditorShell
      tool={tool}
      setTool={(next) => {
        if (next === 'balloon' && !balloonId && bomLines[0]) setBalloonId(bomLines[0].id)
        setTool(next)
      }}
      color={color}
      stroke={stroke}
      onColor={(value) => {
        setColor(value)
        patchSelected({ color: value }, true)
      }}
      onStroke={(value) => {
        setStroke(value)
        patchSelected({ stroke: value }, true)
      }}
      canUndo={pastRef.current.length > 0}
      canRedo={futureRef.current.length > 0}
      onUndo={undo}
      onRedo={redo}
      onDelete={removeSelected}
      deleteDisabled={!selectedId}
      onZoomIn={() => setZoom((value) => Math.min(8, value * 1.25))}
      onZoomOut={() => setZoom((value) => Math.max(0.25, value / 1.25))}
      onFit={() => {
        setZoom(1)
        setPan({ x: 0, y: 0 })
      }}
      onTrim={() => setTrimming(true)}
      onReset={resetAll}
      onCancel={cancel}
      onSave={save}
      saving={saving}
      message={message}
      historyTick={historyTick}
    >
      <div className="annotation-workspace">
        <div
          className={`annotation-stage tool-${tool}`}
          ref={frameRef}
          role="application"
          aria-label="Annotation canvas"
        >
          <Stage
            width={view.w}
            height={view.h}
            onMouseDown={onPointerDown}
            onMouseMove={onPointerMove}
            onMouseUp={onPointerUp}
            onContextMenu={openMenu}
            onTouchStart={onPointerDown}
            onTouchMove={onPointerMove}
            onTouchEnd={onPointerUp}
          >
            <Layer>
              <Group x={offsetX} y={offsetY} scaleX={scale} scaleY={scale}>
                <Rect
                  x={boardX}
                  y={boardY}
                  width={boardW}
                  height={boardH}
                  fill="#ffffff"
                  stroke="#c9d3de"
                  strokeWidth={1 / scale}
                  listening={false}
                />
                <KonvaImage name="background" image={htmlImage} width={imageWidth} height={imageHeight} />
                {shown.map((item) => (
                  <AnnotationShape
                    key={item.id}
                    item={item}
                    imageWidth={imageWidth}
                    imageHeight={imageHeight}
                    scale={scale}
                    selected={item.id === selectedId}
                    draggable={tool === 'select' && item.id !== 'draft'}
                    nodeRef={(node) => {
                      if (item.id === 'draft') return
                      if (node) nodeRefs.current[item.id] = node
                      else delete nodeRefs.current[item.id]
                    }}
                    onDragStart={beginDrag}
                    onArrowMove={(dx, dy, record) => moveArrow(item.id, dx, dy, record)}
                    onBoxMove={(x, y, record) => moveBox(item.id, x, y, record)}
                    onCenterMove={(x, y, record) => moveCenter(item.id, x, y, record)}
                    onTipMove={(x, y, record) => moveTip(item.id, x, y, record)}
                    onEndpoint={(which, x, y, record) => {
                      const previous = dragBeforeRef.current || annotationsRef.current
                      const origin = previous.find((entry) => entry.id === item.id)
                      if (!origin) return
                      const patch =
                        which === 'start'
                          ? { x: (x / imageWidth) * 100, y: (y / imageHeight) * 100 }
                          : { x2: (x / imageWidth) * 100, y2: (y / imageHeight) * 100 }
                      const next = annotationsRef.current.map((entry) =>
                        entry.id === item.id ? { ...origin, ...patch } : entry,
                      )
                      if (record) replace(next, previous)
                      else {
                        annotationsRef.current = next
                        setItems(next)
                      }
                    }}
                    onTransformEnd={(event) => finishTransform(event, item, imageWidth, imageHeight, replace, dragBeforeRef)}
                  />
                ))}
                <Transformer
                  ref={transformerRef}
                  rotateEnabled={false}
                  ignoreStroke
                  boundBoxFunc={(oldBox, newBox) => {
                    if (newBox.width < 8 || newBox.height < 8) return oldBox
                    return newBox
                  }}
                />
              </Group>
            </Layer>
          </Stage>
        </div>
        <aside className="annotation-side">
          <h4>Add a balloon</h4>
          {bomLines.length === 0 ? (
            <p className="markup-note">Import a bill of materials first. Then choose a part and click it in the photo.</p>
          ) : (
            <>
              <p className="markup-note">
                Choose a part, then click that part in the photo. The balloon shows that part’s number and stays
                tied to it. Drag the balloon, or drag the leader point onto the part. Use Text for words.
              </p>
              <ul className="callout-index">
                {bomLines.map((line) => (
                  <li key={line.id}>
                    <button
                      type="button"
                      className={tool === 'balloon' && balloonId === line.id ? 'markup-select selected' : 'markup-select'}
                      onClick={() => {
                        setBalloonId(line.id)
                        setTool('balloon')
                      }}
                    >
                      {line.balloon}. {line.partNumber || 'Part'}
                      {line.description ? ` · ${line.description}` : ''}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <h4>Selected mark</h4>
          {selected?.type === 'text' ? (
            <label className="field">
              <span className="field-label">Text</span>
              <input
                value={selected.text}
                onChange={(event) =>
                  patchSelected({ text: capitalizeSentences(event.target.value) }, false)
                }
                onBlur={() => {
                  if (dragBeforeRef.current) {
                    replace(annotationsRef.current, dragBeforeRef.current)
                    dragBeforeRef.current = null
                  }
                }}
                onFocus={() => {
                  dragBeforeRef.current = clone(annotationsRef.current)
                }}
              />
            </label>
          ) : null}
          {selected?.type === 'callout' ? (
            selected.bomLineId ? (
              <p className="markup-note">{balloonPartNote(selected, bomLines)}</p>
            ) : (
              <label className="field">
                <span className="field-label">Callout number</span>
                <input
                  type="number"
                  min="1"
                  max="999"
                  value={selected.number}
                  onChange={(event) => {
                    const number = Number(event.target.value)
                    if (!Number.isInteger(number) || number < 1 || number > 999) return
                    patchSelected({ number }, false)
                  }}
                  onFocus={() => {
                    dragBeforeRef.current = clone(annotationsRef.current)
                  }}
                  onBlur={() => {
                    if (dragBeforeRef.current) {
                      replace(annotationsRef.current, dragBeforeRef.current)
                      dragBeforeRef.current = null
                    }
                  }}
                />
              </label>
            )
          ) : null}
          {selected && selected.type !== 'text' && selected.type !== 'callout' ? (
            <p className="markup-note">Drag the mark to move it. Drag a handle to resize it.</p>
          ) : null}
          {!selected ? (
            <p className="markup-note">
              Right-click a mark for color, line weight, and callouts. You can also choose one from the list.
              Drag marks onto the blank sheet around the photo.
            </p>
          ) : null}
          <h4>Marks</h4>
          {items.length === 0 ? (
            <p className="markup-note">No marks yet. Right-click the sheet to add a callout.</p>
          ) : (
            <ul className="callout-index">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={item.id === selectedId ? 'markup-select selected' : 'markup-select'}
                    onClick={() => {
                      setSelectedId(item.id)
                      setTool('select')
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      setSelectedId(item.id)
                      setMenu({ x: event.clientX, y: event.clientY, id: item.id, point: null })
                    }}
                  >
                    {markLabel(item)}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <h4>Numbered callouts</h4>
          {items.filter((item) => item.type === 'callout').length === 0 ? (
            <p className="markup-note">Callouts you place are listed here with their descriptions.</p>
          ) : (
            <ul className="callout-index">
              {items
                .filter((item) => item.type === 'callout')
                .map((item) => (
                  <li key={item.id}>
                    <button type="button" className="markup-select" onClick={() => setSelectedId(item.id)}>
                      {item.bomLineId
                        ? `Balloon ${item.number}`
                        : `Callout ${item.number}`}
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </aside>
      </div>
      {menu ? (
        <FormatMenu
          menu={menu}
          mark={items.find((item) => item.id === (menu.id || selectedId)) || null}
          onColor={(value) => {
            setColor(value)
            applyFormat({ color: value })
          }}
          onStroke={(value) => {
            setStroke(value)
            applyFormat({ stroke: value })
          }}
          onDelete={() => {
            const id = menu.id || selectedId
            setMenu(null)
            if (!id) return
            replace(annotationsRef.current.filter((item) => item.id !== id))
            setSelectedId(null)
          }}
          onAddCallout={() => {
            if (!menu.point) return
            const created = makeCallout(menu.point)
            if (!created) return
            replace([...annotationsRef.current, created])
            setSelectedId(created.id)
            setTool('select')
            setMenu(null)
          }}
          onAddBalloon={() => {
            if (!menu.point) return
            placeBalloon(menu.point, balloonId)
            setMenu(null)
          }}
          onAddText={() => {
            if (!menu.point) return
            const created = createPlacedAnnotation('text', menu.point, annotationsRef.current, { color, stroke })
            if (!created) return
            replace([...annotationsRef.current, created])
            setSelectedId(created.id)
            setTool('select')
            setMenu(null)
          }}
          balloonReady={Boolean(balloonId)}
          onFit={() => {
            setZoom(1)
            setPan({ x: 0, y: 0 })
            setMenu(null)
          }}
          onTrim={() => {
            setMenu(null)
            setTrimming(true)
          }}
          onClose={() => setMenu(null)}
        />
      ) : null}
      {trimming ? (
        <CropDialog
          src={src}
          title="Trim photo"
          detail="Drag any edge, including the bottom, to trim. A studio background replaces the bench. Marks stay with the area you keep."
          onCancel={() => setTrimming(false)}
          onUseWhole={() => setTrimming(false)}
          onApply={applyTrim}
        />
      ) : null}
    </EditorShell>,
  )
}

function markLabel(item) {
  if (item.type === 'callout') return item.bomLineId ? `Balloon ${item.number}` : `Callout ${item.number}`
  if (item.type === 'text') return `Text. ${item.text.trim() || 'Text'}`
  if (item.type === 'arrow') return 'Arrow'
  if (item.type === 'rect') return 'Rectangle'
  if (item.type === 'ellipse') return 'Circle'
  return 'Mark'
}

function FormatMenu({
  menu,
  mark,
  onColor,
  onStroke,
  onDelete,
  onAddCallout,
  onAddBalloon,
  onAddText,
  balloonReady,
  onFit,
  onTrim,
  onClose,
}) {
  const menuRef = useRef(null)
  const [place, setPlace] = useState({ left: menu.x, top: menu.y })

  useEffect(() => {
    const node = menuRef.current
    if (!node) return
    const rect = node.getBoundingClientRect()
    const left = Math.min(menu.x, window.innerWidth - rect.width - 8)
    const top = Math.min(menu.y, window.innerHeight - rect.height - 8)
    setPlace({ left: Math.max(8, left), top: Math.max(8, top) })
  }, [menu.x, menu.y])

  useEffect(() => {
    function onPointerDown(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) onClose()
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [onClose])

  return (
    <div
      ref={menuRef}
      className="context-menu"
      role="menu"
      style={{ left: place.left, top: place.top }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <p className="context-menu-label">{mark ? markLabel(mark) : 'Sheet'}</p>
      <p className="context-menu-label">Color</p>
      <div className="context-swatches">
        {ANNOTATION_COLORS.map((item) => (
          <button
            key={item.id}
            type="button"
            className="context-swatch"
            style={{ background: item.value }}
            aria-label={item.label}
            disabled={!mark}
            onClick={() => onColor(item.value)}
          />
        ))}
      </div>
      <p className="context-menu-label">Line weight</p>
      <div className="context-weights">
        {LINE_THICKNESS.map((item) => (
          <button key={item.id} type="button" disabled={!mark} onClick={() => onStroke(item.value)}>
            {item.label}
          </button>
        ))}
      </div>
      {mark?.type === 'callout' && mark.bomLineId ? (
        <p className="context-menu-note">
          The balloon shows that part’s number only. Drag the balloon, or drag the leader point onto the part.
        </p>
      ) : null}
      <button type="button" onClick={onAddBalloon} disabled={!menu.point || !balloonReady}>
        Add balloon here
      </button>
      <button type="button" onClick={onAddCallout} disabled={!menu.point}>
        Add callout here
      </button>
      <button type="button" onClick={onAddText} disabled={!menu.point}>
        Add text here
      </button>
      <button type="button" onClick={onFit}>
        Fit photo
      </button>
      <button type="button" onClick={onTrim}>
        Trim photo
      </button>
      <button type="button" className="danger" onClick={onDelete} disabled={!mark}>
        Delete
      </button>
    </div>
  )
}

function finishTransform(event, item, imageWidth, imageHeight, replace, dragBeforeRef) {
  const node = event.target
  const previous = dragBeforeRef.current || null
  const scaleX = node.scaleX()
  const scaleY = node.scaleY()
  node.scaleX(1)
  node.scaleY(1)
  let patch = null
  if (item.type === 'text') {
    patch = {
      x: (node.x() / imageWidth) * 100,
      y: (node.y() / imageHeight) * 100,
      fontSize: Math.max(0.8, (item.fontSize || 2.4) * scaleY),
    }
  } else if (item.type === 'rect') {
    patch = {
      x: (node.x() / imageWidth) * 100,
      y: (node.y() / imageHeight) * 100,
      w: (Math.max(4, node.width() * scaleX) / imageWidth) * 100,
      h: (Math.max(4, node.height() * scaleY) / imageHeight) * 100,
    }
    node.width(Math.max(4, node.width() * scaleX))
    node.height(Math.max(4, node.height() * scaleY))
  } else if (item.type === 'ellipse') {
    const radiusX = Math.max(4, node.radiusX() * scaleX)
    const radiusY = Math.max(4, node.radiusY() * scaleY)
    node.radiusX(radiusX)
    node.radiusY(radiusY)
    patch = {
      x: ((node.x() - radiusX) / imageWidth) * 100,
      y: ((node.y() - radiusY) / imageHeight) * 100,
      w: ((radiusX * 2) / imageWidth) * 100,
      h: ((radiusY * 2) / imageHeight) * 100,
      circular: false,
    }
  }
  if (!patch) return
  if (!previous) return
  const current = previous.map((entry) => (entry.id === item.id ? { ...entry, ...patch } : entry))
  replace(current, previous)
}

function AnnotationShape({
  item,
  imageWidth,
  imageHeight,
  scale,
  selected,
  draggable,
  nodeRef,
  onDragStart,
  onArrowMove,
  onBoxMove,
  onCenterMove,
  onTipMove,
  onEndpoint,
  onTransformEnd,
}) {
  const box = geometry(item, imageWidth, imageHeight)
  const common = {
    id: item.id,
    name: 'annotation',
    draggable,
    onDragStart,
  }
  if (item.type === 'arrow') {
    const head = Math.max(16, box.stroke * 4)
    return (
      <Group>
        <Arrow
          {...common}
          ref={nodeRef}
          points={[box.x1, box.y1, box.x2, box.y2]}
          stroke="#ffffff"
          fill="#ffffff"
          strokeWidth={box.stroke + 4}
          pointerLength={head + 2}
          pointerWidth={head + 2}
          hitStrokeWidth={28}
          onDragEnd={(event) => {
            const dx = event.target.x()
            const dy = event.target.y()
            event.target.position({ x: 0, y: 0 })
            onArrowMove(dx, dy, true)
          }}
        />
        <Arrow
          listening={false}
          points={[box.x1, box.y1, box.x2, box.y2]}
          stroke={item.color}
          fill={item.color}
          strokeWidth={box.stroke}
          pointerLength={head}
          pointerWidth={head}
        />
        {selected ? (
          <>
            <Circle
              name="handle"
              x={box.x1}
              y={box.y1}
              radius={7 / scale}
              fill="#ffffff"
              stroke="#0e4d7b"
              strokeWidth={2 / scale}
              draggable
              onDragStart={onDragStart}
              onDragEnd={(event) => onEndpoint('start', event.target.x(), event.target.y(), true)}
            />
            <Circle
              name="handle"
              x={box.x2}
              y={box.y2}
              radius={7 / scale}
              fill="#ffffff"
              stroke="#0e4d7b"
              strokeWidth={2 / scale}
              draggable
              onDragStart={onDragStart}
              onDragEnd={(event) => onEndpoint('end', event.target.x(), event.target.y(), true)}
            />
          </>
        ) : null}
      </Group>
    )
  }
  if (item.type === 'rect') {
    return (
      <Group>
        <Rect
          {...common}
          ref={nodeRef}
          x={box.x}
          y={box.y}
          width={Math.max(1, box.w)}
          height={Math.max(1, box.h)}
          stroke={selected ? '#0e4d7b' : item.color}
          strokeWidth={selected ? box.stroke + 1.5 : box.stroke}
          onDragEnd={(event) => onBoxMove(event.target.x(), event.target.y(), true)}
          onTransformStart={onDragStart}
          onTransformEnd={onTransformEnd}
        />
      </Group>
    )
  }
  if (item.type === 'ellipse') {
    return (
      <Ellipse
        {...common}
        ref={nodeRef}
        x={box.x + box.w / 2}
        y={box.y + box.h / 2}
        radiusX={Math.max(1, box.w / 2)}
        radiusY={Math.max(1, box.h / 2)}
        stroke={selected ? '#0e4d7b' : item.color}
        strokeWidth={selected ? box.stroke + 1.5 : box.stroke}
        onDragEnd={(event) => {
          const radiusX = event.target.radiusX()
          const radiusY = event.target.radiusY()
          onBoxMove(event.target.x() - radiusX, event.target.y() - radiusY, true)
        }}
        onTransformStart={onDragStart}
        onTransformEnd={onTransformEnd}
      />
    )
  }
  if (item.type === 'text') {
    const label = item.text.trim() || 'Label'
    const boxWidth = Math.max(48, label.length * box.fontSize * 0.56 + 16)
    const boxHeight = box.fontSize + 18
    return (
      <Group
        {...common}
        ref={nodeRef}
        x={box.x}
        y={box.y}
        width={boxWidth}
        height={boxHeight}
        onDragEnd={(event) => onBoxMove(event.target.x(), event.target.y(), true)}
        onTransformStart={onDragStart}
        onTransformEnd={onTransformEnd}
      >
        <Rect
          width={boxWidth}
          height={boxHeight}
          fill="#ffffff"
          stroke={selected ? '#0e4d7b' : item.color}
          strokeWidth={Math.max(1.5, box.stroke * 0.6)}
          cornerRadius={3}
        />
        <Text
          x={8}
          y={6}
          text={label}
          fontSize={box.fontSize}
          fontStyle="normal"
          fontFamily="Segoe UI, sans-serif"
          fill="#1b2430"
          listening={false}
        />
      </Group>
    )
  }
  return (
    <>
      {box.showLeader ? (
        <>
          <Arrow
            points={[box.edgeX, box.edgeY, box.tipX, box.tipY]}
            stroke="#ffffff"
            fill="#ffffff"
            strokeWidth={box.leaderWidth + Math.max(1.5, box.leaderWidth * 0.7)}
            pointerLength={box.head + 1}
            pointerWidth={box.head + 1}
            lineCap="round"
            listening={false}
          />
          <Arrow
            points={[box.edgeX, box.edgeY, box.tipX, box.tipY]}
            stroke={item.color}
            fill={item.color}
            strokeWidth={box.leaderWidth}
            pointerLength={box.head}
            pointerWidth={box.head}
            lineCap="round"
            listening={false}
          />
        </>
      ) : null}
      <Group
        {...common}
        ref={nodeRef}
        x={box.x}
        y={box.y}
        onDragMove={(event) => onCenterMove(event.target.x(), event.target.y(), false)}
        onDragEnd={(event) => onCenterMove(event.target.x(), event.target.y(), true)}
      >
        <Circle radius={box.radius + (selected ? 3 / scale : 0)} stroke={selected ? '#083656' : undefined} strokeWidth={selected ? 2 / scale : 0} />
        <Circle radius={box.radius} fill={item.color} stroke="#ffffff" strokeWidth={Math.max(1.5, box.leaderWidth)} />
        <Text
          text={String(item.number || '')}
          fontSize={box.numberSize}
          fontStyle="bold"
          fontFamily="Segoe UI, sans-serif"
          fill="#ffffff"
          width={box.radius * 2}
          height={box.radius * 2}
          offsetX={box.radius}
          offsetY={box.radius}
          align="center"
          verticalAlign="middle"
          listening={false}
        />
      </Group>
      {selected ? (
        <Circle
          name="handle"
          x={box.tipX}
          y={box.tipY}
          radius={8 / scale}
          fill="#ffffff"
          stroke={item.color}
          strokeWidth={2 / scale}
          draggable
          onDragStart={onDragStart}
          onDragMove={(event) => onTipMove(event.target.x(), event.target.y(), false)}
          onDragEnd={(event) => onTipMove(event.target.x(), event.target.y(), true)}
        />
      ) : null}
    </>
  )
}

function portal(node) {
  return createPortal(node, document.body)
}

function EditorShell({
  children,
  tool,
  setTool,
  color,
  stroke,
  onColor,
  onStroke,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onDelete,
  deleteDisabled,
  onZoomIn,
  onZoomOut,
  onFit,
  onTrim,
  onReset,
  onCancel,
  onSave,
  saving,
  disabled,
  message,
  historyTick,
}) {
  return (
    <div className="annotation-dialog" role="dialog" aria-modal="true" aria-labelledby="annotation-title">
      <div className="annotation-dialog-panel">
        <header className="annotation-dialog-header">
          <div>
            <h3 id="annotation-title">Edit photo annotations</h3>
            <p>
              Click the part. A blue balloon and leader appear with that part’s number only. Drag the balloon, or
              drag the leader point onto the part. Choose Text to write on the photo. Save keeps the original photo
              and a finished picture.
            </p>
          </div>
          <div className="annotation-dialog-actions">
            <button type="button" className="btn btn-secondary" onClick={onCancel}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={onSave} disabled={disabled || saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </header>
        {setTool ? (
          <div className="annotation-toolbar" role="toolbar" aria-label="Annotation tools">
            {TOOLS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={tool === item.id ? 'btn btn-primary' : 'btn btn-secondary'}
                aria-pressed={tool === item.id}
                onClick={() => setTool(item.id)}
              >
                {item.label}
              </button>
            ))}
            <button type="button" className="btn btn-danger" onClick={onDelete} disabled={deleteDisabled}>
              Delete
            </button>
            <button type="button" className="btn btn-secondary" onClick={onUndo} disabled={!canUndo}>
              Undo
            </button>
            <button type="button" className="btn btn-secondary" onClick={onRedo} disabled={!canRedo}>
              Redo
            </button>
            <label className="annotation-choice">
              Color
              <select value={color} onChange={(event) => onColor(event.target.value)}>
                {ANNOTATION_COLORS.map((item) => (
                  <option key={item.id} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="annotation-choice">
              Line
              <select value={stroke} onChange={(event) => onStroke(Number(event.target.value))}>
                {LINE_THICKNESS.map((item) => (
                  <option key={item.id} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="btn btn-secondary" onClick={onZoomIn}>
              Zoom in
            </button>
            <button type="button" className="btn btn-secondary" onClick={onZoomOut}>
              Zoom out
            </button>
            <button type="button" className="btn btn-secondary" onClick={onFit}>
              Fit
            </button>
            <button type="button" className="btn btn-secondary" onClick={onTrim}>
              Trim
            </button>
            <button type="button" className="btn btn-secondary" onClick={onReset}>
              Reset
            </button>
          </div>
        ) : null}
        {message ? <p className="field-error">{message}</p> : null}
        {children}
        <span className="annotation-history-tick" hidden>
          {historyTick}
        </span>
      </div>
    </div>
  )
}

export function AnnotationPreview({ src, annotations, alt }) {
  const [url, setUrl] = useState('')
  const signature = JSON.stringify(annotations || [])

  useEffect(() => {
    let cancelled = false
    let created = ''
    const parsed = JSON.parse(signature)
    loadHtmlImage(src)
      .then(async (image) => {
        if (cancelled) return
        if (!parsed.length) {
          setUrl(src)
          return
        }
        const blob = await renderComposite(image, parsed)
        if (cancelled || !blob) return
        created = URL.createObjectURL(blob)
        setUrl(created)
      })
      .catch(() => {
        if (!cancelled) setUrl(src)
      })
    return () => {
      cancelled = true
      if (created) URL.revokeObjectURL(created)
    }
  }, [src, signature])

  if (!url) return <div className="image-missing">Loading photo…</div>
  return <img src={url} alt={alt} />
}

export default ImageEditor
