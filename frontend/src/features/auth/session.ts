import type { components } from '@/api/schema'

export type Me = components['schemas']['Me']
export type Membership = components['schemas']['Membership']
export type TokenResponse = components['schemas']['TokenResponse']

export const TOKEN_STORAGE_KEY = 'pgcrm_access_token'
export const EXPIRES_AT_STORAGE_KEY = 'pgcrm_expires_at'
export const ME_STORAGE_KEY = 'pgcrm_me'
export const ORG_STORAGE_KEY = 'pgcrm_org_id'

export interface AuthSession {
  token: string
  expiresAt: number | null
  me: Me
  orgId: string | null
}

function getStorage(): Storage | null {
  return typeof window !== 'undefined' ? window.localStorage : null
}

export function getStoredToken(): string | null {
  return getStorage()?.getItem(TOKEN_STORAGE_KEY) ?? null
}

export function getStoredOrgId(): string | null {
  return getStorage()?.getItem(ORG_STORAGE_KEY) ?? null
}

export function resolveSelectedOrgId(me: Me, preferredOrgId: string | null): string | null {
  if (me.memberships.length === 1) {
    return me.memberships[0].org_id
  }
  if (preferredOrgId && me.memberships.some((m) => m.org_id === preferredOrgId)) {
    return preferredOrgId
  }
  return null
}

export function loadSession(): AuthSession | null {
  const storage = getStorage()
  if (!storage) return null

  const token = storage.getItem(TOKEN_STORAGE_KEY)
  const meRaw = storage.getItem(ME_STORAGE_KEY)
  if (!token || !meRaw) return null

  try {
    const me = JSON.parse(meRaw) as Me
    const expiresRaw = storage.getItem(EXPIRES_AT_STORAGE_KEY)
    const expiresAt = expiresRaw ? Number.parseInt(expiresRaw, 10) : null
    const orgId = resolveSelectedOrgId(me, storage.getItem(ORG_STORAGE_KEY))
    if (orgId) {
      storage.setItem(ORG_STORAGE_KEY, orgId)
    } else {
      storage.removeItem(ORG_STORAGE_KEY)
    }
    return { token, expiresAt, me, orgId }
  } catch {
    clearStoredSession()
    return null
  }
}

export function saveTokenResponse(res: TokenResponse): AuthSession {
  const storage = getStorage()
  const expiresAt = Date.now() + res.expires_in * 1000
  const existingOrg = storage?.getItem(ORG_STORAGE_KEY) ?? null
  const orgId = resolveSelectedOrgId(res.me, existingOrg)

  if (storage) {
    storage.setItem(TOKEN_STORAGE_KEY, res.access_token)
    storage.setItem(EXPIRES_AT_STORAGE_KEY, String(expiresAt))
    storage.setItem(ME_STORAGE_KEY, JSON.stringify(res.me))
    if (orgId) {
      storage.setItem(ORG_STORAGE_KEY, orgId)
    } else {
      storage.removeItem(ORG_STORAGE_KEY)
    }
  }

  return {
    token: res.access_token,
    expiresAt,
    me: res.me,
    orgId,
  }
}

export function saveSelectedOrgId(orgId: string | null): void {
  const storage = getStorage()
  if (!storage) return
  if (orgId) {
    storage.setItem(ORG_STORAGE_KEY, orgId)
  } else {
    storage.removeItem(ORG_STORAGE_KEY)
  }
}

export function saveMe(me: Me): void {
  const storage = getStorage()
  if (!storage) return
  storage.setItem(ME_STORAGE_KEY, JSON.stringify(me))
}

export function clearStoredSession(): void {
  const storage = getStorage()
  if (!storage) return
  storage.removeItem(TOKEN_STORAGE_KEY)
  storage.removeItem(EXPIRES_AT_STORAGE_KEY)
  storage.removeItem(ME_STORAGE_KEY)
  storage.removeItem(ORG_STORAGE_KEY)
}

export function getSelectedMembership(session: AuthSession | null): Membership | null {
  if (!session || !session.orgId) return null
  return session.me.memberships.find((m) => m.org_id === session.orgId) ?? null
}
