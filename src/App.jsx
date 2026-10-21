import { useCallback, useEffect, useRef, useState } from 'react'
import Dashboard from './Dashboard.jsx'
import Editor from './Editor.jsx'
import { AUTO_BACKUP_MS, LATEST_BACKUP_NAME, createBackupBlob, downloadBlob, readBackupFile, restoreBackup } from './backup.js'
import { allowStoredFolder, chooseBackupFolder, loadStoredFolder, writeLatestBackup } from './backupFolder.js'
import { createBlankDocument, createRevisionFrom } from './model.js'
import { loadDocumentStore, saveDocuments } from './storage.js'

// Two screens share one list of documents.
// activeDocument is null on the list. It holds a copy while editing.
// The list is written when a document is saved, revised, or a draft is deleted.
// A failed write leaves the previous saved copy in place.
// Nothing here is a real approval or a login system.

function App() {
  const [store] = useState(() => loadDocumentStore())
  const [documents, setDocuments] = useState(store.documents)
  const [canPersist, setCanPersist] = useState(store.ok)
  const [loadWarning] = useState(store.warning)
  const [saveError, setSaveError] = useState('')
  const [activeDocument, setActiveDocument] = useState(null)
  const [folderName, setFolderName] = useState('')
  const [folderPermission, setFolderPermission] = useState('missing')
  const [backupNote, setBackupNote] = useState('')
  const [backupError, setBackupError] = useState(false)
  const [backupWorking, setBackupWorking] = useState(false)
  const documentsRef = useRef(store.documents)
  const flushDraftRef = useRef(null)
  const folderHandleRef = useRef(null)
  const folderPermissionRef = useRef('missing')
  const lastCopyRef = useRef('')
  const lastAttemptRef = useRef(0)
  const screenKey = activeDocument ? activeDocument.id : 'list'

  useEffect(() => {
    documentsRef.current = documents
  }, [documents])

  function persistList(nextList) {
    if (!canPersist) {
      setSaveError('Documents could not be read, so nothing new was saved over them.')
      return false
    }
    const ok = saveDocuments(nextList)
    if (!ok) {
      setSaveError('Could not save in this browser. The last successful copy was kept.')
      return false
    }
    documentsRef.current = nextList
    setSaveError('')
    setDocuments(nextList)
    return true
  }

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [screenKey])

  useEffect(() => {
    if (!activeDocument) {
      document.title = 'WKI Builder'
      return
    }
    document.title = `${activeDocument.title || 'New document'} · WKI Builder`
  }, [activeDocument])

  function saveDocument(doc) {
    const current = documentsRef.current
    const exists = current.some((item) => item.id === doc.id)
    const nextList = exists
      ? current.map((item) => (item.id === doc.id ? doc : item))
      : [doc, ...current]
    const ok = persistList(nextList)
    if (ok) setActiveDocument(doc)
    return ok
  }

  function createRevision(doc) {
    const revision = createRevisionFrom(doc)
    const ok = persistList([revision, ...documentsRef.current])
    if (ok) setActiveDocument(revision)
    return ok
  }

  const registerFlush = useCallback((flush) => {
    flushDraftRef.current = flush
    return () => {
      if (flushDraftRef.current === flush) flushDraftRef.current = null
    }
  }, [])

  function flushOpenDraft() {
    if (!flushDraftRef.current) return { ok: true, skipped: true }
    return flushDraftRef.current()
  }

  function backupStatus(message, isError) {
    setBackupError(isError)
    setBackupNote(message)
  }

  async function copyToFolder(force) {
    const now = Date.now()
    if (!force && now - lastAttemptRef.current < AUTO_BACKUP_MS) return
    lastAttemptRef.current = now
    const flush = flushOpenDraft()
    let draftNote = ''
    if (flush?.ok === false && flush.reason === 'required') {
      draftNote = ' The open document is missing required fields, so those edits were left unsaved.'
    } else if (flush?.ok === false) {
      draftNote = ' The open document could not be saved in this browser.'
    }

    const handle = folderHandleRef.current
    if (!handle || folderPermissionRef.current !== 'granted') {
      if (flush?.ok && !flush.skipped) {
        backupStatus(`Saved in this browser.${draftNote} Choose a backup folder to keep a copy outside the browser.`, false)
      }
      return
    }

    const signature = JSON.stringify(documentsRef.current)
    if (!force && signature === lastCopyRef.current) return

    setBackupWorking(true)
    try {
      const { blob, documentCount, imageCount } = await createBackupBlob(documentsRef.current)
      await writeLatestBackup(handle, blob, LATEST_BACKUP_NAME)
      lastCopyRef.current = signature
      const when = new Intl.DateTimeFormat(undefined, {
        hour: 'numeric',
        minute: '2-digit',
      }).format(new Date())
      backupStatus(
        `Copied ${documentCount} documents and ${imageCount} photos to ${handle.name || 'the backup folder'} at ${when}.${draftNote}`,
        false,
      )
    } catch (error) {
      backupStatus(
        `${error?.message || 'Could not update the backup file.'} The browser copy is unchanged. The next try is in 5 minutes.`,
        true,
      )
    } finally {
      setBackupWorking(false)
    }
  }

  const copyToFolderRef = useRef(copyToFolder)
  useEffect(() => {
    copyToFolderRef.current = copyToFolder
  })

  useEffect(() => {
    let cancelled = false
    loadStoredFolder()
      .then((stored) => {
        if (cancelled || !stored) return
        folderHandleRef.current = stored.handle
        folderPermissionRef.current = stored.permission
        setFolderName(stored.name)
        setFolderPermission(stored.permission)
        if (stored.permission === 'granted') {
          backupStatus(`Backup folder: ${stored.name}. A copy is written there every 5 minutes.`, false)
          copyToFolderRef.current(true)
        } else {
          backupStatus(`Backup folder: ${stored.name}. Allow that folder to keep the 5-minute copy running.`, true)
        }
      })
      .catch(() => {
        if (!cancelled) backupStatus('The saved backup folder could not be opened. Choose it again.', true)
      })

    const timer = window.setInterval(() => copyToFolderRef.current(false), AUTO_BACKUP_MS)
    function onVisible() {
      if (document.visibilityState === 'visible') copyToFolderRef.current(false)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  async function pickBackupFolder() {
    try {
      if (folderHandleRef.current && folderPermission !== 'granted') {
        const permission = await allowStoredFolder(folderHandleRef.current)
        folderPermissionRef.current = permission
        setFolderPermission(permission)
        if (permission === 'granted') {
          backupStatus(`Backup folder: ${folderName}. Copying now, then every 5 minutes.`, false)
          lastAttemptRef.current = 0
          await copyToFolderRef.current(true)
          return
        }
      }
      const picked = await chooseBackupFolder()
      folderHandleRef.current = picked.handle
      folderPermissionRef.current = 'granted'
      setFolderName(picked.name)
      setFolderPermission('granted')
      backupStatus(`Backup folder: ${picked.name}. Copying now, then every 5 minutes.`, false)
      lastAttemptRef.current = 0
      await copyToFolderRef.current(true)
    } catch (error) {
      if (error?.name === 'AbortError') return
      backupStatus(error?.message || 'Could not use that backup folder.', true)
    }
  }

  async function downloadBackup() {
    setBackupWorking(true)
    try {
      flushOpenDraft()
      const { blob, documentCount, imageCount } = await createBackupBlob(documentsRef.current)
      const day = new Date().toISOString().slice(0, 10)
      downloadBlob(blob, `wki-backup-${day}.zip`)
      backupStatus(`Downloaded ${documentCount} documents and ${imageCount} photos.`, false)
    } catch (error) {
      backupStatus(error?.message || 'Could not create the backup.', true)
    } finally {
      setBackupWorking(false)
    }
  }

  async function loadBackup(file) {
    if (!file) return
    setBackupWorking(true)
    try {
      const backup = await readBackupFile(file)
      const warning = canPersist
        ? ''
        : ' The current browser copy could not be read.'
      const confirmed = window.confirm(
        `Replace the work instructions in this browser with this backup? It contains ${backup.documents.length} documents and ${backup.images.length} photos.${warning} The zip file is left where it is.`,
      )
      if (!confirmed) {
        backupStatus('Load cancelled. The browser copy was left as it is.', false)
        return
      }
      const documentsFromBackup = await restoreBackup(backup)
      documentsRef.current = documentsFromBackup
      setDocuments(documentsFromBackup)
      setCanPersist(true)
      setSaveError('')
      setActiveDocument(null)
      lastCopyRef.current = ''
      lastAttemptRef.current = 0
      if (folderPermissionRef.current === 'granted') {
        await copyToFolderRef.current(true)
      } else {
        backupStatus(
          `Loaded ${documentsFromBackup.length} documents and ${backup.images.length} photos from the backup.`,
          false,
        )
      }
    } catch (error) {
      backupStatus(error?.message || 'Could not load that backup.', true)
    } finally {
      setBackupWorking(false)
    }
  }

  function deleteDraft(doc) {
    if (doc.status !== 'Draft') return false
    const name = doc.documentNumber || doc.title || 'this draft'
    const sampleNote = doc.isSample ? ' This is sample data.' : ''
    const confirmed = window.confirm(`Delete draft ${name}? This cannot be undone.${sampleNote}`)
    if (!confirmed) return false
    const ok = persistList(documentsRef.current.filter((item) => item.id !== doc.id))
    if (ok) setActiveDocument((current) => (current?.id === doc.id ? null : current))
    return ok
  }

  const isSaved = activeDocument
    ? documents.some((item) => item.id === activeDocument.id)
    : false

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <p className="eyebrow">Manufacturing documents</p>
          <h1>WKI Builder</h1>
        </div>
        <p className="header-note">Browser prototype</p>
      </header>
      <p className="banner">
        Prototype only. Documents are saved in this browser’s local storage. Photos are stored
        beside them in this browser. Setting a status does not approve a document, and this app
        does not limit who can open or edit it.
      </p>
      {loadWarning ? <p className="banner banner-warning">{loadWarning}</p> : null}
      {saveError ? <p className="banner banner-warning">{saveError}</p> : null}
      <BackupBar
        note={backupNote}
        isError={backupError}
        working={backupWorking}
        folderName={folderName}
        needsPermission={folderPermission === 'prompt' || folderPermission === 'denied'}
        onChooseFolder={pickBackupFolder}
        onDownload={downloadBackup}
        onLoad={loadBackup}
      />
      <main className="page">
        {activeDocument ? (
          <Editor
            key={activeDocument.id}
            initialDocument={activeDocument}
            isSaved={isSaved}
            onBack={() => setActiveDocument(null)}
            onSave={saveDocument}
            onCreateRevision={createRevision}
            onDelete={deleteDraft}
            onRegisterFlush={registerFlush}
          />
        ) : (
          <Dashboard
            documents={documents}
            onOpen={(doc) => setActiveDocument(structuredClone(doc))}
            onCreate={() => setActiveDocument(createBlankDocument())}
            onDelete={deleteDraft}
          />
        )}
      </main>
    </div>
  )
}

function BackupBar({ note, isError, working, folderName, needsPermission, onChooseFolder, onDownload, onLoad }) {
  const fileRef = useRef(null)
  const folderLabel = needsPermission
    ? 'Allow backup folder'
    : folderName
      ? 'Change backup folder'
      : 'Choose backup folder'

  return (
    <div className="backup-bar">
      <p className={note ? `backup-note ${isError ? 'is-error' : 'is-done'}` : 'backup-note'}>
        {note ||
          'Choose a backup folder in OneDrive. The app then saves and copies your work there every 5 minutes. Load backup brings a saved zip back into this browser.'}
      </p>
      <div className="backup-actions">
        <button type="button" className="btn btn-secondary" onClick={onChooseFolder} disabled={working}>
          {folderLabel}
        </button>
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
    </div>
  )
}

export default App
