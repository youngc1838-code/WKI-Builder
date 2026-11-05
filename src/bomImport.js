// Read a DBA Manufacturing BOM components export.
// DBA writes CSV from File → Data Export, or from the component grid Output button.

function delimiterOf(text) {
  const first = String(text).split(/\r?\n/, 1)[0] || ''
  const tabs = (first.match(/\t/g) || []).length
  const commas = (first.match(/,/g) || []).length
  const semis = (first.match(/;/g) || []).length
  if (tabs >= commas && tabs >= semis && tabs > 0) return '\t'
  if (semis > commas && semis > 0) return ';'
  return ','
}

function parseTable(text) {
  const source = String(text ?? '').replace(/^\uFEFF/, '')
  const delimiter = delimiterOf(source)
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < source.length; index += 1) {
    const ch = source[index]
    if (quoted) {
      if (ch === '"') {
        if (source[index + 1] === '"') {
          cell += '"'
          index += 1
        } else {
          quoted = false
        }
      } else {
        cell += ch
      }
      continue
    }
    if (ch === '"') {
      quoted = true
    } else if (ch === delimiter) {
      row.push(cell)
      cell = ''
    } else if (ch === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else if (ch !== '\r') {
      cell += ch
    }
  }
  row.push(cell)
  if (row.some((item) => item.trim())) rows.push(row)
  return rows
}

function column(header, patterns) {
  return header.findIndex((cell) => patterns.some((pattern) => pattern.test(cell)))
}

export function parseDbaBom(text) {
  const rows = parseTable(text)
  if (!rows.length) return []
  const header = rows[0].map((cell) => cell.trim().toLowerCase())
  const hasHeader = header.some((cell) =>
    /component|citem|part number|description|usage|quantity|\bqty\b/.test(cell),
  )
  const data = hasHeader ? rows.slice(1) : rows
  const lineNo = hasHeader
    ? column(header, [/line\s*#/, /line\s*no/, /line\s*number/, /^linno$/, /^lineno$/, /^line$/])
    : -1
  const part = hasHeader
    ? column(header, [
        /component\s*id/,
        /componentid/,
        /citemcode/,
        /item code/,
        /part number/,
        /part no/,
        /^component$/,
        /^part$/,
      ])
    : 0
  const description = hasHeader
    ? column(header, [/^description$/, /descript/, /^notes$/])
    : 1
  const quantity = hasHeader
    ? column(header, [/usage qty/, /^usage$/, /^quantity$/, /^qty$/])
    : 2
  const sequence = hasHeader ? column(header, [/^sequence$/, /^stage$/]) : -1
  let partColumn = part >= 0 ? part : 0
  if (partColumn === lineNo) partColumn = partColumn === 0 ? 1 : 0

  return data
    .map((row) => ({
      partNumber: String(row[partColumn] || '').trim(),
      description: description >= 0 ? String(row[description] || '').trim() : '',
      quantity: quantity >= 0 ? String(row[quantity] || '').trim() : '',
      lineNo: lineNo >= 0 ? String(row[lineNo] || '').trim() : '',
      sequence: sequence >= 0 ? String(row[sequence] || '').trim() : '',
    }))
    .filter((row) => row.partNumber || row.description)
}
