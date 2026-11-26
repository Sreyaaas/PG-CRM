import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, test } from 'vitest'
import { CollectionCard } from './CollectionCard'

describe('Rent collection card', () => {
  afterEach(cleanup)

  test('shows received of expected, the percentage, and the three parts', () => {
    render(
      <MemoryRouter>
        <CollectionCard confirmedPaise={11883100} provisionalPaise={21786850} duePaise={12116350} dueCount={8} />
      </MemoryRouter>,
    )
    expect(screen.getByText('₹3,36,699.50')).toBeInTheDocument()
    expect(screen.getByText('₹4,57,863')).toBeInTheDocument()
    expect(screen.getByLabelText('74 percent received')).toHaveTextContent('74%')
    expect(screen.getByText('Still due · 8')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Who owes' })).toHaveAttribute('href', '/owner/money')
  })

  test('renders nothing when there is no rent to show', () => {
    const { container } = render(
      <MemoryRouter>
        <CollectionCard confirmedPaise={0} provisionalPaise={0} duePaise={0} dueCount={0} />
      </MemoryRouter>,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
