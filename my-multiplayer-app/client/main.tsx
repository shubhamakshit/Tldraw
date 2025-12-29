import React from 'react'
import ReactDOM from 'react-dom/client'
import { createHashRouter, RouterProvider } from 'react-router-dom'
import './index.css'
import { Room } from './pages/Room'
import { Lobby } from './pages/Lobby' // Import Lobby

// --- NUCLEAR CLEAN ---
// Wipes all local data to guarantee a fresh start
try {
    console.warn('Performing NUCLEAR CLEAN of local storage...')
    localStorage.clear()
    
    // Also try to nuke IndexedDB if tldraw is using it
    if (window.indexedDB) {
        window.indexedDB.databases().then((dbs) => {
            dbs.forEach((db) => {
                if (db.name && db.name.includes('tldraw')) {
                    window.indexedDB.deleteDatabase(db.name)
                }
            })
        })
    }
} catch (e) {
    console.error('Nuclear clean failed:', e)
}
// ---------------------

const router = createHashRouter([
    {
        path: '/',
        element: <Lobby />, // Show Lobby at root
    },
    {
        path: '/:roomId',
        element: <Room />,
    },
])

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
        <RouterProvider router={router} />
    </React.StrictMode>
)