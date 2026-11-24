import { describe, expect, test } from 'vitest'
import { formatINR, parseRupeesToPaise } from './money'

describe('money formatters', () => {
  test('[FE-01/AC1] formatINR formats integer paise with Indian grouping and minimal decimals', () => {
    expect(formatINR(1050000)).toBe('₹10,500')
    expect(formatINR(10000000)).toBe('₹1,00,000')
    expect(formatINR(12345)).toBe('₹123.45')
    expect(formatINR(0)).toBe('₹0')
    expect(formatINR(5)).toBe('₹0.05')
  })

  test('[FE-01/AC2] parseRupeesToPaise converts formatted rupee strings without float math', () => {
    expect(parseRupeesToPaise('10,500.50')).toBe(1050050)
    expect(parseRupeesToPaise('1,00,000')).toBe(10000000)
    expect(parseRupeesToPaise('₹19.99')).toBe(1999)
    expect(parseRupeesToPaise('123.4')).toBe(12340)
    expect(parseRupeesToPaise('0.01')).toBe(1)
    expect(parseRupeesToPaise('.50')).toBe(50)
    // Case where float multiplication (19.99 * 100 = 1998.9999999999998) or 10.07 * 100 would fail
    expect(parseRupeesToPaise('10.07')).toBe(1007)
    expect(parseRupeesToPaise('35.85')).toBe(3585)
    expect(() => parseRupeesToPaise('10.123')).toThrow()
    expect(() => parseRupeesToPaise('')).toThrow()
  })
})
