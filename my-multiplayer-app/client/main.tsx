import React from 'react'
import ReactDOM from 'react-dom/client'
import { createHashRouter, RouterProvider } from 'react-router-dom'
import './index.css'
import { Room } from './pages/Room'
import { Lobby } from './pages/Lobby' // Import Lobby

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