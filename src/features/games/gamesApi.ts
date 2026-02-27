import { apiUrl } from '../../net/apiBase'

export type GameStatus = 'open' | 'closed'
export type GameVisibility = 'private' | 'public'
export type GameCloseReason = 'give_up' | 'timeout' | 'last_standing' | null
export type GamePlayState = 'lobby' | 'active' | 'closed'

export type Game = {
  id: number
  createdByUserId: number
  status: GameStatus
  playState: GamePlayState
  closeReason: GameCloseReason
  pointsAtStake: number
  winnerUserId: number | null
  currentTurnUserId: number | null
  turnNumber: number
  visibility: GameVisibility
  maxPlayers: number
  playersCount: number
  fieldWidth: number
  fieldHeight: number
  randomSize: boolean
  createdAt: string
  startedAt: string | null
  updatedAt: string
  lastMoveAt: string | null
  closedAt: string | null
}

export type Limits = {
  openGames: number
  openGamesLimit: number
  createdOpenGames: number
  createdOpenGamesLimit: number
  playableOpenGames: number
  playableOpenGamesLimit: number
  canCreateGame: boolean
  canJoinGame: boolean
  moveTimeoutSeconds: number
  maxPlayersPerCreatedGameLimit: number
  tierLevel: number
}

export type GamePlayer = {
  id: number
  userId: number
  email: string
  joinedAt: string
  status: 'active' | 'gave_up'
  gaveUpAt: string | null
  positionX: number | null
  positionY: number | null
  capturedCellsCount: number
  gameScore: number
}

export type GameInvitation = {
  id: number
  email: string
  token: string
  createdAt: string
  acceptedAt: string | null
  joinApiPath: string
  frontendInvitePath: string
}

export type GameEvent = {
  id: number
  type: string
  actorUserId: number | null
  payload: Record<string, unknown>
  createdAt: string
}

export type GameDetails = {
  game: Game
  state: GameState | null
  players: GamePlayer[]
  invitations: GameInvitation[]
  events: GameEvent[]
}

export type GameState = {
  width: number
  height: number
  cells: number[][]
  currentTurnUserId: number | null
  turnNumber: number
  playState: GamePlayState
}

export type MovePayload = { x: number; y: number }

export type GameMoveResult = {
  game: Game
  state: GameState
  players: GamePlayer[]
  move: {
    to: { x: number; y: number }
    captured: boolean
    income: number
  }
}

export type CreateGameInput = {
  visibility: GameVisibility
  maxPlayers: number
  fieldWidth: number
  fieldHeight: number
  randomSize: boolean
}

type GamesListResponse = { games?: unknown; limits?: unknown }
type GameWithLimitsResponse = { game?: unknown; limits?: unknown }
type GameShowResponse = { game?: unknown; state?: unknown; players?: unknown; invitations?: unknown; events?: unknown }
type GameJoinResponse = { game?: unknown; state?: unknown; players?: unknown; limits?: unknown }
type GameStateResponse = { game?: unknown; state?: unknown; players?: unknown }
type GameMoveResponse = { game?: unknown; state?: unknown; players?: unknown; move?: unknown }
type InvitationCreateResponse = { invitation?: unknown }
type PendingInvitationsResponse = { invitations?: unknown }
type InvitationRejectResponse = { rejectedInvitationId?: unknown }
type ErrorResponse = { message?: unknown; limits?: unknown }
type LongPollMetaResponse = { cursor?: unknown; timeout?: unknown }

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
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

