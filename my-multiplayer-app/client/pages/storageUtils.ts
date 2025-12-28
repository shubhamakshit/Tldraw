// storageUtils.ts
export interface RoomMetadata {
    id: string
    name: string
    lastVisited: number
}

const STORAGE_KEY = 'tldraw_saved_rooms'

export const getRooms = (): RoomMetadata[] => {
    try {
        const stored = localStorage.getItem(STORAGE_KEY)
        return stored ? JSON.parse(stored) : []
    } catch {
        return []
    }
}

export const saveRoom = (id: string, name?: string) => {
    const rooms = getRooms()
    const existing = rooms.find(r => r.id === id)
    const roomName = name || existing?.name || `Untitled Board`
    
    // Create updated list with current room at the top
    const updated = [
        { id, name: roomName, lastVisited: Date.now() },
        ...rooms.filter(r => r.id !== id)
    ]
    
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
    return updated
}

export const deleteRoom = (id: string) => {
    const rooms = getRooms().filter(r => r.id !== id)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rooms))
    return rooms
}

export const updateRoomName = (id: string, newName: string) => {
    const rooms = getRooms()
    const index = rooms.findIndex(r => r.id === id)
    if (index !== -1) {
        rooms[index].name = newName
        rooms[index].lastVisited = Date.now() 
        localStorage.setItem(STORAGE_KEY, JSON.stringify(rooms))
    }
    return rooms
}