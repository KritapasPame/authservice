import { Elysia } from 'elysia'
import { extname, resolve, sep } from 'node:path'

// admin-ui/ lives at the repo root, three levels up from this file
// (entitlement/src/http/static.ts -> entitlement/src/http -> entitlement/src -> entitlement -> repo root).
const ADMIN_UI_ROOT = resolve(import.meta.dir, '../../../admin-ui')

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
}

async function serveIndex() {
  return serveFile('/index.html')
}

async function serveFile(requestPath: string) {
  // resolve() collapses any ../ segments; the startsWith check below then rejects anything
  // that escaped ADMIN_UI_ROOT (path traversal), returning 404 either way.
  const target = resolve(ADMIN_UI_ROOT, `.${requestPath}`)
  if (target !== ADMIN_UI_ROOT && !target.startsWith(ADMIN_UI_ROOT + sep)) {
    return new Response('not found', { status: 404 })
  }

  const file = Bun.file(target)
  if (!(await file.exists())) return new Response('not found', { status: 404 })

  const headers: Record<string, string> = {}
  const type = MIME[extname(target)]
  if (type) headers['Content-Type'] = type
  return new Response(file, { headers })
}

// Mounted at the http/app.ts level. Registered as plain (non-prefixed) routes here so that
// GET /admin (bare, no trailing content) resolves to index.html — Elysia's router still gives
// priority to the more specific static/param routes already declared elsewhere (e.g.
// adminRouter's GET /admin/overview) over this wildcard, regardless of mount order.
export const staticRouter = new Elysia()
  .get('/admin', () => serveIndex())
  .get('/admin/', () => serveIndex())
  .get('/admin/*', ({ params }) => serveFile(`/${params['*'] ?? ''}`))
