import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, test } from 'vitest'
import { CollectionCard } from './CollectionCard'

function renderCard(props: Parameters<typeof CollectionCard>[0]) {
  return render(
    <MemoryRouter>
      <CollectionCard {...props} />
    </MemoryRouter>,
  )
}

describe('Rent collection card', () => {
  afterEach(cleanup)

  test('shows received of expected, the percentage, and collected / UPI / still due', () => {
    renderCard({ confirmedPaise: 11883100, provisionalPaise: 21786850, duePaise: 12116350, dueCount: 8 })
    expect(screen.getByText('₹3,36,699.50')).toBeInTheDocument()
    expect(screen.getByText('₹4,57,863')).toBeInTheDocument()
    expect(screen.getByLabelText('74 percent received')).toHaveTextContent('74%')
    expect(screen.getByText('Collected').parentElement).toHaveTextContent('₹1,18,831')
    expect(screen.getByText('UPI to verify').parentElement).toHaveTextContent('₹2,17,868.50')
    const due = screen.getByRole('link', { name: /Still due/ })
    expect(due).toHaveTextContent('8 residents')
    expect(due).toHaveTextContent('₹1,21,163.50')
    expect(due).toHaveAttribute('href', '/owner/money')
  })

  test('without dues it shows what came in, with no target or percentage', () => {
    renderCard({ confirmedPaise: 500000, provisionalPaise: 0, duePaise: null, dueCount: 0 })
    expect(screen.getByText('Rent received').parentElement).toHaveTextContent('₹5,000')
    expect(screen.queryByText(/expected/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/percent received/)).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Still due/ })).not.toBeInTheDocument()
  })
})
