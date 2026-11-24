/**
 * Format integer paise into Indian Rupee display without floating-point errors.
 * Examples:
 *  - 1050000 -> "₹10,500"
 *  - 10000000 -> "₹1,00,000"
 *  - 12345 -> "₹123.45"
 */
export function formatINR(paise: number): string {
  if (!Number.isFinite(paise) || !Number.isInteger(paise)) {
    throw new RangeError(`Expected integer paise, got: ${paise}`)
  }

  const hasFraction = Math.abs(paise) % 100 !== 0
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: hasFraction ? 2 : 0,
  }).format(paise / 100)
}

/**
 * Parse a rupee string (e.g. "10,500.50" or "₹1,00,000") into integer paise
 * strictly using string splitting (no floating-point multiplication).
 */
export function parseRupeesToPaise(input: string): number {
  const cleaned = input.trim().replace(/[₹,\s]/g, '')
  if (!cleaned) {
    throw new Error('Amount cannot be empty')
  }

  let sign = 1
  let unsigned = cleaned
  if (unsigned.startsWith('-')) {
    sign = -1
    unsigned = unsigned.slice(1)
  } else if (unsigned.startsWith('+')) {
    unsigned = unsigned.slice(1)
  }

  const parts = unsigned.split('.')
  if (parts.length > 2) {
    throw new Error(`Invalid rupee amount: "${input}"`)
  }

  const [wholeRaw = '', fracRaw = ''] = parts
  if (!wholeRaw && !fracRaw) {
    throw new Error(`Invalid rupee amount: "${input}"`)
  }
  if ((wholeRaw && !/^\d+$/.test(wholeRaw)) || (fracRaw && !/^\d+$/.test(fracRaw))) {
    throw new Error(`Invalid rupee amount: "${input}"`)
  }
  if (fracRaw.length > 2) {
    throw new Error(`Too many decimal places in rupee amount: "${input}"`)
  }

  const whole = wholeRaw ? Number.parseInt(wholeRaw, 10) : 0
  const frac = Number.parseInt(fracRaw.padEnd(2, '0'), 10)
  const paise = sign * (whole * 100 + frac)
  return Object.is(paise, -0) ? 0 : paise
}
