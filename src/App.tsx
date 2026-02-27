import { useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, Route, Routes, useParams } from 'react-router-dom'
import { GamesLobby } from './features/games/GamesLobby'
import { AuthHeader } from './features/auth/AuthHeader'
import { fetchRealtimeToken, type AuthState } from './features/auth/authApi'
import { useAuthSession } from './features/auth/useAuthSession'
import {
  getGameDetails,
  getGameStateLongPoll,
  moveGame,
  type Game,
  type GameDetails,
  type GamePlayer,
  type GameState,
} from './features/games/gamesApi'
import { PhoenixGameSocket } from './net/ws'
import { HealthStatus } from './features/health/HealthStatus'
import { RealtimeTransportStatus } from './features/realtime/realtimeStatus'
import { publishRealtimeStatus } from './features/realtime/realtimeBus'
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
}

function ProfilePage({ authState, authBusy, onTierUpgrade }: ProfilePageProps) {
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
      </div>
      {message ? <p className="meta">{message}</p> : null}
    </section>
  )
}

function GamesPage({ authState }: PageProps) {
  usePageTitle('Games')
  return <GamesLobby authState={authState} />
}

type Coord = { x: number; y: number }
type GameAction = 'move' | 'buy'
type MoveValidation =
  | { ok: true; action: GameAction }
  | { ok: false; reason: string }
type RealtimeGamePayload = {
  game: Partial<Game>
  state: GameState | null
  players: Array<{
    userId: number
    email: string
    status: 'active' | 'gave_up'
    positionX: number | null
    positionY: number | null
    capturedCellsCount: number
    gameScore: number
  }>
}

