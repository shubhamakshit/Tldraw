import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { uniqueId } from 'tldraw'

interface SavedRoom {
    id: string
    lastVisited: number
}

export function Lobby() {
    const navigate = useNavigate()
    const [name, setName] = useState(localStorage.getItem('tldraw_user_name') || '')
    const [recentRooms, setRecentRooms] = useState<SavedRoom[]>([])

    useEffect(() => {
        const stored = localStorage.getItem('tldraw_recent_rooms')
        if (stored) {
            try {
                const parsed = JSON.parse(stored)
                setRecentRooms(parsed.sort((a: SavedRoom, b: SavedRoom) => b.lastVisited - a.lastVisited))
            } catch (e) {
                console.error("Failed to parse recent rooms", e)
            }
        }
    }, [])

    const handleCreate = () => {
        saveName()
        const newId = uniqueId()
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
        const updated = [newEntry, ...recentRooms.filter(r => r.id !== id)].slice(0, 10)
        localStorage.setItem('tldraw_recent_rooms', JSON.stringify(updated))
    }

    return (
        <div style={{ 
            display: 'flex', flexDirection: 'column', minHeight: '100vh',
            backgroundColor: '#000', color: '#fff', padding: '0 20px'
        }}>
            {/* Header / Nav */}
            <nav style={{ 
                height: '64px', display: 'flex', alignItems: 'center', 
                maxWidth: '1000px', width: '100%', margin: '0 auto',
                borderBottom: '1px solid #333', justifyContent: 'space-between'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <svg width="26" height="26" viewBox="0 0 76 65" fill="#fff"><path d="M37.5274 0L75.0548 65H0L37.5274 0Z"></path></svg>
                    <span style={{ fontWeight: 600, fontSize: '1.2rem', letterSpacing: '-0.02em' }}>Collaborative Suite</span>
                </div>
                <div style={{ display: 'flex', gap: '24px' }}>
                     <a href="https://tldraw.com" target="_blank" style={{ fontSize: '0.9rem', color: '#888', textDecoration: 'none' }}>tldraw</a>
                     <a href="https://workers.cloudflare.com" target="_blank" style={{ fontSize: '0.9rem', color: '#888', textDecoration: 'none' }}>Cloudflare</a>
                </div>
            </nav>

            <main style={{ 
                flex: 1, display: 'flex', flexDirection: 'column', 
                maxWidth: '1000px', width: '100%', margin: '80px auto 0'
            }}>
                <div style={{ marginBottom: '60px' }}>
                    <h1 style={{ fontSize: '3.5rem', fontWeight: 800, margin: '0 0 16px 0', letterSpacing: '-0.04em', lineHeight: 1.1 }}>
                        Create, collaborate, <br/>and remove.
                    </h1>
                    <p style={{ color: '#888', fontSize: '1.25rem', maxWidth: '600px', lineHeight: 1.6 }}>
                        A minimalist suite of professional tools for designers and engineers. 
                        Real-time whiteboarding and SOTA color extraction.
                    </p>
                </div>

                {/* Display Name Input (Global for the session) */}
                <div style={{ 
                    marginBottom: '32px', padding: '24px', border: '1px solid #333', borderRadius: '8px',
                    display: 'flex', alignItems: 'center', gap: '20px', background: '#0a0a0a'
                }}>
                    <label style={{ fontSize: '0.75rem', color: '#888', textTransform: 'uppercase', fontWeight: 600, whiteSpace: 'nowrap' }}>Identity</label>
                    <input 
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Enter your display name..."
                        style={{ 
                            background: 'transparent', border: 'none', borderBottom: '1px solid #333',
                            padding: '8px 0', color: '#fff', fontSize: '1.1rem', outline: 'none', flex: 1
                        }}
                        onFocus={e => e.currentTarget.style.borderColor = '#fff'}
                        onBlur={e => e.currentTarget.style.borderColor = '#333'}
                    />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '24px', marginBottom: '80px' }}>
                    {/* Tool 1: Whiteboard */}
                    <div style={{ 
                        padding: '40px', border: '1px solid #333', borderRadius: '12px',
                        display: 'flex', flexDirection: 'column', gap: '24px', position: 'relative', overflow: 'hidden'
                    }}>
                        <div>
                            <div style={{ fontSize: '0.75rem', color: '#0070f3', textTransform: 'uppercase', fontWeight: 700, marginBottom: '8px' }}>Multiplayer Core</div>
                            <h2 style={{ fontSize: '1.8rem', fontWeight: 700, margin: 0 }}>Whiteboard</h2>
                            <p style={{ color: '#888', marginTop: '12px', lineHeight: 1.5 }}>
                                Endless canvas for brainstorming and system design. Built on tldraw SDK.
                            </p>
                        </div>
                        <button 
                            onClick={handleCreate}
                            disabled={!name.trim()}
                            style={{ 
                                padding: '14px', background: '#fff', color: '#000', 
                                border: 'none', borderRadius: '6px', fontWeight: 600,
                                fontSize: '1rem', cursor: 'pointer', transition: '0.2s',
                                opacity: name.trim() ? 1 : 0.5, marginTop: 'auto'
                            }}
                            onMouseOver={e => { if(name.trim()) e.currentTarget.style.background = '#ccc'; }}
                            onMouseOut={e => { e.currentTarget.style.background = '#fff'; }}
                        >
                            New Board
                        </button>
                    </div>

                    {/* Tool 2: ColorRM Pro */}
                    <div style={{ 
                        padding: '40px', border: '1px solid #fff', borderRadius: '12px',
                        display: 'flex', flexDirection: 'column', gap: '24px', 
                        background: 'linear-gradient(135deg, #000 0%, #111 100%)', boxShadow: '0 0 30px rgba(255,255,255,0.05)'
                    }}>
                        <div>
                            <div style={{ fontSize: '0.75rem', color: '#a855f7', textTransform: 'uppercase', fontWeight: 700, marginBottom: '8px' }}>Advanced Extraction</div>
                            <h2 style={{ fontSize: '1.8rem', fontWeight: 700, margin: 0 }}>ColorRM Pro</h2>
                            <p style={{ color: '#888', marginTop: '12px', lineHeight: 1.5 }}>
                                Professional PDF/Image sync with SOTA color removal. Collaborative precision.
                            </p>
                        </div>
                        <a href="/color_rm.html" style={{ 
                            padding: '14px', background: '#0070f3', color: '#fff', 
                            textDecoration: 'none', borderRadius: '6px', fontWeight: 600,
                            fontSize: '1rem', cursor: 'pointer', transition: '0.2s',
                            textAlign: 'center', marginTop: 'auto'
                        }}
                        onMouseOver={e => e.currentTarget.style.background = '#0062d1'}
                        onMouseOut={e => e.currentTarget.style.background = '#0070f3'}
                        >
                            Open ColorRM
                        </a>
                    </div>
                </div>

                {recentRooms.length > 0 && (
                    <div style={{ marginBottom: '100px' }}>
                        <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '24px' }}>Recent Projects</h2>
                        <div style={{ border: '1px solid #333', borderRadius: '8px', overflow: 'hidden' }}>
                            {recentRooms.map((room, i) => (
                                <div 
                                    key={room.id}
                                    onClick={() => handleJoin(room.id)}
                                    style={{ 
                                        padding: '16px 24px', display: 'flex', justifyContent: 'space-between',
                                        alignItems: 'center', cursor: 'pointer', transition: '0.2s',
                                        borderBottom: i === recentRooms.length - 1 ? 'none' : '1px solid #333',
                                        background: '#000'
                                    }}
                                    onMouseOver={e => e.currentTarget.style.background = '#111'}
                                    onMouseOut={e => e.currentTarget.style.background = '#000'}
                                >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                        <div style={{ width: '32px', height: '32px', background: '#333', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem' }}>
                                            {i + 1}
                                        </div>
                                        <span style={{ fontWeight: 500 }}>{room.id}</span>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
                                        <span style={{ color: '#888', fontSize: '0.9rem' }}>{new Date(room.lastVisited).toLocaleDateString()}</span>
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </main>

            <footer style={{ 
                padding: '40px 0', borderTop: '1px solid #333', maxWidth: '1000px', 
                width: '100%', margin: '0 auto', display: 'flex', 
                justifyContent: 'space-between', color: '#888', fontSize: '0.8rem'
            }}>
                <div>Built with tldraw & Cloudflare</div>
                <div style={{ display: 'flex', gap: '24px' }}>
                    <span>v2.4.0</span>
                    <a href="#" style={{ color: 'inherit', textDecoration: 'none' }}>Documentation</a>
                    <a href="#" style={{ color: 'inherit', textDecoration: 'none' }}>GitHub</a>
                </div>
            </footer>
        </div>
    )
}