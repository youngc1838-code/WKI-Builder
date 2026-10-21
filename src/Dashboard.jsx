import { useMemo, useState } from 'react'
import { DOCUMENT_TYPES, STATUSES, formatWhen, statusClass } from './model.js'

function Dashboard({ documents, onOpen, onCreate, onDelete }) {
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('All')
  const [statusFilter, setStatusFilter] = useState('All')

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase()
    return documents
      .filter((doc) => {
        const matchesQuery =
          query.length === 0 ||
          doc.title.toLowerCase().includes(query) ||
          doc.documentNumber.toLowerCase().includes(query)
        const matchesType = typeFilter === 'All' || doc.documentType === typeFilter
        const matchesStatus = statusFilter === 'All' || doc.status === statusFilter
        return matchesQuery && matchesType && matchesStatus
      })
      .sort((a, b) => {
        const byDate = new Date(b.updatedAt) - new Date(a.updatedAt)
        if (byDate !== 0) return byDate
        return a.documentNumber.localeCompare(b.documentNumber)
      })
  }, [documents, search, typeFilter, statusFilter])

  return (
    <section>
      <div className="page-heading">
        <h2>Documents</h2>
        <p>
          Saved work instructions and SOPs. Rows marked Sample are example data.
          Released revisions stay locked. Create a revision when the work changes
          so the released copy is not overwritten.
        </p>
      </div>

      <div className="toolbar">
        <label>
          Search
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Title or document number"
          />
        </label>
        <label>
          Document type
          <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
            <option value="All">All types</option>
            {DOCUMENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="All">All statuses</option>
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn btn-primary toolbar-action" onClick={onCreate}>
          New document
        </button>
      </div>

      <p className="result-count">
        {visible.length} of {documents.length} {documents.length === 1 ? 'document' : 'documents'}
      </p>

      {visible.length === 0 ? (
        <p className="empty">
          {documents.length === 0
            ? 'No documents yet. Create one to get started.'
            : 'No documents match this search or filter.'}
        </p>
      ) : (
        <div className="table-wrap">
          <table className="doc-table">
            <thead>
              <tr>
                <th>Document</th>
                <th>Type</th>
                <th>Department</th>
                <th>Status</th>
                <th>Updated</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((doc) => (
                <tr key={doc.id}>
                  <td>
                    <div className="doc-number">
                      {doc.documentNumber || 'No number'} · Rev {doc.revision || '—'}
                    </div>
                    <div className="doc-title">
                      {doc.title || 'Untitled'}
                      {doc.isSample ? <span className="sample-tag">Sample</span> : null}
                    </div>
                    {doc.partNumber ? <div className="doc-part">{doc.partNumber}</div> : null}
                  </td>
                  <td>{doc.documentType}</td>
                  <td>{doc.department || '—'}</td>
                  <td>
                    <span className={statusClass(doc.status)}>{doc.status}</span>
                  </td>
                  <td>{formatWhen(doc.updatedAt)}</td>
                  <td>
                    <div className="row-actions">
                      <button
                        type="button"
                        className="btn btn-secondary"
                        aria-label={`Open ${doc.documentNumber} ${doc.title}`}
                        onClick={() => onOpen(doc)}
                      >
                        Open
                      </button>
                      {doc.status === 'Draft' ? (
                        <button type="button" className="btn btn-danger" onClick={() => onDelete(doc)}>
                          Delete
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

export default Dashboard
