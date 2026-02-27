const ENV_API_BASE = String(import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '')

function runtimeFallbackApiBase(): string {
  if (typeof window === 'undefined') {
    return ''
  }

  const host = window.location.hostname.toLowerCase()

  if (host === 'gridgame.online' || host === 'www.gridgame.online') {
    return 'https://api.gridgame.online'
  }

  if (host === 'space-grid-game.up.railway.app') {
    return 'https://space-grid-game-backend.up.railway.app'
  }

  return ''
}

export function getApiBaseUrl(): string {
  return ENV_API_BASE || runtimeFallbackApiBase()
}

export function apiUrl(path: string): string {
  const base = getApiBaseUrl()
  return base ? `${base}${path}` : path
}

