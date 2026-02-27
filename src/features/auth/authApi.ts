export type AuthUser = {
  id: number
  email: string
  score: number
  tierLevel: number
  scoreWalletMax: number
  nextTierUpgradeCost: number | null
}

type MeResponse = {
  authenticated?: unknown
  user?: unknown
}
type MeLongPollResponse = MeResponse & {
  cursor?: unknown
  timeout?: unknown
}

type EmailAuthResponse = {
  status?: unknown
  authenticated?: unknown
  created?: unknown
  user?: unknown
}

export type AuthState =
  | { kind: 'guest' }
  | { kind: 'authed'; user: AuthUser; created?: boolean }

export type AuthLongPollCycle = {
  authState: AuthState
  cursor: string | null
  timedOut: boolean
}

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '')

function apiUrl(path: string): string {
  return API_BASE_URL ? `${API_BASE_URL}${path}` : path
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseUser(value: unknown): AuthUser | null {
  if (!isObject(value)) return null
  if (typeof value.id !== 'number') return null
  if (typeof value.email !== 'string' || value.email.trim() === '') return null
  if (typeof value.score !== 'number') return null
  if (typeof value.tierLevel !== 'number') return null
  if (typeof value.scoreWalletMax !== 'number') return null
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

export async function fetchCurrentUser(signal?: AbortSignal): Promise<AuthState> {
  const response = await fetch(apiUrl('/api/auth/me'), {
    method: 'GET',
    signal,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
    },
  })

  if (response.status === 401) {
    return { kind: 'guest' }
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`)
  }

  const data = (await response.json()) as MeResponse
  const user = parseUser(data.user)
  if (data.authenticated === true && user) {
    return { kind: 'authed', user }
  }

  return { kind: 'guest' }
}

export async function fetchCurrentUserLongPoll(
  sinceCursor: string | null,
  signal?: AbortSignal,
): Promise<AuthLongPollCycle> {
  const query = new URLSearchParams({ timeoutSeconds: '25' })
  if (sinceCursor) query.set('since', sinceCursor)

  const response = await fetch(apiUrl(`/api/auth/me/long-poll?${query.toString()}`), {
    method: 'GET',
    signal,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
    },
  })

  if (response.status === 401) {
    return { authState: { kind: 'guest' }, cursor: sinceCursor, timedOut: false }
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`)
  }

  const data = (await response.json()) as MeLongPollResponse
  const user = parseUser(data.user)
  const authState: AuthState =
    data.authenticated === true && user ? { kind: 'authed', user } : { kind: 'guest' }

  return {
    authState,
    cursor: typeof data.cursor === 'string' && data.cursor.trim() !== '' ? data.cursor : null,
    timedOut: data.timeout === true,
  }
}

export async function authByEmail(email: string): Promise<AuthState> {
  const response = await fetch(apiUrl('/api/auth/email'), {
    method: 'POST',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email }),
  })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`)
  }

  const data = (await response.json()) as EmailAuthResponse
  const user = parseUser(data.user)
  if (data.authenticated !== true || !user) {
    throw new Error('Invalid auth response')
  }

  return {
    kind: 'authed',
    user,
    created: data.created === true,
  }
}

export async function logout(): Promise<void> {
  const response = await fetch(apiUrl('/api/auth/logout'), {
    method: 'POST',
    credentials: 'include',
    headers: {
      Accept: 'application/json, */*',
    },
  })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`)
  }
}

export async function tierUpgrade(): Promise<AuthUser> {
  const response = await fetch(apiUrl('/api/auth/tier-upgrade'), {
    method: 'POST',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    let message = `HTTP ${response.status} ${response.statusText}`
    try {
      const data = (await response.json()) as { message?: unknown }
      if (typeof data.message === 'string' && data.message.trim() !== '') {
        message = data.message
      }
    } catch {
      // ignore parse errors and use generic message
    }
    throw new Error(message)
  }

  const data = (await response.json()) as { user?: unknown }
  const user = parseUser(data.user)
  if (!user) throw new Error('Invalid tier upgrade response')
  return user
}
