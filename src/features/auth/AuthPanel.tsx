import { type FormEvent, useEffect, useState } from 'react'
import { authByEmail, fetchCurrentUser, logout, type AuthState } from './authApi'

type ViewState =
  | { phase: 'loading' }
  | { phase: 'ready'; auth: AuthState; error: string | null; busy: boolean }

type AuthPanelProps = {
  onAuthStateChange?: (auth: AuthState) => void
}

export function AuthPanel({ onAuthStateChange }: AuthPanelProps) {
  const [emailInput, setEmailInput] = useState('')
  const [state, setState] = useState<ViewState>({ phase: 'loading' })

  useEffect(() => {
    const controller = new AbortController()

    void (async () => {
      try {
        const auth = await fetchCurrentUser(controller.signal)
        setState({ phase: 'ready', auth, error: null, busy: false })
        onAuthStateChange?.(auth)
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return
        }

        setState({
          phase: 'ready',
          auth: { kind: 'guest' },
          error: error instanceof Error ? error.message : 'Failed to load auth state',
          busy: false,
        })
        onAuthStateChange?.({ kind: 'guest' })
      }
    })()

    return () => controller.abort()
  }, [onAuthStateChange])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (state.phase !== 'ready' || state.busy) return

    const normalized = emailInput.trim().toLowerCase()
    if (!normalized) {
      setState({ ...state, error: 'Email is required.' })
      return
    }

    setState({ ...state, busy: true, error: null })
    try {
      const auth = await authByEmail(normalized)
      setState({ phase: 'ready', auth, error: null, busy: false })
      onAuthStateChange?.(auth)
      setEmailInput('')
    } catch (error) {
      setState({
        phase: 'ready',
        auth: { kind: 'guest' },
        error: error instanceof Error ? error.message : 'Login failed',
        busy: false,
      })
      onAuthStateChange?.({ kind: 'guest' })
    }
  }

  const handleLogout = async () => {
    if (state.phase !== 'ready' || state.busy) return

    setState({ ...state, busy: true, error: null })
    try {
      await logout()
      setState({ phase: 'ready', auth: { kind: 'guest' }, error: null, busy: false })
      onAuthStateChange?.({ kind: 'guest' })
    } catch (error) {
      setState({
        ...state,
        busy: false,
        error: error instanceof Error ? error.message : 'Logout failed',
      })
    }
  }

  if (state.phase === 'loading') {
    return (
      <section className="panel" aria-busy="true" aria-live="polite">
        <h2 className="section-title">Auth</h2>
        <p className="meta">Checking current session...</p>
        <form className="auth-form" onSubmit={(event) => event.preventDefault()}>
          <label className="field-label" htmlFor="auth-email-loading">
            Write your email
          </label>
          <input
            id="auth-email-loading"
            className="field-input"
            type="email"
            value=""
            placeholder="player@example.com"
            disabled
            readOnly
          />
          <button type="submit" className="button" disabled>
            Auth
          </button>
        </form>
      </section>
    )
  }

  return (
    <section className="panel">
      <h2 className="section-title">Auth</h2>

      {state.auth.kind === 'authed' ? (
        <div className="auth-block">
          <p className="status-line">
            Authed as <span className="status-value">{state.auth.user.email}</span>
          </p>
          <p className="meta">Current email used for gameplay session.</p>
          <button
            type="button"
            className="button"
            onClick={handleLogout}
            disabled={state.busy}
          >
            {state.busy ? 'Logging out...' : 'Log out'}
          </button>
        </div>
      ) : (
        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="field-label" htmlFor="auth-email">
            Write your email
          </label>
          <input
            id="auth-email"
            className="field-input"
            type="email"
            autoComplete="email"
            placeholder="player@example.com"
            value={emailInput}
            onChange={(event) => setEmailInput(event.target.value)}
            disabled={state.busy}
            required
          />
          <button type="submit" className="button" disabled={state.busy}>
            {state.busy ? 'Authenticating...' : 'Auth'}
          </button>
        </form>
      )}

      {state.auth.kind === 'authed' && state.auth.created ? (
        <p className="meta">New user created and authenticated.</p>
      ) : null}
      {state.error ? <p className="error-text">{state.error}</p> : null}
    </section>
  )
}

export type { AuthPanelProps }
