import { test, expect } from 'bun:test'
import { createApp } from '../src/http/app'

// /admin (ไม่มี slash) ต้อง redirect ไป /admin/ — ไม่งั้น relative asset ใน index.html
// (styles.css, src/*.js) ถูก browser resolve เทียบ / แล้ว 404 ทั้งหน้า; query ต้องรอด
// เพราะ Zitadel ส่ง ?code= กลับมาที่ /admin ตาม redirect URI ที่ลงทะเบียน
test('GET /admin redirects to /admin/ (relative asset base) เก็บ query ครบ', async () => {
  const app = createApp()
  const res = await app.handle(new Request('http://localhost/admin'))
  expect(res.status).toBe(301)
  expect(res.headers.get('location')).toBe('/admin/')
  const res2 = await app.handle(new Request('http://localhost/admin?code=abc&state=xyz'))
  expect(res2.headers.get('location')).toBe('/admin/?code=abc&state=xyz')
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
  // no auth header supplied -> requireAuth rejects (401, see tests/auth.test.ts) before ever
  // reaching the file server; the important thing here is it must NOT be handled as a
  // static-file 404 (proves no route conflict).
  expect(res.status).not.toBe(404)
})

test('static files ส่ง Cache-Control: no-cache (กัน CDN/browser cache ค้างหลัง deploy)', async () => {
  const app = createApp()
  for (const p of ['/admin/', '/admin/config.js', '/admin/styles.css']) {
    const res = await app.handle(new Request('http://localhost' + p))
    expect(res.headers.get('cache-control')).toBe('no-cache')
  }
})
