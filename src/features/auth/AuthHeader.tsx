import { useState } from 'react'
import type { AuthState } from './authApi'

type AuthHeaderProps = {
  authState: AuthState | null
  loading: boolean
  busy: boolean
  error: string | null
  onLogin: (email: string) => Promise<unknown>
  onLogout: () => Promise<unknown>
}

export function AuthHeader({
  authState,
  loading,
  busy,
  error,
  onLogin,
  onLogout,
}: AuthHeaderProps) {
  const [email, setEmail] = useState('')

  const handleLogin = async () => {
    const value = email.trim()
    if (!value) return
    try {
      await onLogin(value)
      setEmail('')
    } catch {
      // State/error is handled by the shared auth hook.
    }
  }

  return (
    <div className="header-auth" aria-live="polite">
      {authState?.kind === 'authed' ? (
        <div className="header-auth-authed">
          <div className="header-user">
            <span className="header-user-email">{authState.user.email}</span>
            <span className="header-user-meta">
              User #{authState.user.id} • Tier {authState.user.tierLevel}/5 • Score{' '}
              {authState.user.score}/{authState.user.scoreWalletMax}
            </span>
          </div>
          <button type="button" className="button button-secondary" onClick={() => void onLogout()} disabled={busy}>
            {busy ? '...' : 'Log out'}
          </button>
        </div>
      ) : (
        <div className="header-auth-form">
          <label className="sr-only" htmlFor="header-auth-email">
            Email
          </label>
          <input
            id="header-auth-email"
            className="field-input header-auth-input"
            type="email"
            autoComplete="email"
            placeholder={loading ? 'Checking session...' : 'player@example.com'}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void handleLogin()
              }
            }}
            disabled={loading || busy}
          />
          <button type="button" className="button" onClick={() => void handleLogin()} disabled={loading || busy || !email.trim()}>
            {busy ? 'Auth...' : 'Auth'}
          </button>
        </div>
      )}
      {error ? <div className="header-auth-error">{error}</div> : null}
    </div>
  )
}
