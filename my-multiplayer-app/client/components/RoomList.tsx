import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { uniqueId } from 'tldraw' // uniqueId from tldraw
import { RoomMetadata, getRooms, saveRoom, updateRoomName, deleteRoom } from '../pages/storageUtils'
import { colors } from '../constants/theme' // Corrected path
import { PlusIcon, FileIcon, CloseIcon } from './Icons'

interface FileItemProps {
    room: RoomMetadata
    isActive: boolean
    theme: { bg: string; border: string; hover: string; text: string }
    onClick: () => void
    onRename: (id: string, name: string) => void
    onDelete: (id: string) => void
}

function FileItem({ room, isActive, theme, onClick, onRename, onDelete }: FileItemProps) {
    const [isEditing, setIsEditing] = useState(false)
    const [tempName, setTempName] = useState(room.name)
    const [hovered, setHovered] = useState(false)
    const inputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        if (isEditing && inputRef.current) {
            inputRef.current.focus()
            inputRef.current.select()
        }
    }, [isEditing])

    const handleFinish = () => {
        if (tempName.trim()) {
            onRename(room.id, tempName.trim())
        } else {
            setTempName(room.name)
        }
        setIsEditing(false)
    }

    return (
        <div
            onClick={onClick}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            style={{
                display: 'flex',
                alignItems: 'center',
                padding: '8px 10px',
                borderRadius: 6,
                background: isActive ? theme.hover : (hovered ? theme.hover : 'transparent'),
                cursor: 'pointer',
                marginBottom: 2,
            }}
        >
            <div style={{ 
                marginRight: 10, 
                color: isActive ? colors.selected : colors.textMuted,
                display: 'flex',
            }}>
                <FileIcon />
            </div>
            
            <div style={{ flex: 1, minWidth: 0 }}>
                {isEditing ? (
                    <input
                        ref={inputRef}
                        value={tempName}
                        onChange={(e) => setTempName(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') handleFinish()
                            if (e.key === 'Escape') {
                                setTempName(room.name)
                                setIsEditing(false)
                            }
                        }}
                        onBlur={handleFinish}
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            width: '100%',
                            padding: '2px 6px',
                            background: theme.bg,
                            border: `2px solid ${colors.selected}`,
                            borderRadius: 4,
                            fontSize: 13,
                            color: theme.text,
                            outline: 'none',
                        }}
                    />
                ) : (
                    <div 
                        onDoubleClick={(e) => {
                            e.stopPropagation()
                            setIsEditing(true)
                        }}
                        style={{
                            fontSize: 13,
                            fontWeight: isActive ? 600 : 400,
                            color: theme.text,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                        }}
                    >
                        {room.name}
                    </div>
                )}
                <div style={{ 
                    fontSize: 11, 
                    color: colors.textMuted,
                    marginTop: 2,
                }}>
                    {new Date(room.lastVisited).toLocaleDateString()}
                </div>
            </div>
            
            {!isEditing && hovered && (
                <button 
                    onClick={(e) => {
                        e.stopPropagation()
                        onDelete(room.id)
                    }} 
                    style={{ 
                        background: 'none', 
                        border: 'none', 
                        color: colors.textMuted, 
                        cursor: 'pointer', 
                        padding: 4,
                        display: 'flex',
                    }}
                >
                    <CloseIcon />
                </button>
            )}
        </div>
    )
}

export function RoomList({ currentRoomId, theme, onClose }: { currentRoomId: string, theme: any, onClose: () => void }) {
    const navigate = useNavigate()
    const [rooms, setRooms] = useState<RoomMetadata[]>([])

    useEffect(() => {
        setRooms(getRooms().sort((a, b) => b.lastVisited - a.lastVisited))
    }, [])

    const handleCreate = () => {
        const newId = uniqueId()
        saveRoom(newId, `Untitled Board ${rooms.length + 1}`)
        onClose()
        navigate(`/${newId}`)
    }

    const handleRename = (id: string, newName: string) => {
        const updated = updateRoomName(id, newName)
        setRooms(updated.sort((a, b) => b.lastVisited - a.lastVisited))
    }

    const handleDelete = (id: string) => {
        if (confirm('Delete this board?')) {
            const updated = deleteRoom(id)
            setRooms(updated)
            if (id === currentRoomId) navigate('/')
        }
    }

    return (
        <>
            <div style={{ padding: 12 }}>
                <button
                    onClick={handleCreate}
                    style={{
                        width: '100%',
                        padding: '10px 16px',
                        background: colors.selected,
                        color: '#fff',
                        border: 'none',
                        borderRadius: 8,
                        fontSize: 14,
                        fontWeight: 500,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 8,
                    }}
                >
                    <PlusIcon />
                    New Board
                </button>
            </div>

            <div style={{
                padding: '0 12px',
                fontSize: 11,
                fontWeight: 600,
                color: colors.textMuted,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                marginTop: 12,
            }}>
                Recent
            </div>

            <div style={{
                flex: 1,
                overflowY: 'auto',
                padding: '8px 8px 12px',
            }}>
                {rooms.map(room => (
                    <FileItem 
                        key={room.id}
                        room={room}
                        isActive={room.id === currentRoomId}
                        theme={theme}
                        onClick={() => {
                            if (room.id !== currentRoomId) {
                                navigate(`/${room.id}`)
                                onClose()
                            }
                        }}
                        onRename={handleRename}
                        onDelete={handleDelete}
                    />
                ))}
            </div>
        </>
    )
}