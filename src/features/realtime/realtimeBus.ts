export type RealtimeTransportState =
  | 'idle'
  | 'ws-connecting'
  | 'ws-connected'
  | 'polling-fallback'

export type RealtimeStatusPayload = {
  state: RealtimeTransportState
  message?: string
  at: number
}

const EVENT_NAME = 'space-grid:realtime-status'

function fallbackState(): RealtimeStatusPayload {
  return {
    state: 'idle',
    at: Date.now(),
  }
}

export function getRealtimeStatusState(): RealtimeStatusPayload {
  if (typeof window === 'undefined') return fallbackState()
  const globalWindow = window as Window & {
    __spaceGridRealtimeStatus?: RealtimeStatusPayload
  }
  return globalWindow.__spaceGridRealtimeStatus ?? fallbackState()
}

export function publishRealtimeStatus(
  state: RealtimeTransportState,
  message?: string,
): void {
  if (typeof window === 'undefined') return
  const payload: RealtimeStatusPayload = {
    state,
    message,
    at: Date.now(),
  }
  const globalWindow = window as Window & {
    __spaceGridRealtimeStatus?: RealtimeStatusPayload
  }
  globalWindow.__spaceGridRealtimeStatus = payload
  window.dispatchEvent(new CustomEvent<RealtimeStatusPayload>(EVENT_NAME, { detail: payload }))
}

export function subscribeRealtimeStatus(
  listener: (payload: RealtimeStatusPayload) => void,
): () => void {
  if (typeof window === 'undefined') return () => {}

  const handler = (event: Event) => {
    const customEvent = event as CustomEvent<RealtimeStatusPayload>
    listener(customEvent.detail ?? getRealtimeStatusState())
  }
  window.addEventListener(EVENT_NAME, handler)
  return () => window.removeEventListener(EVENT_NAME, handler)
}

