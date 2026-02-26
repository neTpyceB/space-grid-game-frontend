import { useEffect, useMemo, useState } from 'react'
import type { AuthState } from '../auth/authApi'
import {
  closeGame,
  createGame,
  createInvitation,
  getGameDetails,
  joinGameByToken,
  listCreatedGames,
  listPlayableGames,
  OpenGamesLimitReachedError,
  type Game,
  type GameDetails,
  type Limits,
} from './gamesApi'

const LIST_REFRESH_MS = 10000
const CLOCK_REFRESH_MS = 30000

type LobbySnapshot = {
  playableGames: Game[]
  createdGames: Game[]
  limits: Limits
}

type LobbyViewState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'ready'; data: LobbySnapshot; busy: boolean; error: string | null }
  | { phase: 'error'; message: string }

function formatDateTime(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function gameSort(a: Game, b: Game): number {
  return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
}

function formatHoursLeft(game: Game, moveTimeoutSeconds: number, nowMs: number): string {
  if (game.status !== 'open') return 'Closed'
  const anchorMs = new Date(game.lastMoveAt ?? game.createdAt).getTime()
  if (Number.isNaN(anchorMs)) return 'Unknown'
  const remainingMs = anchorMs + moveTimeoutSeconds * 1000 - nowMs
  if (remainingMs <= 0) return 'Expired (timeout)'
  const totalMinutes = Math.ceil(remainingMs / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return hours > 0 ? `${hours}h ${minutes}m left` : `${minutes}m left`
}

function parseInviteContext(): { gameId: number | null; token: string } {
  const pathMatch = window.location.pathname.match(/^\/invite\/game\/(\d+)$/)
  const token = new URLSearchParams(window.location.search).get('token')?.trim() ?? ''
  const gameId = pathMatch ? Number(pathMatch[1]) : null
  return {
    gameId: Number.isInteger(gameId) && (gameId ?? 0) > 0 ? gameId : null,
    token,
  }
}

type GamesLobbyProps = {
  authState: AuthState | null
}

export function GamesLobby({ authState }: GamesLobbyProps) {
  const [viewState, setViewState] = useState<LobbyViewState>({ phase: 'idle' })
  const [selectedGameId, setSelectedGameId] = useState<number | null>(null)
  const [selectedDetails, setSelectedDetails] = useState<GameDetails | null>(null)
  const [detailsBusy, setDetailsBusy] = useState(false)
  const [detailsError, setDetailsError] = useState<string | null>(null)
  const [closingGameId, setClosingGameId] = useState<number | null>(null)
  const [joinBusy, setJoinBusy] = useState(false)
  const [inviteBusy, setInviteBusy] = useState(false)
  const [createBusy, setCreateBusy] = useState(false)
  const [joinGameIdInput, setJoinGameIdInput] = useState('')
  const [joinTokenInput, setJoinTokenInput] = useState('')
  const [inviteEmailInput, setInviteEmailInput] = useState('')
  const [createMaxPlayersInput, setCreateMaxPlayersInput] = useState('2')
  const [joinMessage, setJoinMessage] = useState<string | null>(null)
  const [inviteMessage, setInviteMessage] = useState<string | null>(null)
  const [nowMs, setNowMs] = useState(Date.now())
  const [refreshNonce, setRefreshNonce] = useState(0)

  useEffect(() => {
    const inviteContext = parseInviteContext()
    if (inviteContext.gameId) setJoinGameIdInput(String(inviteContext.gameId))
    if (inviteContext.token) setJoinTokenInput(inviteContext.token)
  }, [])

  useEffect(() => {
    const timerId = window.setInterval(() => setNowMs(Date.now()), CLOCK_REFRESH_MS)
    return () => window.clearInterval(timerId)
  }, [])

  useEffect(() => {
    if (authState?.kind !== 'authed') {
      setViewState(authState === null ? { phase: 'loading' } : { phase: 'idle' })
      setSelectedGameId(null)
      setSelectedDetails(null)
      setDetailsError(null)
      return
    }

    const controller = new AbortController()
    let active = true

    const loadLobby = async () => {
      setViewState((prev) =>
        prev.phase === 'ready' ? { ...prev, busy: true, error: null } : { phase: 'loading' },
      )

      try {
        const [playable, created] = await Promise.all([
          listPlayableGames(controller.signal),
          listCreatedGames(controller.signal),
        ])
        if (!active) return

        const data: LobbySnapshot = {
          playableGames: [...playable.games].sort(gameSort),
          createdGames: [...created].sort(gameSort),
          limits: playable.limits,
        }

        setViewState({ phase: 'ready', data, busy: false, error: null })
        setSelectedGameId((prev) => {
          if (prev && data.playableGames.some((game) => game.id === prev)) return prev
          return data.playableGames[0]?.id ?? data.createdGames[0]?.id ?? null
        })
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
        if (!active) return
        setViewState({
          phase: 'error',
          message: error instanceof Error ? error.message : 'Failed to load lobby',
        })
      }
    }

    void loadLobby()
    const timerId = window.setInterval(() => setRefreshNonce((v) => v + 1), LIST_REFRESH_MS)

    return () => {
      active = false
      controller.abort()
      window.clearInterval(timerId)
    }
  }, [authState, refreshNonce])

  useEffect(() => {
    if (authState?.kind !== 'authed' || selectedGameId === null) {
      setSelectedDetails(null)
      setDetailsBusy(false)
      setDetailsError(null)
      return
    }

    const controller = new AbortController()
    let active = true
    setDetailsBusy(true)
    setDetailsError(null)

    void (async () => {
      try {
        const details = await getGameDetails(selectedGameId, controller.signal)
        if (!active) return
        setSelectedDetails(details)
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
        if (!active) return
        setDetailsError(error instanceof Error ? error.message : 'Failed to load game details')
      } finally {
        if (active) setDetailsBusy(false)
      }
    })()

    return () => {
      active = false
      controller.abort()
    }
  }, [authState, selectedGameId, refreshNonce])

  const refreshLobby = () => setRefreshNonce((v) => v + 1)

  const selectedGame = useMemo(() => {
    if (viewState.phase !== 'ready' || selectedGameId === null) return null
    return (
      viewState.data.playableGames.find((g) => g.id === selectedGameId) ??
      viewState.data.createdGames.find((g) => g.id === selectedGameId) ??
      selectedDetails?.game ??
      null
    )
  }, [viewState, selectedGameId, selectedDetails])

  const handleCreateGame = async () => {
    if (authState?.kind !== 'authed' || viewState.phase !== 'ready' || createBusy) return
    setCreateBusy(true)
    setJoinMessage(null)
    setInviteMessage(null)
    setViewState({ ...viewState, error: null })
    try {
      const raw = Number(createMaxPlayersInput)
      const safeMax = Number.isInteger(raw) ? Math.max(2, Math.min(4, raw)) : undefined
      const result = await createGame(safeMax)
      setSelectedGameId(result.game.id)
      setViewState({
        phase: 'ready',
        data: {
          playableGames: [result.game, ...viewState.data.playableGames.filter((g) => g.id !== result.game.id)].sort(gameSort),
          createdGames: [result.game, ...viewState.data.createdGames.filter((g) => g.id !== result.game.id)].sort(gameSort),
          limits: result.limits,
        },
        busy: false,
        error: null,
      })
      refreshLobby()
    } catch (error) {
      if (error instanceof OpenGamesLimitReachedError) {
        setViewState({
          phase: 'ready',
          data: {
            ...viewState.data,
            limits: error.limits ?? viewState.data.limits,
          },
          busy: false,
          error: error.message,
        })
      } else {
        setViewState({
          ...viewState,
          error: error instanceof Error ? error.message : 'Failed to create game',
        })
      }
    } finally {
      setCreateBusy(false)
    }
  }

  const handleCloseGame = async (gameId: number) => {
    if (authState?.kind !== 'authed' || closingGameId !== null || viewState.phase !== 'ready') return
    setClosingGameId(gameId)
    setDetailsError(null)
    try {
      const result = await closeGame(gameId)
      setViewState((prev) => {
        if (prev.phase !== 'ready') return prev
        const replace = (list: Game[]) =>
          list.map((g) => (g.id === gameId ? result.game : g)).sort(gameSort)
        return {
          phase: 'ready',
          data: {
            playableGames: replace(prev.data.playableGames),
            createdGames: replace(prev.data.createdGames),
            limits: result.limits,
          },
          busy: prev.busy,
          error: null,
        }
      })
      if (selectedDetails?.game.id === gameId) {
        setSelectedDetails({ ...selectedDetails, game: result.game })
      }
      refreshLobby()
    } catch (error) {
      setDetailsError(error instanceof Error ? error.message : 'Failed to give up game')
    } finally {
      setClosingGameId(null)
    }
  }

  const handleJoinByToken = async () => {
    if (authState?.kind !== 'authed' || joinBusy) return
    const gameId = Number(joinGameIdInput.trim())
    const token = joinTokenInput.trim()
    if (!Number.isInteger(gameId) || gameId < 1) {
      setJoinMessage('Enter a valid game ID.')
      return
    }
    if (!token) {
      setJoinMessage('Invitation token is required.')
      return
    }

    setJoinBusy(true)
    setJoinMessage(null)
    try {
      const result = await joinGameByToken(gameId, token)
      setJoinMessage(`Joined game #${result.game.id}.`)
      setSelectedGameId(result.game.id)
      if (viewState.phase === 'ready') {
        setViewState({
          phase: 'ready',
          data: {
            playableGames: [result.game, ...viewState.data.playableGames.filter((g) => g.id !== result.game.id)].sort(gameSort),
            createdGames: viewState.data.createdGames.map((g) => (g.id === result.game.id ? result.game : g)).sort(gameSort),
            limits: result.limits,
          },
          busy: false,
          error: null,
        })
      }
      refreshLobby()
    } catch (error) {
      setJoinMessage(error instanceof Error ? error.message : 'Failed to join game')
    } finally {
      setJoinBusy(false)
    }
  }

  const handleCreateInvitation = async () => {
    if (authState?.kind !== 'authed' || inviteBusy || !selectedGame) return
    const email = inviteEmailInput.trim().toLowerCase()
    if (!email) {
      setInviteMessage('Email is required.')
      return
    }
    setInviteBusy(true)
    setInviteMessage(null)
    try {
      const invitation = await createInvitation(selectedGame.id, email)
      setInviteEmailInput('')
      setInviteMessage(`Invitation created for ${invitation.email}. Token: ${invitation.token}`)
      if (selectedDetails?.game.id === selectedGame.id) {
        setSelectedDetails({
          ...selectedDetails,
          invitations: [invitation, ...selectedDetails.invitations],
        })
      }
      refreshLobby()
    } catch (error) {
      setInviteMessage(error instanceof Error ? error.message : 'Failed to create invitation')
    } finally {
      setInviteBusy(false)
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
        <p className="meta">Authenticate to create or join multiplayer games.</p>
      </section>
    )
  }

  const renderLobbyBody = () => {
    if (viewState.phase === 'loading' || viewState.phase === 'idle') {
      return <p className="meta">Loading lobby...</p>
    }
    if (viewState.phase === 'error') {
      return (
        <>
          <p className="error-text">{viewState.message}</p>
          <button type="button" className="button" onClick={refreshLobby}>
            Retry
          </button>
        </>
      )
    }

    const { playableGames, createdGames, limits } = viewState.data
    const createdGameIds = new Set(createdGames.map((g) => g.id))
    const isOwnerOfSelected =
      selectedGame !== null && selectedGame.createdByUserId === authState.user.id
    const maxCreatePlayersOptions = Array.from(
      { length: Math.max(1, Math.min(4, limits.maxPlayersPerCreatedGameLimit) - 1) },
      (_, idx) => String(idx + 2),
    )

    return (
      <div className="lobby-grid">
        <section className="lobby-column">
          <div className="limits-box">
            <p className="status-line">
              Playable open: <span className="status-value">{limits.playableOpenGames}</span> /{' '}
              {limits.playableOpenGamesLimit}
            </p>
            <p className="meta">
              Created open: {limits.createdOpenGames} / {limits.createdOpenGamesLimit}
            </p>
            <p className="meta">
              Can create: {limits.canCreateGame ? 'Yes' : 'No'} • Can join:{' '}
              {limits.canJoinGame ? 'Yes' : 'No'}
            </p>
            <p className="meta">
              Move timeout: {Math.round(limits.moveTimeoutSeconds / 3600)}h • Max players per your game:{' '}
              {limits.maxPlayersPerCreatedGameLimit}
            </p>
          </div>

          <section className="panel panel-inset">
            <h3 className="section-title">Create Game</h3>
            <div className="inline-form">
              <label className="field-label" htmlFor="create-max-players">
                Max players
              </label>
              <select
                id="create-max-players"
                className="field-input"
                value={createMaxPlayersInput}
                onChange={(e) => setCreateMaxPlayersInput(e.target.value)}
                disabled={createBusy}
              >
                {maxCreatePlayersOptions.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="button"
                onClick={handleCreateGame}
                disabled={createBusy || !limits.canCreateGame}
              >
                {createBusy ? 'Creating...' : 'Create game'}
              </button>
              <button type="button" className="button button-secondary" onClick={refreshLobby}>
                Refresh
              </button>
            </div>
            {viewState.error ? <p className="error-text">{viewState.error}</p> : null}
          </section>

          <section className="panel panel-inset">
            <h3 className="section-title">Join By Invitation Token</h3>
            <div className="join-grid">
              <div>
                <label className="field-label" htmlFor="join-game-id">
                  Game ID
                </label>
                <input
                  id="join-game-id"
                  className="field-input"
                  value={joinGameIdInput}
                  onChange={(e) => setJoinGameIdInput(e.target.value)}
                  inputMode="numeric"
                  placeholder="42"
                />
              </div>
              <div>
                <label className="field-label" htmlFor="join-token">
                  Invitation token
                </label>
                <input
                  id="join-token"
                  className="field-input"
                  value={joinTokenInput}
                  onChange={(e) => setJoinTokenInput(e.target.value)}
                  placeholder="abcd1234..."
                />
              </div>
            </div>
            <div className="lobby-toolbar">
              <button
                type="button"
                className="button"
                onClick={handleJoinByToken}
                disabled={joinBusy || !limits.canJoinGame}
              >
                {joinBusy ? 'Joining...' : 'Join game'}
              </button>
            </div>
            {joinMessage ? <p className="meta">{joinMessage}</p> : null}
          </section>

          <section className="panel panel-inset">
            <h3 className="section-title">Playable Games (Created + Joined)</h3>
            {playableGames.length === 0 ? (
              <p className="meta">No playable games yet.</p>
            ) : (
              <ul className="game-list">
                {playableGames.map((game) => {
                  const isSelected = selectedGameId === game.id
                  const isClosing = closingGameId === game.id
                  const isOwner = game.createdByUserId === authState.user.id
                  return (
                    <li key={`playable-${game.id}`} className={`game-card ${isSelected ? 'is-selected' : ''}`}>
                      <div className="game-card-row">
                        <strong>Game #{game.id}</strong>
                        <span className={`pill ${game.status === 'open' ? 'pill-open' : 'pill-closed'}`}>
                          {game.status}
                        </span>
                      </div>
                      <p className="meta">
                        {isOwner ? 'Owner' : 'Joined'} • Players {game.playersCount ?? '—'}/{game.maxPlayers}
                      </p>
                      <p className="meta">Timeout: {formatHoursLeft(game, limits.moveTimeoutSeconds, nowMs)}</p>
                      <div className="game-card-actions">
                        <button
                          type="button"
                          className="button button-secondary"
                          onClick={() => setSelectedGameId(game.id)}
                        >
                          {isSelected ? 'Selected' : game.status === 'open' ? 'Open / Continue' : 'Open'}
                        </button>
                        <button
                          type="button"
                          className="button button-danger"
                          onClick={() => handleCloseGame(game.id)}
                          disabled={game.status !== 'open' || isClosing}
                        >
                          {isClosing ? 'Giving up...' : isOwner ? 'Close / Give up' : 'Give up'}
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          <section className="panel panel-inset">
            <h3 className="section-title">My Created Games</h3>
            {createdGames.length === 0 ? (
              <p className="meta">You have not created games yet.</p>
            ) : (
              <ul className="game-list">
                {createdGames.map((game) => (
                  <li key={`created-${game.id}`} className="game-card compact-card">
                    <div className="game-card-row">
                      <strong>Game #{game.id}</strong>
                      <span className={`pill ${game.status === 'open' ? 'pill-open' : 'pill-closed'}`}>
                        {game.status}
                      </span>
                    </div>
                    <p className="meta">
                      Players {game.playersCount ?? '—'}/{game.maxPlayers} •{' '}
                      {createdGameIds.has(game.id) ? 'In playable list' : 'Not currently playable'}
                    </p>
                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={() => setSelectedGameId(game.id)}
                    >
                      Open details
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </section>

        <section className="lobby-column panel panel-inset" aria-label="Selected game details">
          <h3 className="section-title">Game Details</h3>
          {selectedGameId === null ? <p className="meta">Select a game from the lobby.</p> : null}
          {detailsBusy ? <p className="meta">Loading game details...</p> : null}
          {detailsError ? <p className="error-text">{detailsError}</p> : null}

          {selectedGame ? (
            <>
              <dl className="details-grid">
                <div><dt>ID</dt><dd>{selectedGame.id}</dd></div>
                <div><dt>Owner user ID</dt><dd>{selectedGame.createdByUserId}</dd></div>
                <div><dt>Status</dt><dd>{selectedGame.status}</dd></div>
                <div><dt>Players</dt><dd>{selectedGame.playersCount ?? '—'} / {selectedGame.maxPlayers}</dd></div>
                <div><dt>Close reason</dt><dd>{selectedGame.closeReason ?? '—'}</dd></div>
                <div><dt>Winner user ID</dt><dd>{selectedGame.winnerUserId ?? '—'}</dd></div>
                <div><dt>Points at stake</dt><dd>{selectedGame.pointsAtStake}</dd></div>
                <div><dt>Move timeout left</dt><dd>{viewState.phase === 'ready' ? formatHoursLeft(selectedGame, viewState.data.limits.moveTimeoutSeconds, nowMs) : '—'}</dd></div>
                <div><dt>Created</dt><dd>{formatDateTime(selectedGame.createdAt)}</dd></div>
                <div><dt>Updated</dt><dd>{formatDateTime(selectedGame.updatedAt)}</dd></div>
                <div><dt>Last move</dt><dd>{formatDateTime(selectedGame.lastMoveAt)}</dd></div>
                <div><dt>Closed at</dt><dd>{formatDateTime(selectedGame.closedAt)}</dd></div>
              </dl>

              <section className="panel panel-inset">
                <h4 className="section-title">Players</h4>
                {!selectedDetails ? (
                  <p className="meta">Load details to see players.</p>
                ) : selectedDetails.players.length === 0 ? (
                  <p className="meta">No players attached yet.</p>
                ) : (
                  <ul className="simple-list">
                    {selectedDetails.players.map((player) => (
                      <li key={player.id}>
                        <strong>{player.email}</strong>
                        <span className="meta inline-meta"> user #{player.userId} • joined {formatDateTime(player.joinedAt)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {isOwnerOfSelected ? (
                <section className="panel panel-inset">
                  <h4 className="section-title">Invite Player By Email</h4>
                  <div className="join-grid">
                    <div>
                      <label className="field-label" htmlFor="invite-email">
                        Email
                      </label>
                      <input
                        id="invite-email"
                        className="field-input"
                        type="email"
                        value={inviteEmailInput}
                        onChange={(e) => setInviteEmailInput(e.target.value)}
                        placeholder="friend@example.com"
                      />
                    </div>
                  </div>
                  <div className="lobby-toolbar">
                    <button
                      type="button"
                      className="button"
                      onClick={handleCreateInvitation}
                      disabled={inviteBusy || selectedGame.status !== 'open'}
                    >
                      {inviteBusy ? 'Creating invite...' : 'Create invitation'}
                    </button>
                  </div>
                  {inviteMessage ? <p className="meta">{inviteMessage}</p> : null}
                </section>
              ) : null}

              <section className="panel panel-inset">
                <h4 className="section-title">Invitations</h4>
                {!selectedDetails ? (
                  <p className="meta">Load details to see invitations.</p>
                ) : selectedDetails.invitations.length === 0 ? (
                  <p className="meta">No invitations yet.</p>
                ) : (
                  <ul className="simple-list">
                    {selectedDetails.invitations.map((invitation) => (
                      <li key={invitation.id}>
                        <div>
                          <strong>{invitation.email}</strong>
                          <span className="meta inline-meta">
                            {' '}
                            • {invitation.acceptedAt ? `Accepted ${formatDateTime(invitation.acceptedAt)}` : 'Pending'}
                          </span>
                        </div>
                        <div className="meta token-line">Token: {invitation.token}</div>
                        <div className="meta token-line">Join path: {invitation.frontendInvitePath}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          ) : null}
        </section>
      </div>
    )
  }

  return (
    <section className="main-stage" aria-label="Lobby">
      <h2 className="section-title">Lobby</h2>
      <p className="meta">Current player: {authState.user.email}</p>
      {renderLobbyBody()}
    </section>
  )
}
