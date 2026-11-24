import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { configureApiHandlers, configureAuthGetter } from '@/api/client'
import { useToast } from '@/components/Toast'
import {
  clearStoredSession,
  getSelectedMembership,
  getStoredOrgId,
  getStoredToken,
  loadSession,
  resolveSelectedOrgId,
  saveMe,
  saveSelectedOrgId,
  saveTokenResponse,
  type AuthSession,
  type Me,
  type Membership,
  type TokenResponse,
} from './session'

interface AuthContextValue {
  session: AuthSession | null
  membership: Membership | null
  loginWithToken: (res: TokenResponse) => AuthSession
  selectOrg: (orgId: string) => void
  updateMe: (me: Me) => void
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

configureAuthGetter({
  getToken: getStoredToken,
  getOrgId: getStoredOrgId,
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(() => loadSession())
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { showToast } = useToast()

  const clearAuthAndCache = useCallback(() => {
    clearStoredSession()
    setSession(null)
    queryClient.clear()
  }, [queryClient])

  const handleUnauthorized = useCallback(() => {
    clearAuthAndCache()
    showToast('Session expired', 'error')
    navigate('/login', { replace: true })
  }, [clearAuthAndCache, navigate, showToast])

  const handleForbidden = useCallback(
    (message: string) => {
      showToast(message || "You don't have access to this", 'error')
    },
    [showToast],
  )

  useEffect(() => {
    configureAuthGetter({
      getToken: () => session?.token ?? getStoredToken(),
      getOrgId: () => session?.orgId ?? getStoredOrgId(),
    })
  }, [session])

  useEffect(() => {
    configureApiHandlers({
      onUnauthorized: handleUnauthorized,
      onForbidden: handleForbidden,
    })
    return () => {
      configureApiHandlers({})
    }
  }, [handleUnauthorized, handleForbidden])

  const loginWithToken = useCallback((res: TokenResponse): AuthSession => {
    const next = saveTokenResponse(res)
    setSession(next)
    return next
  }, [])

  const selectOrg = useCallback((orgId: string) => {
    saveSelectedOrgId(orgId)
    setSession((prev) => {
      if (!prev) return prev
      const resolved = resolveSelectedOrgId(prev.me, orgId)
      return { ...prev, orgId: resolved }
    })
  }, [])

  const updateMe = useCallback((me: Me) => {
    saveMe(me)
    setSession((prev) => {
      if (!prev) return prev
      const orgId = resolveSelectedOrgId(me, prev.orgId)
      saveSelectedOrgId(orgId)
      return { ...prev, me, orgId }
    })
  }, [])

  const logout = useCallback(() => {
    clearAuthAndCache()
    navigate('/login', { replace: true })
  }, [clearAuthAndCache, navigate])

  const membership = getSelectedMembership(session)

  return (
    <AuthContext.Provider
      value={{
        session,
        membership,
        loginWithToken,
        selectOrg,
        updateMe,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return ctx
}