function parseGame(value: unknown): Game {
  if (!isObject(value)) throw new Error('Invalid game payload')

  const status = value.status
  const playState = value.playState
  const visibility = value.visibility
  const closeReason = value.closeReason

  if (status !== 'open' && status !== 'closed') throw new Error('Invalid game.status')
  if (playState !== 'lobby' && playState !== 'active' && playState !== 'closed') {
    throw new Error('Invalid game.playState')
  }
  if (visibility !== 'private' && visibility !== 'public') throw new Error('Invalid game.visibility')
  if (
    closeReason !== 'give_up' &&
    closeReason !== 'timeout' &&
    closeReason !== 'last_standing' &&
    closeReason !== null
  ) {
    throw new Error('Invalid game.closeReason')
  }

  return {
    id: asInt(value.id, 'game.id'),
    createdByUserId: asInt(value.createdByUserId, 'game.createdByUserId'),
    status,
    playState,
    closeReason,
    pointsAtStake: Number(value.pointsAtStake ?? 0),
    winnerUserId: value.winnerUserId === null ? null : asInt(value.winnerUserId, 'game.winnerUserId'),
    currentTurnUserId:
      value.currentTurnUserId === null ? null : asInt(value.currentTurnUserId, 'game.currentTurnUserId'),
    turnNumber: asInt(value.turnNumber, 'game.turnNumber'),
    visibility,
    maxPlayers: asInt(value.maxPlayers, 'game.maxPlayers'),
    playersCount: asInt(value.playersCount, 'game.playersCount'),
    fieldWidth: asInt(value.fieldWidth, 'game.fieldWidth'),
    fieldHeight: asInt(value.fieldHeight, 'game.fieldHeight'),
    randomSize: value.randomSize === true,
    createdAt: asString(value.createdAt, 'game.createdAt'),
    startedAt: value.startedAt === null ? null : asString(value.startedAt, 'game.startedAt'),
    updatedAt: asString(value.updatedAt, 'game.updatedAt'),
    lastMoveAt: value.lastMoveAt === null ? null : asString(value.lastMoveAt, 'game.lastMoveAt'),
    closedAt: value.closedAt === null ? null : asString(value.closedAt, 'game.closedAt'),
  }
}

function parseLimits(value: unknown): Limits {
  if (!isObject(value)) throw new Error('Invalid limits payload')
  return {
    openGames: asInt(value.openGames, 'limits.openGames'),
    openGamesLimit: asInt(value.openGamesLimit, 'limits.openGamesLimit'),
    createdOpenGames: asInt(value.createdOpenGames, 'limits.createdOpenGames'),
    createdOpenGamesLimit: asInt(value.createdOpenGamesLimit, 'limits.createdOpenGamesLimit'),
    playableOpenGames: asInt(value.playableOpenGames, 'limits.playableOpenGames'),
    playableOpenGamesLimit: asInt(value.playableOpenGamesLimit, 'limits.playableOpenGamesLimit'),
    canCreateGame: value.canCreateGame === true,
    canJoinGame: value.canJoinGame === true,
    moveTimeoutSeconds: asInt(value.moveTimeoutSeconds, 'limits.moveTimeoutSeconds'),
    maxPlayersPerCreatedGameLimit: asInt(
      value.maxPlayersPerCreatedGameLimit,
      'limits.maxPlayersPerCreatedGameLimit',
    ),
    tierLevel: asInt(value.tierLevel, 'limits.tierLevel'),
  }
}

function parsePlayers(value: unknown): GamePlayer[] {
  if (!Array.isArray(value)) return []
  return value.map((row) => {
    if (!isObject(row)) throw new Error('Invalid player payload')
    const status = row.status
    if (status !== 'active' && status !== 'gave_up') throw new Error('Invalid player.status')
    return {
      id: asInt(row.id, 'player.id'),
      userId: asInt(row.userId, 'player.userId'),
      email: asString(row.email, 'player.email'),
      joinedAt: asString(row.joinedAt, 'player.joinedAt'),
      status,
      gaveUpAt: row.gaveUpAt === null ? null : asString(row.gaveUpAt, 'player.gaveUpAt'),
      positionX: row.positionX === null ? null : asInt(row.positionX, 'player.positionX'),
      positionY: row.positionY === null ? null : asInt(row.positionY, 'player.positionY'),
      capturedCellsCount: asInt(row.capturedCellsCount, 'player.capturedCellsCount'),
      gameScore: asInt(row.gameScore, 'player.gameScore'),
    }
  })
}

