import { useEffect, useRef, useState } from 'react'
import { getImage, prepareImageBlob, putImage } from './imageStore.js'
import ImageEditor from './ImageEditor.jsx'
import CropDialog from './CropDialog.jsx'
import { renderComposite, loadHtmlImage } from './composite.js'
import { remapAnnotations } from './annotations.js'
import PrintSheet from './PrintSheet.jsx'
import ImageGallery from './ImageGallery.jsx'
import RichTextBox from './RichTextBox.jsx'
import { plainText } from './richText.js'
import {
  DOCUMENT_TYPES,
  createStep,
  formatWhen,
  isLockedStatus,
  prepareForSave,
  statusClass,
  validateDocument,
} from './model.js'

const emptyErrors = { fieldErrors: {}, messages: [] }

function Field({ label, required, hint, error, wide, children }) {
  return (
    <label className={wide ? 'field wide' : 'field'}>
      <span className="field-label">
        {label}
        {required ? <span className="req"> *</span> : null}
      </span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
      {error ? <span className="field-error">{error}</span> : null}
    </label>
  )
}

function allPhotos(doc) {
  return [
    ...(doc.coverImages || []),
    ...(doc.completedImages || []),
    ...(doc.bomImages || []),
    ...(doc.steps || []).flatMap((step) => step.images || []),
  ]
}

function imagesFor(doc, target) {
  if (!target) return []
  if (target.list === 'steps') {
    return doc.steps.find((step) => step.id === target.stepId)?.images || []
  }
  return doc[target.list] || []
}

function withImages(doc, target, images) {
  if (target.list === 'steps') {
    return {
      ...doc,
      steps: doc.steps.map((step) => (step.id === target.stepId ? { ...step, images } : step)),
    }
  }
  return { ...doc, [target.list]: images }
}

