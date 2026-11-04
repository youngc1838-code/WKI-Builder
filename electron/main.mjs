import { app, BrowserWindow, Menu, MenuItem, shell } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startServer } from '../server/index.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function dataDirectory() {
  if (process.env.WKI_DATA_DIR) return path.resolve(process.env.WKI_DATA_DIR)
  return path.join(app.getPath('desktop'), 'WKI', 'Data')
}

function distDirectory() {
  if (app.isPackaged) return path.join(process.resourcesPath, 'dist')
  return path.join(root, 'dist')
}

let started

app.whenReady().then(async () => {
  started = await startServer({
    dataDir: dataDirectory(),
    distDir: distDirectory(),
    host: '127.0.0.1',
    port: 0,
  })

  const window = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: 'WKI Builder',
    autoHideMenuBar: true,
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  try {
    window.webContents.session.setSpellCheckerLanguages(['en-US'])
  } catch {
    // The operating system may not have that dictionary installed.
  }

  window.webContents.on('context-menu', (event, params) => {
    if (!params.misspelledWord) return
    event.preventDefault()
    const menu = new Menu()
    if (!params.dictionarySuggestions.length) {
      menu.append(new MenuItem({ label: 'No spelling suggestions', enabled: false }))
    }
    for (const suggestion of params.dictionarySuggestions) {
      menu.append(
        new MenuItem({
          label: suggestion,
          click: () => window.webContents.replaceMisspelling(suggestion),
        }),
      )
    }
    menu.append(new MenuItem({ type: 'separator' }))
    menu.append(
      new MenuItem({
        label: 'Add to dictionary',
        click: () => window.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
      }),
    )
    menu.popup()
  })

  await window.loadURL(started.url)
})

app.on('window-all-closed', () => {
  const closing = started?.close() || Promise.resolve()
  closing.finally(() => app.quit())
})
