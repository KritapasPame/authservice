import { test, expect } from 'bun:test'
import { createApp } from '../src/http/app'

test('GET /admin serves index.html', async () => {
  const app = createApp()
  const res = await app.handle(new Request('http://localhost/admin'))
  expect(res.status).toBe(200)
  expect(res.headers.get('content-type')).toContain('text/html')
  const body = await res.text()
  expect(body).toContain('<title>Auth Platform Admin</title>')
})

test('GET /admin/ (trailing slash) also serves index.html', async () => {
  const app = createApp()
  const res = await app.handle(new Request('http://localhost/admin/'))
  expect(res.status).toBe(200)
  expect(res.headers.get('content-type')).toContain('text/html')
})

test('GET /admin/styles.css serves the stylesheet', async () => {
  const app = createApp()
  const res = await app.handle(new Request('http://localhost/admin/styles.css'))
  expect(res.status).toBe(200)
  expect(res.headers.get('content-type')).toContain('text/css')
  const body = await res.text()
  expect(body).toContain(':root')
})

test('GET /admin/src/auth.js serves nested module files', async () => {
  const app = createApp()
  const res = await app.handle(new Request('http://localhost/admin/src/auth.js'))
  expect(res.status).toBe(200)
  expect(res.headers.get('content-type')).toContain('text/javascript')
})

test('GET /admin/../secrets/x is blocked (path traversal)', async () => {
  const app = createApp()
  const res = await app.handle(new Request('http://localhost/admin/../secrets/x'))
  expect(res.status).toBe(404)
})

test('GET /admin/nope.js 404s for a missing file', async () => {
  const app = createApp()
  const res = await app.handle(new Request('http://localhost/admin/nope.js'))
  expect(res.status).toBe(404)
})

test('existing JSON API routes under /admin are unaffected by the static wildcard', async () => {
  const app = createApp()
  const res = await app.handle(new Request('http://localhost/admin/overview'))
  // no auth header supplied -> requireAuth should reject before ever reaching the file server;
  // the important thing is it must NOT be handled as a static-file 404 (proves no route conflict).
  expect(res.status).not.toBe(404)
})
