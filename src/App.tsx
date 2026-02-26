import { useState } from 'react'
import { AuthPanel } from './features/auth/AuthPanel'
import { type AuthState } from './features/auth/authApi'
import { GamesLobby } from './features/games/GamesLobby'
import { HealthStatus } from './features/health/HealthStatus'
import './App.css'

function App() {
  const [authState, setAuthState] = useState<AuthState | null>(null)

  return (
    <div className="app-page">
      <main className="app-shell">
        <div className="app-layout">
          <aside className="sidebar-menu" aria-label="Main menu">
            <h1>Space Grid Game</h1>
            <AuthPanel onAuthStateChange={setAuthState} />
          </aside>

          <GamesLobby authState={authState} />
        </div>
      </main>
      <footer className="app-footer">
        <HealthStatus compact />
      </footer>
    </div>
  )
}

export default App
