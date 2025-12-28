import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { uniqueId } from 'tldraw'

// Types for our local storage data
interface SavedRoom {
    id: string
    lastVisited: number
}

export function Lobby() {
    const navigate = useNavigate()
    const [name, setName] = useState(localStorage.getItem('tldraw_user_name') || '')
    const [recentRooms, setRecentRooms] = useState<SavedRoom[]>([])

    useEffect(() => {
        // Load recent rooms
        const stored = localStorage.getItem('tldraw_recent_rooms')
        if (stored) {
            try {
                const parsed = JSON.parse(stored)
                // Sort by newest first
                setRecentRooms(parsed.sort((a: SavedRoom, b: SavedRoom) => b.lastVisited - a.lastVisited))
            } catch (e) {
                console.error("Failed to parse recent rooms", e)
            }
        }
    }, [])

    const handleCreate = () => {
        saveName()
        const newId = uniqueId()
        // Save to recent list immediately
        addToRecents(newId)
        navigate(`/${newId}`)
    }

    const handleJoin = (id: string) => {
        saveName()
        addToRecents(id)
        navigate(`/${id}`)
    }

    const saveName = () => {
        if (name.trim()) {
            localStorage.setItem('tldraw_user_name', name.trim())
        }
    }

    const addToRecents = (id: string) => {
        const newEntry = { id, lastVisited: Date.now() }
        const updated = [newEntry, ...recentRooms.filter(r => r.id !== id)].slice(0, 10) // Keep top 10
        localStorage.setItem('tldraw_recent_rooms', JSON.stringify(updated))
    }

    return (
        <div style={{ 
            display: 'flex', flexDirection: 'column', alignItems: 'center', 
            justifyContent: 'center', height: '100vh', gap: '20px',
            fontFamily: 'sans-serif', backgroundColor: '#f0f0f0' 
        }}>
            <h1>Multiplayer Whiteboard</h1>
            
            {/* 1. USER AUTH (Simple) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                <label>Your Name</label>
                <input 
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Enter your name..."
                    style={{ padding: '10px', fontSize: '16px', borderRadius: '5px', border: '1px solid #ccc' }}
                />
            </div>

            {/* 2. CREATE BOARD */}
            <button 
                onClick={handleCreate}
                disabled={!name.trim()}
                style={{ 
                    padding: '10px 20px', fontSize: '18px', cursor: 'pointer',
                    backgroundColor: name.trim() ? '#2f80ed' : '#ccc', 
                    color: 'white', border: 'none', borderRadius: '5px' 
                }}
            >
                Create New Board
            </button>

            {/* 3. RECENT BOARDS MANAGER */}
            {recentRooms.length > 0 && (
                <div style={{ marginTop: '20px', width: '300px' }}>
                    <h3>Recent Boards</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {recentRooms.map(room => (
                            <div 
                                key={room.id}
                                onClick={() => handleJoin(room.id)}
                                style={{ 
                                    padding: '10px', backgroundColor: 'white', 
                                    borderRadius: '5px', cursor: 'pointer',
                                    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                                    display: 'flex', justifyContent: 'space-between'
                                }}
                            >
                                <span>{room.id.substring(0, 15)}...</span>
                                <span style={{ color: '#888', fontSize: '12px' }}>
                                    {new Date(room.lastVisited).toLocaleDateString()}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    )
}