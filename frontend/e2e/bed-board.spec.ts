import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

const API_BASE = process.env.E2E_API_URL ?? 'http://127.0.0.1:8000/api/v1'
const PASSWORD = 'devpass123'

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

async function apiLogin(request: APIRequestContext, phone: string) {
  const res = await request.post(`${API_BASE}/auth/login`, {
    data: { phone, password: PASSWORD },
  })
  expect(res.ok()).toBeTruthy()
  const json = (await res.json()) as {
    access_token: string
    me: { memberships: Array<{ org_id: string }> }
  }
  return {
    token: json.access_token,
    orgId: json.me.memberships[0].org_id,
  }
}

async function uiLogin(page: Page, phone: string) {
  await page.goto('/login')
  await page.getByLabel('Mobile number').fill(phone)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(/\/(owner|caretaker|select-org)/)
  if (/select-org/.test(page.url())) {
    await page.getByRole('button').first().click()
    await page.waitForURL(/\/(owner|caretaker)/)
  }
}

async function ensureOccupiedStay(
  request: APIRequestContext,
): Promise<{
  residentId: string
  residentName: string
  bedLabel: string
  propertyId: string
}> {
  const auth = await apiLogin(request, '9000000001')
  const headers = { Authorization: `Bearer ${auth.token}`, 'X-Org-Id': auth.orgId }

  const propsRes = await request.get(`${API_BASE}/properties`, { headers })
  expect(propsRes.ok()).toBeTruthy()
  const props = (await propsRes.json()) as Array<{
    id: string
    name: string
    qr_slug: string
    security_deposit_paise: number
    maintenance_charge_paise: number
    exit_deduction_paise: number
  }>
  const sunrise = props.find((p) => p.name.includes('Sunrise HSR')) ?? props[0]

  const boardRes = await request.get(`${API_BASE}/properties/${sunrise.id}/bed-board`, { headers })
  expect(boardRes.ok()).toBeTruthy()
  const board = (await boardRes.json()) as {
    rooms: Array<{
      beds: Array<{
        id: string
        label: string
        status: string
        is_active: boolean
        base_rent_paise: number
        stay: {
          id: string
          status: string
          resident: { id: string; full_name: string }
        } | null
      }>
    }>
  }
  const allBeds = board.rooms.flatMap((r) => r.beds).filter((b) => b.is_active)
  const vacantBed = allBeds.find((b) => b.status === 'vacant')

  if (vacantBed) {
    const suffix = Date.now().toString().slice(-6)
    const residentName = `Test Resident ${suffix}`
    const residentPhone = `98${Date.now().toString().slice(-8)}`

    const up1Res = await request.post(`${API_BASE}/public/join/${sunrise.qr_slug}/uploads`, {
      data: { kind: 'kyc_id', content_type: 'image/png', size_bytes: TINY_PNG.length },
    })
    const up2Res = await request.post(`${API_BASE}/public/join/${sunrise.qr_slug}/uploads`, {
      data: { kind: 'selfie', content_type: 'image/png', size_bytes: TINY_PNG.length },
    })
    if (up1Res.ok() && up2Res.ok()) {
      const up1 = (await up1Res.json()) as { object_key: string; upload_url: string }
      const up2 = (await up2Res.json()) as { object_key: string; upload_url: string }
      const put1 = await request.put(up1.upload_url, {
        headers: { 'Content-Type': 'image/png' },
        data: TINY_PNG,
      })
      const put2 = await request.put(up2.upload_url, {
        headers: { 'Content-Type': 'image/png' },
        data: TINY_PNG,
      })

      if (put1.ok() && put2.ok()) {
        const submitRes = await request.post(`${API_BASE}/public/join/${sunrise.qr_slug}`, {
          data: {
            full_name: residentName,
            phone: residentPhone,
            permanent_address: '10 HSR Layout, Bengaluru',
            occupation: 'working',
            emergency_contact_name: 'Parent',
            emergency_contact_phone: '9876500000',
            id_doc_type: 'aadhaar',
            id_doc_number: '123456789012',
            id_doc_path: up1.object_key,
            selfie_path: up2.object_key,
            is_foreign_national: false,
            accepted_rules: true,
            accepted_exit_deduction_paise: sunrise.exit_deduction_paise,
          },
        })
        if (submitRes.ok()) {
          const submitted = (await submitRes.json()) as { request_id: string }
          const todayIST = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Kolkata',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          }).format(new Date())

          const approveRes = await request.post(
            `${API_BASE}/onboarding-requests/${submitted.request_id}/approve`,
            {
              headers,
              data: {
                bed_id: vacantBed.id,
                stay_type: 'monthly',
                rent_paise: vacantBed.base_rent_paise,
                deposit_paise: sunrise.security_deposit_paise,
                maintenance_charge_paise: sunrise.maintenance_charge_paise,
                check_in_date: todayIST,
              },
            },
          )
          expect(approveRes.ok()).toBeTruthy()
          const approved = (await approveRes.json()) as { resident_id: string }
          return {
            residentId: approved.resident_id,
            residentName,
            bedLabel: vacantBed.label,
            propertyId: sunrise.id,
          }
        }
      }
    }
  }

  // Fallback for local dev when S3/MinIO is unavailable or unlicensed: use an existing occupied bed.
  const occupiedBed = [...allBeds].reverse().find((b) => b.status === 'occupied' && b.stay)
  expect(occupiedBed).toBeTruthy()
  return {
    residentId: occupiedBed!.stay!.resident.id,
    residentName: occupiedBed!.stay!.resident.full_name,
    bedLabel: occupiedBed!.label,
    propertyId: sunrise.id,
  }
}

