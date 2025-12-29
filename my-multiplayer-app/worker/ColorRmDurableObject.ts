import { DurableObject } from 'cloudflare:workers'
import { AutoRouter, IRequest, error } from 'itty-router'

interface Session {
    socket: WebSocket
    sessionId: string
}

export class ColorRmDurableObject extends DurableObject {
    sessions: Session[] = []
    state: any = null // Will hold the color_rm app state
    roomId: string | null = null

    constructor(ctx: DurableObjectState, env: Env) {
        super(ctx, env)
        this.ctx.blockConcurrencyWhile(async () => {
            this.roomId = await this.ctx.storage.get('roomId') as string | null
            this.state = await this.ctx.storage.get('state') || null
        })
    }

    private readonly router = AutoRouter({
        catch: (e) => {
            console.error('ColorRm DO Error:', e)
            return error(500, 'Internal Server Error')
        },
    })
        .get('/api/color_rm/connect/:roomId', async (request) => {
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
        const sessionId = request.query.sessionId as string
        if (!sessionId) return error(400, 'Missing sessionId')

        const { 0: client, 1: server } = new WebSocketPair()
        server.accept()

        const session: Session = { socket: server, sessionId }
        this.sessions.push(session)

        // Send initial state to the new client
        // Always send full-sync even if state is null, so client knows it's ready.
        const initialState = this.state || { 
            history_map: {}, 
            idx: 0, 
            images: [] // Client ignores this anyway as it handles base file
        }
        server.send(JSON.stringify({ type: 'full-sync', state: initialState }))

        server.addEventListener('message', async (event) => {
            try {
                const message = JSON.parse(event.data as string)

                if (message.type === 'state-update') {
                    // Update internal state, but EXCLUDE images array
                    // because images are handled via the base file upload/download.
                    const { images, ...syncableState } = message.state
                    this.state = syncableState
                    
                    this.broadcast(event.data as string, session.sessionId)
                    await this.ctx.storage.put('state', this.state)
                }
            } catch (e) {
                console.error('Failed to process message:', e)
            }
        })

        server.addEventListener('close', () => {
            this.sessions = this.sessions.filter(s => s.sessionId !== session.sessionId)
        })
        server.addEventListener('error', (err) => {
            console.error('WebSocket error:', err)
            this.sessions = this.sessions.filter(s => s.sessionId !== session.sessionId)
        })

        return new Response(null, { status: 101, webSocket: client })
    }

    broadcast(message: string, originatorSessionId?: string) {
        for (const session of this.sessions) {
            if (session.sessionId !== originatorSessionId) {
                try {
                    session.socket.send(message)
                } catch (e) {
                    console.error(`Failed to send to session ${session.sessionId}:`, e)
                    this.sessions = this.sessions.filter(s => s.sessionId !== session.sessionId)
                }
            }
        }
    }
}
