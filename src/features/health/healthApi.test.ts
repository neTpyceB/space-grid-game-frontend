import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fetchHealthStatusLongPoll,
  fetchHealthStatusSnapshot,
  UnsupportedLongPollingError,
} from './healthApi'

const originalFetch = globalThis.fetch

afterEach(() => {
  vi.restoreAllMocks()
  globalThis.fetch = originalFetch
})

describe('fetchHealthStatusSnapshot', () => {
  it('requests the new server status endpoint and parses JSON status', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 'ok' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    globalThis.fetch = fetchMock as typeof fetch

    const result = await fetchHealthStatusSnapshot()

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/server/status',
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: expect.stringContaining('application/json'),
        }),
      }),
    )
    expect(result).toEqual({ kind: 'up', statusText: 'ok' })
  })

  it('parses plain-text responses as status text', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('OK', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      }),
    )
    globalThis.fetch = fetchMock as typeof fetch

    const result = await fetchHealthStatusSnapshot()

    expect(result).toEqual({ kind: 'up', statusText: 'OK' })
  })

  it('returns DOWN result on HTTP error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('fail', {
        status: 503,
        statusText: 'Service Unavailable',
      }),
    )
    globalThis.fetch = fetchMock as typeof fetch

    const result = await fetchHealthStatusSnapshot()

    expect(result.kind).toBe('down')
    if (result.kind === 'down') {
      expect(result.error).toContain('HTTP 503')
    }
  })
})

describe('fetchHealthStatusLongPoll', () => {
  it('requests the new long-poll endpoint with cursor and timeout and parses response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'ok',
          cursor: 'v2',
          timeout: true,
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    )
    globalThis.fetch = fetchMock as typeof fetch

    const result = await fetchHealthStatusLongPoll('v1')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/server/status/long-poll?')
    expect(String(url)).toContain('since=v1')
    expect(String(url)).toContain('timeoutSeconds=30')
    expect(result).toEqual({
      result: { kind: 'up', statusText: 'ok' },
      cursor: 'v2',
      timedOut: true,
    })
  })

  it('throws unsupported error when long-poll endpoint is not implemented', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 404,
        statusText: 'Not Found',
      }),
    )
    globalThis.fetch = fetchMock as typeof fetch

    await expect(fetchHealthStatusLongPoll(null)).rejects.toBeInstanceOf(
      UnsupportedLongPollingError,
    )
  })

  it('returns DOWN cycle on transient network error and keeps cursor', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network failed'))
    globalThis.fetch = fetchMock as typeof fetch

    const result = await fetchHealthStatusLongPoll('v7')

    expect(result.cursor).toBe('v7')
    expect(result.timedOut).toBe(false)
    expect(result.result.kind).toBe('down')
    if (result.result.kind === 'down') {
      expect(result.result.error).toContain('network failed')
    }
  })
})
