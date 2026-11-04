import { useEffect, useRef, useState } from 'react'
import { parseDbaBom } from './bomImport.js'
import { capitalizeSentences } from './textCase.js'
import { assignBalloons, createBomLine } from './model.js'

function moveItem(list, from, to) {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list
  const next = [...list]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

export function Balloon({ number }) {
  return <span className="balloon">{number}</span>
}

export function BomList({
  lines,
  locked,
  quantityEditId,
  onChange,
  onAdd,
  onRemove,
  onDelete,
  onEditQuantity,
  onQuantityDone,
}) {
  const fileRef = useRef(null)
  const dragFrom = useRef(null)
  const qtyRefs = useRef({})
  const quantityEditRef = useRef(quantityEditId)
  quantityEditRef.current = quantityEditId

  useEffect(() => {
    if (!quantityEditId) return
    const node = qtyRefs.current[quantityEditId]
    if (node && document.activeElement !== node) node.focus()
  }, [quantityEditId])

  function update(id, patch) {
    onChange(lines.map((line) => (line.id === id ? { ...line, ...patch } : line)))
  }

  function importFile(file) {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result || '')
      if (!text.trim()) return
      if (file.name.toLowerCase().endsWith('.xlsx') || file.name.toLowerCase().endsWith('.xls')) {
        window.alert('Save the DBA export as a CSV file, then import that file.')
        return
      }
      const parsed = parseDbaBom(text)
      if (!parsed.length) {
        window.alert('No parts were found in that file. Export BOM components from DBA as CSV.')
        return
      }
      const replace =
        lines.length === 0 ||
        window.confirm(`Replace the current bill of materials with ${parsed.length} parts from ${file.name}?`)
      if (!replace) return
      onChange(assignBalloons(parsed.map((line) => createBomLine(line))))
    }
    reader.readAsText(file)
  }

  return (
    <div className="bom-list">
      <div className="bom-list-heading">
        <h4>Bill of materials</h4>
        {locked ? null : (
          <div className="bom-list-actions">
            <button type="button" className="btn btn-secondary" onClick={() => fileRef.current?.click()}>
              Import DBA BOM
            </button>
            <button type="button" className="btn btn-secondary" onClick={onAdd}>
              Add part
            </button>
            <button type="button" className="btn btn-danger" onClick={onDelete} disabled={lines.length === 0}>
              Delete BOM
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.txt,.tsv,text/csv"
              hidden
              onChange={(event) => {
                importFile(event.target.files?.[0])
                event.target.value = ''
              }}
            />
          </div>
        )}
      </div>
      <p className="tool-list-note">
        Export BOM components from DBA as CSV, then import them here. Each part gets a balloon
        number, and that number stays with the part. Adding, removing, changing a quantity, or
        deleting the whole list asks for the passcode. Parts stay off each step until you add them there. To mark a
        picture, right-click it and choose Add balloons, pick the part, then click that part in
        the photo. The balloon shows only that number. Use Text on the photo for words.
      </p>
      {lines.length === 0 ? <p className="tool-empty">No parts yet.</p> : null}
      {lines.length ? (
        <div className="bom-columns" aria-hidden="true">
          <span />
          <span>No.</span>
          <span>Part</span>
          <span>Description</span>
          <span>Qty</span>
          <span />
        </div>
      ) : null}
      {lines.map((line, index) => (
        <div
          className="bom-row"
          key={line.id}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault()
            const from = dragFrom.current
            dragFrom.current = null
            if (locked || from == null) return
            onChange(moveItem(lines, from, index))
          }}
        >
          {locked ? (
            <span />
          ) : (
            <button
              type="button"
              className="drag-handle"
              draggable
              aria-label={`Drag part ${index + 1}`}
              onDragStart={() => {
                dragFrom.current = index
              }}
              onDragEnd={() => {
                dragFrom.current = null
              }}
            >
              ↕
            </button>
          )}
          <Balloon number={line.balloon} />
          <input
            value={line.partNumber}
            readOnly={locked}
            aria-label={`Part number ${index + 1}`}
            placeholder="Part number"
            spellCheck={false}
            onChange={(event) => update(line.id, { partNumber: event.target.value })}
          />
          <input
            value={line.description}
            readOnly={locked}
            aria-label={`Description ${index + 1}`}
            placeholder="Description"
            spellCheck
            onChange={(event) => update(line.id, { description: capitalizeSentences(event.target.value) })}
          />
          <input
            ref={(node) => {
              qtyRefs.current[line.id] = node
            }}
            value={line.quantity}
            readOnly={locked || quantityEditId !== line.id}
            aria-label={`Quantity ${index + 1}`}
            placeholder="Qty"
            spellCheck={false}
            title={locked ? undefined : 'Changing the quantity asks for the passcode'}
            onMouseDown={(event) => {
              if (locked || quantityEditId === line.id) return
              event.preventDefault()
              onEditQuantity(line.id)
            }}
            onFocus={(event) => {
              if (locked || quantityEditId === line.id) return
              const node = event.target
              const id = line.id
              requestAnimationFrame(() => {
                if (quantityEditRef.current === id) return
                if (document.activeElement === node) node.blur()
              })
              onEditQuantity(id)
            }}
            onBlur={() => {
              if (quantityEditId === line.id) onQuantityDone()
            }}
            onChange={(event) => update(line.id, { quantity: event.target.value })}
          />
          {locked ? (
            <span />
          ) : (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => onRemove(line.id)}
            >
              Remove
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

function stepLabel(step) {
  const name = String(step.title || '').trim()
  return name ? `Step ${step.number}. ${name}` : `Step ${step.number}`
}

function joinSteps(list) {
  const labels = list.map(stepLabel)
  if (labels.length <= 1) return labels[0] || ''
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`
  return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`
}

export function StepBalloons({ lines, selectedIds, stepId, steps, locked, onChange }) {
  const [choice, setChoice] = useState('')
  const [pendingId, setPendingId] = useState('')
  const numbered = lines
  const selected = new Set(selectedIds || [])
  const added = numbered.filter((line) => selected.has(line.id))
  const available = numbered.filter((line) => !selected.has(line.id))
  const pending = numbered.find((line) => line.id === pendingId) || null
  const pendingSteps = pending
    ? (steps || []).filter((step) => step.id !== stepId && (step.bomLineIds || []).includes(pending.id))
    : []

  function ordered(ids) {
    const next = new Set(ids)
    return numbered.map((line) => line.id).filter((id) => next.has(id))
  }

  function usedElsewhere(id) {
    return (steps || []).filter((step) => step.id !== stepId && (step.bomLineIds || []).includes(id))
  }

  function commit(id) {
    if (!id || selected.has(id)) return
    onChange(ordered([...selected, id]))
    setChoice('')
    setPendingId('')
  }

  function requestAdd() {
    if (!choice) return
    if (usedElsewhere(choice).length) {
      setPendingId(choice)
      return
    }
    commit(choice)
  }

  function remove(id) {
    onChange(ordered([...selected].filter((item) => item !== id)))
    if (pendingId === id) setPendingId('')
  }

  return (
    <div className="balloon-picker">
      <h4>Parts on this step</h4>
      <p className="tool-list-note">
        Add only the parts used on this step. Importing a bill of materials does not put those parts here.
      </p>
      {added.length === 0 ? <p className="tool-empty">No parts on this step yet.</p> : null}
      {added.length ? (
        <div className="step-parts">
          {added.map((line) => (
            <div key={line.id} className="step-part">
              <Balloon number={line.balloon} />
              <span className="step-part-copy">
                <strong>{line.partNumber || 'No part number'}</strong>
                {line.description ? <small>{line.description}</small> : null}
              </span>
              {locked ? (
                <span />
              ) : (
                <button type="button" className="btn btn-secondary" onClick={() => remove(line.id)}>
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
      ) : null}
      {!locked && lines.length === 0 ? (
        <p className="tool-list-note">Import a bill of materials before adding parts to a step.</p>
      ) : null}
      {!locked && available.length ? (
        <div className="step-part-add">
          <select
            aria-label="Choose a part to add to this step"
            value={choice}
            onChange={(event) => {
              setChoice(event.target.value)
              setPendingId('')
            }}
          >
            <option value="">Choose a part</option>
            {available.map((line) => (
              <option key={line.id} value={line.id}>
                {line.balloon}. {line.partNumber || 'No part number'}
                {line.description ? ` — ${line.description}` : ''}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn-secondary" disabled={!choice} onClick={requestAdd}>
            Add part
          </button>
        </div>
      ) : null}
      {pending && pendingSteps.length ? (
        <div className="part-warning" role="status">
          <strong>{pending.partNumber || 'This part'} is already in use.</strong>
          <p>
            It is on {joinSteps(pendingSteps)}. You can still add it to this step.
          </p>
          <div className="part-warning-actions">
            <button type="button" className="btn btn-secondary" onClick={() => commit(pending.id)}>
              Add it here anyway
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setPendingId('')}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
