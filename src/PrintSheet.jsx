import { createPortal } from 'react-dom'
import { AnnotationPreview } from './ImageEditor.jsx'
import { plainText, toEditorHtml } from './richText.js'

function RichContent({ value }) {
  if (!plainText(value)) return <p> </p>
  return <div className="rich-text" dangerouslySetInnerHTML={{ __html: toEditorHtml(value) }} />
}

function PrintBox({ title, text, children }) {
  return (
    <section className="print-box">
      <h3>{title}</h3>
      {children || <RichContent value={text} />}
    </section>
  )
}

function RunningHead({ doc, pageLabel }) {
  return (
    <header className="print-running">
      <span>
        {doc.documentNumber || 'No document number'} · Rev {doc.revision || '—'}
      </span>
      <span>{pageLabel}</span>
    </header>
  )
}

function SheetPage({ pageNumber, className = '', children }) {
  return (
    <article className={className ? `print-page ${className}` : 'print-page'}>
      {children}
      <span className="sheet-page-no">{pageNumber}</span>
    </article>
  )
}

function PhotoFigure({ src, alt, annotations, emptyLabel }) {
  return (
    <figure className="print-figure">
      {src ? (
        <AnnotationPreview src={src} annotations={annotations || []} alt={alt} />
      ) : (
        <div className="print-photo-blank">{emptyLabel}</div>
      )}
    </figure>
  )
}

function photoList(list, legacy) {
  if (Array.isArray(list) && list.length) return list
  return legacy ? [legacy] : []
}

function PrintPhotos({ images, imageUrls, emptyLabel }) {
  if (!images.length) return <div className="print-photo-blank">{emptyLabel}</div>
  return images.map((image) => (
    <div className="print-photo" key={image.attachmentId || image.id}>
      <PhotoFigure
        src={imageUrls[image.id]}
        annotations={image.annotations}
        alt={image.caption || emptyLabel}
        emptyLabel="This photo is not in browser storage."
      />
      {plainText(image.caption) ? <p className="print-caption">{image.caption}</p> : null}
      {(image.annotations || []).some((item) => item.type === 'callout') ? (
        <ol className="print-callouts">
          {(image.annotations || [])
            .filter((item) => item.type === 'callout')
            .map((item) => (
              <li key={item.id}>
                <strong>{item.number}.</strong> {item.text.trim() || 'No description yet'}
              </li>
            ))}
        </ol>
      ) : null}
    </div>
  ))
}

function PrintSheet({ doc, imageUrls, onBack, onPrint }) {
  const steps = doc.steps || []
  const coverImages = photoList(doc.coverImages, doc.coverImage)
  const completedImages = photoList(doc.completedImages, doc.completedImage)
  const bomImages = photoList(doc.bomImages)
  const coverUrl = coverImages[0] ? imageUrls[coverImages[0].id] : ''

  return createPortal(
    <div className="print-root">
      <div className="print-actions">
        <button type="button" className="btn btn-secondary" onClick={onBack}>
          Back to editor
        </button>
        <button type="button" className="btn btn-primary" onClick={onPrint}>
          Print
        </button>
        <p>Operator sheet. Status, save buttons, and other editing controls are left off.</p>
      </div>

      <SheetPage pageNumber={1} className="print-cover">
        <header className="print-cover-band">
          <p className="print-kicker">{doc.documentType || 'Work Instruction'}</p>
          <p className="print-cover-id">
            <span>{doc.documentNumber.trim() || 'No document number'}</span>
            <span className="print-rev">Rev {doc.revision.trim() || '—'}</span>
          </p>
        </header>
        <section className={coverUrl ? 'print-cover-hero has-photo' : 'print-cover-hero'}>
          {coverUrl ? <img className="print-cover-bg" src={coverUrl} alt="" /> : null}
          <h2>{doc.title.trim() || 'Untitled document'}</h2>
          <span className="print-cover-rule" aria-hidden="true" />
          {doc.partNumber.trim() ? (
            <p className="print-cover-part">Assembly {doc.partNumber.trim()}</p>
          ) : null}
        </section>
        <div className="print-cover-body">
          <div className="print-info-grid">
            <PrintBox title="Document number" text={doc.documentNumber} />
            <PrintBox title="Revision" text={doc.revision} />
            <PrintBox title="Assembly number" text={doc.partNumber} />
            <PrintBox title="Department" text={doc.department} />
            <PrintBox title="Prepared by" text={doc.preparedBy} />
            <PrintBox title="Reviewer" text={doc.reviewer} />
            <PrintBox title="Effective date" text={doc.effectiveDate} />
          </div>
          {coverImages.length ? (
            <section className="print-box print-cover-photos">
              <h3>Cover photos</h3>
              <PrintPhotos images={coverImages} imageUrls={imageUrls} emptyLabel="Cover photo" />
            </section>
          ) : null}
        </div>
      </SheetPage>

      <SheetPage pageNumber={2}>
        <RunningHead doc={doc} pageLabel="Page 2 · Requirements" />
        <h2>Requirements</h2>
        <PrintBox title="Purpose" text={doc.purpose} />
        <PrintBox title="Scope" text={doc.scope} />
        <PrintBox title="Safety requirements" text={doc.safety} />
        <PrintBox title="Required equipment" text={doc.toolsEquipment} />
        <PrintBox title="Bill of Materials">
          {plainText(doc.materialsParts) ? <RichContent value={doc.materialsParts} /> : null}
          <PrintPhotos
            images={bomImages}
            imageUrls={imageUrls}
            emptyLabel="Space for a bill of materials picture"
          />
        </PrintBox>
        <PrintBox title="References" text={doc.references} />
        <section className="print-box">
          <h3>Completed assembly</h3>
          <PrintPhotos
            images={completedImages}
            imageUrls={imageUrls}
            emptyLabel="Space for a photo of the completed assembly"
          />
        </section>
      </SheetPage>

      {steps.length === 0 ? (
        <SheetPage pageNumber={3}>
          <RunningHead doc={doc} pageLabel="Page 3 · Process" />
          <h2>Process</h2>
          <PrintBox title="Steps" text="No process steps have been added." />
        </SheetPage>
      ) : (
        steps.map((step, index) => (
          <SheetPage pageNumber={index + 3} key={step.id}>
            <RunningHead doc={doc} pageLabel={`Page ${index + 3} · Step ${index + 1} of ${steps.length}`} />
            <h2>
              Step {index + 1}
              {step.title.trim() ? `. ${step.title.trim()}` : ''}
            </h2>
            <PrintBox title="Instruction" text={step.instruction} />
            <div className="print-step-grid">
              <PrintBox title="Tools or parts" text={step.toolsOrParts} />
              <PrintBox title="Quality check" text={step.qualityCheck} />
            </div>
            {plainText(step.safetyNote) ? <PrintBox title="Safety note" text={step.safetyNote} /> : null}
            <section className="print-box">
              <h3>Photos</h3>
              <PrintPhotos
                images={step.images || []}
                imageUrls={imageUrls}
                emptyLabel="No photo on this step"
              />
            </section>
          </SheetPage>
        ))
      )}
    </div>,
    document.body,
  )
}

export default PrintSheet