function parseGameState(value: unknown): GameState | null {
  if (value === null || value === undefined) return null
  if (!isObject(value)) throw new Error('Invalid game state payload')
  const playState = value.playState
  if (playState !== 'lobby' && playState !== 'active' && playState !== 'closed') {
    throw new Error('Invalid state.playState')
  }
  if (!Array.isArray(value.cells)) throw new Error('Invalid state.cells')
  const cells = value.cells.map((row, y) => {
    if (!Array.isArray(row)) throw new Error(`Invalid state.cells[${y}]`)
    return row.map((cell, x) => asInt(cell, `state.cells[${y}][${x}]`))
  })
  return {
    width: asInt(value.width, 'state.width'),
    height: asInt(value.height, 'state.height'),
    cells,
    currentTurnUserId:
      value.currentTurnUserId === null ? null : asInt(value.currentTurnUserId, 'state.currentTurnUserId'),
    turnNumber: asInt(value.turnNumber, 'state.turnNumber'),
    playState,
  }
}

function parseInvitations(value: unknown): GameInvitation[] {
  if (!Array.isArray(value)) return []
  return value.map((row) => {
    if (!isObject(row)) throw new Error('Invalid invitation payload')
    return {
      id: asInt(row.id, 'invitation.id'),
      email: asString(row.email, 'invitation.email'),
      token: asString(row.token, 'invitation.token'),
      createdAt: asString(row.createdAt, 'invitation.createdAt'),
      acceptedAt: row.acceptedAt === null ? null : asString(row.acceptedAt, 'invitation.acceptedAt'),
      joinApiPath: asString(row.joinApiPath, 'invitation.joinApiPath'),
      frontendInvitePath: asString(row.frontendInvitePath, 'invitation.frontendInvitePath'),
    }
  })
}

function parseEvents(value: unknown): GameEvent[] {
  if (!Array.isArray(value)) return []
  return value.map((row) => {
    if (!isObject(row)) throw new Error('Invalid event payload')
    return {
      id: asInt(row.id, 'event.id'),
      type: asString(row.type, 'event.type'),
      actorUserId: row.actorUserId === null ? null : asInt(row.actorUserId, 'event.actorUserId'),
      payload: isObject(row.payload) ? row.payload : {},
      createdAt: asString(row.createdAt, 'event.createdAt'),
    }
  })
}

async function readJson(response: Response): Promise<unknown> {
  return response.json()
}

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const data = (await readJson(response)) as ErrorResponse
    if (typeof data.message === 'string' && data.message.trim() !== '') return data.message
  } catch {
    // ignore parse error
  }
  return fallback
}

export class OpenGamesLimitReachedError extends Error {
  limits: Limits | null
  constructor(message: string, limits: Limits | null) {
    super(message)
    this.name = 'OpenGamesLimitReachedError'
    this.limits = limits
  }
}

export type LongPollCycle<T> = {
  data: T
  cursor: string | null
  timedOut: boolean
}

async function parseGamesListResponse(response: Response): Promise<{ games: Game[]; limits: Limits }> {
  const data = (await readJson(response)) as GamesListResponse
  const games = Array.isArray(data.games) ? data.games.map(parseGame) : []
  const limits = parseLimits(data.limits)
  return { games, limits }
}

function parseLongPollMeta(data: LongPollMetaResponse): {
  cursor: string | null
  timedOut: boolean
} {
  return {
    cursor:
      typeof data.cursor === 'string' && data.cursor.trim() !== '' ? data.cursor : null,
    timedOut: data.timeout === true,
  }
}

