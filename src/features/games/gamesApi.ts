export type GameStatus = 'open' | 'closed'
export type GameCloseReason = 'give_up' | 'timeout' | null

export type Game = {
  id: number
  status: GameStatus
  closeReason: GameCloseReason
  pointsAtStake: number
  winnerUserId: number | null
  createdAt: string
  updatedAt: string
  lastMoveAt: string | null
  closedAt: string | null
}

export type Limits = {
  openGames: number
  openGamesLimit: number
  canCreateGame: boolean
  moveTimeoutSeconds: number
}

type GamesListResponse = {
  status?: unknown
  games?: unknown
  limits?: unknown
}

type GameOneResponse = {
  status?: unknown
  game?: unknown
  limits?: unknown
}

type ErrorResponse = {
  status?: unknown
  message?: unknown
  code?: unknown
  limits?: unknown
}

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '')

function apiUrl(path: string): string {
  return API_BASE_URL ? `${API_BASE_URL}${path}` : path
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseGame(value: unknown): Game {
  if (!isObject(value)) throw new Error('Invalid game payload')

  const status = value.status
  const closeReason = value.closeReason
  if (status !== 'open' && status !== 'closed') throw new Error('Invalid game status')
  if (closeReason !== 'give_up' && closeReason !== 'timeout' && closeReason !== null) {
    throw new Error('Invalid game close reason')
  }

  const game: Game = {
    id: Number(value.id),
    status,
    closeReason,
    pointsAtStake: Number(value.pointsAtStake ?? 0),
    winnerUserId: value.winnerUserId === null ? null : Number(value.winnerUserId),
    createdAt: String(value.createdAt ?? ''),
    updatedAt: String(value.updatedAt ?? ''),
    lastMoveAt: value.lastMoveAt === null ? null : String(value.lastMoveAt ?? ''),
    closedAt: value.closedAt === null ? null : String(value.closedAt ?? ''),
  }

  if (!Number.isInteger(game.id) || game.id < 1) throw new Error('Invalid game id')
  if (!Number.isFinite(game.pointsAtStake)) throw new Error('Invalid pointsAtStake')

  return game
}

function parseLimits(value: unknown): Limits {
  if (!isObject(value)) throw new Error('Invalid limits payload')

  return {
    openGames: Number(value.openGames),
    openGamesLimit: Number(value.openGamesLimit),
    canCreateGame: value.canCreateGame === true,
    moveTimeoutSeconds: Number(value.moveTimeoutSeconds),
  }
}

async function readJson(response: Response): Promise<unknown> {
  return response.json()
}

export class OpenGamesLimitReachedError extends Error {
  limits: Limits | null

  constructor(message: string, limits: Limits | null) {
    super(message)
    this.name = 'OpenGamesLimitReachedError'
    this.limits = limits
  }
}

export async function listGames(signal?: AbortSignal): Promise<{
  games: Game[]
  limits: Limits
}> {
  const response = await fetch(apiUrl('/api/games'), {
    method: 'GET',
    signal,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
    },
  })

  if (response.status === 401) throw new Error('Authentication required')
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`)

  const data = (await readJson(response)) as GamesListResponse
  const gamesRaw = Array.isArray(data.games) ? data.games : []
  const games = gamesRaw.map(parseGame)
  const limits = parseLimits(data.limits)

  return { games, limits }
}

export async function createGame(): Promise<{ game: Game; limits: Limits }> {
  const response = await fetch(apiUrl('/api/games'), {
    method: 'POST',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
    },
  })

  if (response.status === 401) throw new Error('Authentication required')

  if (response.status === 409) {
    const data = (await readJson(response)) as ErrorResponse
    let limits: Limits | null = null
    try {
      limits = parseLimits(data.limits)
    } catch {
      limits = null
    }
    throw new OpenGamesLimitReachedError(
      typeof data.message === 'string' ? data.message : 'Open games limit reached',
      limits,
    )
  }

  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`)

  const data = (await readJson(response)) as GameOneResponse
  return {
    game: parseGame(data.game),
    limits: parseLimits(data.limits),
  }
}

export async function getGame(id: number, signal?: AbortSignal): Promise<Game> {
  const response = await fetch(apiUrl(`/api/games/${id}`), {
    method: 'GET',
    signal,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
    },
  })

  if (response.status === 401) throw new Error('Authentication required')
  if (response.status === 404) throw new Error('Game not found')
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`)

  const data = (await readJson(response)) as GameOneResponse
  return parseGame(data.game)
}

export async function closeGame(id: number): Promise<{ game: Game; limits: Limits }> {
  const response = await fetch(apiUrl(`/api/games/${id}/close`), {
    method: 'POST',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
    },
  })

  if (response.status === 401) throw new Error('Authentication required')
  if (response.status === 404) throw new Error('Game not found')
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`)

  const data = (await readJson(response)) as GameOneResponse
  return {
    game: parseGame(data.game),
    limits: parseLimits(data.limits),
  }
}
