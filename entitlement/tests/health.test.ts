import { test, expect } from 'bun:test'
import { createApp } from '../src/http/app'

test('GET /health returns ok', async () => {
  const app = createApp()
  const res = await app.handle(new Request('http://localhost/health'))
  expect(await res.json()).toEqual({ ok: true })
})