export async function listPlayableGames(signal?: AbortSignal): Promise<{ games: Game[]; limits: Limits }> {
  const response = await fetch(apiUrl('/api/games'), {
    method: 'GET',
    signal,
    credentials: 'include',
    headers: { Accept: 'application/json' },
  })
  if (response.status === 401) throw new Error('Authentication required')
  if (!response.ok) throw new Error(await readErrorMessage(response, `HTTP ${response.status}`))
  return parseGamesListResponse(response)
}

export async function listPlayableGamesLongPoll(
  sinceCursor: string | null,
  signal?: AbortSignal,
): Promise<LongPollCycle<{ games: Game[]; limits: Limits }>> {
  const query = new URLSearchParams({ timeoutSeconds: '25' })
  if (sinceCursor) query.set('since', sinceCursor)
  const response = await fetch(apiUrl(`/api/games/long-poll?${query.toString()}`), {
    method: 'GET',
    signal,
    credentials: 'include',
    headers: { Accept: 'application/json' },
  })
  if (response.status === 401) throw new Error('Authentication required')
  if (!response.ok) throw new Error(await readErrorMessage(response, `HTTP ${response.status}`))
  const data = (await readJson(response)) as GamesListResponse & LongPollMetaResponse
  return {
    data: {
      games: Array.isArray(data.games) ? data.games.map(parseGame) : [],
      limits: parseLimits(data.limits),
    },
    ...parseLongPollMeta(data),
  }
}

export async function listCreatedGames(signal?: AbortSignal): Promise<{ games: Game[]; limits: Limits }> {
  const response = await fetch(apiUrl('/api/games/created'), {
    method: 'GET',
    signal,
    credentials: 'include',
    headers: { Accept: 'application/json' },
  })
  if (response.status === 401) throw new Error('Authentication required')
  if (!response.ok) throw new Error(await readErrorMessage(response, `HTTP ${response.status}`))
  return parseGamesListResponse(response)
}

export async function listPublicGames(signal?: AbortSignal): Promise<{ games: Game[]; limits: Limits }> {
  const response = await fetch(apiUrl('/api/games/public'), {
    method: 'GET',
    signal,
    credentials: 'include',
    headers: { Accept: 'application/json' },
  })
  if (response.status === 401) throw new Error('Authentication required')
  if (!response.ok) throw new Error(await readErrorMessage(response, `HTTP ${response.status}`))
  return parseGamesListResponse(response)
}

export async function listPublicGamesLongPoll(
  sinceCursor: string | null,
  signal?: AbortSignal,
): Promise<LongPollCycle<{ games: Game[]; limits: Limits }>> {
  const query = new URLSearchParams({ timeoutSeconds: '25' })
  if (sinceCursor) query.set('since', sinceCursor)
  const response = await fetch(apiUrl(`/api/games/public/long-poll?${query.toString()}`), {
    method: 'GET',
    signal,
    credentials: 'include',
    headers: { Accept: 'application/json' },
  })
  if (response.status === 401) throw new Error('Authentication required')
  if (!response.ok) throw new Error(await readErrorMessage(response, `HTTP ${response.status}`))
  const data = (await readJson(response)) as GamesListResponse & LongPollMetaResponse
  return {
    data: {
      games: Array.isArray(data.games) ? data.games.map(parseGame) : [],
      limits: parseLimits(data.limits),
    },
    ...parseLongPollMeta(data),
  }
}

export async function listPendingInvitations(signal?: AbortSignal): Promise<GameInvitation[]> {
  const response = await fetch(apiUrl('/api/invitations'), {
    method: 'GET',
    signal,
    credentials: 'include',
    headers: { Accept: 'application/json' },
  })
  if (response.status === 401) throw new Error('Authentication required')
  if (!response.ok) throw new Error(await readErrorMessage(response, `HTTP ${response.status}`))
  const data = (await readJson(response)) as PendingInvitationsResponse
  return parseInvitations(data.invitations)
}

