// Photo files are stored in IndexedDB, a file drawer built into the browser.
// The work instruction itself stays in localStorage and only remembers each photo's id.
// Removing a photo from a step does not delete the file, so an unsaved edit cannot erase it.

const DB_NAME = 'wki-builder-images'
const STORE = 'images'
const DB_VERSION = 1
const MAX_EDGE = 1600
const MAX_FILE_BYTES = 1200000

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Could not open photo storage.'))
  })
}

function finishTransaction(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error || new Error('Could not store the photo.'))
    transaction.onabort = () => reject(transaction.error || new Error('Could not store the photo.'))
  })
}

export async function putImage(id, blob) {
  const db = await openDb()
  try {
    const transaction = db.transaction(STORE, 'readwrite')
    const done = finishTransaction(transaction)
    transaction.objectStore(STORE).put(blob, id)
    await done
  } finally {
    db.close()
  }
}

export async function listImageIds() {
  const db = await openDb()
  try {
    const transaction = db.transaction(STORE, 'readonly')
    const done = finishTransaction(transaction)
    const request = transaction.objectStore(STORE).getAllKeys()
    const keys = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || [])
      request.onerror = () => reject(request.error || new Error('Could not list the photos.'))
    })
    await done
    return keys.map((key) => String(key))
  } finally {
    db.close()
  }
}

export async function getImage(id) {
  const db = await openDb()
  try {
    const transaction = db.transaction(STORE, 'readonly')
    const done = finishTransaction(transaction)
    const request = transaction.objectStore(STORE).get(id)
    const blob = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || null)
      request.onerror = () => reject(request.error || new Error('Could not read the photo.'))
    })
    await done
    return blob
  } finally {
    db.close()
  }
}

// Large photos are reduced before they are stored. Smaller photos are kept as chosen.
export function prepareImageBlob(file) {
  if (!file || !String(file.type || '').startsWith('image/')) {
    return Promise.reject(new Error('Choose an image file.'))
  }

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      const longest = Math.max(image.width, image.height)
      const needsScale = longest > MAX_EDGE
      const needsCompress = file.size > MAX_FILE_BYTES
      if (!needsScale && !needsCompress) {
        URL.revokeObjectURL(url)
        resolve(file)
        return
      }
      const scale = needsScale ? MAX_EDGE / longest : 1
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(image.width * scale))
      canvas.height = Math.max(1, Math.round(image.height * scale))
      const context = canvas.getContext('2d')
      if (!context) {
        URL.revokeObjectURL(url)
        reject(new Error('Could not prepare that image.'))
        return
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      canvas.toBlob(
        (blob) => {
          URL.revokeObjectURL(url)
          if (!blob) reject(new Error('Could not prepare that image.'))
          else resolve(blob)
        },
        'image/jpeg',
        0.82,
      )
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not read that image.'))
    }
    image.src = url
  })
}
