import { useState, useEffect } from 'react'
import { useBackups, BackupItem } from '../hooks/useBackups'
import { useAuth } from '../hooks/useAuth'
import { colors } from '../constants/theme'
import { uniqueId } from 'tldraw'
import { saveRoom } from '../pages/storageUtils'
import { useNavigate } from 'react-router-dom'

export function BackupList() {
    const { isAuthenticated } = useAuth()
    const { backups, isLoading, error, fetchBackups, fetchBackupContent, deleteBackup } = useBackups()
    const navigate = useNavigate()

    // Selection state for bulk actions
    const [selectedBackups, setSelectedBackups] = useState<Set<string>>(new Set())
    const [isDeleting, setIsDeleting] = useState(false)

    // Restore Modal state
    const [restoreModalOpen, setRestoreModalOpen] = useState(false)
    const [selectedBackupForRestore, setSelectedBackupForRestore] = useState<BackupItem | null>(null)
    const [isBulkRestore, setIsBulkRestore] = useState(false)

    useEffect(() => {
        if (isAuthenticated) {
            fetchBackups()
        }
    }, [isAuthenticated, fetchBackups])

    if (!isAuthenticated) return null

    // --- Selection Handlers ---

    const toggleSelection = (key: string) => {
        const newSet = new Set(selectedBackups)
        if (newSet.has(key)) {
            newSet.delete(key)
        } else {
            newSet.add(key)
        }
        setSelectedBackups(newSet)
    }

    const toggleSelectAll = () => {
        if (selectedBackups.size === backups.length) {
            setSelectedBackups(new Set())
        } else {
            setSelectedBackups(new Set(backups.map(b => b.key)))
        }
    }

    const handleBulkDelete = async () => {
        if (selectedBackups.size === 0) return
        if (!confirm(`Are you sure you want to permanently delete ${selectedBackups.size} backup(s)?`)) return

        setIsDeleting(true)
        try {
            // Execute deletions in parallel
            await Promise.all(Array.from(selectedBackups).map(key => deleteBackup(key)))
            setSelectedBackups(new Set())
        } catch (e) {
            alert('Some deletions failed. Please try refreshing.')
        } finally {
            setIsDeleting(false)
        }
    }

    const handleBulkRestore = () => {
        if (selectedBackups.size === 0) return
        setIsBulkRestore(true)
        setRestoreModalOpen(true)
        setSelectedBackupForRestore(null)
    }

    const processBulkRestore = async (mode: 'new' | 'overwrite') => {
        setRestoreModalOpen(false)
        try {
            const backupsToRestore = backups.filter(b => selectedBackups.has(b.key))

            // Process sequentially to avoid overwhelming browser/network
            for (const backup of backupsToRestore) {
                try {
                    const content = await fetchBackupContent(backup.key)

                    let targetId = uniqueId()
                    let isOverwrite = false

                    if (mode === 'overwrite' && backup.originalId) {
                        targetId = backup.originalId
                        isOverwrite = true
                    }

                    // Use localStorage for cross-tab persistence
                    localStorage.setItem(`restore_data_${targetId}`, JSON.stringify(content))

                    if (isOverwrite) {
                        saveRoom(targetId, backup.name)
                    } else {
                        saveRoom(targetId, `Restored: ${backup.name}`)
                    }

                    window.open(`/${targetId}`, '_blank')
                } catch (err) {
                    console.error(`Failed to restore ${backup.name}`, err)
                }
            }

            setSelectedBackups(new Set())
            setIsBulkRestore(false)
        } catch (e) {
            alert('Bulk restore encountered errors.')
        }
    }

    // --- Restore Handlers ---

    const initiateRestore = (backup: BackupItem) => {
        setSelectedBackupForRestore(backup)
        setIsBulkRestore(false)
        setRestoreModalOpen(true)
    }

    const processRestore = async (backup: BackupItem, mode: 'new' | 'overwrite') => {
        setRestoreModalOpen(false)

        try {
            // 1. Fetch content
            const content = await fetchBackupContent(backup.key)

            // 2. Determine Room ID
            let targetId = uniqueId()
            let isOverwrite = false

            if (mode === 'overwrite' && backup.originalId) {
                targetId = backup.originalId
                isOverwrite = true
            }

            // 3. Store for restoration
            // We use sessionStorage to pass the payload to the RoomPage
            sessionStorage.setItem(`restore_data_${targetId}`, JSON.stringify(content))

            // Update local storage name if needed
            if (!isOverwrite) {
                saveRoom(targetId, `Restored: ${backup.name}`)
            } else {
                // If overwriting, maybe keep original name or update it?
                // Let's ensure the room name is consistent with the backup
                saveRoom(targetId, backup.name)
            }

            // 4. Navigate
            navigate(`/${targetId}`)

        } catch (e) {
            alert('Failed to restore backup: ' + e)
        }
    }

    return (
        <div style={{ marginTop: 40, border: '1px solid #333', borderRadius: 12, padding: 24, background: '#0a0a0a' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <h2 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>Cloud Backups</h2>
                    {backups.length > 0 && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.9rem', color: '#666', marginLeft: 12 }}>
                            <input
                                type="checkbox"
                                checked={selectedBackups.size === backups.length && backups.length > 0}
                                onChange={toggleSelectAll}
                                style={{ cursor: 'pointer' }}
                            />
                            <span>Select All</span>
                        </div>
                    )}
                </div>

                <div style={{ display: 'flex', gap: 12 }}>
                    {selectedBackups.size > 0 && (
                        <>
                            <button
                                onClick={handleBulkRestore}
                                style={{
                                    background: '#113311', border: '1px solid #225522', color: '#aaffaa',
                                    padding: '6px 12px', borderRadius: 6, cursor: 'pointer',
                                    fontSize: '0.9rem', fontWeight: 600
                                }}
                            >
                                Restore ({selectedBackups.size})
                            </button>
                            <button
                                onClick={handleBulkDelete}
                                disabled={isDeleting}
                                style={{
                                    background: '#331111', border: '1px solid #552222', color: '#ffaaaa',
                                    padding: '6px 12px', borderRadius: 6, cursor: 'pointer',
                                    fontSize: '0.9rem', fontWeight: 600
                                }}
                            >
                                {isDeleting ? 'Deleting...' : `Delete (${selectedBackups.size})`}
                            </button>
                        </>
                    )}
                    <button
                        onClick={() => fetchBackups()}
                        style={{ background: 'none', border: 'none', color: colors.selected, cursor: 'pointer' }}
                    >
                        Refresh
                    </button>
                </div>
            </div>

            {isLoading && <div style={{ color: '#888' }}>Loading backups...</div>}
            {error && <div style={{ color: '#ff6b6b' }}>{error}</div>}

            {!isLoading && !error && backups.length === 0 && (
                <div style={{ color: '#888', fontStyle: 'italic' }}>No backups found. Open a board to create one.</div>
            )}

            <div style={{ display: 'grid', gap: 12 }}>
                {backups.map(backup => {
                    const isSelected = selectedBackups.has(backup.key)
                    return (
                        <div key={backup.key} style={{
                            padding: 16, border: isSelected ? `1px solid ${colors.selected}` : '1px solid #333',
                            borderRadius: 8,
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            background: isSelected ? 'rgba(0, 112, 243, 0.05)' : '#111',
                            transition: 'all 0.2s'
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                                <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => toggleSelection(backup.key)}
                                    style={{ cursor: 'pointer', transform: 'scale(1.2)' }}
                                />
                                <div>
                                    <div style={{ fontWeight: 600, fontSize: '1rem', color: '#fff' }}>{backup.name}</div>
                                    <div style={{ fontSize: '0.8rem', color: '#666', marginTop: 4 }}>
                                        {new Date(backup.date).toLocaleString()} • {(backup.size / 1024).toFixed(1)} KB
                                        {backup.originalId && <span style={{ marginLeft: 8, opacity: 0.7 }}>[ID: {backup.originalId.slice(0, 8)}...]</span>}
                                    </div>
                                </div>
                            </div>
                            <button
                                onClick={() => initiateRestore(backup)}
                                style={{
                                    padding: '8px 16px', background: '#333', color: '#fff',
                                    border: 'none', borderRadius: 6, cursor: 'pointer',
                                    fontSize: '0.9rem', fontWeight: 500
                                }}
                                onMouseOver={e => e.currentTarget.style.background = '#444'}
                                onMouseOut={e => e.currentTarget.style.background = '#333'}
                            >
                                Restore
                            </button>
                        </div>
                    )
                })}
            </div>

            {/* Restore Options Modal */}
            {restoreModalOpen && (selectedBackupForRestore || isBulkRestore) && (
                <div style={{
                    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 1000,
                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                }} onClick={() => setRestoreModalOpen(false)}>
                    <div
                        style={{
                            background: '#1a1a1a', border: '1px solid #333', borderRadius: 12, padding: 32,
                            maxWidth: 500, width: '90%', color: '#fff',
                            boxShadow: '0 20px 50px rgba(0,0,0,0.5)'
                        }}
                        onClick={e => e.stopPropagation()}
                    >
                        {isBulkRestore ? (
                            <>
                                <h3 style={{ marginTop: 0, fontSize: '1.5rem' }}>Bulk Restore</h3>
                                <p style={{ color: '#ccc', lineHeight: 1.5 }}>
                                    You are about to restore <strong>{selectedBackups.size}</strong> backups.
                                </p>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 24 }}>
                                    <button
                                        onClick={() => processBulkRestore('new')}
                                        style={{
                                            padding: '16px', background: '#333', border: '1px solid #444', borderRadius: 8,
                                            color: '#fff', cursor: 'pointer', textAlign: 'left',
                                            transition: 'background 0.2s'
                                        }}
                                        onMouseOver={e => e.currentTarget.style.background = '#444'}
                                        onMouseOut={e => e.currentTarget.style.background = '#333'}
                                    >
                                        <div style={{ fontWeight: 600, fontSize: '1.1rem', marginBottom: 4 }}>Restore as New Boards</div>
                                        <div style={{ fontSize: '0.9rem', color: '#888' }}>
                                            Creates {selectedBackups.size} new rooms. Safe and non-destructive.
                                        </div>
                                    </button>

                                    <button
                                        onClick={() => processBulkRestore('overwrite')}
                                        style={{
                                            padding: '16px', background: '#331111', border: '1px solid #552222', borderRadius: 8,
                                            color: '#ffaaaa', cursor: 'pointer', textAlign: 'left'
                                        }}
                                        onMouseOver={e => e.currentTarget.style.background = '#441111'}
                                        onMouseOut={e => e.currentTarget.style.background = '#331111'}
                                    >
                                        <div style={{ fontWeight: 600, fontSize: '1.1rem', marginBottom: 4 }}>Overwrite Originals</div>
                                        <div style={{ fontSize: '0.9rem', color: '#ffaaaa', opacity: 0.8 }}>
                                            Restores to original Room IDs where available.
                                            {(() => {
                                                const overwriteCount = backups.filter(b => selectedBackups.has(b.key) && b.originalId).length
                                                const missingCount = selectedBackups.size - overwriteCount
                                                if (missingCount > 0) {
                                                    return ` (${overwriteCount} will overwrite, ${missingCount} will be new)`
                                                }
                                                return ' All selected backups have original IDs.'
                                            })()}
                                        </div>
                                    </button>
                                </div>
                            </>
                        ) : (
                            <>
                                <h3 style={{ marginTop: 0, fontSize: '1.5rem' }}>Restore Backup</h3>
                                <p style={{ color: '#ccc', lineHeight: 1.5 }}>
                                    How would you like to restore <strong>{selectedBackupForRestore?.name}</strong>?
                                </p>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 24 }}>
                                    <button
                                        onClick={() => selectedBackupForRestore && processRestore(selectedBackupForRestore, 'new')}
                                        style={{
                                            padding: '16px', background: '#333', border: '1px solid #444', borderRadius: 8,
                                            color: '#fff', cursor: 'pointer', textAlign: 'left',
                                            transition: 'background 0.2s'
                                        }}
                                        onMouseOver={e => e.currentTarget.style.background = '#444'}
                                        onMouseOut={e => e.currentTarget.style.background = '#333'}
                                    >
                                        <div style={{ fontWeight: 600, fontSize: '1.1rem', marginBottom: 4 }}>Create New Board</div>
                                        <div style={{ fontSize: '0.9rem', color: '#888' }}>
                                            Import this backup into a completely new room. Safe and non-destructive.
                                        </div>
                                    </button>

                                    {selectedBackupForRestore?.originalId ? (
                                        <button
                                            onClick={() => selectedBackupForRestore && processRestore(selectedBackupForRestore, 'overwrite')}
                                            style={{
                                                padding: '16px', background: '#331111', border: '1px solid #552222', borderRadius: 8,
                                                color: '#ffaaaa', cursor: 'pointer', textAlign: 'left'
                                            }}
                                            onMouseOver={e => e.currentTarget.style.background = '#441111'}
                                            onMouseOut={e => e.currentTarget.style.background = '#331111'}
                                        >
                                            <div style={{ fontWeight: 600, fontSize: '1.1rem', marginBottom: 4 }}>Overwrite Original</div>
                                            <div style={{ fontSize: '0.9rem', color: '#ffaaaa', opacity: 0.8 }}>
                                                Restore to original room <code>{selectedBackupForRestore.originalId}</code>.
                                                <strong> Warning: This will overwrite current data in that room.</strong>
                                            </div>
                                        </button>
                                    ) : (
                                        <div style={{
                                            padding: '16px', background: '#222', border: '1px solid #333', borderRadius: 8,
                                            color: '#666', cursor: 'not-allowed'
                                        }}>
                                            <div style={{ fontWeight: 600, fontSize: '1.1rem', marginBottom: 4 }}>Overwrite Original</div>
                                            <div style={{ fontSize: '0.9rem' }}>
                                                Not available (Original Room ID not found in backup metadata).
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </>
                        )}

                        <div style={{ marginTop: 24, display: 'flex', justifyContent: 'flex-end' }}>
                            <button
                                onClick={() => setRestoreModalOpen(false)}
                                style={{
                                    padding: '10px 20px', background: 'none', border: 'none',
                                    color: '#888', cursor: 'pointer', fontSize: '1rem'
                                }}
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
