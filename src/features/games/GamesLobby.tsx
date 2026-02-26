import { useEffect, useState } from 'react'
import type { AuthState } from '../auth/authApi'
import {
  closeGame,
  createGame,
  getGame,
  listGames,
  OpenGamesLimitReachedError,
  type Game,
  type Limits,
} from './gamesApi'

const LIST_REFRESH_MS = 10000
const CLOCK_REFRESH_MS = 30000

type LobbyData = {
  games: Game[]
  limits: Limits
}

type LobbyViewState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'ready'; data: LobbyData; error: string | null; busy: boolean }
  | { phase: 'error'; message: string }

function formatDateTime(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function formatHoursLeft(game: Game, moveTimeoutSeconds: number, nowMs: number): string {
  if (game.status !== 'open') return 'Closed'

  const anchor = new Date(game.lastMoveAt ?? game.createdAt).getTime()
  if (Number.isNaN(anchor)) return 'Unknown'

  const remainingMs = anchor + moveTimeoutSeconds * 1000 - nowMs
  if (remainingMs <= 0) return 'Expired (timeout)'

  const totalMinutes = Math.ceil(remainingMs / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60

  if (hours > 0) return `${hours}h ${minutes}m left`
  return `${minutes}m left`
}

function gameSort(a: Game, b: Game): number {
  const aTime = new Date(a.updatedAt).getTime()
  const bTime = new Date(b.updatedAt).getTime()
  return bTime - aTime
}

type GamesLobbyProps = {
  authState: AuthState | null
}

export function GamesLobby({ authState }: GamesLobbyProps) {
  const [viewState, setViewState] = useState<LobbyViewState>({ phase: 'idle' })
  const [selectedGameId, setSelectedGameId] = useState<number | null>(null)
  const [selectedGame, setSelectedGame] = useState<Game | null>(null)
  const [selectedBusy, setSelectedBusy] = useState(false)
  const [selectedError, setSelectedError] = useState<string | null>(null)
  const [closingGameId, setClosingGameId] = useState<number | null>(null)
  const [nowMs, setNowMs] = useState(Date.now())
  const [reloadTick, setReloadTick] = useState(0)

  useEffect(() => {
    const timerId = window.setInterval(() => setNowMs(Date.now()), CLOCK_REFRESH_MS)
    return () => window.clearInterval(timerId)
  }, [])

  useEffect(() => {
    if (authState?.kind !== 'authed') {
      setViewState(authState === null ? { phase: 'loading' } : { phase: 'idle' })
      setSelectedGameId(null)
      setSelectedGame(null)
      setSelectedError(null)
      return
    }

    const controller = new AbortController()
    let active = true

    const load = async () => {
      setViewState((prev) =>
        prev.phase === 'ready'
          ? { ...prev, busy: true, error: null }
          : { phase: 'loading' },
      )

      try {
        const data = await listGames(controller.signal)
        if (!active) return

        const games = [...data.games].sort(gameSort)
        setViewState({ phase: 'ready', data: { games, limits: data.limits }, error: null, busy: false })

        setSelectedGameId((prev) => {
          if (prev && games.some((game) => game.id === prev)) return prev
          return games[0]?.id ?? null
        })
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
        if (!active) return
        setViewState({ phase: 'error', message: error instanceof Error ? error.message : 'Failed to load games' })
      }
    }

    void load()
    const timerId = window.setInterval(() => setReloadTick((value) => value + 1), LIST_REFRESH_MS)

    return () => {
      active = false
      controller.abort()
      window.clearInterval(timerId)
    }
  }, [authState, reloadTick])

  useEffect(() => {
    if (authState?.kind !== 'authed' || selectedGameId === null) {
      setSelectedGame(null)
      setSelectedError(null)
      return
    }

    const controller = new AbortController()
    let active = true
    setSelectedBusy(true)
    setSelectedError(null)

    void (async () => {
      try {
        const game = await getGame(selectedGameId, controller.signal)
        if (!active) return
        setSelectedGame(game)
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
        if (!active) return
        setSelectedError(error instanceof Error ? error.message : 'Failed to load game')
      } finally {
        if (active) setSelectedBusy(false)
      }
    })()

    return () => {
      active = false
      controller.abort()
    }
  }, [authState, selectedGameId, reloadTick])

  const requestRefresh = () => setReloadTick((value) => value + 1)

  const handleCreateGame = async () => {
    if (authState?.kind !== 'authed') return
    if (viewState.phase !== 'ready' || viewState.busy) return

    setViewState({ ...viewState, busy: true, error: null })
    try {
      const created = await createGame()
      const nextGames = [created.game, ...viewState.data.games.filter((g) => g.id !== created.game.id)].sort(gameSort)
      setViewState({
        phase: 'ready',
        data: { games: nextGames, limits: created.limits },
        error: null,
        busy: false,
      })
      setSelectedGameId(created.game.id)
      setReloadTick((value) => value + 1)
    } catch (error) {
      if (error instanceof OpenGamesLimitReachedError) {
        setViewState({
          phase: 'ready',
          data: {
            games: viewState.data.games,
            limits: error.limits ?? viewState.data.limits,
          },
          error: error.message,
          busy: false,
        })
        return
      }

      setViewState({
        phase: 'ready',
        data: viewState.data,
        error: error instanceof Error ? error.message : 'Failed to create game',
        busy: false,
      })
    }
  }

  const handleCloseGame = async (gameId: number) => {
    if (authState?.kind !== 'authed') return
    if (closingGameId !== null) return

    setClosingGameId(gameId)
    try {
      const result = await closeGame(gameId)
      setViewState((prev) => {
        if (prev.phase !== 'ready') return prev
        const games = prev.data.games
          .map((game) => (game.id === gameId ? result.game : game))
          .sort(gameSort)
        return {
          phase: 'ready',
          data: { games, limits: result.limits },
          error: null,
          busy: prev.busy,
        }
      })
      if (selectedGameId === gameId) setSelectedGame(result.game)
      requestRefresh()
    } catch (error) {
      setSelectedError(error instanceof Error ? error.message : 'Failed to close game')
    } finally {
      setClosingGameId(null)
    }
  }

  if (authState === null) {
    return (
      <section className="main-stage panel" aria-label="Lobby">
        <h2 className="section-title">Lobby</h2>
        <p className="meta">Waiting for auth status...</p>
      </section>
    )
  }

  if (authState.kind === 'guest') {
    return (
      <section className="main-stage panel" aria-label="Lobby">
        <h2 className="section-title">Lobby</h2>
        <p className="meta">Authenticate to see your games and create a new one.</p>
      </section>
    )
  }

  const renderContent = () => {
    if (viewState.phase === 'loading' || viewState.phase === 'idle') {
      return <p className="meta">Loading games...</p>
    }

    if (viewState.phase === 'error') {
      return (
        <>
          <p className="error-text">{viewState.message}</p>
          <button type="button" className="button" onClick={requestRefresh}>
            Retry
          </button>
        </>
      )
    }

    const { games, limits } = viewState.data
    const selected = selectedGameId ? selectedGame ?? games.find((game) => game.id === selectedGameId) ?? null : null

    return (
      <div className="lobby-grid">
        <section className="lobby-column">
          <div className="lobby-toolbar">
            <button
              type="button"
              className="button"
              onClick={handleCreateGame}
              disabled={viewState.busy || !limits.canCreateGame}
            >
              {viewState.busy ? 'Working...' : 'Create game'}
            </button>
            <button type="button" className="button button-secondary" onClick={requestRefresh}>
              Refresh
            </button>
          </div>

          <div className="limits-box">
            <p className="status-line">
              Open games: <span className="status-value">{limits.openGames}</span> / {limits.openGamesLimit}
            </p>
            <p className="meta">
              Create allowed: {limits.canCreateGame ? 'Yes' : 'No'} • Move timeout:{' '}
              {Math.round(limits.moveTimeoutSeconds / 3600)}h
            </p>
          </div>

          {viewState.error ? <p className="error-text">{viewState.error}</p> : null}

          {games.length === 0 ? (
            <p className="meta">No games yet. Create your first game.</p>
          ) : (
            <ul className="game-list" aria-label="My games">
              {games.map((game) => {
                const isSelected = selectedGameId === game.id
                const isClosing = closingGameId === game.id
                const actionLabel =
                  game.status === 'open' ? (isSelected ? 'Continue' : 'Start') : 'Open'

                return (
                  <li key={game.id} className={`game-card ${isSelected ? 'is-selected' : ''}`}>
                    <div className="game-card-row">
                      <strong>Game #{game.id}</strong>
                      <span className={`pill ${game.status === 'open' ? 'pill-open' : 'pill-closed'}`}>
                        {game.status}
                      </span>
                    </div>
                    <p className="meta">Time left: {formatHoursLeft(game, limits.moveTimeoutSeconds, nowMs)}</p>
                    <p className="meta">
                      Updated: {formatDateTime(game.updatedAt)}
                      {game.closeReason ? ` • Reason: ${game.closeReason}` : ''}
                    </p>
                    <div className="game-card-actions">
                      <button
                        type="button"
                        className="button button-secondary"
                        onClick={() => setSelectedGameId(game.id)}
                      >
                        {actionLabel}
                      </button>
                      <button
                        type="button"
                        className="button button-danger"
                        onClick={() => handleCloseGame(game.id)}
                        disabled={game.status !== 'open' || isClosing}
                      >
                        {isClosing ? 'Giving up...' : 'Give up'}
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section className="lobby-column panel panel-inset" aria-label="Selected game">
          <h3 className="section-title">Game details</h3>
          {selectedGameId === null ? <p className="meta">Select a game to inspect it.</p> : null}
          {selectedBusy ? <p className="meta">Loading game details...</p> : null}
          {selectedError ? <p className="error-text">{selectedError}</p> : null}
          {selected ? (
            <dl className="details-grid">
              <div>
                <dt>ID</dt>
                <dd>{selected.id}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{selected.status}</dd>
              </div>
              <div>
                <dt>Close reason</dt>
                <dd>{selected.closeReason ?? '—'}</dd>
              </div>
              <div>
                <dt>Points at stake</dt>
                <dd>{selected.pointsAtStake}</dd>
              </div>
              <div>
                <dt>Winner user ID</dt>
                <dd>{selected.winnerUserId ?? '—'}</dd>
              </div>
              <div>
                <dt>Move timeout left</dt>
                <dd>{formatHoursLeft(selected, limits.moveTimeoutSeconds, nowMs)}</dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>{formatDateTime(selected.createdAt)}</dd>
              </div>
              <div>
                <dt>Last move</dt>
                <dd>{formatDateTime(selected.lastMoveAt)}</dd>
              </div>
              <div>
                <dt>Updated</dt>
                <dd>{formatDateTime(selected.updatedAt)}</dd>
              </div>
              <div>
                <dt>Closed at</dt>
                <dd>{formatDateTime(selected.closedAt)}</dd>
              </div>
            </dl>
          ) : null}
        </section>
      </div>
    )
  }

  return (
    <section className="main-stage" aria-label="Lobby">
      <h2 className="section-title">Lobby</h2>
      <p className="meta">Current player: {authState.user.email}</p>
      {renderContent()}
    </section>
  )
}
