import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { AuthState } from '../auth/authApi'
import {
  createGame,
  createInvitation,
  getGameDetails,
  giveUpGame,
  joinGame,
  listCreatedGames,
  listPendingInvitations,
  listPlayableGames,
  listPublicGames,
  OpenGamesLimitReachedError,
  type CreateGameInput,
  type Game,
  type GameDetails,
  type GameInvitation,
  type Limits,
} from './gamesApi'

const LIST_REFRESH_MS = 10000
const CLOCK_REFRESH_MS = 30000

type LobbySnapshot = {
  playableGames: Game[]
  createdGames: Game[]
  publicGames: Game[]
  pendingInvitations: GameInvitation[]
  limits: Limits
}

type LobbyTab = 'overview' | 'my-games' | 'public' | 'invites'

type LobbyViewState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'ready'; data: LobbySnapshot; busy: boolean; error: string | null }
  | { phase: 'error'; message: string }

function formatDateTime(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function gameSort(a: Game, b: Game): number {
  return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
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
  return hours > 0 ? `${hours}h ${minutes}m left` : `${minutes}m left`
}

function parseInviteContext(): { gameId: number | null; token: string } {
  const pathMatch = window.location.pathname.match(/^\/invite\/game\/(\d+)$/)
  const token = new URLSearchParams(window.location.search).get('token')?.trim() ?? ''
  const gameId = pathMatch ? Number(pathMatch[1]) : null
  return { gameId: Number.isInteger(gameId) && (gameId ?? 0) > 0 ? gameId : null, token }
}

function parseInviteInput(raw: string): { gameId: number | null; token: string; error: string | null } {
  const value = raw.trim()
  if (!value) return { gameId: null, token: '', error: 'Paste an invite link or token.' }

  const fromPath = (pathname: string, search: string) => {
    const pathMatch = pathname.match(/\/invite\/game\/(\d+)$/)
    const token = new URLSearchParams(search).get('token')?.trim() ?? ''
    const gameId = pathMatch ? Number(pathMatch[1]) : null
    return {
      gameId: Number.isInteger(gameId) && (gameId ?? 0) > 0 ? (gameId as number) : null,
      token,
    }
  }

  if (value.startsWith('/')) {
    const [pathname, search = ''] = value.split('?')
    const parsed = fromPath(pathname, search ? `?${search}` : '')
    if (parsed.gameId && parsed.token) return { ...parsed, error: null }
  }

  try {
    const url = new URL(value)
    const parsed = fromPath(url.pathname, url.search)
    if (parsed.gameId && parsed.token) return { ...parsed, error: null }
  } catch {
    // token-only input is allowed below
  }

  return { gameId: null, token: value, error: null }
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)))
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
  const [actionBusyGameId, setActionBusyGameId] = useState<number | null>(null)
  const [createBusy, setCreateBusy] = useState(false)
  const [joinBusy, setJoinBusy] = useState(false)
  const [inviteBusy, setInviteBusy] = useState(false)
  const [joinGameIdInput, setJoinGameIdInput] = useState('')
  const [joinTokenInput, setJoinTokenInput] = useState('')
  const [inviteEmailInput, setInviteEmailInput] = useState('')
  const [joinMessage, setJoinMessage] = useState<string | null>(null)
  const [inviteMessage, setInviteMessage] = useState<string | null>(null)
  const [createMessage, setCreateMessage] = useState<string | null>(null)
  const [clipboardMessage, setClipboardMessage] = useState<string | null>(null)
  const [nowMs, setNowMs] = useState(Date.now())
  const [refreshNonce, setRefreshNonce] = useState(0)
  const [activeTab, setActiveTab] = useState<LobbyTab>('overview')
  const [joinModalOpen, setJoinModalOpen] = useState(false)
  const [invitePasteInput, setInvitePasteInput] = useState('')
  const [createForm, setCreateForm] = useState<CreateGameInput>({
    visibility: 'private',
    maxPlayers: 2,
    fieldWidth: 4,
    fieldHeight: 4,
    randomSize: false,
  })

  useEffect(() => {
    const invite = parseInviteContext()
    if (invite.gameId) setJoinGameIdInput(String(invite.gameId))
    if (invite.token) setJoinTokenInput(invite.token)
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

    const load = async () => {
      setViewState((prev) =>
        prev.phase === 'ready' ? { ...prev, busy: true, error: null } : { phase: 'loading' },
      )
      try {
        const [playableRes, createdRes, publicRes, pendingInvitations] = await Promise.all([
          listPlayableGames(controller.signal),
          listCreatedGames(controller.signal),
          listPublicGames(controller.signal),
          listPendingInvitations(controller.signal),
        ])
        if (!active) return
        const data: LobbySnapshot = {
          playableGames: [...playableRes.games].sort(gameSort),
          createdGames: [...createdRes.games].sort(gameSort),
          publicGames: [...publicRes.games].sort(gameSort),
          pendingInvitations,
          limits: playableRes.limits,
        }
        setViewState({ phase: 'ready', data, busy: false, error: null })
        setSelectedGameId((prev) => {
          if (prev && [...data.playableGames, ...data.createdGames].some((g) => g.id === prev)) return prev
          return data.playableGames[0]?.id ?? data.createdGames[0]?.id ?? data.publicGames[0]?.id ?? null
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

    void load()
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
        setSelectedErrorText(error instanceof Error ? error.message : 'Failed to load game details')
      } finally {
        if (active) setDetailsBusy(false)
      }
    })()
    return () => {
      active = false
      controller.abort()
    }
  }, [authState, selectedGameId, refreshNonce])

  const setSelectedErrorText = (message: string | null) => setDetailsError(message)
  const refreshLobby = () => setRefreshNonce((v) => v + 1)

  const copyText = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setClipboardMessage(`${label} copied.`)
      window.setTimeout(() => setClipboardMessage((current) => (current === `${label} copied.` ? null : current)), 2000)
    } catch {
      setClipboardMessage(`Could not copy ${label.toLowerCase()}.`)
    }
  }

  const selectedGame = useMemo(() => {
    if (selectedGameId === null) return null
    if (selectedDetails?.game.id === selectedGameId) return selectedDetails.game
    if (viewState.phase !== 'ready') return null
    return (
      viewState.data.playableGames.find((g) => g.id === selectedGameId) ??
      viewState.data.createdGames.find((g) => g.id === selectedGameId) ??
      viewState.data.publicGames.find((g) => g.id === selectedGameId) ??
      null
    )
  }, [selectedGameId, selectedDetails, viewState])

  const validateCreateForm = (limits: Limits): string | null => {
    if (createForm.maxPlayers < 2 || createForm.maxPlayers > 4) return 'Max players must be 2..4.'
    if (createForm.maxPlayers > limits.maxPlayersPerCreatedGameLimit) {
      return `Your current tier allows up to ${limits.maxPlayersPerCreatedGameLimit} players per created game.`
    }
    if (!createForm.randomSize) {
      if (createForm.fieldWidth < 4 || createForm.fieldWidth > 16) return 'Field width must be 4..16.'
      if (createForm.fieldHeight < 4 || createForm.fieldHeight > 16) return 'Field height must be 4..16.'
    }
    return null
  }

  const handleCreate = async () => {
    if (authState?.kind !== 'authed' || viewState.phase !== 'ready' || createBusy) return
    const validation = validateCreateForm(viewState.data.limits)
    if (validation) {
      setCreateMessage(validation)
      return
    }
    setCreateBusy(true)
    setCreateMessage(null)
    try {
      const result = await createGame(createForm)
      setCreateMessage(`Game #${result.game.id} created.`)
      setSelectedGameId(result.game.id)
      setViewState((prev) => {
        if (prev.phase !== 'ready') return prev
        const upsert = (list: Game[]) =>
          [result.game, ...list.filter((g) => g.id !== result.game.id)].sort(gameSort)
        return {
          phase: 'ready',
          data: {
            playableGames: upsert(prev.data.playableGames),
            createdGames: upsert(prev.data.createdGames),
            publicGames:
              result.game.visibility === 'public'
                ? prev.data.publicGames.filter((g) => g.id !== result.game.id)
                : prev.data.publicGames,
            pendingInvitations: prev.data.pendingInvitations,
            limits: result.limits,
          },
          busy: false,
          error: null,
        }
      })
      refreshLobby()
    } catch (error) {
      if (error instanceof OpenGamesLimitReachedError) {
        setCreateMessage(error.message)
        if (viewState.phase === 'ready' && error.limits) {
          setViewState({ ...viewState, data: { ...viewState.data, limits: error.limits } })
        }
      } else {
        setCreateMessage(error instanceof Error ? error.message : 'Failed to create game')
      }
    } finally {
      setCreateBusy(false)
    }
  }

  const handleJoin = async (gameId: number, token?: string) => {
    if (authState?.kind !== 'authed' || joinBusy) return
    setJoinBusy(true)
    setJoinMessage(null)
    try {
      const result = await joinGame(gameId, token)
      setJoinMessage(`Joined game #${result.game.id}.`)
      setSelectedGameId(result.game.id)
      setViewState((prev) => {
        if (prev.phase !== 'ready') return prev
        return {
          phase: 'ready',
          data: {
            playableGames: [result.game, ...prev.data.playableGames.filter((g) => g.id !== result.game.id)].sort(gameSort),
            createdGames: prev.data.createdGames.map((g) => (g.id === result.game.id ? result.game : g)).sort(gameSort),
            publicGames: prev.data.publicGames.filter((g) => g.id !== result.game.id),
            pendingInvitations: prev.data.pendingInvitations.filter((inv) => !(inv.joinApiPath.endsWith(`/${result.game.id}/join`) && token && inv.token === token)),
            limits: result.limits,
          },
          busy: false,
          error: null,
        }
      })
      refreshLobby()
    } catch (error) {
      setJoinMessage(error instanceof Error ? error.message : 'Failed to join game')
    } finally {
      setJoinBusy(false)
    }
  }

  const handleJoinByTokenForm = async () => {
    const gameId = Number(joinGameIdInput.trim())
    const token = joinTokenInput.trim()
    if (!Number.isInteger(gameId) || gameId < 1) {
      setJoinMessage('Enter a valid game ID.')
      return
    }
    if (!token) {
      setJoinMessage('Token is required for private game join.')
      return
    }
    await handleJoin(gameId, token)
  }

  const handleJoinFromInviteInput = async () => {
    const parsed = parseInviteInput(invitePasteInput)
    if (parsed.error) {
      setJoinMessage(parsed.error)
      return
    }
    if (!parsed.token) {
      setJoinMessage('Invite token is required.')
      return
    }
    if (parsed.gameId === null) {
      setJoinTokenInput(parsed.token)
      setJoinMessage('Token filled. Enter game ID or paste a full invite link.')
      return
    }
    setJoinGameIdInput(String(parsed.gameId))
    setJoinTokenInput(parsed.token)
    setJoinModalOpen(false)
    await handleJoin(parsed.gameId, parsed.token)
  }

  const handleGiveUp = async (gameId: number) => {
    if (authState?.kind !== 'authed' || actionBusyGameId !== null) return
    setActionBusyGameId(gameId)
    setDetailsError(null)
    try {
      const result = await giveUpGame(gameId)
      setViewState((prev) => {
        if (prev.phase !== 'ready') return prev
        const replace = (list: Game[]) => list.map((g) => (g.id === gameId ? result.game : g)).sort(gameSort)
        return {
          phase: 'ready',
          data: {
            ...prev.data,
            playableGames: replace(prev.data.playableGames),
            createdGames: replace(prev.data.createdGames),
            publicGames: prev.data.publicGames.filter((g) => g.id !== gameId),
            limits: result.limits,
          },
          busy: prev.busy,
          error: null,
        }
      })
      if (selectedDetails?.game.id === gameId) setSelectedDetails({ ...selectedDetails, game: result.game })
      refreshLobby()
    } catch (error) {
      setDetailsError(error instanceof Error ? error.message : 'Failed to give up')
    } finally {
      setActionBusyGameId(null)
    }
  }

  const handleCreateInvitation = async () => {
    if (!selectedGame || authState?.kind !== 'authed' || inviteBusy) return
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
      setInviteMessage(`Invitation created: ${invitation.frontendInvitePath}`)
      if (selectedDetails?.game.id === selectedGame.id) {
        setSelectedDetails({ ...selectedDetails, invitations: [invitation, ...selectedDetails.invitations] })
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
        <p className="meta">Authenticate to create, join, and manage multiplayer games.</p>
      </section>
    )
  }

  const renderContent = () => {
    if (viewState.phase === 'loading' || viewState.phase === 'idle') return <p className="meta">Loading lobby...</p>
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

    const { playableGames, createdGames, publicGames, pendingInvitations, limits } = viewState.data
    const selectedIsOwner = selectedGame?.createdByUserId === authState.user.id
    const displayedInvitations = selectedDetails?.invitations ?? []
    const showMyGames = activeTab === 'overview' || activeTab === 'my-games'
    const showPublic = activeTab === 'overview' || activeTab === 'public'
    const showInvites = activeTab === 'overview' || activeTab === 'invites'

    return (
      <div className="lobby-grid">
        <section className="lobby-column">
          <div className="panel panel-inset lobby-tabs-shell">
            <div className="lobby-toolbar lobby-toolbar-between">
              <div className="tabs-row" role="tablist" aria-label="Lobby sections">
                {([
                  ['overview', 'Overview'],
                  ['my-games', 'My Games'],
                  ['public', 'Public'],
                  ['invites', 'Invites'],
                ] as const).map(([tab, label]) => (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === tab}
                    className={`tab-button ${activeTab === tab ? 'is-active' : ''}`}
                    onClick={() => setActiveTab(tab)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <button type="button" className="button button-secondary" onClick={() => setJoinModalOpen(true)}>
                Join via invite
              </button>
            </div>
            {clipboardMessage ? <p className="meta">{clipboardMessage}</p> : null}
          </div>

          <div className="limits-box">
            <p className="status-line">
              Tier {limits.tierLevel} • Score {authState.user.score}/{authState.user.scoreWalletMax}
            </p>
            <p className="meta">
              Playable open: {limits.playableOpenGames}/{limits.playableOpenGamesLimit} • Created open:{' '}
              {limits.createdOpenGames}/{limits.createdOpenGamesLimit}
            </p>
            <p className="meta">
              Create: {limits.canCreateGame ? 'allowed' : 'blocked'} • Join:{' '}
              {limits.canJoinGame ? 'allowed' : 'blocked'} • Max players/game:{' '}
              {limits.maxPlayersPerCreatedGameLimit}
            </p>
            <p className="meta">Move timeout: {Math.round(limits.moveTimeoutSeconds / 3600)}h</p>
          </div>

          {showMyGames ? (
          <section className="panel panel-inset">
            <h3 className="section-title">Create Game</h3>
            <div className="join-grid">
              <div>
                <label className="field-label" htmlFor="create-visibility">Visibility</label>
                <select
                  id="create-visibility"
                  className="field-input"
                  value={createForm.visibility}
                  onChange={(e) => setCreateForm((p) => ({ ...p, visibility: e.target.value as CreateGameInput['visibility'] }))}
                  disabled={createBusy}
                >
                  <option value="private">Private (invite only)</option>
                  <option value="public">Public</option>
                </select>
              </div>
              <div>
                <label className="field-label" htmlFor="create-max-players">Max players</label>
                <input
                  id="create-max-players"
                  className="field-input"
                  type="number"
                  min={2}
                  max={Math.min(4, limits.maxPlayersPerCreatedGameLimit)}
                  value={createForm.maxPlayers}
                  onChange={(e) =>
                    setCreateForm((p) => ({
                      ...p,
                      maxPlayers: clampInt(Number(e.target.value || 2), 2, Math.min(4, limits.maxPlayersPerCreatedGameLimit)),
                    }))
                  }
                  disabled={createBusy}
                />
              </div>
              <div>
                <label className="field-label" htmlFor="create-width">Field width</label>
                <input
                  id="create-width"
                  className="field-input"
                  type="number"
                  min={4}
                  max={16}
                  value={createForm.fieldWidth}
                  disabled={createBusy || createForm.randomSize}
                  onChange={(e) =>
                    setCreateForm((p) => ({ ...p, fieldWidth: clampInt(Number(e.target.value || 4), 4, 16) }))
                  }
                />
              </div>
              <div>
                <label className="field-label" htmlFor="create-height">Field height</label>
                <input
                  id="create-height"
                  className="field-input"
                  type="number"
                  min={4}
                  max={16}
                  value={createForm.fieldHeight}
                  disabled={createBusy || createForm.randomSize}
                  onChange={(e) =>
                    setCreateForm((p) => ({ ...p, fieldHeight: clampInt(Number(e.target.value || 4), 4, 16) }))
                  }
                />
              </div>
            </div>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={createForm.randomSize}
                disabled={createBusy}
                onChange={(e) => setCreateForm((p) => ({ ...p, randomSize: e.target.checked }))}
              />
              <span>Random board size (backend picks width/height)</span>
            </label>
            <div className="lobby-toolbar">
              <button type="button" className="button" onClick={handleCreate} disabled={createBusy || !limits.canCreateGame}>
                {createBusy ? 'Creating...' : 'Create game'}
              </button>
              <button type="button" className="button button-secondary" onClick={refreshLobby}>Refresh</button>
            </div>
            {createMessage ? <p className="meta">{createMessage}</p> : null}
            {viewState.error ? <p className="error-text">{viewState.error}</p> : null}
          </section>
          ) : null}

          {showInvites ? (
          <section className="panel panel-inset">
            <h3 className="section-title">Pending Invitations</h3>
            {pendingInvitations.length === 0 ? (
              <p className="meta">No pending invitations for your email.</p>
            ) : (
              <ul className="simple-list">
                {pendingInvitations.map((inv) => {
                  const gameIdMatch = inv.joinApiPath.match(/\/api\/games\/(\d+)\/join$/)
                  const gameId = gameIdMatch ? Number(gameIdMatch[1]) : null
                  return (
                    <li key={`pending-${inv.id}`}>
                      <div>
                        <strong>{inv.email}</strong>
                        <span className="meta inline-meta"> • created {formatDateTime(inv.createdAt)}</span>
                      </div>
                      <div className="meta token-line">Invite path: {inv.frontendInvitePath}</div>
                      <div className="lobby-toolbar">
                        {gameId ? (
                          <button
                            type="button"
                            className="button"
                            onClick={() => void handleJoin(gameId, inv.token)}
                            disabled={joinBusy || !limits.canJoinGame}
                          >
                            {joinBusy ? 'Joining...' : `Join game #${gameId}`}
                          </button>
                        ) : null}
                        {gameId ? (
                          <button
                            type="button"
                            className="button button-secondary"
                            onClick={() => {
                              setJoinGameIdInput(String(gameId))
                              setJoinTokenInput(inv.token)
                            }}
                          >
                            Fill join form
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="button button-secondary"
                          onClick={() => void copyText(inv.frontendInvitePath, 'Invite link')}
                        >
                          Copy link
                        </button>
                        <button
                          type="button"
                          className="button button-secondary"
                          onClick={() => void copyText(inv.token, 'Invite token')}
                        >
                          Copy token
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
          ) : null}

          {showInvites ? (
          <section className="panel panel-inset">
            <h3 className="section-title">Join Private Game (Token)</h3>
            <div className="join-grid">
              <div>
                <label className="field-label" htmlFor="join-game-id">Game ID</label>
                <input id="join-game-id" className="field-input" value={joinGameIdInput} inputMode="numeric" onChange={(e) => setJoinGameIdInput(e.target.value)} />
              </div>
              <div>
                <label className="field-label" htmlFor="join-token">Token</label>
                <input id="join-token" className="field-input" value={joinTokenInput} onChange={(e) => setJoinTokenInput(e.target.value)} />
              </div>
            </div>
            <div className="lobby-toolbar">
              <button type="button" className="button" onClick={() => void handleJoinByTokenForm()} disabled={joinBusy || !limits.canJoinGame}>
                {joinBusy ? 'Joining...' : 'Join private game'}
              </button>
            </div>
            {joinMessage ? <p className="meta">{joinMessage}</p> : null}
          </section>
          ) : null}

          {showPublic ? (
          <section className="panel panel-inset">
            <h3 className="section-title">Public Games</h3>
            {publicGames.length === 0 ? (
              <p className="meta">No joinable public games available right now.</p>
            ) : (
              <ul className="game-list">
                {publicGames.map((game) => (
                  <li key={`public-${game.id}`} className="game-card compact-card">
                    <div className="game-card-row">
                      <strong>Game #{game.id}</strong>
                      <span className="pill pill-open">public</span>
                    </div>
                    <p className="meta">
                      Players {game.playersCount}/{game.maxPlayers} • Board {game.fieldWidth}x{game.fieldHeight}
                    </p>
                    <div className="game-card-actions">
                      <button
                        type="button"
                        className="button"
                        onClick={() => void handleJoin(game.id)}
                        disabled={joinBusy || !limits.canJoinGame}
                      >
                        {joinBusy ? 'Joining...' : 'Join public game'}
                      </button>
                      <button type="button" className="button button-secondary" onClick={() => setSelectedGameId(game.id)}>
                        Inspect
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
          ) : null}

          {showMyGames ? (
          <section className="panel panel-inset">
            <h3 className="section-title">My Games (Playable)</h3>
            {playableGames.length === 0 ? (
              <p className="meta">No playable games yet.</p>
            ) : (
              <ul className="game-list">
                {playableGames.map((game) => {
                  const isSelected = selectedGameId === game.id
                  const isOwner = game.createdByUserId === authState.user.id
                  const busy = actionBusyGameId === game.id
                  return (
                    <li key={`playable-${game.id}`} className={`game-card ${isSelected ? 'is-selected' : ''}`}>
                      <div className="game-card-row">
                        <strong>Game #{game.id}</strong>
                        <span className={`pill ${game.status === 'open' ? 'pill-open' : 'pill-closed'}`}>{game.status}</span>
                      </div>
                      <p className="meta">
                        {game.visibility} • {isOwner ? 'owner' : 'participant'} • Players {game.playersCount}/{game.maxPlayers}
                      </p>
                      <p className="meta">
                        Board {game.fieldWidth}x{game.fieldHeight}{game.randomSize ? ' (random)' : ''} • {formatHoursLeft(game, limits.moveTimeoutSeconds, nowMs)}
                      </p>
                      <div className="game-card-actions">
                        <Link to={`/games/${game.id}`} className="button button-secondary nav-button">Game page</Link>
                        <button type="button" className="button button-secondary" onClick={() => setSelectedGameId(game.id)}>
                          {isSelected ? 'Selected' : 'Details'}
                        </button>
                        <button
                          type="button"
                          className="button button-danger"
                          disabled={busy || game.status !== 'open'}
                          onClick={() => void handleGiveUp(game.id)}
                        >
                          {busy ? 'Working...' : 'Give up'}
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
          ) : null}

          {showMyGames ? (
          <section className="panel panel-inset">
            <h3 className="section-title">Created By Me</h3>
            {createdGames.length === 0 ? (
              <p className="meta">No created games yet.</p>
            ) : (
              <ul className="game-list">
                {createdGames.map((game) => (
                  <li key={`created-${game.id}`} className="game-card compact-card">
                    <div className="game-card-row">
                      <strong>Game #{game.id}</strong>
                      <span className={`pill ${game.status === 'open' ? 'pill-open' : 'pill-closed'}`}>{game.status}</span>
                    </div>
                    <p className="meta">
                      {game.visibility} • Players {game.playersCount}/{game.maxPlayers} • {game.fieldWidth}x{game.fieldHeight}
                    </p>
                    <div className="game-card-actions">
                      <button type="button" className="button button-secondary" onClick={() => setSelectedGameId(game.id)}>
                        Open details
                      </button>
                      <Link to={`/games/${game.id}`} className="button button-secondary nav-button">Game page</Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
          ) : null}
        </section>

        <section className="lobby-column panel panel-inset" aria-label="Selected game details">
          <h3 className="section-title">Selected Game</h3>
          {selectedGameId === null ? <p className="meta">Select a game to inspect it.</p> : null}
          {detailsBusy ? <p className="meta">Loading game details...</p> : null}
          {detailsError ? <p className="error-text">{detailsError}</p> : null}
          {selectedGame ? (
            <>
              <dl className="details-grid">
                <div><dt>ID</dt><dd>{selectedGame.id}</dd></div>
                <div><dt>Owner user ID</dt><dd>{selectedGame.createdByUserId}</dd></div>
                <div><dt>Status</dt><dd>{selectedGame.status}</dd></div>
                <div><dt>Visibility</dt><dd>{selectedGame.visibility}</dd></div>
                <div><dt>Players</dt><dd>{selectedGame.playersCount}/{selectedGame.maxPlayers}</dd></div>
                <div><dt>Board size</dt><dd>{selectedGame.fieldWidth}x{selectedGame.fieldHeight}{selectedGame.randomSize ? ' (random)' : ''}</dd></div>
                <div><dt>Close reason</dt><dd>{selectedGame.closeReason ?? '—'}</dd></div>
                <div><dt>Winner user ID</dt><dd>{selectedGame.winnerUserId ?? '—'}</dd></div>
                <div><dt>Timeout left</dt><dd>{formatHoursLeft(selectedGame, limits.moveTimeoutSeconds, nowMs)}</dd></div>
                <div><dt>Created</dt><dd>{formatDateTime(selectedGame.createdAt)}</dd></div>
                <div><dt>Updated</dt><dd>{formatDateTime(selectedGame.updatedAt)}</dd></div>
                <div><dt>Last move</dt><dd>{formatDateTime(selectedGame.lastMoveAt)}</dd></div>
                <div><dt>Closed at</dt><dd>{formatDateTime(selectedGame.closedAt)}</dd></div>
              </dl>

              <div className="lobby-toolbar">
                <Link to={`/games/${selectedGame.id}`} className="button button-secondary nav-button">
                  Open game page
                </Link>
                <button
                  type="button"
                  className="button button-danger"
                  disabled={actionBusyGameId === selectedGame.id || selectedGame.status !== 'open'}
                  onClick={() => void handleGiveUp(selectedGame.id)}
                >
                  {actionBusyGameId === selectedGame.id ? 'Working...' : 'Give up'}
                </button>
              </div>

              <section className="panel panel-inset">
                <h4 className="section-title">Players</h4>
                {!selectedDetails ? (
                  <p className="meta">Load details to see players.</p>
                ) : selectedDetails.players.length === 0 ? (
                  <p className="meta">No players yet.</p>
                ) : (
                  <ul className="simple-list">
                    {selectedDetails.players.map((p) => (
                      <li key={p.id}>
                        <div>
                          <strong>{p.email}</strong>
                          <span className="meta inline-meta"> • user #{p.userId}</span>
                        </div>
                        <div className="meta">
                          {p.status}
                          {p.gaveUpAt ? ` • gave up ${formatDateTime(p.gaveUpAt)}` : ''} • joined {formatDateTime(p.joinedAt)}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {selectedIsOwner ? (
                <section className="panel panel-inset">
                  <h4 className="section-title">Create Invitation (Owner)</h4>
                  <div className="join-grid">
                    <div>
                      <label className="field-label" htmlFor="invite-email">Invitee email</label>
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
                      onClick={() => void handleCreateInvitation()}
                      disabled={inviteBusy || selectedGame.status !== 'open'}
                    >
                      {inviteBusy ? 'Creating...' : 'Create invitation'}
                    </button>
                  </div>
                  {inviteMessage ? <p className="meta">{inviteMessage}</p> : null}
                </section>
              ) : null}

              <section className="panel panel-inset">
                <h4 className="section-title">Invitations</h4>
                {!selectedDetails ? (
                  <p className="meta">Load details to see invitations.</p>
                ) : displayedInvitations.length === 0 ? (
                  <p className="meta">No invitations.</p>
                ) : (
                  <ul className="simple-list">
                    {displayedInvitations.map((inv) => (
                      <li key={inv.id}>
                        <div>
                          <strong>{inv.email}</strong>
                          <span className="meta inline-meta">
                            {' '}
                            • {inv.acceptedAt ? `Accepted ${formatDateTime(inv.acceptedAt)}` : 'Pending'}
                          </span>
                        </div>
                        <div className="meta token-line">Token: {inv.token}</div>
                        <div className="meta token-line">Frontend invite: {inv.frontendInvitePath}</div>
                        <div className="game-card-actions">
                          <button
                            type="button"
                            className="button button-secondary"
                            onClick={() => void copyText(inv.frontendInvitePath, 'Invite link')}
                          >
                            Copy link
                          </button>
                          <button
                            type="button"
                            className="button button-secondary"
                            onClick={() => void copyText(inv.token, 'Invite token')}
                          >
                            Copy token
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="panel panel-inset">
                <h4 className="section-title">Events</h4>
                {!selectedDetails ? (
                  <p className="meta">Load details to see events.</p>
                ) : selectedDetails.events.length === 0 ? (
                  <p className="meta">No events yet.</p>
                ) : (
                  <ul className="simple-list">
                    {selectedDetails.events.map((event) => (
                      <li key={event.id}>
                        <div>
                          <strong>{event.type}</strong>
                          <span className="meta inline-meta">
                            {' '}
                            • event #{event.id}
                            {event.actorUserId !== null ? ` • actor user #${event.actorUserId}` : ''}
                          </span>
                        </div>
                        <div className="meta">{formatDateTime(event.createdAt)}</div>
                        <pre className="event-payload">{JSON.stringify(event.payload, null, 2)}</pre>
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
      {renderContent()}
      {joinModalOpen ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setJoinModalOpen(false)}>
          <div
            className="modal-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="invite-join-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="page-title-row">
              <h3 id="invite-join-title" className="section-title">Join by Invite</h3>
              <button type="button" className="button button-secondary" onClick={() => setJoinModalOpen(false)}>
                Close
              </button>
            </div>
            <p className="meta">
              Paste a full invite link like <code>/invite/game/123?token=...</code> or paste a token only.
            </p>
            <label className="field-label" htmlFor="invite-paste-input">Invite link or token</label>
            <textarea
              id="invite-paste-input"
              className="field-input modal-textarea"
              value={invitePasteInput}
              onChange={(e) => setInvitePasteInput(e.target.value)}
              placeholder="https://gridgame.online/invite/game/123?token=..."
              rows={3}
            />
            <div className="join-grid">
              <div>
                <label className="field-label" htmlFor="modal-join-game-id">Game ID</label>
                <input
                  id="modal-join-game-id"
                  className="field-input"
                  value={joinGameIdInput}
                  onChange={(e) => setJoinGameIdInput(e.target.value)}
                  inputMode="numeric"
                />
              </div>
              <div>
                <label className="field-label" htmlFor="modal-join-token">Token</label>
                <input
                  id="modal-join-token"
                  className="field-input"
                  value={joinTokenInput}
                  onChange={(e) => setJoinTokenInput(e.target.value)}
                />
              </div>
            </div>
            <div className="lobby-toolbar">
              <button type="button" className="button button-secondary" onClick={() => void handleJoinFromInviteInput()}>
                Parse invite
              </button>
              <button
                type="button"
                className="button"
                onClick={() => void handleJoinByTokenForm()}
                disabled={joinBusy}
              >
                {joinBusy ? 'Joining...' : 'Join game'}
              </button>
            </div>
            {joinMessage ? <p className="meta">{joinMessage}</p> : null}
          </div>
        </div>
      ) : null}
    </section>
  )
}
