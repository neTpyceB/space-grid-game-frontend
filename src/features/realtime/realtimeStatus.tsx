import { useEffect, useState } from 'react'
import {
  getRealtimeStatusState,
  subscribeRealtimeStatus,
  type RealtimeStatusPayload,
} from './realtimeBus'

export function RealtimeTransportStatus({ compact = false }: { compact?: boolean }) {
  const [payload, setPayload] = useState<RealtimeStatusPayload>(() =>
    getRealtimeStatusState(),
  )

  useEffect(() => {
    const unsubscribe = subscribeRealtimeStatus(setPayload)
    setPayload(getRealtimeStatusState())
    return unsubscribe
  }, [])

  const statusClass =
    payload.state === 'ws-connected'
      ? 'status-up'
      : payload.state === 'idle'
        ? 'status-checking'
        : 'status-down'
  const statusText =
    payload.state === 'ws-connected'
      ? 'WS CONNECTED'
      : payload.state === 'ws-connecting'
        ? 'WS CONNECTING'
        : payload.state === 'polling-fallback'
          ? 'POLLING FALLBACK'
          : 'IDLE'
  const subtitle =
    payload.message ??
    (payload.state === 'ws-connected'
      ? 'Realtime updates over WebSocket.'
      : payload.state === 'ws-connecting'
        ? 'Opening realtime socket.'
        : payload.state === 'polling-fallback'
          ? 'Using long-poll updates.'
          : 'Open a game page to start realtime transport.')

  return (
    <section className={compact ? 'footer-banner footer-banner-transport' : 'panel'} aria-live="polite">
      <p className="status-line">
        Realtime transport:{' '}
        <span className={`status-value ${statusClass}`}>
          {statusText}
        </span>
      </p>
      <p className="meta compact-meta">
        {subtitle} • Last {new Date(payload.at).toLocaleTimeString()}
      </p>
    </section>
  )
}