export async function listPendingInvitationsLongPoll(
  sinceCursor: string | null,
  signal?: AbortSignal,
): Promise<LongPollCycle<GameInvitation[]>> {
  const query = new URLSearchParams({ timeoutSeconds: '25' })
  if (sinceCursor) query.set('since', sinceCursor)
  const response = await fetch(apiUrl(`/api/invitations/long-poll?${query.toString()}`), {
    method: 'GET',
    signal,
    credentials: 'include',
    headers: { Accept: 'application/json' },
  })
  if (response.status === 401) throw new Error('Authentication required')
  if (!response.ok) throw new Error(await readErrorMessage(response, `HTTP ${response.status}`))
  const data = (await readJson(response)) as PendingInvitationsResponse & LongPollMetaResponse
  return {
    data: parseInvitations(data.invitations),
    ...parseLongPollMeta(data),
  }
}

export async function createGame(input: CreateGameInput): Promise<{ game: Game; limits: Limits }> {
  const response = await fetch(apiUrl('/api/games'), {
    method: 'POST',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  })

  if (response.status === 401) throw new Error('Authentication required')
  if (response.status === 409) {
    let limits: Limits | null = null
    let message = 'Open games limit reached'
    try {
      const data = (await readJson(response)) as ErrorResponse
      if (typeof data.message === 'string' && data.message) message = data.message
      limits = data.limits ? parseLimits(data.limits) : null
    } catch {
      // ignore parse failures
    }
    throw new OpenGamesLimitReachedError(message, limits)
  }
  if (!response.ok) throw new Error(await readErrorMessage(response, `HTTP ${response.status}`))

  const data = (await readJson(response)) as GameWithLimitsResponse
  return {
    game: parseGame(data.game),
    limits: parseLimits(data.limits),
  }
}

export async function getGameDetails(id: number, signal?: AbortSignal): Promise<GameDetails> {
  const response = await fetch(apiUrl(`/api/games/${id}`), {
    method: 'GET',
    signal,
    credentials: 'include',
    headers: { Accept: 'application/json' },
  })
  if (response.status === 401) throw new Error('Authentication required')
  if (response.status === 404) throw new Error('Game not found')
  if (!response.ok) throw new Error(await readErrorMessage(response, `HTTP ${response.status}`))
  const data = (await readJson(response)) as GameShowResponse
  return {
    game: parseGame(data.game),
    state: parseGameState(data.state),
    players: parsePlayers(data.players),
    invitations: parseInvitations(data.invitations),
    events: parseEvents(data.events),
  }
}

export async function getGameState(
  id: number,
  signal?: AbortSignal,
): Promise<{ game: Game; state: GameState | null; players: GamePlayer[] }> {
  const response = await fetch(apiUrl(`/api/games/${id}/state`), {
    method: 'GET',
    signal,
    credentials: 'include',
    headers: { Accept: 'application/json' },
  })
  if (response.status === 401) throw new Error('Authentication required')
  if (response.status === 404) throw new Error('Game not found')
  if (!response.ok) throw new Error(await readErrorMessage(response, `HTTP ${response.status}`))
  const data = (await readJson(response)) as GameStateResponse
  return {
    game: parseGame(data.game),
    state: parseGameState(data.state),
    players: parsePlayers(data.players),
  }
}

export async function getGameStateLongPoll(
  id: number,
  sinceCursor: string | null,
  signal?: AbortSignal,
): Promise<LongPollCycle<{ game: Game; state: GameState | null; players: GamePlayer[] }>> {
  const query = new URLSearchParams({ timeoutSeconds: '25' })
  if (sinceCursor) query.set('since', sinceCursor)
  const response = await fetch(apiUrl(`/api/games/${id}/state/long-poll?${query.toString()}`), {
    method: 'GET',
    signal,
    credentials: 'include',
    headers: { Accept: 'application/json' },
  })
  if (response.status === 401) throw new Error('Authentication required')
  if (response.status === 404) throw new Error('Game not found')
  if (!response.ok) throw new Error(await readErrorMessage(response, `HTTP ${response.status}`))
  const data = (await readJson(response)) as GameStateResponse & LongPollMetaResponse
  return {
    data: {
      game: parseGame(data.game),
      state: parseGameState(data.state),
      players: parsePlayers(data.players),
    },
    ...parseLongPollMeta(data),
  }
}

