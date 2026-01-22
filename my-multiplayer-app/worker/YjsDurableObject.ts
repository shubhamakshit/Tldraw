import { DurableObject } from 'cloudflare:workers'
import { AutoRouter, IRequest, error } from 'itty-router'

/**
 * Optimized WebSocket Durable Object for Yjs-style sync
 * Uses delta-based updates and throttled presence for performance.
 */

interface Session {
    socket: WebSocket
    clientId: string
    lastPresenceTime: number
}

interface PageState {
    history: any[]
    metadata?: any
    lastUpdate: number
}

// Throttle presence updates to 50ms
const PRESENCE_THROTTLE_MS = 50

export class YjsDurableObject extends DurableObject {
    sessions: Session[] = []
    roomId: string | null = null
    // Store page states
    pageStates: Map<number, PageState> = new Map()
    // Track last known history length per client per page (for delta detection)
    clientPageVersions: Map<string, Map<number, number>> = new Map()
    // Pending save timer
    saveTimer: ReturnType<typeof setTimeout> | null = null

    constructor(ctx: DurableObjectState, env: Env) {
        super(ctx, env)
        this.ctx.blockConcurrencyWhile(async () => {
            this.roomId = await this.ctx.storage.get('roomId') as string | null
            // Load stored page states
            const stored = await this.ctx.storage.get('pageStates') as any
            if (stored) {
                this.pageStates = new Map(Object.entries(stored).map(([k, v]) => [parseInt(k), v as PageState]))
            }
        })
    }

    private readonly router = AutoRouter({
        catch: (e) => {
            console.error('Yjs DO Error:', e)
            return error(500, 'Internal Server Error')
        },
    })
        .get('/yjs/:roomId', async (request) => {
            if (!this.roomId) {
                this.roomId = request.params.roomId
                await this.ctx.storage.put('roomId', this.roomId)
            }
            return this.handleConnect(request)
        })

    fetch(request: Request): Response | Promise<Response> {
        return this.router.fetch(request)
    }

    async handleConnect(request: IRequest) {
        const upgradeHeader = request.headers.get('Upgrade')
        if (upgradeHeader !== 'websocket') {
            return error(400, 'Expected WebSocket upgrade')
        }

        const { 0: client, 1: server } = new WebSocketPair()
        server.accept()

        const clientId = `client_${Date.now()}_${Math.random().toString(36).slice(2)}`
        const session: Session = { socket: server, clientId, lastPresenceTime: 0 }
        this.sessions.push(session)

        // Initialize version tracking for this client
        this.clientPageVersions.set(clientId, new Map())

        console.log(`[Yjs DO] Client connected: ${clientId}, room: ${this.roomId}, total: ${this.sessions.length}`)

        // Send current state to new client (full sync on connect)
        if (this.pageStates.size > 0) {
            for (const [pageIdx, state] of this.pageStates) {
                try {
                    server.send(JSON.stringify({
                        type: 'state-update',
                        pageIdx,
                        history: state.history,
                        metadata: state.metadata,
                        timestamp: state.lastUpdate
                    }))
                    // Mark this client as having this version
                    this.clientPageVersions.get(clientId)?.set(pageIdx, state.history.length)
                } catch (e) {
                    console.error('[Yjs DO] Error sending stored state:', e)
                }
            }
        }

        server.addEventListener('message', async (event) => {
            try {
                const data = event.data

                if (typeof data === 'string') {
                    const msg = JSON.parse(data)

                    // Handle state updates
                    if (msg.type === 'state-update' && msg.pageIdx !== undefined) {
                        const pageIdx = msg.pageIdx
                        const incomingHistory = msg.history || []
                        const existingState = this.pageStates.get(pageIdx)
                        const existingLen = existingState?.history?.length || 0

                        // OPTIMIZATION: Only store if history actually changed
                        if (incomingHistory.length !== existingLen || !existingState) {
                            this.pageStates.set(pageIdx, {
                                history: incomingHistory,
                                metadata: msg.metadata,
                                lastUpdate: Date.now()
                            })

                            // Debounced persist (save after 1 second of no updates)
                            this.scheduleSave()
                        }

                        // Broadcast to other clients immediately
                        this.broadcast(data, clientId)

                        // Update sender's version tracking
                        this.clientPageVersions.get(clientId)?.set(pageIdx, incomingHistory.length)
                    }
                    // Handle presence - with throttling
                    else if (msg.type === 'presence') {
                        const now = Date.now()
                        if (now - session.lastPresenceTime >= PRESENCE_THROTTLE_MS) {
                            session.lastPresenceTime = now
                            // Broadcast presence immediately (it's small)
                            this.broadcast(data, clientId)
                        }
                        // Else drop the presence update (throttled)
                    }
                    // Handle page structure
                    else if (msg.type === 'page-structure') {
                        // Broadcast immediately
                        this.broadcast(data, clientId)
                    }
                    // Other messages - relay immediately
                    else {
                        this.broadcast(data, clientId)
                    }
                } else if (data instanceof ArrayBuffer || data instanceof Uint8Array) {
                    // Binary messages - just relay
                    this.broadcast(data, clientId)
                }
            } catch (err) {
                console.error('[Yjs DO] Message handling error:', err)
            }
        })

        server.addEventListener('close', () => {
            this.sessions = this.sessions.filter(s => s.clientId !== clientId)
            this.clientPageVersions.delete(clientId)
            console.log(`[Yjs DO] Client disconnected: ${clientId}, remaining: ${this.sessions.length}`)
        })

        server.addEventListener('error', (e) => {
            console.error('[Yjs DO] WebSocket error:', e)
            this.sessions = this.sessions.filter(s => s.clientId !== clientId)
            this.clientPageVersions.delete(clientId)
        })

        return new Response(null, { status: 101, webSocket: client })
    }

    scheduleSave() {
        if (this.saveTimer) {
            clearTimeout(this.saveTimer)
        }
        this.saveTimer = setTimeout(async () => {
            try {
                const toStore: Record<number, PageState> = {}
                this.pageStates.forEach((v, k) => { toStore[k] = v })
                await this.ctx.storage.put('pageStates', toStore)
                console.log(`[Yjs DO] Persisted ${this.pageStates.size} pages to storage`)
            } catch (e) {
                console.error('[Yjs DO] Save error:', e)
            }
        }, 1000) // Save 1 second after last update
    }

    broadcast(data: string | ArrayBuffer | Uint8Array, excludeClientId?: string) {
        let sent = 0
        for (const session of this.sessions) {
            if (session.clientId === excludeClientId) continue
            try {
                if (session.socket.readyState === WebSocket.OPEN) {
                    session.socket.send(data)
                    sent++
                }
            } catch (e) {
                console.error('[Yjs DO] Broadcast error:', e)
            }
        }
    }
}