test('[FE-23/AC1,AC2,AC3,AC4,AC5,AC6] Bed board filters, resident notice/withdraw, move out today, and owner correct dates', async ({
  page,
  request,
}) => {
  const created = await ensureOccupiedStay(request)
  const expectedFirstName = created.residentName.trim().split(/\s+/)[0]

  // 1. Caretaker opens Bed board
  await uiLogin(page, '9000000002')
  await page.getByRole('link', { name: 'Bed board' }).click()
  await expect(page).toHaveURL(/\/caretaker\/beds$/)

  const tile = page.getByTestId(`bed-tile-${created.bedLabel}`)
  await expect(tile).toBeVisible()
  await expect(tile).toContainText('Occupied')
  await expect(tile).toContainText(expectedFirstName)

  // AC2: Filter chips
  const filterGroup = page.getByRole('group', { name: 'Bed status filter' })
  await filterGroup.getByRole('button', { name: 'Vacant' }).click()
  await expect(tile).toBeHidden()
  await filterGroup.getByRole('button', { name: 'All' }).click()
  await expect(tile).toBeVisible()

  // 2. Caretaker opens Resident detail
  await tile.click()
  await expect(page).toHaveURL(new RegExp(`/caretaker/residents/${created.residentId}$`))
  await expect(page.getByRole('heading', { name: created.residentName })).toBeVisible()

  // AC4: Caretaker must NOT see Correct dates
  await expect(page.getByRole('button', { name: 'Correct dates' })).toBeHidden()

  // AC5: Give notice shows computed last day before confirming and has NO date picker for caretaker
  await page.getByRole('button', { name: 'Give notice' }).click()
  const noticeDialog = page.getByRole('dialog', { name: 'Give notice' })
  await expect(noticeDialog.getByText(/Last day:/)).toBeVisible()
  expect(await noticeDialog.locator('input[type="date"]').count()).toBe(0)
  await noticeDialog.getByRole('button', { name: 'Confirm notice' }).click()
  await expect(noticeDialog).toBeHidden()
  await expect(page.getByLabel('Current stay').getByText('On notice')).toBeVisible()

  // AC6: Bed board reflects On notice
  await page.getByRole('link', { name: 'Bed board' }).click()
  await expect(page.getByTestId(`bed-tile-${created.bedLabel}`)).toContainText('On notice')
  await filterGroup.getByRole('button', { name: 'On notice' }).click()
  await expect(page.getByTestId(`bed-tile-${created.bedLabel}`)).toBeVisible()

  // AC6: Withdraw notice returns bed to Occupied
  await page.getByTestId(`bed-tile-${created.bedLabel}`).click()
  await page.getByRole('button', { name: 'Withdraw notice' }).click()
  const withdrawDialog = page.getByRole('dialog', { name: 'Withdraw notice' })
  await withdrawDialog.getByRole('button', { name: 'Confirm withdraw' }).click()
  await expect(withdrawDialog).toBeHidden()
  await expect(page.getByLabel('Current stay').getByText('Occupied')).toBeVisible()

  // AC3, AC4: Move out today has no date picker for caretaker and frees the bed immediately
  await page.getByRole('button', { name: 'Move out today' }).click()
  const moveOutDialog = page.getByRole('dialog', { name: 'Move out today' })
  expect(await moveOutDialog.locator('input[type="date"]').count()).toBe(0)
  await moveOutDialog.getByRole('button', { name: 'Confirm move-out' }).click()
  await expect(moveOutDialog).toBeHidden()

  await page.getByRole('link', { name: 'Bed board' }).click()
  await expect(page.getByTestId(`bed-tile-${created.bedLabel}`)).toContainText('Vacant')

  // AC4: Owner sees Correct dates on the vacated stay
  await page.getByRole('button', { name: 'Account menu' }).click()
  await page.getByRole('menuitem', { name: 'Log out' }).click()
  await uiLogin(page, '9000000001')

  await page.goto(`/owner/residents/${created.residentId}`)
  await expect(page.getByRole('heading', { name: created.residentName })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Correct dates' })).toBeVisible()
})
