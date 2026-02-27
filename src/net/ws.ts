type SocketStatus = 'connecting' | 'connected' | 'disconnected'

type PhoenixMessage = {
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
    const parsed = JSON.parse(data) as {
      topic?: unknown
      event?: unknown
      payload?: unknown
      ref?: unknown
    }
    if (typeof parsed.topic !== 'string' || typeof parsed.event !== 'string') return null
    return {
      topic: parsed.topic,
      event: parsed.event,
      payload: parsed.payload,
      ref: typeof parsed.ref === 'string' ? parsed.ref : null,
    }
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
          this.onStatusChange?.('connected')
          this.requestState()
          return
        }
        this.onStatusChange?.('disconnected')
        this.onEvent?.('error', { message: 'Join failed' })
        return
      }

      this.onEvent?.(message.event, message.payload)
    }

    ws.onerror = () => {
      this.onEvent?.('error', { message: 'WebSocket error' })
    }

    ws.onclose = () => {
      this.onStatusChange?.('disconnected')
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
    this.ws.send(
      JSON.stringify({
        topic: this.topic,
        event,
        payload,
        ref,
      }),
    )
    return ref
  }
}
