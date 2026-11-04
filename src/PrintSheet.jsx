import { createPortal } from 'react-dom'
import { AnnotationPreview } from './ImageEditor.jsx'
import { assignBalloons } from './model.js'
import { plainText, toEditorHtml } from './richText.js'

function RichContent({ value }) {
  if (!plainText(value)) return <p> </p>
  return <div className="rich-text" dangerouslySetInnerHTML={{ __html: toEditorHtml(value) }} />
}

function PrintToolList({ title, tools, legacy }) {
  const rows = (tools || []).filter(
    (tool) => String(tool.identifier || '').trim() || String(tool.description || '').trim(),
  )
  if (rows.length === 0) {
    return <PrintBox title={title} text={legacy} />
  }
  return (
    <section className="print-box">
      <h3>{title}</h3>
      <table className="print-tool-table">
        <thead>
          <tr>
            <th>Item</th>
            <th>Kind</th>
            <th>Identifier</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((tool, index) => (
            <tr key={tool.id}>
              <td>{index + 1}</td>
              <td>{tool.kind}</td>
              <td>{tool.identifier}</td>
              <td>{tool.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {plainText(legacy) ? <RichContent value={legacy} /> : null}
    </section>
  )
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

function SheetPage({ pageNumber, className = '', id, children }) {
  return (
    <article id={id} className={className ? `print-page ${className}` : 'print-page'}>
      {children}
      <span className="sheet-page-no">{pageNumber}</span>
    </article>
  )
}

function chunk(items, size) {
  const pages = []
  for (let index = 0; index < items.length; index += size) pages.push(items.slice(index, index + size))
  return pages
}

const TOC_ROWS = 22
const BOM_ROWS = 16

export function sheetPlan(doc) {
  const steps = doc.steps || []
  const bomCount = (doc.bomLines || []).length
  const bomPages = bomCount === 0 ? 0 : Math.ceil(bomCount / BOM_ROWS)
  const contentsPages = Math.max(1, Math.ceil((1 + bomPages + steps.length) / TOC_ROWS))
  let page = 2 + contentsPages
  const requirementsPage = page
  page += 1
  const bomPageNumbers = Array.from({ length: bomPages }, () => {
    const current = page
    page += 1
    return current
  })
  const stepPageNumbers = steps.map(() => {
    const current = page
    page += 1
    return current
  })
  return { requirementsPage, bomPageNumbers, stepPageNumbers, contentsPages }
}

export function editorContents(doc) {
  const steps = doc.steps || []
  const plan = sheetPlan(doc)
  const entries = [
    { id: 'edit-cover', label: 'Document information', page: 1 },
    { id: 'edit-requirements', label: 'Requirements', page: plan.requirementsPage },
    {
      id: 'edit-bom',
      label: 'Bill of materials',
      page: plan.bomPageNumbers[0] || null,
    },
  ]
  steps.forEach((step, index) => {
    const title = String(step.title || '').trim()
    entries.push({
      id: `edit-step-${step.id}`,
      label: title ? `Step ${index + 1}. ${title}` : `Step ${index + 1}`,
      page: plan.stepPageNumbers[index],
    })
  })
  return entries
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
  return (
    <div className="print-photo-stack">
      {images.map((image) => (
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
                    <strong>{item.number}.</strong>
                    {item.text.trim() ? ` ${item.text.trim()}` : ''}
                  </li>
                ))}
            </ol>
          ) : null}
        </div>
      ))}
    </div>
  )
}

