import { publishRealtimeStatus } from '../features/realtime/realtimeBus'

type SocketStatus = 'connecting' | 'connected' | 'disconnected'

type PhoenixMessage = {
  joinRef: string | null
  topic: string
  event: string
  payload: unknown
  ref: string | null
}

type PhoenixSocketOptions = {
  url: string
  topic: string
  onStatusChange?: (status: SocketStatus) => void
  onEvent?: (event: string, payload: unknown) => void
}

function safeParseMessage(data: string): PhoenixMessage | null {
  try {
    const parsed = JSON.parse(data) as unknown

    // Phoenix WebSocket serializer v2 format: [join_ref, ref, topic, event, payload]
    if (Array.isArray(parsed) && parsed.length >= 5) {
      const [joinRefRaw, refRaw, topicRaw, eventRaw, payloadRaw] = parsed
      if (typeof topicRaw !== 'string' || typeof eventRaw !== 'string') return null
      return {
        joinRef: typeof joinRefRaw === 'string' ? joinRefRaw : null,
        topic: topicRaw,
        event: eventRaw,
        payload: payloadRaw,
        ref: typeof refRaw === 'string' ? refRaw : null,
      }
    }

    // Backward-compatible object format parser
    if (parsed && typeof parsed === 'object') {
      const p = parsed as {
        topic?: unknown
        event?: unknown
        payload?: unknown
        ref?: unknown
        join_ref?: unknown
      }
      if (typeof p.topic !== 'string' || typeof p.event !== 'string') return null
      return {
        joinRef: typeof p.join_ref === 'string' ? p.join_ref : null,
        topic: p.topic,
        event: p.event,
        payload: p.payload,
        ref: typeof p.ref === 'string' ? p.ref : null,
      }
    }
    return null
  } catch {
    return null
  }
}

export class PhoenixGameSocket {
  private readonly url: string
  private readonly topic: string
  private readonly onStatusChange?: (status: SocketStatus) => void
  private readonly onEvent?: (event: string, payload: unknown) => void
  private ws: WebSocket | null = null
  private ref = 0
  private joinRef: string | null = null

  constructor(options: PhoenixSocketOptions) {
    this.url = options.url
    this.topic = options.topic
    this.onStatusChange = options.onStatusChange
    this.onEvent = options.onEvent
  }

  connect(): void {
    this.disconnect()
    this.onStatusChange?.('connecting')
    publishRealtimeStatus('ws-connecting')
    const ws = new WebSocket(this.url)
    this.ws = ws

    ws.onopen = () => {
      this.joinRef = this.push('phx_join', {})
    }

    ws.onmessage = (event) => {
      const message = safeParseMessage(String(event.data))
      if (!message || message.topic !== this.topic) return

      if (message.event === 'phx_reply' && message.ref === this.joinRef) {
        const payload = message.payload as { status?: unknown }
        if (payload && payload.status === 'ok') {
          try {
            this.onStatusChange?.('connected')
          } catch {
            // keep socket alive even if UI callback fails
          }
          publishRealtimeStatus('ws-connected')
          this.requestState()
          return
        }
        try {
          this.onStatusChange?.('disconnected')
        } catch {
          // ignore callback errors
        }
        publishRealtimeStatus('polling-fallback', 'WebSocket join failed, using long poll.')
        try {
          this.onEvent?.('error', { message: 'Join failed' })
        } catch {
          // ignore callback errors
        }
        return
      }

      try {
        this.onEvent?.(message.event, message.payload)
      } catch {
        this.onEvent?.('error', { message: 'Failed to handle realtime event payload' })
      }
    }

    ws.onerror = () => {
      publishRealtimeStatus('polling-fallback', 'WebSocket error, using long poll.')
      try {
        this.onEvent?.('error', { message: 'WebSocket error' })
      } catch {
        // ignore callback errors
      }
    }

    ws.onclose = () => {
      try {
        this.onStatusChange?.('disconnected')
      } catch {
        // ignore callback errors
      }
      publishRealtimeStatus('polling-fallback', 'WebSocket disconnected, using long poll.')
    }
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  requestState(): boolean {
    return Boolean(this.push('request_state', {}))
  }

  sendMove(x: number, y: number, buyCell = true): boolean {
    return Boolean(this.push('move', { x, y, buyCell }))
  }

  private push(event: string, payload: unknown): string | null {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return null
    this.ref += 1
    const ref = String(this.ref)
    const joinRef = event === 'phx_join' ? null : this.joinRef
    this.ws.send(JSON.stringify([joinRef, ref, this.topic, event, payload]))
    return ref
  }
}
