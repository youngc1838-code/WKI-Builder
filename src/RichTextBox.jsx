import { useEffect, useRef } from 'react'
import { plainText, sanitizeHtml, toEditorHtml } from './richText.js'

const COMMANDS = [
  { command: 'bold', label: 'B', title: 'Bold' },
  { command: 'italic', label: 'I', title: 'Italic' },
  { command: 'underline', label: 'U', title: 'Underline' },
  { command: 'insertUnorderedList', label: '•', title: 'Bullets' },
  { command: 'insertOrderedList', label: '1.', title: 'Numbering' },
]

function RichTextBox({ value, onChange, readOnly, placeholder, invalid, labelledBy }) {
  const editorRef = useRef(null)

  useEffect(() => {
    const node = editorRef.current
    if (!node || document.activeElement === node) return
    const html = toEditorHtml(value)
    if (node.innerHTML !== html) node.innerHTML = html
  }, [value])

  function emit() {
    const node = editorRef.current
    if (!node || !onChange) return
    const html = sanitizeHtml(node.innerHTML)
    onChange(plainText(html) ? html : '')
  }

  function format(command) {
    editorRef.current?.focus()
    document.execCommand('styleWithCSS', false, false)
    document.execCommand(command)
    emit()
  }

  return (
    <div className={invalid ? 'rich-field invalid' : 'rich-field'}>
      {readOnly ? null : (
        <div className="rich-toolbar" role="toolbar" aria-label="Text formatting">
          {COMMANDS.map((item) => (
            <button
              key={item.command}
              type="button"
              className={`rich-command rich-command-${item.command}`}
              title={item.title}
              aria-label={item.title}
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
        suppressContentEditableWarning
        onInput={emit}
        onBlur={emit}
      />
    </div>
  )
}

export default RichTextBox
