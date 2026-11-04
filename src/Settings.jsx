import { useRef } from 'react'

function Settings({
  dataDir,
  fileStore,
  note,
  isError,
  working,
  folderName,
  needsPermission,
  onChooseFolder,
  onDownload,
  onLoad,
}) {
  const fileRef = useRef(null)
  const folderLabel = needsPermission
    ? 'Allow backup folder'
    : folderName
      ? 'Change backup folder'
      : 'Choose backup folder'

  return (
    <section>
      <div className="page-heading">
        <h2>Settings</h2>
        <p>Backup and status controls live here. The document list stays clear of them.</p>
      </div>

      <section className="panel">
        <h3>Automatic backup</h3>
        <p className="section-note">
          Documents and photos are copied into the data folder every 5 minutes. Each save also
          updates the work-order files in that folder.
        </p>
        <p className="settings-label">Folder</p>
        <p className="settings-path">{fileStore ? dataDir || 'The WKI data folder' : folderName || 'No folder chosen yet'}</p>
        <p className={note ? `backup-note ${isError ? 'is-error' : 'is-done'}` : 'backup-note'}>
          {note || 'The next copy runs within 5 minutes.'}
        </p>
        <div className="backup-actions settings-actions">
          {fileStore ? null : (
            <button type="button" className="btn btn-secondary" onClick={onChooseFolder} disabled={working}>
              {folderLabel}
            </button>
          )}
          <button type="button" className="btn btn-secondary" onClick={() => fileRef.current?.click()} disabled={working}>
            Load backup
          </button>
          <button type="button" className="btn btn-secondary" onClick={onDownload} disabled={working}>
            {working ? 'Working…' : 'Download backup'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".zip,application/zip"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) onLoad(file)
            }}
          />
        </div>
      </section>

      <section className="panel">
        <h3>Document status</h3>
        <p className="section-note">
          Changing a document to Draft, In Review, Released, or Obsolete asks for a passcode.
          Adding, removing, changing a quantity, or deleting the whole bill of materials asks for the same passcode.
          The passcode is not shown here and is not stored on the document. Setting a status
          still does not approve the document.
        </p>
      </section>
    </section>
  )
}

export default Settings
