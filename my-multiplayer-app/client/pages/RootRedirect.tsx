// RootRedirect.tsx
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { uniqueId } from 'tldraw'
import { getRooms, saveRoom } from './storageUtils'

export function RootRedirect() {
    const navigate = useNavigate()

    useEffect(() => {
        const rooms = getRooms()
        // Sort by recency (newest timestamp first)
        rooms.sort((a, b) => b.lastVisited - a.lastVisited)

        if (rooms.length > 0) {
            navigate(`/${rooms[0].id}`, { replace: true })
        } else {
            const newId = uniqueId()
            saveRoom(newId, 'My First Board')
            navigate(`/${newId}`, { replace: true })
        }
    }, [navigate])

    return null
}