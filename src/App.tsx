import { useEffect, useState } from 'react'
import { NavLink, Route, Routes, useParams } from 'react-router-dom'
import { GamesLobby } from './features/games/GamesLobby'
import { AuthHeader } from './features/auth/AuthHeader'
import { type AuthState } from './features/auth/authApi'
import { useAuthSession } from './features/auth/useAuthSession'
import { getGameDetails, type GameDetails } from './features/games/gamesApi'
import { HealthStatus } from './features/health/HealthStatus'
import { usePageTitle } from './app/usePageTitle'
import './App.css'

type PageProps = {
  authState: AuthState | null
}

function HomePage() {
  usePageTitle('Home')
  return (
    <section className="page-panel">
      <h1>Welcome to Space Grid Game</h1>
      <p>
        Turn-based multiplayer browser game. The frontend shows current state and sends
        simple actions to the backend.
      </p>
      <p>
        Start by authenticating with your email in the header, then open the Games page to
        create or join a game lobby.
      </p>
    </section>
  )
}

function AboutPage() {
  usePageTitle('About')
  return (
    <section className="page-panel">
      <h1>About The Game</h1>
      <p>
        This is a move-based board game prototype (Monopoly-like / grid-based) where the
        backend is the source of truth for rules and calculations.
      </p>
      <p>
        Planned gameplay concepts: turns, dice/random events, player movement, and stateful
        matches between multiple players.
      </p>
      <p>
        Current frontend scope: authentication, lobby, game creation/joining, invitations, and
        basic game page placeholder.
      </p>
    </section>
  )
}

type ProfilePageProps = PageProps & {
  authBusy: boolean
  onTierUpgrade: () => Promise<unknown>
  onRefreshAuth: () => Promise<unknown>
}

function ProfilePage({ authState, authBusy, onTierUpgrade, onRefreshAuth }: ProfilePageProps) {
  usePageTitle('Profile')
  const [message, setMessage] = useState<string | null>(null)
  if (authState?.kind !== 'authed') {
    return (
      <section className="page-panel">
        <h1>Profile</h1>
        <p>Please authenticate first to view your profile.</p>
      </section>
    )
  }

  return (
    <section className="page-panel">
      <h1>Profile</h1>
      <div className="profile-grid">
        <div className="profile-card">
          <div className="profile-label">User ID</div>
          <div className="profile-value">{authState.user.id}</div>
        </div>
        <div className="profile-card">
          <div className="profile-label">Email</div>
          <div className="profile-value">{authState.user.email}</div>
        </div>
        <div className="profile-card">
          <div className="profile-label">Score</div>
          <div className="profile-value">
            {authState.user.score} / {authState.user.scoreWalletMax}
          </div>
        </div>
        <div className="profile-card">
          <div className="profile-label">Tier</div>
          <div className="profile-value">{authState.user.tierLevel} / 5</div>
        </div>
        <div className="profile-card">
          <div className="profile-label">Next Tier Upgrade Cost</div>
          <div className="profile-value">
            {authState.user.nextTierUpgradeCost ?? 'Max tier reached'}
          </div>
        </div>
      </div>
      <div className="lobby-toolbar" style={{ marginTop: '0.75rem' }}>
        <button
          type="button"
          className="button"
          disabled={authBusy || authState.user.nextTierUpgradeCost === null}
          onClick={async () => {
            setMessage(null)
            try {
              await onTierUpgrade()
              setMessage('Tier upgraded successfully.')
            } catch (error) {
              setMessage(error instanceof Error ? error.message : 'Tier upgrade failed')
            }
          }}
        >
          {authBusy ? 'Working...' : 'Tier Upgrade'}
        </button>
        <button
          type="button"
          className="button button-secondary"
          disabled={authBusy}
          onClick={async () => {
            setMessage(null)
            try {
              await onRefreshAuth()
              setMessage('Profile refreshed.')
            } catch (error) {
              setMessage(error instanceof Error ? error.message : 'Refresh failed')
            }
          }}
        >
          Refresh Profile
        </button>
      </div>
      {message ? <p className="meta">{message}</p> : null}
    </section>
  )
}

function GamesPage({ authState }: PageProps) {
  usePageTitle('Games')
  return <GamesLobby authState={authState} />
}

