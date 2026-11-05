import { useEffect, useRef, useState } from 'react'
import { plainText, sanitizeHtml, toEditorHtml } from './richText.js'
import { capitalizeSentences } from './textCase.js'

const COMMANDS = [
  { command: 'bold', label: 'B', title: 'Bold' },
  { command: 'italic', label: 'I', title: 'Italic' },
  { command: 'underline', label: 'U', title: 'Underline' },
  { command: 'insertUnorderedList', label: '•', title: 'Bullets' },
  { command: 'insertOrderedList', label: '1.', title: 'Numbering' },
]

function marksAtSelection(root) {
  const selection = document.getSelection()
  const node = selection?.anchorNode
  if (!root || !node || !root.contains(node)) return {}
  const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement
  if (!element) return {}
  return {
    bold: Boolean(element.closest('b, strong')),
    italic: Boolean(element.closest('i, em')),
    underline: Boolean(element.closest('u')),
    insertUnorderedList: Boolean(element.closest('ul')),
    insertOrderedList: Boolean(element.closest('ol')),
  }
}

const BLOCK = /^(DIV|P|LI|TR|H[1-6]|BLOCKQUOTE)$/

function needsCapital(root) {
  const selection = document.getSelection()
  if (!selection?.rangeCount || !root) return true
  const range = selection.getRangeAt(0)
  if (!range.collapsed || !root.contains(range.startContainer)) return false

  let node = range.startContainer
  let offset = range.startOffset
  if (node === root && offset === 0) return true

  while (node && node !== root.parentNode) {
    if (node.nodeType === Node.TEXT_NODE) {
      const chunk = (node.nodeValue || '').slice(0, offset).replace(/\u00a0/g, ' ')
      for (let index = chunk.length - 1; index >= 0; index -= 1) {
        const character = chunk[index]
        if (/[.!?]/.test(character)) return true
        if (!/\s/.test(character)) return false
      }
    } else if (node.nodeType === Node.ELEMENT_NODE && offset > 0) {
      const previous = node.childNodes[offset - 1]
      if (
        previous?.nodeType === Node.ELEMENT_NODE &&
        (previous.tagName === 'BR' || BLOCK.test(previous.tagName))
      ) {
        return true
      }
      if (previous) {
        node = previous
        while (node.lastChild) node = node.lastChild
        offset = node.nodeType === Node.TEXT_NODE ? (node.nodeValue || '').length : node.childNodes.length
        continue
      }
    }

    if (node === root) return true
    if (!node.previousSibling) {
      const parent = node.parentNode
      if (parent && parent !== root && BLOCK.test(parent.tagName)) return true
      node = parent
      offset = 0
      continue
    }

    const previous = node.previousSibling
    if (previous.nodeType === Node.ELEMENT_NODE && (previous.tagName === 'BR' || BLOCK.test(previous.tagName))) {
      return true
    }
    node = previous
    while (node?.lastChild) node = node.lastChild
    offset = node?.nodeType === Node.TEXT_NODE ? (node.nodeValue || '').length : 0
  }
  return true
}

function insideBold(root) {
  const selection = document.getSelection()
  const node = selection?.anchorNode
  if (!root || !node || !root.contains(node)) return false
  const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement
  return Boolean(element?.closest('b, strong'))
}

function clearUnwantedBold(root) {
  if (!root || insideBold(root)) return
  try {
    if (document.queryCommandState('bold')) document.execCommand('bold')
  } catch {
    // The browser may not support the editing command.
  }
}

