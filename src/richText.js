// Text fields can stay plain or become simple formatted text.
// Only a short list of tags is kept, so a backup cannot carry scripts.

const ALLOWED = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'UL', 'OL', 'LI', 'BR', 'P', 'DIV'])

export function looksLikeHtml(value) {
  return /<\/?[a-z][\s\S]*>/i.test(String(value ?? ''))
}

function wrapChildren(node, tag) {
  const wrapper = node.ownerDocument.createElement(tag)
  wrapper.append(...node.childNodes)
  node.append(wrapper)
}

function referenceId(value) {
  return /^[A-Za-z0-9_-]{1,80}$/.test(String(value || ''))
}

function keepReference(child) {
  const bomLine = child.getAttribute('data-bom-line') || ''
  const tool = child.getAttribute('data-tool') || ''
  if (!referenceId(bomLine) && !referenceId(tool)) return false
  const span = child.ownerDocument.createElement('span')
  if (referenceId(bomLine)) {
    span.setAttribute('data-bom-line', bomLine)
    span.setAttribute('class', 'part-ref')
  } else {
    span.setAttribute('data-tool', tool)
    span.setAttribute('class', 'tool-ref')
  }
  span.setAttribute('contenteditable', 'false')
  span.textContent = (child.textContent || '').replace(/\s+/g, ' ').trim()
  child.replaceWith(span)
  return true
}

function sanitizeNode(node) {
  for (const child of [...node.childNodes]) {
    if (child.nodeType === Node.TEXT_NODE) continue
    if (child.nodeType !== Node.ELEMENT_NODE) {
      child.remove()
      continue
    }
    if (child.tagName === 'SPAN' && keepReference(child)) continue
    sanitizeNode(child)
    if (child.tagName === 'SPAN') {
      const style = child.getAttribute('style') || ''
      if (/text-decoration:[^;"]*underline/i.test(style)) wrapChildren(child, 'u')
      if (/font-style:\s*italic/i.test(style)) wrapChildren(child, 'i')
      if (/font-weight:\s*(bold|[6-9]00)/i.test(style)) wrapChildren(child, 'b')
      child.replaceWith(...child.childNodes)
      continue
    }
    if (!ALLOWED.has(child.tagName)) {
      child.replaceWith(...child.childNodes)
      continue
    }
    for (const attr of [...child.attributes]) child.removeAttribute(attr.name)
  }
}

export function sanitizeHtml(value) {
  const text = String(value ?? '')
  if (!looksLikeHtml(text) || typeof DOMParser === 'undefined') return text
  const doc = new DOMParser().parseFromString(text, 'text/html')
  sanitizeNode(doc.body)
  return doc.body.innerHTML
}

export function plainText(value) {
  const text = String(value ?? '').replace(/\u00a0/g, ' ')
  if (!looksLikeHtml(text) || typeof DOMParser === 'undefined') return text.trim()
  const doc = new DOMParser().parseFromString(sanitizeHtml(text), 'text/html')
  return (doc.body.textContent || '').replace(/\u00a0/g, ' ').trim()
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function refreshSpans(html, attribute, className, byId) {
  const pattern = new RegExp(`<span\\b[^>]*\\b${attribute}="([^"]+)"[^>]*>[\\s\\S]*?<\\/span>`, 'gi')
  return String(html || '').replace(pattern, (full, id) => {
    const item = byId.get(id)
    if (!item) return ''
    return `<span ${attribute}="${id}" class="${className}" contenteditable="false">${item.balloon}</span>`
  })
}

export function refreshReferenceHtml(html, partsById, toolsById) {
  const withParts = refreshSpans(html, 'data-bom-line', 'part-ref', partsById || new Map())
  return refreshSpans(withParts, 'data-tool', 'tool-ref', toolsById || new Map())
}

export function remapReferenceHtml(html, bomMap, toolMap) {
  return String(html || '')
    .replace(/data-bom-line="([^"]+)"/g, (full, id) => {
      const next = bomMap?.get(id)
      return next ? `data-bom-line="${next}"` : 'data-removed="1"'
    })
    .replace(/data-tool="([^"]+)"/g, (full, id) => {
      const next = toolMap?.get(id)
      return next ? `data-tool="${next}"` : 'data-removed="1"'
    })
    .replace(/<span\b[^>]*data-removed="1"[^>]*>[\s\S]*?<\/span>/gi, '')
}

export function toEditorHtml(value) {
  const text = String(value ?? '')
  if (!text.trim()) return ''
  if (!looksLikeHtml(text)) return escapeHtml(text).replaceAll('\n', '<br>')
  return sanitizeHtml(text)
}
