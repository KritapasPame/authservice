import { test, expect } from 'bun:test'
import { Elysia } from 'elysia'
import { requireAuth } from '../src/http/auth'

test('no token → 401', async () => {
  const app = new Elysia().use(requireAuth).get('/x', () => 'ok')
  const res = await app.handle(new Request('http://localhost/x'))
  expect(res.status).toBe(401)
})
