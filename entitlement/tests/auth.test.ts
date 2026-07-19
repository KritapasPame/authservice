import { test, expect } from 'bun:test'
import { Elysia } from 'elysia'
import { requireAuth } from '../src/http/auth'
import { createApp } from '../src/http/app'

test('no token → 401', async () => {
  const app = new Elysia().use(requireAuth).get('/x', () => 'ok')
  const res = await app.handle(new Request('http://localhost/x'))
  expect(res.status).toBe(401)
})

// Regression: requireAuth's `throw status(401, ...)` inside a scoped `.derive` surfaces to the
// app-level onError (src/http/app.ts) as an ElysiaCustomStatusResponse, not a plain Error. Before
// app.ts learned to recognize that shape, its catch-all masked every auth rejection as 500.
// requireAuth alone (test above) never exercises app.ts's onError, so this checks the real
// composed app (createApp) instead.
test('no token → 401 through the full composed app (not masked as 500)', async () => {
  const app = createApp()
  const res = await app.handle(new Request('http://localhost/admin/overview'))
  expect(res.status).toBe(401)
})
