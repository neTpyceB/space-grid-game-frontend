import type { AuthUser } from '../auth/authApi'
import { apiUrl } from '../../net/apiBase'

type SyncUserRaw = {
  id?: unknown
  email?: unknown
  score?: unknown
  tierLevel?: unknown
  scoreWalletMax?: unknown
  nextTierUpgradeCost?: unknown
}

type SyncLightGameRaw = {
  id?: unknown
  status?: unknown
  playState?: unknown
  visibility?: unknown
  currentTurnUserId?: unknown
  updatedAt?: unknown
}

type SyncCurrentGamePlayerRaw = {
  userId?: unknown
  email?: unknown
  status?: unknown
  positionX?: unknown
  positionY?: unknown
  capturedCellsCount?: unknown
  gameScore?: unknown
}

type SyncCurrentGameRaw = {
  id?: unknown
  status?: unknown
  playState?: unknown
  currentTurnUserId?: unknown
  turnNumber?: unknown
  state?: unknown
  players?: unknown
}

type SyncResponseRaw = {
  authenticated?: unknown
  user?: unknown
  pendingInvitationsCount?: unknown
  games?: unknown
  currentGame?: unknown
  cursor?: unknown
  timeout?: unknown
}

export type SyncLightGame = {
  id: number
  status: 'open' | 'closed'
  playState: 'lobby' | 'active' | 'closed'
  visibility: 'private' | 'public'
  currentTurnUserId: number | null
  updatedAt: string
}

export type SyncCurrentGameState = {
  width: number
  height: number
  cells: number[][]
}

export type SyncCurrentGamePlayer = {
  userId: number
  email: string
  status: 'active' | 'gave_up'
  positionX: number | null
  positionY: number | null
  capturedCellsCount: number
  gameScore: number
}

export type SyncCurrentGame = {
  id: number
  status: 'open' | 'closed'
  playState: 'lobby' | 'active' | 'closed'
  currentTurnUserId: number | null
  turnNumber: number
  state: SyncCurrentGameState | null
  players: SyncCurrentGamePlayer[]
}

export type SyncLongPollCycle = {
  authenticated: boolean
  user: AuthUser | null
  pendingInvitationsCount: number
  games: SyncLightGame[]
  currentGame: SyncCurrentGame | null
  cursor: string | null
  timedOut: boolean
}

function asInt(value: unknown, label: string): number {
  const n = Number(value)
  if (!Number.isInteger(n)) throw new Error(`Invalid ${label}`)
  return n
}

function asString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`Invalid ${label}`)
  return value
}

function parseUser(value: SyncUserRaw | null): AuthUser | null {
  if (!value) return null
  if (
    typeof value.id !== 'number' ||
    typeof value.email !== 'string' ||
    typeof value.score !== 'number' ||
    typeof value.tierLevel !== 'number' ||
    typeof value.scoreWalletMax !== 'number'
  ) {
    return null
  }
  if (value.nextTierUpgradeCost !== null && typeof value.nextTierUpgradeCost !== 'number') {
    return null
  }
  return {
    id: value.id,
    email: value.email,
    score: value.score,
    tierLevel: value.tierLevel,
    scoreWalletMax: value.scoreWalletMax,
    nextTierUpgradeCost: value.nextTierUpgradeCost,
  }
}

function parsePlayState(value: unknown, label: string): 'lobby' | 'active' | 'closed' {
  if (value === 'lobby' || value === 'active' || value === 'closed') return value
  throw new Error(`Invalid ${label}`)
}

function parseStatus(value: unknown, label: string): 'open' | 'closed' {
  if (value === 'open' || value === 'closed') return value
  throw new Error(`Invalid ${label}`)
}

function parseVisibility(value: unknown, label: string): 'private' | 'public' {
  if (value === 'private' || value === 'public') return value
  throw new Error(`Invalid ${label}`)
}

function parseLightGames(value: unknown): SyncLightGame[] {
  if (!Array.isArray(value)) return []
  return value.map((row, index) => {
    if (!row || typeof row !== 'object') throw new Error(`Invalid games[${index}]`)
    const game = row as SyncLightGameRaw
    return {
      id: asInt(game.id, 'games.id'),
      status: parseStatus(game.status, 'games.status'),
      playState: parsePlayState(game.playState, 'games.playState'),
      visibility: parseVisibility(game.visibility, 'games.visibility'),
      currentTurnUserId:
        game.currentTurnUserId === null ? null : asInt(game.currentTurnUserId, 'games.currentTurnUserId'),
      updatedAt: asString(game.updatedAt, 'games.updatedAt'),
    }
  })
}

