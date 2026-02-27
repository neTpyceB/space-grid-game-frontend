import { useCallback, useEffect, useState } from 'react'
import {
  authByEmail,
  fetchCurrentUser,
  logout as apiLogout,
  tierUpgrade as apiTierUpgrade,
  type AuthState,
} from './authApi'

type AuthSessionState = {
  authState: AuthState | null
  loading: boolean
  busy: boolean
  error: string | null
}

export function useAuthSession() {
  const [state, setState] = useState<AuthSessionState>({
    authState: null,
    loading: true,
    busy: false,
    error: null,
  })
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const authState = await fetchCurrentUser(signal)
    setState((prev) => ({
      ...prev,
      authState,
      loading: false,
      busy: false,
      error: null,
    }))
    return authState
  }, [])

  useEffect(() => {
    const controller = new AbortController()

    void (async () => {
      try {
        await refresh(controller.signal)
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setState((prev) => ({
          ...prev,
          authState: { kind: 'guest' },
          loading: false,
          busy: false,
          error: error instanceof Error ? error.message : 'Failed to load auth session',
        }))
      }
    })()

    return () => controller.abort()
  }, [refresh])

  const login = useCallback(async (email: string) => {
    setState((prev) => ({ ...prev, busy: true, error: null }))
    try {
      const authState = await authByEmail(email.trim().toLowerCase())
      setState((prev) => ({ ...prev, authState, busy: false, error: null }))
      return authState
    } catch (error) {
      setState((prev) => ({
        ...prev,
        authState: { kind: 'guest' },
        busy: false,
        error: error instanceof Error ? error.message : 'Login failed',
      }))
      throw error
    }
  }, [])

  const logout = useCallback(async () => {
    setState((prev) => ({ ...prev, busy: true, error: null }))
    try {
      await apiLogout()
      setState((prev) => ({
        ...prev,
        authState: { kind: 'guest' },
        busy: false,
        error: null,
      }))
    } catch (error) {
      setState((prev) => ({
        ...prev,
        busy: false,
        error: error instanceof Error ? error.message : 'Logout failed',
      }))
      throw error
    }
  }, [])

  const tierUpgrade = useCallback(async () => {
    setState((prev) => ({ ...prev, busy: true, error: null }))
    try {
      const user = await apiTierUpgrade()
      setState((prev) => ({
        ...prev,
        authState: { kind: 'authed', user },
        busy: false,
        error: null,
      }))
      return user
    } catch (error) {
      setState((prev) => ({
        ...prev,
        busy: false,
        error: error instanceof Error ? error.message : 'Tier upgrade failed',
      }))
      throw error
    }
  }, [])

  return {
    ...state,
    login,
    logout,
    tierUpgrade,
    refresh,
  }
}