const PLAYER_COLORS = ['#0ea5e9', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#14b8a6']

function formatDateTime(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function getPlayerColor(userId: number | null, orderedUserIds: number[]): string {
  if (userId === null) return '#cbd5e1'
  const index = orderedUserIds.indexOf(userId)
  return PLAYER_COLORS[(index >= 0 ? index : 0) % PLAYER_COLORS.length]
}

function getPlayerName(userId: number | null, players: GamePlayer[], myUserId: number): string {
  if (userId === null) return '—'
  if (userId === myUserId) return 'You'
  const player = players.find((p) => p.userId === userId)
  return player ? player.email : `user #${userId}`
}

function buildStateSnapshotKey(
  game: Game,
  state: GameState | null,
  players: GamePlayer[],
): string {
  const playersKey = players
    .map((p) => `${p.userId}:${p.status}:${p.positionX ?? 'n'}:${p.positionY ?? 'n'}:${p.capturedCellsCount}:${p.gameScore}`)
    .join('|')
  const cellsKey = state ? state.cells.map((row) => row.join(',')).join(';') : 'no-state'
  return [
    game.id,
    game.updatedAt,
    game.playState,
    game.turnNumber,
    game.currentTurnUserId ?? 'n',
    game.pointsAtStake,
    state?.turnNumber ?? 'n',
    state?.playState ?? 'n',
    state?.currentTurnUserId ?? 'n',
    cellsKey,
    playersKey,
  ].join('~')
}

function isSameCoord(a: Coord | null, b: Coord | null): boolean {
  if (!a || !b) return false
  return a.x === b.x && a.y === b.y
}

function parseRealtimePayload(payload: unknown): RealtimeGamePayload | null {
  if (!payload || typeof payload !== 'object') return null
  const p = payload as {
    game?: unknown
    state?: unknown
    players?: unknown
  }
  if (!p.game || typeof p.game !== 'object') return null
  const game = p.game as Partial<Game>

  let state: GameState | null = null
  if (p.state && typeof p.state === 'object') {
    const s = p.state as {
      width?: unknown
      height?: unknown
      cells?: unknown
      currentTurnUserId?: unknown
      turnNumber?: unknown
      playState?: unknown
    }
    if (Array.isArray(s.cells)) {
      state = {
        width: Number(s.width ?? 0),
        height: Number(s.height ?? 0),
        cells: s.cells.map((row) => (Array.isArray(row) ? row.map((c) => Number(c)) : [])),
        currentTurnUserId:
          s.currentTurnUserId === null || s.currentTurnUserId === undefined
            ? null
            : Number(s.currentTurnUserId),
        turnNumber: Number(s.turnNumber ?? 0),
        playState: (s.playState as GameState['playState']) ?? 'lobby',
      }
    }
  }

  const playersRaw = Array.isArray(p.players) ? p.players : []
  const players = playersRaw
    .filter((row) => row && typeof row === 'object')
    .map((row) => {
      const pr = row as {
        userId?: unknown
        email?: unknown
        status?: unknown
        positionX?: unknown
        positionY?: unknown
        capturedCellsCount?: unknown
        gameScore?: unknown
      }
      const parsedStatus: 'active' | 'gave_up' = pr.status === 'gave_up' ? 'gave_up' : 'active'
      return {
        userId: Number(pr.userId),
        email: String(pr.email ?? ''),
        status: parsedStatus,
        positionX: pr.positionX === null || pr.positionX === undefined ? null : Number(pr.positionX),
        positionY: pr.positionY === null || pr.positionY === undefined ? null : Number(pr.positionY),
        capturedCellsCount: Number(pr.capturedCellsCount ?? 0),
        gameScore: Number(pr.gameScore ?? 0),
      }
    })
    .filter((player) => Number.isInteger(player.userId) && player.email !== '')

  return { game, state, players }
}

function resolveWsBaseUrl(): string {
  const envUrl = String(import.meta.env.VITE_WS_BASE_URL ?? '').trim()
  if (envUrl) return envUrl

  if (typeof window !== 'undefined') {
    const host = window.location.hostname.toLowerCase()
    if (host === 'localhost' || host === '127.0.0.1') {
      return 'ws://localhost:4000/socket/websocket'
    }
  }

  return 'wss://api.gridgame.online/socket/websocket'
}

function validateMoveTarget(
  target: Coord,
  state: GameState | null,
  players: GamePlayer[],
  myUserId: number,
): MoveValidation {
  if (!state) return { ok: false, reason: 'Game state is not available yet.' }
  if (state.playState !== 'active') return { ok: false, reason: `Game is ${state.playState}.` }
  if (state.currentTurnUserId !== myUserId) return { ok: false, reason: 'It is not your turn.' }

  if (target.x < 0 || target.y < 0 || target.x >= state.width || target.y >= state.height) {
    return { ok: false, reason: 'Target is out of bounds.' }
  }

  const myPlayer = players.find((p) => p.userId === myUserId)
  if (!myPlayer || myPlayer.positionX === null || myPlayer.positionY === null) {
    return { ok: false, reason: 'Your player position is not available.' }
  }

  const dx = target.x - myPlayer.positionX
  const dy = target.y - myPlayer.positionY
  const distance = Math.abs(dx) + Math.abs(dy)
  if (distance === 0) return { ok: true, action: 'buy' }
  if (distance !== 1) return { ok: false, reason: 'Move must be exactly 1 cell.' }
  if (Math.abs(dx) === 1 && Math.abs(dy) === 1) return { ok: false, reason: 'Diagonal moves are not allowed.' }

  const occupied = players.some(
    (p) =>
      p.status === 'active' &&
      p.userId !== myUserId &&
      p.positionX === target.x &&
      p.positionY === target.y,
  )
  if (occupied) return { ok: false, reason: 'Target cell is occupied by another active player.' }

  return { ok: true, action: 'move' }
}

function GameBoardPage({ authState }: PageProps) {
  const params = useParams<{ id: string }>()
  const gameId = params.id ?? '—'
  usePageTitle(`Game #${gameId}`)
  const [details, setDetails] = useState<GameDetails | null>(null)
  const [gameState, setGameState] = useState<GameState | null>(null)
  const [liveGame, setLiveGame] = useState<Game | null>(null)
  const [livePlayers, setLivePlayers] = useState<GamePlayer[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingState, setLoadingState] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [moveError, setMoveError] = useState<string | null>(null)
  const [moveNotice, setMoveNotice] = useState<string | null>(null)
  const [moveBusy, setMoveBusy] = useState(false)
  const [selectedCell, setSelectedCell] = useState<Coord | null>(null)
  const [pollNonce, setPollNonce] = useState(0)
  const lastSnapshotKeyRef = useRef<string | null>(null)
  const gameStateCursorRef = useRef<string | null>(null)
  const wsClientRef = useRef<PhoenixGameSocket | null>(null)
  const [wsConnected, setWsConnected] = useState(false)
  const [wsTransportState, setWsTransportState] = useState<'idle' | 'connecting' | 'connected' | 'disconnected'>('idle')
  const liveGameRef = useRef<Game | null>(null)
  const livePlayersRef = useRef<GamePlayer[] | null>(null)
  const gameStateRef = useRef<GameState | null>(null)
  const detailsRef = useRef<GameDetails | null>(null)

  useEffect(() => {
    liveGameRef.current = liveGame
    livePlayersRef.current = livePlayers
    gameStateRef.current = gameState
    detailsRef.current = details
  }, [liveGame, livePlayers, gameState, details])

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
        if (active) {
          setDetails(data)
          setLiveGame(data.game)
          setLivePlayers(data.players)
          setGameState(data.state)
          lastSnapshotKeyRef.current = buildStateSnapshotKey(data.game, data.state, data.players)
        }
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

  useEffect(() => {
    if (authState?.kind !== 'authed') return
    const numericId = Number(gameId)
    if (!Number.isInteger(numericId) || numericId < 1) return
    const controller = new AbortController()
    let active = true

    const connectWs = async () => {
      try {
        setWsTransportState('connecting')
        const token = await fetchRealtimeToken(controller.signal)
        if (!active) return

        const url = new URL(resolveWsBaseUrl())
        url.searchParams.set('vsn', '2.0.0')
        url.searchParams.set('token', token)

        const client = new PhoenixGameSocket({
          url: url.toString(),
          topic: `game:${numericId}`,
          onStatusChange: (status) => {
            setWsConnected(status === 'connected')
            if (status === 'connecting') {
              setWsTransportState('connecting')
              publishRealtimeStatus('ws-connecting')
            } else if (status === 'connected') {
              setWsTransportState('connected')
              publishRealtimeStatus('ws-connected')
            } else {
              setWsTransportState('disconnected')
              publishRealtimeStatus('polling-fallback', 'WebSocket disconnected, using long poll.')
            }
          },
          onEvent: (event, payload) => {
            if (event === 'state_snapshot' || event === 'state_updated') {
              const parsed = parseRealtimePayload(payload)
              const baseGame = liveGameRef.current ?? detailsRef.current?.game ?? null
              if (!parsed || !baseGame) return
              const nextGame: Game = {
                ...baseGame,
                ...parsed.game,
              }
              const nextPlayers: GamePlayer[] =
                parsed.players.length > 0
                  ? parsed.players.map((player) => {
                      const fallback =
                        livePlayersRef.current?.find((p) => p.userId === player.userId) ??
                        detailsRef.current?.players.find((p) => p.userId === player.userId)
                      return {
                        id: fallback?.id ?? player.userId,
                        userId: player.userId,
                        email: player.email,
                        joinedAt: fallback?.joinedAt ?? '',
                        status: player.status,
                        gaveUpAt: fallback?.gaveUpAt ?? null,
                        positionX: player.positionX,
                        positionY: player.positionY,
                        capturedCellsCount: player.capturedCellsCount,
                        gameScore: player.gameScore,
                      }
                    })
                  : livePlayersRef.current ?? detailsRef.current?.players ?? []
              const nextState = parsed.state ?? gameStateRef.current ?? detailsRef.current?.state ?? null
              const nextKey = buildStateSnapshotKey(nextGame, nextState, nextPlayers)
              if (nextKey !== lastSnapshotKeyRef.current) {
                lastSnapshotKeyRef.current = nextKey
                setLiveGame(nextGame)
                setGameState(nextState)
                setLivePlayers(nextPlayers)
                setDetails((prev) =>
                  prev
                    ? {
                        ...prev,
                        game: nextGame,
                        state: nextState,
                        players: nextPlayers,
                      }
                    : prev,
                )
              }
              setMoveBusy(false)
              return
            }

            if (event === 'move_applied') {
              setMoveBusy(false)
              if (payload && typeof payload === 'object') {
                const p = payload as { income?: unknown; captured?: unknown }
                const income = Number.isFinite(Number(p.income)) ? Number(p.income) : null
                const captured = p.captured === true
                if (income !== null) {
                  setMoveNotice(`Action applied${captured ? ' • captured' : ''} • income +${income}`)
                  return
                }
              }
              setMoveNotice('Action applied.')
              return
            }

            if (event === 'error') {
              const msg =
                payload && typeof payload === 'object' && 'message' in payload
                  ? String((payload as { message?: unknown }).message ?? 'WebSocket error')
                  : 'WebSocket error'
              setMoveError(msg)
            }
          },
        })

        wsClientRef.current = client
        client.connect()
      } catch {
        setWsConnected(false)
        setWsTransportState('disconnected')
        publishRealtimeStatus('polling-fallback', 'WebSocket unavailable, using long poll.')
      }
    }

    void connectWs()

    return () => {
      active = false
      controller.abort()
      if (wsClientRef.current) {
        wsClientRef.current.disconnect()
      }
      wsClientRef.current = null
      setWsConnected(false)
      setWsTransportState('idle')
      publishRealtimeStatus('idle')
    }
  }, [authState, gameId])

  useEffect(() => {
    if (wsConnected || wsTransportState !== 'disconnected') return
    if (authState?.kind !== 'authed') return
    const numericId = Number(gameId)
    if (!Number.isInteger(numericId) || numericId < 1) return
    const controller = new AbortController()
    let active = true
    let firstResponsePending = lastSnapshotKeyRef.current === null
    setLoadingState(firstResponsePending)
    publishRealtimeStatus('polling-fallback', 'Listening for board updates over long poll.')

    const delay = (ms: number) =>
      new Promise<void>((resolve) => {
        window.setTimeout(resolve, ms)
      })

    const run = async () => {
      while (active && !controller.signal.aborted) {
        try {
          const cycle = await getGameStateLongPoll(
            numericId,
            gameStateCursorRef.current,
            controller.signal,
          )
          if (!active) return
          gameStateCursorRef.current = cycle.cursor ?? gameStateCursorRef.current
          if (cycle.timedOut) continue
          const nextGame = cycle.data.game
          const nextState = cycle.data.state
          const nextPlayers = cycle.data.players
          const nextKey = buildStateSnapshotKey(nextGame, nextState, nextPlayers)
          if (lastSnapshotKeyRef.current !== nextKey) {
            lastSnapshotKeyRef.current = nextKey
            setLiveGame(nextGame)
            setGameState(nextState)
            setLivePlayers(nextPlayers)
            setDetails((prev) =>
              prev
                ? {
                    ...prev,
                    game: nextGame,
                    state: nextState,
                    players: nextPlayers,
                  }
                : prev,
            )
          }
          setError(null)
          if (firstResponsePending) {
            firstResponsePending = false
            setLoadingState(false)
          }
        } catch (e) {
          if (e instanceof DOMException && e.name === 'AbortError') return
          if (!active) return
          setError(e instanceof Error ? e.message : 'Failed to load game state')
          if (firstResponsePending) {
            firstResponsePending = false
            setLoadingState(false)
          }
          await delay(1500)
        }
      }
    }

    void run()
    return () => {
      active = false
      controller.abort()
    }
  }, [authState, gameId, pollNonce, wsConnected, wsTransportState])

  useEffect(() => {
    setSelectedCell(null)
    setMoveError(null)
    setMoveNotice(null)
    gameStateCursorRef.current = null
    lastSnapshotKeyRef.current = null
    wsClientRef.current?.requestState()
  }, [gameId])

  if (authState?.kind !== 'authed') {
    return (
      <section className="page-panel">
        <h1>Game #{gameId}</h1>
        <p>Please authenticate first to open a game page.</p>
      </section>
    )
  }

  const game = liveGame ?? details?.game ?? null
  const players = livePlayers ?? details?.players ?? []
  const state = gameState ?? details?.state ?? null
  const myUserId = authState.user.id
  const myPlayer = players.find((p) => p.userId === myUserId) ?? null
  const orderedUserIds = players.map((p) => p.userId)

  const cellOwnerMatrix = state?.cells ?? null
  const boardWidth = state?.width ?? game?.fieldWidth ?? 4
  const boardHeight = state?.height ?? game?.fieldHeight ?? 4

  const selectedValidation =
    selectedCell && state ? validateMoveTarget(selectedCell, state, players, myUserId) : null
  const myPosition =
    myPlayer && myPlayer.positionX !== null && myPlayer.positionY !== null
      ? { x: myPlayer.positionX, y: myPlayer.positionY }
      : null

  const adjacentTargets = useMemo(() => {
    if (!state || !myPosition || state.currentTurnUserId !== myUserId || state.playState !== 'active') return new Set<string>()
    const targets = [
      { x: myPosition.x + 1, y: myPosition.y },
      { x: myPosition.x - 1, y: myPosition.y },
      { x: myPosition.x, y: myPosition.y + 1 },
      { x: myPosition.x, y: myPosition.y - 1 },
    ]
    const set = new Set<string>()
    for (const t of targets) {
      if (validateMoveTarget(t, state, players, myUserId).ok) set.add(`${t.x}:${t.y}`)
    }
    return set
  }, [state, myPosition, players, myUserId])

  const legalMoves = useMemo(() => {
    const result: Coord[] = []
    adjacentTargets.forEach((key) => {
      const [xStr, yStr] = key.split(':')
      result.push({ x: Number(xStr), y: Number(yStr) })
    })
    return result.sort((a, b) => a.y - b.y || a.x - b.x)
  }, [adjacentTargets])

  const sortedPlayers = useMemo(() => {
    return [...players].sort((a, b) => {
      const aTurn = state?.currentTurnUserId === a.userId ? 1 : 0
      const bTurn = state?.currentTurnUserId === b.userId ? 1 : 0
      if (aTurn !== bTurn) return bTurn - aTurn
      if (a.status !== b.status) return a.status === 'active' ? -1 : 1
      if (a.gameScore !== b.gameScore) return b.gameScore - a.gameScore
      return a.id - b.id
    })
  }, [players, state?.currentTurnUserId])

  const ownershipStats = useMemo(() => {
    if (!state) return null
    const totals = new Map<number, number>()
    let ownedCells = 0
    for (const row of state.cells) {
      for (const owner of row) {
        if (owner > 0) {
          ownedCells += 1
          totals.set(owner, (totals.get(owner) ?? 0) + 1)
        }
      }
    }
    return { totalCells: state.width * state.height, ownedCells, totals }
  }, [state])

  const handleMove = async (target: Coord) => {
    const numericId = Number(gameId)
    if (!Number.isInteger(numericId) || numericId < 1) return
    const validation = validateMoveTarget(target, state, players, myUserId)
    setSelectedCell(target)
    setMoveNotice(null)
    if (!validation.ok) {
      setMoveError(validation.reason)
      return
    }

    if (wsConnected && wsClientRef.current?.isConnected()) {
      setMoveBusy(true)
      setMoveError(null)
      const sent = wsClientRef.current.sendMove(
        target.x,
        target.y,
        validation.action === 'buy',
      )
      if (!sent) {
        setMoveBusy(false)
        setMoveError('Failed to send move over WebSocket')
        return
      }
      setMoveNotice(
        validation.action === 'buy'
          ? `Buy request sent at (${target.x}, ${target.y})`
          : `Move sent to (${target.x}, ${target.y})`,
      )
      return
    }

    setMoveBusy(true)
    setMoveError(null)
    try {
      const result = await moveGame(numericId, {
        x: target.x,
        y: target.y,
        buyCell: validation.action === 'buy',
      })
      setLiveGame(result.game)
      setGameState(result.state)
      setLivePlayers(result.players)
      setDetails((prev) =>
        prev
          ? {
              ...prev,
              game: result.game,
              state: result.state,
              players: result.players,
            }
          : prev,
      )
      setMoveNotice(
        `${validation.action === 'buy' ? 'Buy' : 'Move'} to (${result.move.to.x}, ${result.move.to.y}) • ${
          result.move.captured ? 'captured cell' : 'already yours'
        } • income +${result.move.income}`,
      )
      setPollNonce((v) => v + 1)
    } catch (e) {
      setMoveError(e instanceof Error ? e.message : 'Move failed')
    } finally {
      setMoveBusy(false)
    }
  }

  return (
    <section className="page-panel">
      <div className="page-title-row">
        <h1>Game #{gameId}</h1>
        <NavLink className="button button-secondary nav-button" to="/games">
          Back to Games
        </NavLink>
      </div>
      <p className="meta compact-intro">Double-click an adjacent cell to move and capture it.</p>

      {loading ? <p className="meta">Loading game details...</p> : null}
      {loadingState ? <p className="meta">Loading board state...</p> : null}
      {error ? <p className="error-text">{error}</p> : null}
      {game ? (
        <div className="game-top-stats">
          <span className="mini-stat">{game.visibility}</span>
          <span className="mini-stat">
            {game.playersCount}/{game.maxPlayers} players
          </span>
          <span className="mini-stat">
            {boardWidth}x{boardHeight}
            {game.randomSize ? ' random' : ''}
          </span>
          <span className="mini-stat">state: {game.playState}</span>
          <span className="mini-stat">turn #{game.turnNumber}</span>
          <span className="mini-stat">stake {game.pointsAtStake}</span>
        </div>
      ) : null}

      {game && players.length > 0 ? (
        <>
          <div className="game-board-layout">
            <section
              className={`panel panel-inset game-board-panel${
                state?.currentTurnUserId === myUserId && state.playState === 'active' ? ' is-your-turn' : ''
              }`}
              tabIndex={0}
            >
              <div className="game-board-toolbar">
                <div className="turn-badge">
                  {state?.playState === 'active'
                    ? state.currentTurnUserId === myUserId
                      ? 'Your turn'
                      : `Turn: ${getPlayerName(state.currentTurnUserId, players, myUserId)}`
                    : `Game ${state?.playState ?? game.playState}`}
                </div>
                <div className="meta compact-meta">
                  Turn #{state?.turnNumber ?? game.turnNumber} • Started {formatDateTime(game.startedAt ?? null)}
                </div>
              </div>

              <div className="board-legend">
                {sortedPlayers.map((player) => {
                  const color = getPlayerColor(player.userId, orderedUserIds)
                  const isMe = player.userId === myUserId
                  const isTurn =
                    state?.currentTurnUserId === player.userId && state.playState === 'active'
                  const owned = ownershipStats?.totals.get(player.userId) ?? player.capturedCellsCount
                  const pct = ownershipStats
                    ? Math.round((owned / Math.max(1, ownershipStats.totalCells)) * 100)
                    : null
                  return (
                    <div
                      key={`legend-${player.id}`}
                      className={`legend-pill${isTurn ? ' is-turn' : ''}${isMe ? ' is-me' : ''}`}
                      style={{ ['--legend-color' as string]: color }}
                    >
                      <span className="legend-dot" />
                      <span className="legend-name">{isMe ? 'You' : player.email}</span>
                      <span className="legend-meta">
                        #{player.userId} • {owned} cells{pct !== null ? ` (${pct}%)` : ''} • {player.gameScore} pts
                      </span>
                    </div>
                  )
                })}
              </div>

              {!state ? (
                <div className="game-lobby-preview">
                  <div className="meta">
                    Waiting for game start. Board will become interactive when all players join and backend auto-starts the match.
                  </div>
                  <div
                    className="game-grid-board is-preview"
                    style={{ gridTemplateColumns: `repeat(${boardWidth}, minmax(0, 1fr))` }}
                    aria-label="Board preview"
                  >
                    {Array.from({ length: boardWidth * boardHeight }, (_, i) => (
                      <div key={`preview-${i}`} className="grid-cell-btn preview-cell" aria-hidden="true" />
                    ))}
                  </div>
                </div>
              ) : null}

              {state ? (
              <div
                className="game-grid-board"
                style={{ gridTemplateColumns: `repeat(${boardWidth}, minmax(0, 1fr))` }}
                aria-label="Game board"
              >
                {Array.from({ length: boardWidth * boardHeight }, (_, index) => {
                  const x = index % boardWidth
                  const y = Math.floor(index / boardWidth)
                  const ownerUserId = cellOwnerMatrix?.[y]?.[x] ?? 0
                  const ownerColor = ownerUserId > 0 ? getPlayerColor(ownerUserId, orderedUserIds) : '#e2e8f0'
                  const occupants = players.filter(
                    (p) => p.positionX === x && p.positionY === y && p.status === 'active',
                  )
                  const isMyCell = ownerUserId === myUserId
                  const isSelected = selectedCell?.x === x && selectedCell?.y === y
                  const isMyPos = myPosition?.x === x && myPosition?.y === y
                  const isAdjacentValid = adjacentTargets.has(`${x}:${y}`)
                  const isBuyTarget = isMyPos && state?.currentTurnUserId === myUserId && state.playState === 'active'
                  const isPathFrom = isSameCoord(myPosition, myPosition) && !!selectedCell && myPosition?.x === x && myPosition?.y === y
                  const showPath =
                    myPosition &&
                    selectedCell &&
                    Math.abs(selectedCell.x - myPosition.x) + Math.abs(selectedCell.y - myPosition.y) === 1
                  const pathDirection =
                    showPath && myPosition.x === x && myPosition.y === y
                      ? selectedCell.x > x
                        ? 'right'
                        : selectedCell.x < x
                          ? 'left'
                          : selectedCell.y > y
                            ? 'down'
                            : 'up'
                      : null
                  const ownerName = ownerUserId > 0 ? getPlayerName(ownerUserId, players, myUserId) : 'unclaimed'
                  const occupantNames = occupants.map((p) => (p.userId === myUserId ? 'You' : p.email)).join(', ')
                  const cellLabel = `Cell ${x},${y} • owner: ${ownerName}${occupantNames ? ` • players: ${occupantNames}` : ''}`
                  return (
                    <button
                      key={`${x}:${y}`}
                      type="button"
                      className={`grid-cell-btn${ownerUserId > 0 ? ' is-owned' : ''}${isMyCell ? ' is-owned-self' : ''}${
                        isSelected ? ' is-selected' : ''
                      }${isMyPos ? ' is-my-position' : ''}${isAdjacentValid ? ' is-valid-target' : ''}${
                        isBuyTarget ? ' is-buy-target' : ''
                      }`}
                      style={{ ['--cell-owner-color' as string]: ownerColor }}
                      title={cellLabel}
                      onClick={() => {
                        setSelectedCell({ x, y })
                        setMoveError(null)
                      }}
                      onDoubleClick={() => void handleMove({ x, y })}
                      disabled={moveBusy}
                    >
                      <span className="grid-cell-coords">{x},{y}</span>
                      {showPath && pathDirection && isPathFrom ? (
                        <span className={`cell-path-segment dir-${pathDirection}`} aria-hidden="true" />
                      ) : null}
                      {occupants.length > 0 ? (
                        <span className="grid-cell-occupants">
                          {occupants.map((p) => (
                            <span
                              key={`occ-${p.id}`}
                              className={`grid-token${p.userId === myUserId ? ' is-me' : ''}`}
                              style={{ ['--token-color' as string]: getPlayerColor(p.userId, orderedUserIds) }}
                              title={`${p.email} (${p.gameScore} pts)`}
                            >
                              {p.email.slice(0, 1).toUpperCase()}
                            </span>
                          ))}
                        </span>
                      ) : null}
                    </button>
                  )
                })}
              </div>
              ) : null}

              <div className="game-board-actions">
                <button
                  type="button"
                  className="button"
                  disabled={moveBusy || !selectedCell || !selectedValidation?.ok}
                  onClick={() => (selectedCell ? void handleMove(selectedCell) : undefined)}
                >
                  {moveBusy
                    ? 'Working...'
                    : selectedCell
                      ? selectedValidation?.ok && selectedValidation.action === 'buy'
                        ? `Buy at ${selectedCell.x},${selectedCell.y}`
                        : `Move to ${selectedCell.x},${selectedCell.y}`
                      : 'Select a cell'}
                </button>
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={!selectedCell || moveBusy}
                  onClick={() => {
                    setSelectedCell(null)
                    setMoveError(null)
                  }}
                >
                  Clear selection
                </button>
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={loadingState}
                  onClick={() => {
                    if (wsConnected && wsClientRef.current?.isConnected()) {
                      wsClientRef.current.requestState()
                    } else {
                      setPollNonce((v) => v + 1)
                    }
                  }}
                >
                  Refresh state
                </button>
                {legalMoves.map((move) => (
                  <button
                    key={`quick-move-${move.x}-${move.y}`}
                    type="button"
                    className="button button-secondary"
                    disabled={moveBusy || !state || state.playState !== 'active'}
                    onClick={() => void handleMove(move)}
                    title="Quick move"
                  >
                    ↦ {move.x},{move.y}
                  </button>
                ))}
                {myPosition && state?.currentTurnUserId === myUserId && state.playState === 'active' ? (
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={moveBusy}
                    onClick={() => void handleMove(myPosition)}
                  >
                    Buy current cell
                  </button>
                ) : null}
              </div>

              {selectedCell ? (
                <p className={`meta${selectedValidation?.ok ? '' : ' error-text'}`}>
                  Selected: ({selectedCell.x}, {selectedCell.y})
                  {selectedValidation?.ok
                    ? selectedValidation.action === 'buy'
                      ? ' • buy action'
                      : ' • valid move target'
                    : selectedValidation
                      ? ` • ${selectedValidation.reason}`
                      : ''}
                </p>
              ) : (
                <p className="meta">Tip: single-click selects, double-click attempts move immediately.</p>
              )}
              {moveError ? <p className="error-text">{moveError}</p> : null}
              {moveNotice ? <p className="meta">{moveNotice}</p> : null}
              {game.closeReason || game.winnerUserId !== null ? (
                <p className="meta">
                  {game.winnerUserId !== null ? `Winner: ${getPlayerName(game.winnerUserId, players, myUserId)} • ` : ''}
                  Close reason: {game.closeReason ?? '—'}
                </p>
              ) : null}
            </section>

            <section className="panel panel-inset">
              <h2 className="section-title">Live Players</h2>
              {ownershipStats ? (
                <p className="meta">
                  Board control: {ownershipStats.ownedCells}/{ownershipStats.totalCells} cells captured
                </p>
              ) : null}
              <ul className="simple-list">
                {sortedPlayers.map((player) => {
                  const isTurn =
                    state?.currentTurnUserId === player.userId && state.playState === 'active'
                  return (
                    <li key={`live-player-${player.id}`}>
                      <div className="game-card-row">
                        <strong>{player.userId === myUserId ? 'You' : player.email}</strong>
                        <span className={`pill ${player.status === 'active' ? 'pill-open' : 'pill-closed'}`}>
                          {player.status}
                        </span>
                      </div>
                      <div className="meta">
                        user #{player.userId} • pos {player.positionX ?? '—'},{player.positionY ?? '—'}
                        {isTurn ? ' • current turn' : ''}
                      </div>
                      <div className="meta">
                        Captured: {player.capturedCellsCount} • Game score: {player.gameScore}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </section>
          </div>
        </>
      ) : null}

      {details ? (
        <div className="page-subgrid compact-bottom-panels">
          <details className="panel panel-inset collapsible-panel">
            <summary className="collapsible-summary">
              <span className="section-title">Players (raw details)</span>
            </summary>
            <div className="collapsible-body">
            <h2 className="section-title">Players</h2>
            {details.players.length === 0 ? (
              <p className="meta">No players yet.</p>
            ) : (
              <ul className="simple-list">
                {details.players.map((player) => (
                  <li key={player.id}>
                    <strong>{player.email}</strong>
                    <div className="meta">
                      user #{player.userId} • {player.status} • pos {player.positionX ?? '—'},{player.positionY ?? '—'}
                      {' • '}captured {player.capturedCellsCount} • score {player.gameScore}
                      {player.gaveUpAt ? ` • gave up ${new Date(player.gaveUpAt).toLocaleString()}` : ''}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            </div>
          </details>
          <details className="panel panel-inset collapsible-panel">
            <summary className="collapsible-summary">
              <span className="section-title">Events</span>
            </summary>
            <div className="collapsible-body">
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
            </div>
          </details>
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

          <div className="footer-status">
            <HealthStatus compact />
          </div>
          <div className="footer-status">
            <RealtimeTransportStatus compact />
          </div>
        </div>
      </footer>
    </div>
  )
}

export default function App() {
  return <AppLayout />
}
