export type HealthCheckResult =
  | { kind: 'up'; statusText: string }
  | { kind: 'down'; statusText: string; error: string }

export type HealthLongPollCycle = {
  result: HealthCheckResult
  cursor: string | null
  timedOut: boolean
}

export class UnsupportedLongPollingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsupportedLongPollingError'
  }
}

type HealthJson = {
  status?: unknown
  cursor?: unknown
  timeout?: unknown
}

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '')

function apiUrl(path: string): string {
  return API_BASE_URL ? `${API_BASE_URL}${path}` : path
}

function getDownResult(error: unknown): HealthCheckResult {
  const message = error instanceof Error ? error.message : 'Unknown error'

  return {
    kind: 'down',
    statusText: 'DOWN',
    error: message,
  }
}

function parseHealthPayload(data: HealthJson): {
  statusText: string
  cursor: string | null
  timedOut: boolean
} {
  const statusText =
    typeof data.status === 'string' && data.status.trim() !== '' ? data.status : 'UP'
  const cursor =
    typeof data.cursor === 'string' && data.cursor.trim() !== '' ? data.cursor : null
  const timedOut = data.timeout === true

  return { statusText, cursor, timedOut }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

export async function fetchHealthStatusSnapshot(
  signal?: AbortSignal,
): Promise<HealthCheckResult> {
  try {
    const response = await fetch(apiUrl('/api/server/status'), {
      signal,
      headers: {
        Accept: 'application/json, text/plain;q=0.9, */*;q=0.8',
      },
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`)
    }

    let statusText = 'UP'
    const contentType = response.headers.get('content-type') ?? ''

    if (contentType.includes('application/json')) {
      const data = (await response.json()) as { status?: unknown }
      if (typeof data.status === 'string' && data.status.trim() !== '') {
        statusText = data.status
      }
    } else {
      const text = (await response.text()).trim()
      if (text !== '') {
        statusText = text
      }
    }

    return {
      kind: 'up',
      statusText,
    }
  } catch (error) {
    if (isAbortError(error)) {
      throw error
    }
    return getDownResult(error)
  }
}

export async function fetchHealthStatusLongPoll(
  sinceCursor: string | null,
  signal?: AbortSignal,
): Promise<HealthLongPollCycle> {
  const query = new URLSearchParams({
    timeoutSeconds: '25',
  })

  if (sinceCursor) {
    query.set('since', sinceCursor)
  }

  try {
    const response = await fetch(
      apiUrl(`/api/server/status/long-poll?${query.toString()}`),
      {
        signal,
        headers: {
          Accept: 'application/json',
        },
      },
    )

    if (response.status === 404 || response.status === 405 || response.status === 501) {
      throw new UnsupportedLongPollingError(
        `Long polling endpoint is not available (HTTP ${response.status})`,
      )
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`)
    }

    const data = (await response.json()) as HealthJson
    const parsed = parseHealthPayload(data)

    return {
      result: {
        kind: 'up',
        statusText: parsed.statusText,
      },
      cursor: parsed.cursor,
      timedOut: parsed.timedOut,
    }
  } catch (error) {
    if (error instanceof UnsupportedLongPollingError || isAbortError(error)) {
      throw error
    }

    return {
      result: getDownResult(error),
      cursor: sinceCursor,
      timedOut: false,
    }
  }
}