function parseCurrentGame(value: unknown): SyncCurrentGame | null {
  if (value === null || value === undefined) return null
  if (!value || typeof value !== 'object') throw new Error('Invalid currentGame')
  const game = value as SyncCurrentGameRaw
  const state = game.state
  let parsedState: SyncCurrentGameState | null = null
  if (state !== null && state !== undefined) {
    if (!state || typeof state !== 'object') throw new Error('Invalid currentGame.state')
    const raw = state as { width?: unknown; height?: unknown; cells?: unknown }
    if (!Array.isArray(raw.cells)) throw new Error('Invalid currentGame.state.cells')
    parsedState = {
      width: asInt(raw.width, 'currentGame.state.width'),
      height: asInt(raw.height, 'currentGame.state.height'),
      cells: raw.cells.map((row, y) => {
        if (!Array.isArray(row)) throw new Error(`Invalid currentGame.state.cells[${y}]`)
        return row.map((cell, x) => asInt(cell, `currentGame.state.cells[${y}][${x}]`))
      }),
    }
  }

  const playersRaw = Array.isArray(game.players) ? game.players : []
  const players = playersRaw.map((row, index) => {
    if (!row || typeof row !== 'object') throw new Error(`Invalid currentGame.players[${index}]`)
    const player = row as SyncCurrentGamePlayerRaw
    const status = player.status
    if (status !== 'active' && status !== 'gave_up') throw new Error('Invalid currentGame.players.status')
    const parsedStatus: 'active' | 'gave_up' = status
    return {
      userId: asInt(player.userId, 'currentGame.players.userId'),
      email: asString(player.email, 'currentGame.players.email'),
      status: parsedStatus,
      positionX: player.positionX === null ? null : asInt(player.positionX, 'currentGame.players.positionX'),
      positionY: player.positionY === null ? null : asInt(player.positionY, 'currentGame.players.positionY'),
      capturedCellsCount: asInt(player.capturedCellsCount, 'currentGame.players.capturedCellsCount'),
      gameScore: asInt(player.gameScore, 'currentGame.players.gameScore'),
    }
  })

  return {
    id: asInt(game.id, 'currentGame.id'),
    status: parseStatus(game.status, 'currentGame.status'),
    playState: parsePlayState(game.playState, 'currentGame.playState'),
    currentTurnUserId:
      game.currentTurnUserId === null ? null : asInt(game.currentTurnUserId, 'currentGame.currentTurnUserId'),
    turnNumber: asInt(game.turnNumber, 'currentGame.turnNumber'),
    state: parsedState,
    players,
  }
}

function parseErrorMessage(data: unknown, fallback: string): string {
  if (!data || typeof data !== 'object') return fallback
  const message = (data as { message?: unknown }).message
  return typeof message === 'string' && message.trim() !== '' ? message : fallback
}

export async function fetchSyncLongPoll(
  sinceCursor: string | null,
  gameId?: number,
  signal?: AbortSignal,
): Promise<SyncLongPollCycle> {
  const query = new URLSearchParams({ timeoutSeconds: '25' })
  if (sinceCursor) query.set('since', sinceCursor)
  if (typeof gameId === 'number') query.set('gameId', String(gameId))
  const response = await fetch(apiUrl(`/api/sync/long-poll?${query.toString()}`), {
    method: 'GET',
    signal,
    credentials: 'include',
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) {
    let data: unknown = null
    try {
      data = await response.json()
    } catch {
      // ignore parse failure
    }
    throw new Error(parseErrorMessage(data, `HTTP ${response.status}`))
  }

  const data = (await response.json()) as SyncResponseRaw
  return {
    authenticated: data.authenticated === true,
    user: parseUser((data.user as SyncUserRaw | null) ?? null),
    pendingInvitationsCount: asInt(data.pendingInvitationsCount ?? 0, 'pendingInvitationsCount'),
    games: parseLightGames(data.games),
    currentGame: parseCurrentGame(data.currentGame),
    cursor: typeof data.cursor === 'string' && data.cursor.trim() !== '' ? data.cursor : null,
    timedOut: data.timeout === true,
  }
}
