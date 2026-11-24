import { expect, test } from '@playwright/test'

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

test('[FE-01/AC3,AC4] /dev/ui shows every badge label and formatted UTR in Mobile Chrome', async ({
  page,
}) => {
  await page.goto('/dev/ui')

  for (const label of EXPECTED_BADGE_LABELS) {
    await expect(page.getByText(label, { exact: true })).toBeVisible()
  }

  await expect(page.getByText('4123 4567 8901')).toBeVisible()
})