export async function moveGame(id: number, move: MovePayload): Promise<GameMoveResult> {
  const response = await fetch(apiUrl(`/api/games/${id}/move`), {
    method: 'POST',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(move),
  })
  if (response.status === 401) throw new Error('Authentication required')
  if (response.status === 404) throw new Error('Game not found')
  if (!response.ok) throw new Error(await readErrorMessage(response, `HTTP ${response.status}`))
  const data = (await readJson(response)) as GameMoveResponse
  const rawMove = data.move
  if (!isObject(rawMove) || !isObject(rawMove.to)) throw new Error('Invalid move response')
  return {
    game: parseGame(data.game),
    state: parseGameState(data.state) ?? (() => { throw new Error('Missing game state') })(),
    players: parsePlayers(data.players),
    move: {
      to: {
        x: asInt(rawMove.to.x, 'move.to.x'),
        y: asInt(rawMove.to.y, 'move.to.y'),
      },
      captured: rawMove.captured === true,
      income: asInt(rawMove.income, 'move.income'),
    },
  }
}

export async function giveUpGame(id: number): Promise<{ game: Game; limits: Limits }> {
  const response = await fetch(apiUrl(`/api/games/${id}/give-up`), {
    method: 'POST',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  })
  if (response.status === 401) throw new Error('Authentication required')
  if (response.status === 404) throw new Error('Game not found')
  if (!response.ok) throw new Error(await readErrorMessage(response, `HTTP ${response.status}`))
  const data = (await readJson(response)) as GameWithLimitsResponse
  return {
    game: parseGame(data.game),
    limits: parseLimits(data.limits),
  }
}

export async function joinGame(
  id: number,
  token?: string,
): Promise<{ game: Game; state: GameState | null; players: GamePlayer[]; limits: Limits }> {
  const hasToken = typeof token === 'string' && token.trim() !== ''
  const response = await fetch(apiUrl(`/api/games/${id}/join`), {
    method: 'POST',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...(hasToken ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(hasToken ? { body: JSON.stringify({ token: token.trim() }) } : {}),
  })
  if (response.status === 401) throw new Error('Authentication required')
  if (!response.ok) throw new Error(await readErrorMessage(response, `HTTP ${response.status}`))
  const data = (await readJson(response)) as GameJoinResponse
  return {
    game: parseGame(data.game),
    state: parseGameState(data.state),
    players: parsePlayers(data.players),
    limits: parseLimits(data.limits),
  }
}

export async function createInvitation(gameId: number, email: string): Promise<GameInvitation> {
  const response = await fetch(apiUrl(`/api/games/${gameId}/invitations`), {
    method: 'POST',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email }),
  })
  if (response.status === 401) throw new Error('Authentication required')
  if (!response.ok) throw new Error(await readErrorMessage(response, `HTTP ${response.status}`))
  const data = (await readJson(response)) as InvitationCreateResponse
  const parsed = parseInvitations([data.invitation])
  if (!parsed[0]) throw new Error('Invalid invitation response')
  return parsed[0]
}

export async function rejectInvitation(invitationId: number): Promise<number> {
  const response = await fetch(apiUrl(`/api/invitations/${invitationId}/reject`), {
    method: 'POST',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  })
  if (response.status === 401) throw new Error('Authentication required')
  if (response.status === 404) throw new Error('Invitation not found')
  if (!response.ok) throw new Error(await readErrorMessage(response, `HTTP ${response.status}`))
  const data = (await readJson(response)) as InvitationRejectResponse
  return asInt(data.rejectedInvitationId, 'rejectedInvitationId')
}
