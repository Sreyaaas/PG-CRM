import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, test } from 'vitest'
import { ToastProvider } from '@/components/Toast'
import { CaretakerShell } from '@/components/shells/CaretakerShell'
import { OwnerShell } from '@/components/shells/OwnerShell'
import { DevUiPage } from '@/routes/DevUiPage'

// Every source file except this one (it has to name the banned words).
const SOURCES = import.meta.glob(['./**/*.{ts,tsx,css}', '!./design-system.test.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const BANNED = /\b(indigo|violet|purple)\b|gradient/i

afterEach(() => {
  cleanup()
  delete document.documentElement.dataset.theme
})

describe('Marigold design system', () => {
  test('[FE-03/AC2] no indigo, violet, purple or gradient anywhere in src/', () => {
    const files = Object.keys(SOURCES)
    expect(files.length).toBeGreaterThan(30)
    const offenders = files.filter((f) => BANNED.test(SOURCES[f]))
    expect(offenders).toEqual([])
  })

  test('[FE-03/AC1] /dev/ui shows every token, the type scale, radii, shadows and every component section', () => {
    render(
      <ToastProvider>
        <MemoryRouter initialEntries={['/dev/ui']}>
          <DevUiPage />
        </MemoryRouter>
      </ToastProvider>,
    )
    const tokens = [
      'page', 'surface', 'surface-2', 'surface-3', 'line', 'line-strong', 'ink', 'muted', 'subtle',
      'brand', 'on-brand', 'brand-soft', 'brand-ink', 'danger', 'warning', 'success', 'info',
    ]
    for (const t of tokens) expect(screen.getByText(`--${t}`)).toBeInTheDocument()
    for (const name of ['radius-card', 'radius-control', 'radius-chip', 'shadow-xs', 'shadow-sm', 'shadow-lg']) {
      expect(screen.getByText(name)).toBeInTheDocument()
    }
    for (const t of ['Display', 'Heading 1', 'Heading 2', 'Body', 'Caption']) {
      expect(screen.getByText(t)).toBeInTheDocument()
    }
    for (const section of [
      'Colours', 'Type scale', 'Radii and shadows', 'Buttons', 'Form fields', 'Badges and chips',
      'Stat tiles and numbers', 'Cards, list rows and states', 'Sheet and toast', 'Quick-action sheets',
    ]) {
      expect(screen.getByRole('heading', { name: section })).toBeInTheDocument()
    }
    for (const v of ['Primary', 'Brand', 'Secondary', 'Ghost', 'Danger']) {
      expect(screen.getByRole('button', { name: v })).toBeInTheDocument()
    }

    // Light / dark toggle sets data-theme on <html>.
    fireEvent.click(screen.getByRole('button', { name: 'Dark' }))
    expect(document.documentElement.dataset.theme).toBe('dark')
    fireEvent.click(screen.getByRole('button', { name: 'Light' }))
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  test('[FE-03/AC3] caretaker centre + opens a quick-action sheet with Log payment, Log expense, Approve check-in', () => {
    render(
      <MemoryRouter initialEntries={['/caretaker']}>
        <CaretakerShell orgName="Demo PGs" userName="Raju">
          <p>content</p>
        </CaretakerShell>
      </MemoryRouter>,
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Quick actions' }))
    const sheet = screen.getByRole('dialog', { name: 'Quick actions' })
    expect(within(sheet).getByRole('link', { name: /Log payment/ })).toHaveAttribute('href', '/caretaker/payments')
    expect(within(sheet).getByRole('link', { name: /Log expense/ })).toHaveAttribute('href', '/caretaker/expenses')
    expect(within(sheet).getByRole('link', { name: /Approve check-in/ })).toHaveAttribute('href', '/caretaker/check-ins')

    // Esc closes it.
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  test('[FE-03/AC3] owner centre + opens a quick-action sheet with Add property, Add caretaker, Approvals', () => {
    render(
      <MemoryRouter initialEntries={['/owner']}>
        <OwnerShell orgName="Demo PGs" userName="Meera">
          <p>content</p>
        </OwnerShell>
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Quick actions' }))
    const sheet = screen.getByRole('dialog', { name: 'Quick actions' })
    expect(within(sheet).getByRole('link', { name: /Add property/ })).toHaveAttribute('href', '/owner/properties/new')
    expect(within(sheet).getByRole('link', { name: /Add caretaker/ })).toHaveAttribute('href', '/owner/staff')
    expect(within(sheet).getByRole('link', { name: /Approvals/ })).toHaveAttribute('href', '/owner/approvals')

    // Backdrop tap closes it.
    fireEvent.click(screen.getByTestId('sheet-backdrop'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  test('[FE-03/AC4] log out lives in the avatar menu with the user name and role', () => {
    let loggedOut = false
    render(
      <MemoryRouter initialEntries={['/owner']}>
        <OwnerShell orgName="Demo PGs" userName="Meera Nair" onLogout={() => (loggedOut = true)}>
          <p>content</p>
        </OwnerShell>
      </MemoryRouter>,
    )
    expect(screen.queryByRole('menuitem', { name: 'Log out' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }))
    const menu = screen.getByRole('menu')
    expect(within(menu).getByText('Meera Nair')).toBeInTheDocument()
    expect(within(menu).getByText('Owner')).toBeInTheDocument()
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Log out' }))
    expect(loggedOut).toBe(true)
  })
})