function GameBoardPage({ authState }: PageProps) {
  const params = useParams<{ id: string }>()
  const gameId = params.id ?? '—'
  usePageTitle(`Game #${gameId}`)
  const [details, setDetails] = useState<GameDetails | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (authState?.kind !== 'authed') return
    const numericId = Number(gameId)
    if (!Number.isInteger(numericId) || numericId < 1) return
    const controller = new AbortController()
    let active = true
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const data = await getGameDetails(numericId, controller.signal)
        if (active) setDetails(data)
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return
        if (active) setError(e instanceof Error ? e.message : 'Failed to load game')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
      controller.abort()
    }
  }, [authState, gameId])

  if (authState?.kind !== 'authed') {
    return (
      <section className="page-panel">
        <h1>Game #{gameId}</h1>
        <p>Please authenticate first to open a game page.</p>
      </section>
    )
  }

  return (
    <section className="page-panel">
      <div className="page-title-row">
        <h1>Game #{gameId}</h1>
        <NavLink className="button button-secondary nav-button" to="/games">
          Back to Games
        </NavLink>
      </div>
      <p className="meta">
        Placeholder game view. Board is using backend game size metadata when available.
      </p>

      {loading ? <p className="meta">Loading game details...</p> : null}
      {error ? <p className="error-text">{error}</p> : null}
      {details ? (
        <div className="meta">
          {details.game.visibility} • {details.game.playersCount}/{details.game.maxPlayers} players •
          board {details.game.fieldWidth}x{details.game.fieldHeight}
          {details.game.randomSize ? ' (random)' : ''}
        </div>
      ) : null}

      <div
        className="board-shell"
        style={
          details
            ? { gridTemplateColumns: `repeat(${details.game.fieldWidth}, minmax(0, 1fr))`, maxWidth: '100%' }
            : undefined
        }
        aria-label="Board placeholder"
      >
        {Array.from(
          { length: details ? details.game.fieldWidth * details.game.fieldHeight : 16 },
          (_, index) => (
          <div key={index} className="board-cell">
            {index + 1}
          </div>
        ))}
      </div>

      {details ? (
        <div className="page-subgrid">
          <section className="panel panel-inset">
            <h2 className="section-title">Players</h2>
            {details.players.length === 0 ? (
              <p className="meta">No players yet.</p>
            ) : (
              <ul className="simple-list">
                {details.players.map((player) => (
                  <li key={player.id}>
                    <strong>{player.email}</strong>
                    <div className="meta">
                      user #{player.userId} • {player.status}
                      {player.gaveUpAt ? ` • gave up ${new Date(player.gaveUpAt).toLocaleString()}` : ''}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="panel panel-inset">
            <h2 className="section-title">Events</h2>
            {details.events.length === 0 ? (
              <p className="meta">No events yet.</p>
            ) : (
              <ul className="simple-list">
                {details.events.map((event) => (
                  <li key={event.id}>
                    <strong>{event.type}</strong>
                    <div className="meta">
                      #{event.id} • {new Date(event.createdAt).toLocaleString()}
                      {event.actorUserId !== null ? ` • actor ${event.actorUserId}` : ''}
                    </div>
                    <pre className="event-payload">{JSON.stringify(event.payload, null, 2)}</pre>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : null}
    </section>
  )
}

function InviteGamePage({ authState }: PageProps) {
  usePageTitle('Join Invite')
  return <GamesLobby authState={authState} />
}

function NotFoundPage() {
  usePageTitle('Not Found')
  return (
    <section className="page-panel">
      <h1>Page not found</h1>
      <p>Use the menu to navigate to an existing page.</p>
    </section>
  )
}

function AppLayout() {
  const auth = useAuthSession()

  return (
    <div className="site-shell">
      <header className="site-header">
        <div className="site-header-inner">
          <div className="brand-block">
            <NavLink to="/" className="brand-link">
              <span className="brand-logo" aria-hidden="true">
                SG
              </span>
              <span className="brand-text">Space Grid Game</span>
            </NavLink>
          </div>

          <nav className="main-nav" aria-label="Main navigation">
            <NavLink to="/" className={({ isActive }) => `nav-link${isActive ? ' is-active' : ''}`} end>
              Home
            </NavLink>
            <NavLink to="/about" className={({ isActive }) => `nav-link${isActive ? ' is-active' : ''}`}>
              About
            </NavLink>
            <NavLink to="/profile" className={({ isActive }) => `nav-link${isActive ? ' is-active' : ''}`}>
              Profile
            </NavLink>
            <NavLink to="/games" className={({ isActive }) => `nav-link${isActive ? ' is-active' : ''}`}>
              Games
            </NavLink>
          </nav>

          <AuthHeader
            authState={auth.authState}
            loading={auth.loading}
            busy={auth.busy}
            error={auth.error}
            onLogin={auth.login}
            onLogout={auth.logout}
          />
        </div>
      </header>

      <main className="site-main">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route
            path="/profile"
            element={
              <ProfilePage
                authState={auth.authState}
                authBusy={auth.busy}
                onTierUpgrade={auth.tierUpgrade}
                onRefreshAuth={async () => {
                  await auth.refresh()
                }}
              />
            }
          />
          <Route path="/games" element={<GamesPage authState={auth.authState} />} />
          <Route path="/invite/game/:id" element={<InviteGamePage authState={auth.authState} />} />
          <Route path="/games/:id" element={<GameBoardPage authState={auth.authState} />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>

      <footer className="site-footer">
        <div className="site-footer-inner">
          <div className="footer-brand">
            <span className="brand-logo" aria-hidden="true">
              SG
            </span>
            <div>
              <div className="footer-brand-title">Space Grid Game</div>
              <div className="footer-brand-subtitle">Lobby and game frontend</div>
            </div>
          </div>

          <div className="footer-links">
            <span className="footer-link-muted">Docs (soon)</span>
            <span className="footer-link-muted">Support (soon)</span>
            <span className="footer-link-muted">Community (soon)</span>
          </div>

          <div className="footer-status">
            <HealthStatus compact />
          </div>
        </div>
      </footer>
    </div>
  )
}

export default function App() {
  return <AppLayout />
}
