import { describe, expect, test } from 'vitest'
import { paiseToRupeesText, toCsv } from './csv'

describe('CSV export', () => {
  test('paise become exact rupee text without float math', () => {
    expect(paiseToRupeesText(1050050)).toBe('10500.50')
    expect(paiseToRupeesText(1075000)).toBe('10750.00')
    expect(paiseToRupeesText(5)).toBe('0.05')
    expect(paiseToRupeesText(0)).toBe('0.00')
    expect(paiseToRupeesText(-12345)).toBe('-123.45')
  })

  test('quotes commas and quotes, keeps ₹ readable, and blocks spreadsheet formulas', () => {
    const csv = toCsv(
      [
        { name: 'Arjun, Menon', note: 'said "ok"', amt: 1050050 },
        { name: '=HYPERLINK("http://x")', note: '+91 98', amt: 0 },
      ],
      [
        { header: 'Name', value: (r) => r.name },
        { header: 'Note', value: (r) => r.note },
        { header: 'Amount (INR)', value: (r) => paiseToRupeesText(r.amt) },
      ],
    )
    expect(csv.startsWith('﻿')).toBe(true)
    const lines = csv.slice(1).trimEnd().split('\r\n')
    expect(lines[0]).toBe('Name,Note,Amount (INR)')
    expect(lines[1]).toBe('"Arjun, Menon","said ""ok""",10500.50')
    expect(lines[2]).toBe(`"'=HYPERLINK(""http://x"")",'+91 98,0.00`)
  })
})