function RichTextBox({ value, onChange, readOnly, placeholder, invalid, labelledBy, parts, tools }) {
  const editorRef = useRef(null)
  const [active, setActive] = useState({})

  useEffect(() => {
    const node = editorRef.current
    if (!node || document.activeElement === node) return
    const html = toEditorHtml(value)
    if (node.innerHTML !== html) node.innerHTML = html
  }, [value])

  useEffect(() => {
    function refresh() {
      setActive(marksAtSelection(editorRef.current))
    }
    document.addEventListener('selectionchange', refresh)
    return () => document.removeEventListener('selectionchange', refresh)
  }, [])

  function emit() {
    const node = editorRef.current
    if (!node || !onChange) return
    const html = sanitizeHtml(node.innerHTML)
    onChange(plainText(html) ? html : '')
  }

  function insertReference(attribute, className, id, number) {
    const root = editorRef.current
    if (!root || !id) return
    root.focus()
    const html = `<span ${attribute}="${id}" class="${className}" contenteditable="false">${number}</span>&nbsp;`
    document.execCommand('insertHTML', false, html)
    emit()
  }

  function format(command) {
    editorRef.current?.focus()
    document.execCommand('styleWithCSS', false, false)
    document.execCommand(command)
    setActive(marksAtSelection(editorRef.current))
    emit()
  }

  function insertCapital(letter) {
    const inserted = document.execCommand('insertText', false, letter)
    if (inserted) return
    const selection = document.getSelection()
    if (!selection?.rangeCount) return
    const range = selection.getRangeAt(0)
    range.deleteContents()
    const node = document.createTextNode(letter)
    range.insertNode(node)
    range.setStartAfter(node)
    range.collapse(true)
    selection.removeAllRanges()
    selection.addRange(range)
    emit()
  }

  function onKeyDown(event) {
    if (readOnly || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return
    if (event.key.length !== 1 || !/^[a-z]$/.test(event.key)) return
    const root = editorRef.current
    if (!needsCapital(root)) return
    event.preventDefault()
    insertCapital(event.key.toUpperCase())
  }

  function onBeforeInput(event) {
    if (readOnly || event.isComposing) return
    const data = event.data ?? event.nativeEvent?.data
    if (!data || event.inputType !== 'insertText' || !/^[a-z]/.test(data)) return
    const root = editorRef.current
    if (!needsCapital(root)) return
    event.preventDefault()
    insertCapital(data.replace(/^[a-z]/, (character) => character.toUpperCase()))
  }

  function onFocus() {
    const root = editorRef.current
    requestAnimationFrame(() => {
      if (!root || document.activeElement !== root) return
      clearUnwantedBold(root)
    })
  }

  function onPaste(event) {
    const text = event.clipboardData?.getData('text/plain')
    if (!text) return
    const html = event.clipboardData?.getData('text/html')
    if (html) return
    const atBoundary = needsCapital(editorRef.current)
    const capitalized = capitalizeSentences(text)
    const fixed = atBoundary ? capitalized : `${text.slice(0, 1)}${capitalized.slice(1)}`
    if (fixed === text) return
    event.preventDefault()
    document.execCommand('insertText', false, fixed)
  }

  return (
    <div className={invalid ? 'rich-field invalid' : 'rich-field'}>
      {readOnly ? null : (
        <div className="rich-toolbar" role="toolbar" aria-label="Text formatting">
          {(parts || []).length ? (
            <select
              className="rich-insert"
              aria-label="Insert part number"
              value=""
              onChange={(event) => {
                const line = (parts || []).find((item) => item.id === event.target.value)
                event.target.value = ''
                if (!line) return
                insertReference('data-bom-line', 'part-ref', line.id, line.balloon)
              }}
            >
              <option value="">Insert part</option>
              {(parts || []).map((line) => (
                <option key={line.id} value={line.id}>
                  {line.balloon}. {line.partNumber || 'Part'}
                </option>
              ))}
            </select>
          ) : null}
          {(tools || []).length ? (
            <select
              className="rich-insert"
              aria-label="Insert tool number"
              value=""
              onChange={(event) => {
                const tool = (tools || []).find((item) => item.id === event.target.value)
                event.target.value = ''
                if (!tool) return
                insertReference('data-tool', 'tool-ref', tool.id, tool.balloon)
              }}
            >
              <option value="">Insert tool</option>
              {(tools || []).map((tool) => (
                <option key={tool.id} value={tool.id}>
                  {tool.balloon}. {tool.identifier || 'Tool'}
                </option>
              ))}
            </select>
          ) : null}
          {COMMANDS.map((item) => (
            <button
              key={item.command}
              type="button"
              className={
                active[item.command]
                  ? `rich-command rich-command-${item.command} is-on`
                  : `rich-command rich-command-${item.command}`
              }
              title={item.title}
              aria-label={item.title}
              aria-pressed={Boolean(active[item.command])}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => format(item.command)}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
      <div
        ref={editorRef}
        className="rich-editor"
        role="textbox"
        aria-multiline="true"
        aria-labelledby={labelledBy}
        data-placeholder={placeholder || ''}
        contentEditable={readOnly ? 'false' : 'true'}
        spellCheck={!readOnly}
        suppressContentEditableWarning
        onKeyDown={onKeyDown}
        onBeforeInput={onBeforeInput}
        onFocus={onFocus}
        onPaste={onPaste}
        onInput={emit}
        onBlur={emit}
        onKeyUp={() => setActive(marksAtSelection(editorRef.current))}
        onMouseUp={() => setActive(marksAtSelection(editorRef.current))}
      />
    </div>
  )
}

export default RichTextBox
