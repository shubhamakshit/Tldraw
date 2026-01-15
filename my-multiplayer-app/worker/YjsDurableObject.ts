import { DurableObject } from 'cloudflare:workers'
import { AutoRouter, IRequest, error } from 'itty-router'

/**
 * Simple WebSocket relay Durable Object for beta sync
 * Broadcasts all messages to all connected clients.
 * State management happens client-side.
 */

interface Session {
    socket: WebSocket
    clientId: string
}

interface PageState {
    history: any[]
    metadata?: any
}

export class YjsDurableObject extends DurableObject {
    sessions: Session[] = []
    roomId: string | null = null
    // Store page states
    pageStates: Map<number, PageState> = new Map()

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
        const session: Session = { socket: server, clientId }
        this.sessions.push(session)

        console.log(`[Yjs DO] Client connected: ${clientId}, room: ${this.roomId}`)

        // Send current state to new client
        if (this.pageStates.size > 0) {
            for (const [pageIdx, state] of this.pageStates) {
                try {
                    server.send(JSON.stringify({
                        type: 'state-update',
                        pageIdx,
                        history: state.history,
                        metadata: state.metadata
                    }))
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

                    // Handle state updates - store and broadcast
                    if (msg.type === 'state-update' && msg.pageIdx !== undefined) {
                        // Store the state
                        this.pageStates.set(msg.pageIdx, {
                            history: msg.history || [],
                            metadata: msg.metadata
                        })

                        // Persist periodically
                        if (this.pageStates.size % 5 === 0 || msg.history?.length % 10 === 0) {
                            const toStore: Record<number, PageState> = {}
                            this.pageStates.forEach((v, k) => { toStore[k] = v })
                            await this.ctx.storage.put('pageStates', toStore)
                        }
                    }

                    // Broadcast to all other clients
                    this.broadcast(data, clientId)
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
            console.log(`[Yjs DO] Client disconnected: ${clientId}`)
        })

        server.addEventListener('error', (e) => {
            console.error('[Yjs DO] WebSocket error:', e)
            this.sessions = this.sessions.filter(s => s.clientId !== clientId)
        })

        return new Response(null, { status: 101, webSocket: client })
    }

    broadcast(data: string | ArrayBuffer | Uint8Array, excludeClientId?: string) {
        for (const session of this.sessions) {
            if (session.clientId === excludeClientId) continue
            try {
                if (session.socket.readyState === WebSocket.OPEN) {
                    session.socket.send(data)
                }
            } catch (e) {
                console.error('[Yjs DO] Broadcast error:', e)
            }
        }
    }
}
