import { AnnotationPreview } from './ImageEditor.jsx'

function imageFilesFromClipboard(data) {
  const files = []
  for (const item of data?.items ? [...data.items] : []) {
    if (item.kind === 'file' && String(item.type || '').startsWith('image/')) {
      const file = item.getAsFile()
      if (file) files.push(file)
    }
  }
  if (files.length) return files
  return [...(data?.files || [])].filter((file) => String(file.type || '').startsWith('image/'))
}

function pasteTargetIsText(target) {
  if (!target) return false
  const name = target.tagName
  return name === 'INPUT' || name === 'TEXTAREA' || name === 'SELECT' || target.isContentEditable
}

function ImageGallery({
  label,
  hint,
  images,
  locked,
  imageUrls,
  imagesReady,
  onAddFiles,
  onEdit,
  onTrim,
  onRemove,
  onCaption,
  onContextMenu,
}) {
  const photos = images || []

  function handlePaste(event) {
    if (locked || pasteTargetIsText(event.target)) return
    const files = imageFilesFromClipboard(event.clipboardData)
    if (!files.length) return
    event.preventDefault()
    onAddFiles(files)
  }

  return (
    <div
      className="image-block"
      tabIndex={locked ? undefined : 0}
      onPaste={handlePaste}
    >
      <div className="image-block-heading">
        <strong>{label}</strong>
        {locked ? null : (
          <label className="btn btn-secondary file-button">
            Add images
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={(event) => {
                onAddFiles(event.target.files)
                event.target.value = ''
              }}
            />
          </label>
        )}
      </div>
      {hint ? <p className="field-hint">{hint}</p> : null}
      {locked ? null : (
        <p className="field-hint">Click this section, then paste an image.</p>
      )}
      {photos.length === 0 ? (
        <p className="image-empty">No photos yet. Use Add images, or click here and paste.</p>
      ) : (
        <div className="image-list">
          {photos.map((image) => (
            <figure
              key={image.attachmentId || image.id}
              className="image-card"
              onContextMenu={(event) => {
                if (locked || !imageUrls[image.id]) return
                event.preventDefault()
                onContextMenu(event, image.attachmentId)
              }}
            >
              {imageUrls[image.id] ? (
                <AnnotationPreview
                  src={imageUrls[image.id]}
                  annotations={image.annotations || []}
                  alt={image.caption || label}
                />
              ) : (
                <div className="image-missing">
                  {imagesReady ? 'This photo is not in browser storage.' : 'Loading photo…'}
                </div>
              )}
              {imageUrls[image.id] && !locked ? (
                <button type="button" className="btn btn-secondary" onClick={() => onEdit(image.attachmentId)}>
                  Add balloons
                </button>
              ) : null}
              {imageUrls[image.id] && !locked ? (
                <button type="button" className="btn btn-secondary" onClick={() => onTrim(image.attachmentId)}>
                  Trim photo
                </button>
              ) : null}
              {(image.annotations || []).some((item) => item.type === 'callout') ? (
                <ol className="callout-index">
                  {(image.annotations || [])
                    .filter((item) => item.type === 'callout')
                    .map((item) => (
                      <li key={item.id}>
                        <strong>{item.number}.</strong>
                        {item.text.trim() ? ` ${item.text.trim()}` : ''}
                      </li>
                    ))}
                </ol>
              ) : null}
              <label className="field">
                <span className="field-label">Caption</span>
                <input
                  value={image.caption || ''}
                  readOnly={locked}
                  placeholder="What should the technician notice?"
                  onChange={(event) => onCaption(image.attachmentId, event.target.value)}
                />
              </label>
              {locked ? null : (
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => onRemove(image.attachmentId, image.id)}
                >
                  Remove image
                </button>
              )}
            </figure>
          ))}
        </div>
      )}
    </div>
  )
}

export default ImageGallery