function PrintBalloons({ lines }) {
  if (!lines.length) return null
  return (
    <section className="print-box print-balloons">
      <h3>Parts on this step</h3>
      <ul>
        {lines.map((line) => (
          <li key={line.id}>
            <span className="balloon">{line.balloon}</span>
            <span className="print-part-copy">
              <strong>{line.partNumber || 'Part'}</strong>
              {line.description ? <small>{line.description}</small> : null}
              {line.quantity ? <small>Qty {line.quantity}</small> : null}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function PrintSheet({ doc, imageUrls, onBack, onPrint }) {
  const steps = doc.steps || []
  const coverImages = photoList(doc.coverImages, doc.coverImage)
  const completedImages = photoList(doc.completedImages, doc.completedImage)
  const coverUrl = coverImages[0] ? imageUrls[coverImages[0].id] : ''
  const bomLines = assignBalloons(doc.bomLines || [])
  const bomById = new Map(bomLines.map((line) => [line.id, line]))
  const bomChunks = chunk(bomLines, BOM_ROWS)
  const { requirementsPage, bomPageNumbers, stepPageNumbers, contentsPages } = sheetPlan(doc)
  const contentsPageCount = contentsPages
  const contents = [
    { href: '#sheet-requirements', label: 'Requirements', page: requirementsPage },
    ...bomPageNumbers.map((page, index) => ({
      href: `#sheet-bom-${index}`,
      label: index === 0 ? 'Bill of materials' : 'Bill of materials, continued',
      page,
    })),
    ...steps.map((step, index) => ({
      href: `#sheet-step-${step.id}`,
      label: `Step ${index + 1}${step.title.trim() ? `. ${step.title.trim()}` : ''}`,
      page: stepPageNumbers[index],
    })),
  ]
  const contentsChunks = chunk(contents, TOC_ROWS)

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
        </div>
      </SheetPage>

      {contentsChunks.map((group, index) => (
        <SheetPage
          pageNumber={index + 2}
          id={index === 0 ? 'sheet-contents' : `sheet-contents-${index}`}
          className="print-contents"
          key={`contents-${index}`}
        >
          <RunningHead
            doc={doc}
            pageLabel={
              contentsChunks.length > 1
                ? `Page ${index + 2} · Contents ${index + 1} of ${contentsChunks.length}`
                : `Page ${index + 2} · Contents`
            }
          />
          <h2>{index === 0 ? 'Contents' : 'Contents, continued'}</h2>
          <p className="print-contents-note">Page numbers below match the printed sheet.</p>
          <ol className="print-toc">
            {group.map((entry) => (
              <li key={entry.href}>
                <a href={entry.href}>
                  <span>{entry.label}</span>
                  <span className="print-toc-page">{entry.page}</span>
                </a>
              </li>
            ))}
          </ol>
        </SheetPage>
      ))}

      <SheetPage pageNumber={requirementsPage} id="sheet-requirements" className="print-sheet-fit">
        <RunningHead doc={doc} pageLabel={`Page ${requirementsPage} · Requirements`} />
        <h2>Requirements</h2>
        <div className="print-sheet-copy">
          <PrintBox title="Purpose" text={doc.purpose} />
          <PrintBox title="Scope" text={doc.scope} />
          <PrintBox title="Safety requirements" text={doc.safety} />
          <PrintToolList title="Tools and equipment" tools={doc.equipment} legacy={doc.toolsEquipment} />
          {plainText(doc.materialsParts) ? (
            <PrintBox title="Bill of materials notes" text={doc.materialsParts} />
          ) : null}
        </div>
        <div className="print-sheet-media">
          <section className="print-box">
            <h3>Completed assembly</h3>
            <PrintPhotos
              images={completedImages}
              imageUrls={imageUrls}
              emptyLabel="Space for a photo of the completed assembly"
            />
          </section>
        </div>
        <PrintBox title="References" text={doc.references} />
      </SheetPage>

      {bomChunks.map((group, index) => (
        <SheetPage
          pageNumber={bomPageNumbers[index]}
          id={`sheet-bom-${index}`}
          className="print-bom-page"
          key={`bom-${index}`}
        >
          <RunningHead
            doc={doc}
            pageLabel={`Page ${bomPageNumbers[index]} · Bill of materials${bomChunks.length > 1 ? ` ${index + 1} of ${bomChunks.length}` : ''}`}
          />
          <h2>{index === 0 ? 'Bill of materials' : 'Bill of materials, continued'}</h2>
          <table className="print-bom-table">
            <thead>
              <tr>
                <th>No.</th>
                <th>Part</th>
                <th>Description</th>
                <th>Qty</th>
              </tr>
            </thead>
            <tbody>
              {group.map((line) => (
                <tr key={line.id}>
                  <td>
                    <span className="balloon">{line.balloon}</span>
                  </td>
                  <td>{line.partNumber}</td>
                  <td>{line.description}</td>
                  <td>{line.quantity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </SheetPage>
      ))}

      {steps.length === 0 ? (
        <SheetPage pageNumber={cursor}>
          <RunningHead doc={doc} pageLabel={`Page ${cursor} · Process`} />
          <h2>Process</h2>
          <PrintBox title="Steps" text="No process steps have been added." />
        </SheetPage>
      ) : (
        steps.map((step, index) => (
          <SheetPage
            pageNumber={stepPageNumbers[index]}
            id={`sheet-step-${step.id}`}
            className="print-sheet-fit"
            key={step.id}
          >
            <RunningHead
              doc={doc}
              pageLabel={`Page ${stepPageNumbers[index]} · Step ${index + 1} of ${steps.length}`}
            />
            <h2>
              Step {index + 1}
              {step.title.trim() ? `. ${step.title.trim()}` : ''}
            </h2>
            <div className="print-sheet-copy">
              <PrintBox title="Instruction" text={step.instruction} />
              <PrintBalloons
                lines={(step.bomLineIds || []).map((id) => bomById.get(id)).filter(Boolean)}
              />
              <PrintToolList title="Tools, consumables, and supplies" tools={step.tools} legacy={step.toolsOrParts} />
              <PrintBox title="Quality check" text={step.qualityCheck} />
              {plainText(step.safetyNote) ? <PrintBox title="Safety note" text={step.safetyNote} /> : null}
            </div>
            <div className="print-sheet-media">
              <section className="print-box">
                <h3>Photos</h3>
                <PrintPhotos
                  images={step.images || []}
                  imageUrls={imageUrls}
                  emptyLabel="No photo on this step"
                />
              </section>
            </div>
          </SheetPage>
        ))
      )}
    </div>,
    document.body,
  )
}

export default PrintSheet
