import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { Utr } from './Utr'

describe('Utr component', () => {
  test('[FE-01/AC4] <Utr> renders 4123 4567 8901 with tabular-nums and monospace', () => {
    render(<Utr value="412345678901" />)
    const el = screen.getByText('4123 4567 8901')
    expect(el).toBeInTheDocument()
    expect(el).toHaveClass('tabular-nums')
    expect(el).toHaveClass('font-mono')
  })
})
