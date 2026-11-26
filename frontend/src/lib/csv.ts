/** Rupees with two decimals from integer paise, without floating point: 1050050 → "10500.50". */
export function paiseToRupeesText(paise: number): string {
  const sign = paise < 0 ? '-' : ''
  const abs = Math.abs(Math.trunc(paise))
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

function cell(value: unknown): string {
  if (value === null || value === undefined) return ''
  const text = String(value)
  // Quote anything with a comma, quote or newline; and neutralise leading = + - @ so a spreadsheet never runs it
  // as a formula (CSV injection).
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

export function toCsv<T>(rows: T[], columns: { header: string; value: (row: T) => unknown }[]): string {
  const lines = [columns.map((c) => cell(c.header)).join(',')]
  for (const row of rows) lines.push(columns.map((c) => cell(c.value(row))).join(','))
  // BOM so Excel opens UTF-8 (₹, names) correctly; CRLF line endings for spreadsheet apps.
  return '﻿' + lines.join('\r\n') + '\r\n'
}

/** Saves the text as a .csv download. */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Today's date in India for file names, e.g. "2026-11-27". */
export function todayIST(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())
}
