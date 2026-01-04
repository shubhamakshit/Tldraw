import { useState, useCallback } from 'react'
import { useAuth } from './useAuth'
import { apiUrl } from '../config'

export interface BackupItem {
    key: string
    name: string
    date: string
    size: number
    type: string
    originalId?: string
}

export function useBackups() {
    const { token, isAuthenticated } = useAuth()
    const [backups, setBackups] = useState<BackupItem[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const fetchBackups = useCallback(async () => {
        if (!isAuthenticated || !token) return
        setIsLoading(true)
        setError(null)
        try {
            const res = await fetch(apiUrl('/api/backups'), {
                headers: { 'Authorization': `Bearer ${token}` }
            })
            if (!res.ok) throw new Error('Failed to fetch backups')
            const data = await res.json() as any
            setBackups(data.backups)
        } catch (e: any) {
            setError(e.message)
        } finally {
            setIsLoading(false)
        }
    }, [isAuthenticated, token])

    const createBackup = useCallback(async (snapshot: any, roomName: string, roomId: string, type: string = 'tldraw') => {
        if (!isAuthenticated || !token) throw new Error('Not authenticated')

        try {
            const res = await fetch(apiUrl('/api/backup'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ snapshot, roomName, roomId, type })
            })

            if (!res.ok) throw new Error('Backup failed')

            const data = await res.json() as any
            return data
        } catch (e: any) {
            throw e
        }
    }, [isAuthenticated, token])

    const deleteBackup = useCallback(async (key: string) => {
        if (!isAuthenticated || !token) throw new Error('Not authenticated')

        try {
            const encodedKey = encodeURIComponent(key)
            const res = await fetch(apiUrl(`/api/backup/${encodedKey}`), {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            })

            if (!res.ok) throw new Error('Delete failed')

            // Optimistic update
            setBackups(prev => prev.filter(b => b.key !== key))

            return true
        } catch (e: any) {
            throw e
        }
    }, [isAuthenticated, token])

    const fetchBackupContent = useCallback(async (key: string) => {
        if (!isAuthenticated || !token) throw new Error('Not authenticated')

        // Key contains / which needs encoding? Usually path params handle it, but key is "backups/user/..."
        // The server expects encoded key in param: /api/backup/:key
        const encodedKey = encodeURIComponent(key)

        const res = await fetch(apiUrl(`/api/backup/${encodedKey}`), {
            headers: { 'Authorization': `Bearer ${token}` }
        })

        if (!res.ok) throw new Error('Failed to fetch backup content')
        return await res.json()
    }, [isAuthenticated, token])

    return {
        backups,
        isLoading,
        error,
        fetchBackups,
        createBackup,
        fetchBackupContent,
        deleteBackup
    }
}
