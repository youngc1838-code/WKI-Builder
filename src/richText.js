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

function sanitizeNode(node) {
  for (const child of [...node.childNodes]) {
    if (child.nodeType === Node.TEXT_NODE) continue
    if (child.nodeType !== Node.ELEMENT_NODE) {
      child.remove()
      continue
    }
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

export function toEditorHtml(value) {
  const text = String(value ?? '')
  if (!text.trim()) return ''
  if (!looksLikeHtml(text)) return escapeHtml(text).replaceAll('\n', '<br>')
  return sanitizeHtml(text)
}
