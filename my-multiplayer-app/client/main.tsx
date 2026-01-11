import React from 'react'
import ReactDOM from 'react-dom/client'
import { createHashRouter, RouterProvider } from 'react-router-dom'
import './index.css'
import { RoomPage as Room } from './pages/RoomPage'
import { Lobby } from './pages/Lobby' // Import Lobby
import { AuthProvider } from './hooks/useAuth'

// Initialize global logger
import { initLogger } from './utils/logger'
import { useGlobalAndroidIntent } from './hooks/useGlobalAndroidIntent'
initLogger()

// --- ANDROID INTENT BUFFER ---
// Buffer intents until the Editor is ready
if (typeof window !== 'undefined') {
    window.handleSharedFile = (uri: string) => {
        console.log('Buffering shared file:', uri)
        window.pendingFileUri = uri
    }
    window.handleSharedUrl = (url: string) => {
        console.log('Buffering shared url:', url)
        window.pendingUrl = url
    }
}
// -----------------------------

function GlobalIntentHandler() {
    useGlobalAndroidIntent()
    return null
}

const router = createHashRouter([
    {
        path: '/',
        element: <><GlobalIntentHandler /><Lobby /></>, // Show Lobby at root with handler
    },
    {
        path: '/:roomId',
        element: <><GlobalIntentHandler /><Room /></>, // Show Room with handler
    },
])

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
        <AuthProvider>
            <RouterProvider router={router} />
        </AuthProvider>
    </React.StrictMode>
)