import { useEffect, useState } from 'react'
import {
  fetchHealthStatusLongPoll,
  fetchHealthStatusSnapshot,
  type HealthCheckResult,
  UnsupportedLongPollingError,
} from './healthApi'

const FALLBACK_POLL_INTERVAL_MS = 5000
const ERROR_RETRY_MS = 2000
const MAX_ERROR_RETRY_MS = 10000

type TransportMode = 'long-poll' | 'polling-fallback'

type ViewState =
  | { phase: 'loading' }
  | {
      phase: 'ready'
      result: HealthCheckResult
      checkedAt: Date
      transportMode: TransportMode
      note: string
    }

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

export function HealthStatus({ compact = false }: { compact?: boolean }) {
  const [state, setState] = useState<ViewState>({ phase: 'loading' })

  useEffect(() => {
    let isActive = true
    let cursor: string | null = null
    let transportMode: TransportMode = 'long-poll'
    let activeController: AbortController | null = null
    let recoveryRetryMs = ERROR_RETRY_MS

    const publish = (
      result: HealthCheckResult,
      mode: TransportMode,
      note: string,
    ) => {
      if (!isActive) return

      setState({
        phase: 'ready',
        result,
        checkedAt: new Date(),
        transportMode: mode,
        note,
      })
    }

    const runLoop = async () => {
      while (isActive) {
        activeController = new AbortController()

        try {
          if (transportMode === 'long-poll') {
            const cycle = await fetchHealthStatusLongPoll(
              cursor,
              activeController.signal,
            )

            if (cycle.result.kind === 'down') {
              publish(
                cycle.result,
                'long-poll',
                `Long poll connection failed. Retrying in ${Math.round(
                  recoveryRetryMs / 1000,
                )}s.`,
              )

              await sleep(recoveryRetryMs)
              if (!isActive) return

              activeController = new AbortController()
              const probe = await fetchHealthStatusSnapshot(activeController.signal)

              if (probe.kind === 'up') {
                recoveryRetryMs = ERROR_RETRY_MS
                // Force a fresh long-poll subscribe after recovery so backend can reply immediately.
                cursor = null
                publish(
                  probe,
                  'long-poll',
                  'Server reachable again. Re-establishing long poll connection.',
                )
              } else {
                recoveryRetryMs = Math.min(recoveryRetryMs * 2, MAX_ERROR_RETRY_MS)
                publish(
                  probe,
                  'long-poll',
                  `Server still unreachable. Backing off to ${Math.round(
                    recoveryRetryMs / 1000,
                  )}s retries.`,
                )
              }

              continue
            }

            recoveryRetryMs = ERROR_RETRY_MS
            cursor = cycle.cursor ?? cursor
            publish(
              cycle.result,
              'long-poll',
              cycle.timedOut
                ? 'Long poll timeout reached, reconnecting immediately.'
                : 'Long poll connected. Waiting on backend changes/timeouts.',
            )
            continue
          }

          const result = await fetchHealthStatusSnapshot(activeController.signal)
          recoveryRetryMs = ERROR_RETRY_MS
          publish(
            result,
            'polling-fallback',
            'Fallback polling every 5 seconds until backend long polling is available.',
          )
          await sleep(FALLBACK_POLL_INTERVAL_MS)
        } catch (error) {
          if (
            error instanceof DOMException &&
            error.name === 'AbortError'
          ) {
            return
          }

          if (error instanceof UnsupportedLongPollingError) {
            transportMode = 'polling-fallback'
            continue
          }

          publish(
            {
              kind: 'down',
              statusText: 'DOWN',
              error: error instanceof Error ? error.message : 'Unknown error',
            },
            transportMode,
            'Retrying after temporary connection error.',
          )
          await sleep(recoveryRetryMs)
          recoveryRetryMs = Math.min(recoveryRetryMs * 2, MAX_ERROR_RETRY_MS)
        }
      }
    }

    void runLoop()

    return () => {
      isActive = false
      activeController?.abort()
    }
  }, [])

  if (state.phase === 'loading') {
    return (
      <section className={compact ? 'footer-banner' : 'panel'} aria-live="polite">
        <p className="status-line">
          Server status is <span className="status-value status-checking">CHECKING...</span>
        </p>
      </section>
    )
  }

  const { result, checkedAt, transportMode, note } = state
  const checkedTime = checkedAt.toLocaleTimeString()

  return (
    <section className={compact ? 'footer-banner' : 'panel'} aria-live="polite">
      <p className="status-line">
        Server status is{' '}
        <span
          className={`status-value ${
            result.kind === 'up' ? 'status-up' : 'status-down'
          }`}
        >
          {result.statusText}
        </span>
      </p>
      {compact ? (
        <p className="meta compact-meta">
          {transportMode === 'long-poll' ? 'Long polling' : 'Polling fallback'} • Last{' '}
          {checkedTime}
          {result.kind === 'down' ? ` • ${result.error}` : ''}
        </p>
      ) : (
        <>
          <p className="meta">
            Last update: {checkedTime}{' '}
            {transportMode === 'long-poll'
              ? '(long poll reconnects immediately after each response)'
              : '(every 5 seconds)'}
          </p>
          <p className="meta">
            Transport: {transportMode === 'long-poll' ? 'Long polling' : 'Polling fallback'}
          </p>
          <p className="meta">{note}</p>
          {result.kind === 'down' ? <p className="meta">Reason: {result.error}</p> : null}
        </>
      )}
    </section>
  )
}
