import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  ensureDataLayout,
  listImageIds,
  readImage,
  readLibrary,
  writeBackup,
  writeImage,
  writeLibrary,
} from './dataStore.mjs'

const MAX_DOCUMENT_BYTES = 32 * 1024 * 1024
const MAX_IMAGE_BYTES = 12 * 1024 * 1024
const MAX_BACKUP_BYTES = 200 * 1024 * 1024

const STATIC_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
}

export function startServer({ dataDir, distDir, host = '127.0.0.1', port = 4173 }) {
  const root = path.resolve(dataDir)
  ensureDataLayout(root)
  const staticRoot = distDir ? path.resolve(distDir) : ''

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
      if (url.pathname.startsWith('/api/')) {
        await handleApi(req, res, url, root)
        return
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendText(res, 405, 'Method not allowed')
        return
      }
      serveStatic(req, res, url.pathname, staticRoot)
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error?.message || 'Request failed.' })
    }
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      const address = server.address()
      const actualPort = typeof address === 'object' && address ? address.port : port
      resolve({
        server,
        port: actualPort,
        url: `http://${host}:${actualPort}`,
        dataDir: root,
        close: () =>
          new Promise((done) => {
            server.close(() => done())
          }),
      })
    })
  })
}

async function handleApi(req, res, url, dataDir) {
  if (req.method === 'GET' && url.pathname === '/api/health') {
    sendJson(res, 200, {
      ok: true,
      fileStore: true,
      dataDir,
      folders: {
        workOrders: path.join(dataDir, 'work-orders'),
        images: path.join(dataDir, 'images'),
        backups: path.join(dataDir, 'backups'),
      },
    })
    return
  }

  if (url.pathname === '/api/documents') {
    if (req.method === 'GET') {
      sendJson(res, 200, { ok: true, documents: readLibrary(dataDir) })
      return
    }
    if (req.method === 'PUT') {
      const body = await readBody(req, MAX_DOCUMENT_BYTES)
      const parsed = JSON.parse(body.toString('utf8'))
      const documents = Array.isArray(parsed) ? parsed : parsed.documents
      writeLibrary(dataDir, documents)
      sendJson(res, 200, { ok: true })
      return
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/images') {
    sendJson(res, 200, { ok: true, ids: listImageIds(dataDir) })
    return
  }

  if (url.pathname.startsWith('/api/images/')) {
    const id = decodeURIComponent(url.pathname.slice('/api/images/'.length))
    if (req.method === 'GET') {
      const image = readImage(dataDir, id)
      if (!image) {
        sendText(res, 404, 'Image not found')
        return
      }
      res.writeHead(200, {
        'Content-Type': image.mime,
        'Content-Length': image.buffer.length,
        'Cache-Control': 'no-store',
      })
      res.end(image.buffer)
      return
    }
    if (req.method === 'PUT') {
      const buffer = await readBody(req, MAX_IMAGE_BYTES)
      writeImage(dataDir, id, buffer, req.headers['content-type'])
      sendJson(res, 200, { ok: true })
      return
    }
  }

  if (req.method === 'PUT' && url.pathname.startsWith('/api/backups/')) {
    const name = path.basename(decodeURIComponent(url.pathname.slice('/api/backups/'.length)))
    const buffer = await readBody(req, MAX_BACKUP_BYTES)
    writeBackup(dataDir, name, buffer)
    sendJson(res, 200, { ok: true })
    return
  }

  sendText(res, 404, 'Not found')
}

function serveStatic(req, res, pathname, staticRoot) {
  if (!staticRoot || !fs.existsSync(staticRoot)) {
    sendText(res, 404, 'The app files have not been built yet.')
    return
  }
  const requested = pathname === '/' ? '/index.html' : pathname
  const file = safeStaticPath(staticRoot, requested) || safeStaticPath(staticRoot, '/index.html')
  if (!file) {
    sendText(res, 404, 'Not found')
    return
  }
  const data = fs.readFileSync(file)
  res.writeHead(200, {
    'Content-Type': STATIC_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Content-Length': data.length,
    'Cache-Control': 'no-store',
  })
  res.end(req.method === 'HEAD' ? undefined : data)
}

function safeStaticPath(root, pathname) {
  const decoded = decodeURIComponent(pathname.split('?')[0])
  const file = path.resolve(root, `.${decoded}`)
  if (file !== root && !file.startsWith(`${root}${path.sep}`)) return ''
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return ''
  return file
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('That upload is too large.'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload))
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  })
  res.end(body)
}

function sendText(res, status, message) {
  const body = Buffer.from(message)
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': body.length,
  })
  res.end(body)
}

function isDirectRun() {
  const entry = process.argv[1]
  if (!entry) return false
  return import.meta.url === pathToFileURL(path.resolve(entry)).href
}

if (isDirectRun()) {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const dataDir = process.env.WKI_DATA_DIR || path.resolve(here, '../../WKI/Data')
  const distDir = process.env.WKI_DIST_DIR || path.resolve(here, '../dist')
  const host = process.env.WKI_HOST || '127.0.0.1'
  const port = Number(process.env.WKI_PORT || 4173)
  const started = await startServer({ dataDir, distDir, host, port })
  console.log(`WKI Builder is serving ${started.url}`)
  console.log(`Data folder: ${started.dataDir}`)
}
