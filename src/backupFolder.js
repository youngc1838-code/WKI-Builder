// Remembers the folder the user picked so a later visit can update the same backup file.
// The folder handle is not a password or a token.

const DB_NAME = 'wki-builder-backup'
const STORE = 'handles'
const KEY = 'directory'

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Could not open backup folder storage.'))
  })
}

function finishTransaction(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error || new Error('Could not store the backup folder.'))
    transaction.onabort = () => reject(transaction.error || new Error('Could not store the backup folder.'))
  })
}

async function readHandle() {
  const db = await openDb()
  try {
    const transaction = db.transaction(STORE, 'readonly')
    const done = finishTransaction(transaction)
    const request = transaction.objectStore(STORE).get(KEY)
    const handle = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || null)
      request.onerror = () => reject(request.error || new Error('Could not read the backup folder.'))
    })
    await done
    return handle
  } finally {
    db.close()
  }
}

async function writeHandle(handle) {
  const db = await openDb()
  try {
    const transaction = db.transaction(STORE, 'readwrite')
    const done = finishTransaction(transaction)
    transaction.objectStore(STORE).put(handle, KEY)
    await done
  } finally {
    db.close()
  }
}

export function folderPickerAvailable() {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'
}

export async function chooseBackupFolder() {
  if (!folderPickerAvailable()) {
    throw new Error('This browser cannot save into a folder. Use Download backup, or open the app in Edge.')
  }
  const handle = await window.showDirectoryPicker({ mode: 'readwrite', id: 'wki-backup' })
  await writeHandle(handle)
  return { handle, name: handle.name, permission: 'granted' }
}

export async function loadStoredFolder() {
  const handle = await readHandle()
  if (!handle) return null
  let permission = 'prompt'
  try {
    permission = await handle.queryPermission({ mode: 'readwrite' })
  } catch {
    permission = 'prompt'
  }
  return { handle, name: handle.name, permission }
}

export async function allowStoredFolder(handle) {
  const permission = await handle.requestPermission({ mode: 'readwrite' })
  return permission
}

export async function writeLatestBackup(handle, blob, filename) {
  const fileHandle = await handle.getFileHandle(filename, { create: true })
  const writable = await fileHandle.createWritable()
  try {
    await writable.write(blob)
    await writable.close()
  } catch (error) {
    try {
      await writable.abort()
    } catch {
      // The original write error is the one to show.
    }
    throw error
  }
}
