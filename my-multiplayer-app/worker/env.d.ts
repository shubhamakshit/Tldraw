// Type definitions for Cloudflare Worker environment
interface Env {
	// Durable Object bindings
	TLDRAW_DURABLE_OBJECT: DurableObjectNamespace
	COLORM_DURABLE_OBJECT: DurableObjectNamespace
	
	// R2 bucket binding
	TLDRAW_BUCKET: R2Bucket

	// KV Namespaces
	TLDRAW_USERS_KV: KVNamespace

	// Secrets
	LIVEBLOCKS_SECRET_KEY?: string
}
