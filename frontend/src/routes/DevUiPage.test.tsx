import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, test } from 'vitest'
import { DevUiPage } from './DevUiPage'

const EXPECTED_BADGE_LABELS = [
  'Vacant',
  'Reserved',
  'Occupied',
  'On notice',
  'Cash',
  'Provisional',
  'Verified',
  'Flagged',
  'Void',
  'No bill: review',
]

describe('/dev/ui showcase', () => {
  test('[FE-01/AC3] /dev/ui renders every status badge label from the specification', () => {
    render(
      <MemoryRouter initialEntries={['/dev/ui']}>
        <DevUiPage />
      </MemoryRouter>,
    )

    for (const label of EXPECTED_BADGE_LABELS) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })
})