function Editor({ initialDocument, isSaved, onBack, onSave, onCreateRevision, onDelete, onRegisterFlush }) {
  const [form, setForm] = useState(initialDocument)
  const [locked, setLocked] = useState(isLockedStatus(initialDocument.status))
  const [errors, setErrors] = useState(emptyErrors)
  const [notice, setNotice] = useState('')
  const [saveFailed, setSaveFailed] = useState(false)
  const [imageMessage, setImageMessage] = useState('')
  const [imageUrls, setImageUrls] = useState({})
  const [imagesReady, setImagesReady] = useState(false)
  const [editingImage, setEditingImage] = useState(null)
  const [importCrop, setImportCrop] = useState(null)
  const [cardMenu, setCardMenu] = useState(null)
  const [cardTrim, setCardTrim] = useState(null)
  const [showPrint, setShowPrint] = useState(false)
  const previewUrls = useRef([])
  const [savedJson, setSavedJson] = useState(() => JSON.stringify(initialDocument))
  const dirty = JSON.stringify(form) !== savedJson
  const formRef = useRef(form)
  const lockedRef = useRef(locked)
  const savedJsonRef = useRef(savedJson)
  const finishSaveRef = useRef(null)

  useEffect(() => {
    document.body.classList.toggle('print-preview', showPrint)
    if (showPrint) window.scrollTo(0, 0)
    return () => document.body.classList.remove('print-preview')
  }, [showPrint])

  useEffect(() => {
    function handleBeforeUnload(event) {
      if (!dirty) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [dirty])

  useEffect(() => {
    const urls = previewUrls.current
    return () => {
      for (const url of urls) URL.revokeObjectURL(url)
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function loadPreviews() {
      const map = {}
      const created = []
      const photos = allPhotos(initialDocument)
      for (const image of photos) {
        try {
          const blob = await getImage(image.id)
          if (cancelled || !blob) continue
          const url = URL.createObjectURL(blob)
          created.push(url)
          map[image.id] = url
        } catch {
          // A missing photo is shown on the step. The document text stays available.
        }
      }
      if (cancelled) {
        for (const url of created) URL.revokeObjectURL(url)
        return
      }
      previewUrls.current.push(...created)
      setImageUrls((current) => ({ ...current, ...map }))
      setImagesReady(true)
    }

    loadPreviews()
    return () => {
      cancelled = true
    }
  }, [initialDocument])

  function changeForm(recipe) {
    if (locked) return
    const next = recipe(form)
    setNotice('')
    setForm(next)
    setErrors((existing) => (existing.messages.length ? validateDocument(next) : existing))
  }

  function finishSave(next, message) {
    setForm(next)
    const ok = onSave(next)
    if (!ok) {
      setNotice('')
      setSaveFailed(true)
      return false
    }
    setSaveFailed(false)
    setSavedJson(JSON.stringify(next))
    setLocked(isLockedStatus(next.status))
    setErrors(emptyErrors)
    setNotice(message)
    return true
  }

  useEffect(() => {
    formRef.current = form
    lockedRef.current = locked
    savedJsonRef.current = savedJson
    finishSaveRef.current = finishSave
  })

  useEffect(() => {
    if (!onRegisterFlush) return undefined
    return onRegisterFlush(() => {
      const current = formRef.current
      if (lockedRef.current) return { ok: true, skipped: true }
      if (JSON.stringify(current) === savedJsonRef.current) return { ok: true, skipped: true }
      const result = validateDocument(current)
      if (result.messages.length) {
        setErrors(result)
        return { ok: false, reason: 'required' }
      }
      const saved = finishSaveRef.current(prepareForSave(current), 'Saved in this browser.')
      return saved ? { ok: true } : { ok: false, reason: 'save' }
    })
  }, [onRegisterFlush])

  function advanceImport(queue) {
    const nextIndex = queue.index + 1
    if (nextIndex >= queue.items.length) {
      for (const item of queue.items) URL.revokeObjectURL(item.url)
      setImportCrop(null)
      return
    }
    setImportCrop({ ...queue, index: nextIndex })
  }

  async function storeNewImage(target, source) {
    const blob = await prepareImageBlob(source)
    const id = crypto.randomUUID()
    await putImage(id, blob)
    const url = URL.createObjectURL(blob)
    previewUrls.current.push(url)
    setImageUrls((current) => ({ ...current, [id]: url }))
    setNotice('')
    setForm((current) =>
      withImages(current, target, [
        ...imagesFor(current, target),
        { id, attachmentId: id, caption: '', annotations: [], compositeId: '' },
      ]),
    )
  }

  function queueImport(target, fileList) {
    if (locked) return
    const files = [...(fileList || [])]
    const images = files.filter((file) => String(file.type || '').startsWith('image/'))
    const rejected = files.filter((file) => !String(file.type || '').startsWith('image/'))
    if (rejected.length) {
      setImageMessage(rejected.map((file) => `${file.name || 'File'}: Choose an image file.`).join(' '))
    } else {
      setImageMessage('')
    }
    if (!images.length) return
    setImportCrop({
      target,
      index: 0,
      items: images.map((file) => ({ file, url: URL.createObjectURL(file) })),
    })
  }

  async function acceptImport(source) {
    const queue = importCrop
    if (!queue) return
    const current = queue.items[queue.index]
    try {
      await storeNewImage(queue.target, source || current.file)
    } catch (error) {
      setImageMessage(`${current.file.name || 'Image'}: ${error.message || 'could not be stored.'}`)
    }
    advanceImport(queue)
  }

  async function replaceAttachmentImage(target, attachmentId, source, annotations) {
    const blob = await prepareImageBlob(source)
    const id = crypto.randomUUID()
    await putImage(id, blob)
    const url = URL.createObjectURL(blob)
    previewUrls.current.push(url)
    setImageUrls((current) => ({ ...current, [id]: url }))
    setNotice('')
    setForm((current) =>
      withImages(
        current,
        target,
        imagesFor(current, target).map((image) =>
          image.attachmentId === attachmentId ? { ...image, id, annotations } : image,
        ),
      ),
    )
  }

  function removeImage(target, attachmentId, blobId) {
    const stillUsed = allPhotos(form).some(
      (image) => image.id === blobId && image.attachmentId !== attachmentId,
    )
    changeForm((current) =>
      withImages(
        current,
        target,
        imagesFor(current, target).filter((image) => image.attachmentId !== attachmentId),
      ),
    )
    if (!stillUsed) {
      setImageUrls((current) => {
        if (!current[blobId]) return current
        URL.revokeObjectURL(current[blobId])
        const next = { ...current }
        delete next[blobId]
        return next
      })
    }
  }

  async function saveImageAnnotations(annotations) {
    if (!editingImage) return { ok: false, message: 'That photo is no longer open.' }
    const image = imagesFor(form, editingImage).find((item) => item.attachmentId === editingImage.attachmentId)
    if (!image || !imageUrls[image.id]) {
      return { ok: false, message: 'The original photo is not available.' }
    }
    const html = await loadHtmlImage(imageUrls[image.id])
    const blob = await renderComposite(html, annotations)
    const compositeId = crypto.randomUUID()
    await putImage(compositeId, blob)
    const preview = URL.createObjectURL(blob)
    previewUrls.current.push(preview)
    setImageUrls((current) => ({ ...current, [compositeId]: preview }))
    const nextForm = withImages(
      form,
      editingImage,
      imagesFor(form, editingImage).map((entry) =>
        entry.attachmentId === editingImage.attachmentId ? { ...entry, annotations, compositeId } : entry,
      ),
    )
    const prepared = prepareForSave(nextForm)
    const validation = validateDocument(prepared)
    if (validation.messages.length) {
      setForm(prepared)
      setErrors(validation)
      setNotice('Annotations are on this draft. Fill in the required fields, then click Save draft.')
      setEditingImage(null)
      return { ok: true }
    }
    const saved = finishSave(prepared, 'Saved in this browser.')
    if (saved) setEditingImage(null)
    return {
      ok: saved,
      message: saved ? '' : 'The annotations are on this draft, but the browser could not store the document.',
    }
  }

  function handleSave() {
    if (locked || !dirty) return
    const result = validateDocument(form)
    if (result.messages.length) {
      setErrors(result)
      setNotice('')
      return
    }
    finishSave(prepareForSave(form), 'Saved in this browser.')
  }

  function requestBack() {
    if (dirty) {
      const confirmed = window.confirm(
        'You have unsaved changes. Discard them and return to the document list?',
      )
      if (!confirmed) return
    }
    onBack()
  }

  function handleObsolete() {
    const confirmed = window.confirm(
      'Mark this released revision obsolete? The wording stays locked, and the record is not deleted.',
    )
    if (!confirmed) return
    finishSave(
      prepareForSave({ ...form, status: 'Obsolete' }),
      'Marked obsolete in this browser. This is not an approval.',
    )
  }

  function invalid(name) {
    return errors.fieldErrors[name] ? 'invalid' : undefined
  }

  const openImage = editingImage
    ? imagesFor(form, editingImage).find((image) => image.attachmentId === editingImage.attachmentId)
    : null
  const importItem = importCrop ? importCrop.items[importCrop.index] : null
  const trimImage = cardTrim
    ? imagesFor(form, cardTrim).find((image) => image.attachmentId === cardTrim.attachmentId)
    : null

  function gallery(list, stepId, images) {
    const target = { list, stepId }
    return (
      <ImageGallery
        label={
          list === 'coverImages'
            ? 'Cover photos'
            : list === 'completedImages'
              ? 'Completed assembly'
              : list === 'bomImages'
                ? 'Bill of materials'
                : 'Images'
        }
        hint={
          list === 'coverImages'
            ? 'Add one or more photos. The first photo prints behind the assembly name. Right-click a photo to edit or trim it.'
            : list === 'completedImages'
              ? 'Add photos of the completed assembly. Right-click a photo to edit or trim it.'
              : list === 'bomImages'
                ? 'Insert the bill of materials picture from the ERP. You can add more than one. Right-click a photo to edit or trim it.'
                : ''
        }
        images={images}
        locked={locked}
        imageUrls={imageUrls}
        imagesReady={imagesReady}
        onAddFiles={(files) => queueImport(target, files)}
        onEdit={(attachmentId) => setEditingImage({ ...target, attachmentId })}
        onTrim={(attachmentId) => setCardTrim({ ...target, attachmentId })}
        onRemove={(attachmentId, blobId) => removeImage(target, attachmentId, blobId)}
        onCaption={(attachmentId, caption) =>
          changeForm((current) =>
            withImages(
              current,
              target,
              imagesFor(current, target).map((image) =>
                image.attachmentId === attachmentId ? { ...image, caption } : image,
              ),
            ),
          )
        }
        onContextMenu={(event, attachmentId) =>
          setCardMenu({
            x: event.clientX,
            y: event.clientY,
            ...target,
            attachmentId,
          })
        }
      />
    )
  }

  return (
    <form
      className={locked ? 'editor read-only' : 'editor'}
      autoComplete="off"
      onSubmit={(event) => {
        event.preventDefault()
        handleSave()
      }}
    >
      <button type="button" className="btn btn-quiet back-button" onClick={requestBack}>
        Back to documents
      </button>

      <h2>{form.title.trim() || 'New document'}</h2>
      <p className="doc-meta">
        {form.documentType}
        {' · '}
        {form.documentNumber || 'No document number yet'}
        {' · Rev '}
        {form.revision || '—'}
        {form.partNumber ? ` · Assembly ${form.partNumber}` : ''}
        {form.isSample ? <span className="sample-tag">Sample</span> : null}
      </p>
      <p className="updated-line">Updated {formatWhen(form.updatedAt)}</p>

      {form.basedOnRevision ? (
        <p className="revision-note">
          This is a separate draft. Revision {form.basedOnRevision} was not changed.
        </p>
      ) : null}

      {locked ? (
        <p className="lock-note">
          This revision is read-only. Create revision adds a new draft and does not change this copy.
        </p>
      ) : (
        <p className="hint">
          To save a draft, enter a title and document number. Starred fields and every step
          instruction are also required for In Review or Released. A reviewer and effective date
          are required to release. Changing the status here is not a real approval.
        </p>
      )}

      <div className="editor-actions">
        <button type="button" className="btn btn-secondary" onClick={() => setShowPrint(true)}>
          Print document
        </button>
        <label className="status-control">
          <span>Status</span>
          {locked ? (
            <span className={statusClass(form.status)}>{form.status}</span>
          ) : (
            <select
              value={form.status}
              onChange={(event) => {
                const status = event.target.value
                changeForm((current) => ({ ...current, status }))
              }}
            >
              <option value="Draft">Draft</option>
              <option value="In Review">In Review</option>
              <option value="Released">Released</option>
            </select>
          )}
        </label>
        {locked ? null : (
          <button type="submit" className="btn btn-primary" disabled={!dirty}>
            {form.status === 'Draft' ? 'Save draft' : 'Save'}
          </button>
        )}
        {locked ? (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              const ok = onCreateRevision(form)
              if (!ok) setSaveFailed(true)
            }}
          >
            Create revision
          </button>
        ) : null}
        {locked && form.status === 'Released' ? (
          <button type="button" className="btn btn-secondary" onClick={handleObsolete}>
            Mark obsolete
          </button>
        ) : null}
        {isSaved && form.status === 'Draft' && !locked ? (
          <button type="button" className="btn btn-danger action-end" onClick={() => onDelete(form)}>
            Delete draft
          </button>
        ) : null}
      </div>
      {locked ? null : (
        <p className={`save-state ${dirty || !isSaved ? 'is-unsaved' : 'is-saved'}`} role="status">
          {dirty ? 'Unsaved changes' : isSaved ? 'All changes saved' : 'Not saved yet'}
        </p>
      )}

      {errors.messages.length > 0 ? (
        <div className="message error" role="alert">
          <strong>Save was blocked. Fix these items:</strong>
          <ul>
            {errors.messages.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {notice ? (
        <p className="message success" role="status">
          {notice}
        </p>
      ) : null}
      {saveFailed ? (
        <p className="message error" role="alert">
          The draft was not saved. The last successful copy is still in this browser.
        </p>
      ) : null}

      <section className="panel">
        <h3>Document information</h3>
        <p className="section-note">
          These details match the introduction page. Fields marked * are required before a
          document can move to In Review or Released.
        </p>
        <div className="form-grid">
          <Field label="Title" required wide error={errors.fieldErrors.title}>
            <input
              className={invalid('title')}
              value={form.title}
              readOnly={locked}
              aria-invalid={Boolean(errors.fieldErrors.title)}
              onChange={(event) => {
                const title = event.target.value
                changeForm((current) => ({ ...current, title }))
              }}
            />
          </Field>
          <Field label="Document type" wide>
            <select
              value={form.documentType}
              disabled={locked}
              onChange={(event) => {
                const documentType = event.target.value
                changeForm((current) => ({ ...current, documentType }))
              }}
            >
              {DOCUMENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Document number" required error={errors.fieldErrors.documentNumber}>
            <input
              className={invalid('documentNumber')}
              value={form.documentNumber}
              readOnly={locked}
              aria-invalid={Boolean(errors.fieldErrors.documentNumber)}
              onChange={(event) => {
                const documentNumber = event.target.value
                changeForm((current) => ({ ...current, documentNumber }))
              }}
            />
          </Field>
          <Field label="Revision" required error={errors.fieldErrors.revision}>
            <input
              className={invalid('revision')}
              value={form.revision}
              readOnly={locked}
              aria-invalid={Boolean(errors.fieldErrors.revision)}
              onChange={(event) => {
                const revision = event.target.value
                changeForm((current) => ({ ...current, revision }))
              }}
            />
          </Field>
          <Field label="Assembly number" required error={errors.fieldErrors.partNumber}>
            <input
              className={invalid('partNumber')}
              value={form.partNumber}
              readOnly={locked}
              aria-invalid={Boolean(errors.fieldErrors.partNumber)}
              onChange={(event) => {
                const partNumber = event.target.value
                changeForm((current) => ({ ...current, partNumber }))
              }}
            />
          </Field>
          <Field label="Department" required error={errors.fieldErrors.department}>
            <input
              className={invalid('department')}
              value={form.department}
              readOnly={locked}
              aria-invalid={Boolean(errors.fieldErrors.department)}
              onChange={(event) => {
                const department = event.target.value
                changeForm((current) => ({ ...current, department }))
              }}
            />
          </Field>
          <Field label="Prepared by" required error={errors.fieldErrors.preparedBy}>
            <input
              className={invalid('preparedBy')}
              value={form.preparedBy}
              readOnly={locked}
              aria-invalid={Boolean(errors.fieldErrors.preparedBy)}
              onChange={(event) => {
                const preparedBy = event.target.value
                changeForm((current) => ({ ...current, preparedBy }))
              }}
            />
          </Field>
          <Field label="Reviewer" hint="Required to release" error={errors.fieldErrors.reviewer}>
            <input
              className={invalid('reviewer')}
              value={form.reviewer}
              readOnly={locked}
              aria-invalid={Boolean(errors.fieldErrors.reviewer)}
              onChange={(event) => {
                const reviewer = event.target.value
                changeForm((current) => ({ ...current, reviewer }))
              }}
            />
          </Field>
          <Field
            label="Effective date"
            wide
            hint="Required to release"
            error={errors.fieldErrors.effectiveDate}
          >
            <input
              type="date"
              className={invalid('effectiveDate')}
              value={form.effectiveDate}
              readOnly={locked}
              disabled={locked}
              aria-invalid={Boolean(errors.fieldErrors.effectiveDate)}
              onChange={(event) => {
                const effectiveDate = event.target.value
                changeForm((current) => ({ ...current, effectiveDate }))
              }}
            />
          </Field>
        </div>
        {gallery('coverImages', null, form.coverImages)}
      </section>

      <section className="panel">
        <h3>General requirements</h3>
        <div className="form-grid">
          <Field label="Purpose" required wide error={errors.fieldErrors.purpose}>
            <RichTextBox
              value={form.purpose}
              readOnly={locked}
              invalid={Boolean(errors.fieldErrors.purpose)}
              onChange={(purpose) => changeForm((current) => ({ ...current, purpose }))}
            />
          </Field>
          <Field label="Scope" wide>
            <RichTextBox
              value={form.scope}
              readOnly={locked}
              onChange={(scope) => changeForm((current) => ({ ...current, scope }))}
            />
          </Field>
          <Field label="Safety requirements / PPE" wide>
            <RichTextBox
              value={form.safety}
              readOnly={locked}
              placeholder="PPE, lockout, and hazards. Write None if there are none."
              onChange={(safety) => changeForm((current) => ({ ...current, safety }))}
            />
          </Field>
          <Field label="Required tools and equipment" wide>
            <RichTextBox
              value={form.toolsEquipment || ''}
              readOnly={locked}
              placeholder="Tools, fixtures, gages, and equipment."
              onChange={(toolsEquipment) => changeForm((current) => ({ ...current, toolsEquipment }))}
            />
          </Field>
          <Field label="Bill of materials notes" wide hint="Optional. The pictures below print as the bill of materials.">
            <RichTextBox
              value={form.materialsParts || ''}
              readOnly={locked}
              placeholder="Optional notes. Use the pictures for the ERP bill of materials."
              onChange={(materialsParts) => changeForm((current) => ({ ...current, materialsParts }))}
            />
          </Field>
          <Field label="References" wide>
            <RichTextBox
              value={form.references}
              readOnly={locked}
              placeholder="Drawings, specifications, and related documents."
              onChange={(references) => changeForm((current) => ({ ...current, references }))}
            />
          </Field>
        </div>
        {gallery('bomImages', null, form.bomImages)}
        {gallery('completedImages', null, form.completedImages)}
      </section>

      <section className="panel">
        <h3>Procedure steps</h3>
        <p className="section-note">
          Add steps in the order a technician should perform them. Step numbers follow that
          order. Each step needs instruction text before review or release. Photos stay with
          the step they were added to. Right-click a photo to edit or trim it. You do not have to click the
          photo itself.
        </p>
        {imageMessage ? <p className="field-error">{imageMessage}</p> : null}
        {errors.fieldErrors.steps ? <p className="field-error">{errors.fieldErrors.steps}</p> : null}

        {form.steps.length === 0 ? <p className="empty">No steps yet.</p> : null}

        {form.steps.map((step, index) => (
          <article key={step.id} className="step-card">
            <div className="step-index">
              <span>Step</span>
              <strong>{index + 1}</strong>
            </div>
            <div className="step-body">
              <div className="step-grid">
                <Field label="Step title" wide>
                  <input
                    value={step.title || ''}
                    readOnly={locked}
                    onChange={(event) => {
                      const title = event.target.value
                      changeForm((current) => ({
                        ...current,
                        steps: current.steps.map((item) =>
                          item.id === step.id ? { ...item, title } : item,
                        ),
                      }))
                    }}
                  />
                </Field>
                <Field label="Detailed instruction" required wide>
                  <RichTextBox
                    value={step.instruction}
                    readOnly={locked}
                    invalid={Boolean(errors.fieldErrors.steps) && !plainText(step.instruction)}
                    onChange={(instruction) =>
                      changeForm((current) => ({
                        ...current,
                        steps: current.steps.map((item) =>
                          item.id === step.id ? { ...item, instruction } : item,
                        ),
                      }))
                    }
                  />
                </Field>
                <Field label="Required tools or parts">
                  <RichTextBox
                    value={step.toolsOrParts}
                    readOnly={locked}
                    onChange={(toolsOrParts) =>
                      changeForm((current) => ({
                        ...current,
                        steps: current.steps.map((item) =>
                          item.id === step.id ? { ...item, toolsOrParts } : item,
                        ),
                      }))
                    }
                  />
                </Field>
                <Field label="Quality check or acceptance criteria">
                  <RichTextBox
                    value={step.qualityCheck}
                    readOnly={locked}
                    placeholder="What must be verified, and what gets recorded."
                    onChange={(qualityCheck) =>
                      changeForm((current) => ({
                        ...current,
                        steps: current.steps.map((item) =>
                          item.id === step.id ? { ...item, qualityCheck } : item,
                        ),
                      }))
                    }
                  />
                </Field>
                <Field label="Safety note" wide hint="Optional. Leave blank if this step has no extra hazard.">
                  <RichTextBox
                    value={step.safetyNote}
                    readOnly={locked}
                    onChange={(safetyNote) =>
                      changeForm((current) => ({
                        ...current,
                        steps: current.steps.map((item) =>
                          item.id === step.id ? { ...item, safetyNote } : item,
                        ),
                      }))
                    }
                  />
                </Field>
              </div>

              {gallery('steps', step.id, step.images)}
              {step.imageNote ? (
                <Field label="Existing image description" wide>
                  <RichTextBox
                    value={step.imageNote}
                    readOnly={locked}
                    onChange={(imageNote) =>
                      changeForm((current) => ({
                        ...current,
                        steps: current.steps.map((item) =>
                          item.id === step.id ? { ...item, imageNote } : item,
                        ),
                      }))
                    }
                  />
                </Field>
              ) : null}

              {locked ? null : (
                <div className="step-actions">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={index === 0}
                    onClick={() => {
                      changeForm((current) => {
                        const steps = [...current.steps]
                        const target = index - 1
                        if (target < 0) return current
                        const [item] = steps.splice(index, 1)
                        steps.splice(target, 0, item)
                        return { ...current, steps }
                      })
                    }}
                  >
                    Move up
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={index === form.steps.length - 1}
                    onClick={() => {
                      changeForm((current) => {
                        const steps = [...current.steps]
                        const target = index + 1
                        if (target >= steps.length) return current
                        const [item] = steps.splice(index, 1)
                        steps.splice(target, 0, item)
                        return { ...current, steps }
                      })
                    }}
                  >
                    Move down
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      changeForm((current) => {
                        const source = current.steps[index]
                        if (!source) return current
                        const copy = {
                          ...source,
                          id: crypto.randomUUID(),
                          images: (source.images || []).map((image) => ({
                            ...image,
                            attachmentId: crypto.randomUUID(),
                            annotations: (image.annotations || []).map((item) => ({
                              ...item,
                              id: crypto.randomUUID(),
                            })),
                          })),
                        }
                        const steps = [...current.steps]
                        steps.splice(index + 1, 0, copy)
                        return { ...current, steps }
                      })
                    }}
                  >
                    Duplicate
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={() => {
                      changeForm((current) => ({
                        ...current,
                        steps: current.steps.filter((item) => item.id !== step.id),
                      }))
                    }}
                  >
                    Remove
                  </button>
                </div>
              )}
            </div>
          </article>
        ))}

        {locked ? null : (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              changeForm((current) => ({
                ...current,
                steps: [...current.steps, createStep()],
              }))
            }}
          >
            Add step
          </button>
        )}
      </section>
      {openImage && imageUrls[openImage.id] ? (
        <ImageEditor
          src={imageUrls[openImage.id]}
          annotations={openImage.annotations || []}
          onCancel={() => setEditingImage(null)}
          onSave={saveImageAnnotations}
          onTrimmed={(blob, annotations) =>
            replaceAttachmentImage(editingImage, editingImage.attachmentId, blob, annotations)
          }
        />
      ) : null}
      {importItem ? (
        <CropDialog
          src={importItem.url}
          title="Trim photo"
          detail={`Photo ${importCrop.index + 1} of ${importCrop.items.length}. Drag the frame edges to cut the photo before it is added. The frame is already active.`}
          onCancel={() => advanceImport(importCrop)}
          onUseWhole={() => acceptImport(importItem.file)}
          onApply={(blob) => acceptImport(blob)}
        />
      ) : null}
      {cardTrim && trimImage && imageUrls[trimImage.id] ? (
        <CropDialog
          src={imageUrls[trimImage.id]}
          title="Trim photo"
          detail="Drag the frame edges to cut the photo. Marks stay with the area you keep."
          onCancel={() => setCardTrim(null)}
          onUseWhole={() => setCardTrim(null)}
          onApply={async (blob, crop) => {
            await replaceAttachmentImage(
              cardTrim,
              cardTrim.attachmentId,
              blob,
              remapAnnotations(trimImage.annotations || [], crop),
            )
            setCardTrim(null)
          }}
        />
      ) : null}
      {cardMenu ? (
        <div
          className="context-backdrop"
          onClick={() => setCardMenu(null)}
          onContextMenu={(event) => {
            event.preventDefault()
            setCardMenu(null)
          }}
        >
          <div className="context-menu" role="menu" style={{ left: cardMenu.x, top: cardMenu.y }}>
            <button
              type="button"
              onClick={() => {
                setEditingImage({
                  list: cardMenu.list,
                  stepId: cardMenu.stepId,
                  attachmentId: cardMenu.attachmentId,
                })
                setCardMenu(null)
              }}
            >
              Edit annotations
            </button>
            <button
              type="button"
              onClick={() => {
                setCardTrim({
                  list: cardMenu.list,
                  stepId: cardMenu.stepId,
                  attachmentId: cardMenu.attachmentId,
                })
                setCardMenu(null)
              }}
            >
              Trim photo
            </button>
          </div>
        </div>
      ) : null}
      <PrintSheet
        doc={form}
        imageUrls={imageUrls}
        onBack={() => setShowPrint(false)}
        onPrint={() => window.print()}
      />
    </form>
  )
}

export default Editor
