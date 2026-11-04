// Capitalize the first letter of each line and each sentence.

export function capitalizeSentences(value) {
  return String(value ?? '').replace(
    /(^|[\n\r]|[.!?]\s+)([a-z])/g,
    (_, lead, letter) => lead + letter.toUpperCase(),
  )
}

export function shouldCapitalize(before) {
  const text = String(before ?? '').replace(/\u00a0/g, ' ')
  if (!text.trim()) return true
  return /(?:^|\n|[.!?])\s*$/.test(text)
}
