// admin-ui/tests/auth.test.js
// Pure-function tests for the PKCE helpers in src/auth.js. auth.js guards every DOM/browser
// global (window/sessionStorage/location/fetch) inside function bodies, so importing it here
// under `bun test` (no DOM) is safe — we only ever call the pure helpers below.
import { test, expect } from 'bun:test'
import { base64url, randomVerifier, challengeFromVerifier } from '../src/auth.js'

test('base64url produces only URL-safe characters, no padding', () => {
  const bytes = new Uint8Array([251, 255, 190, 255, 254, 0, 1, 2, 3])
  const out = base64url(bytes)
  expect(out).toMatch(/^[A-Za-z0-9_-]+$/)
  expect(out).not.toMatch(/[+/=]/)
})

test('base64url is a known encoding (round-trippable via atob after re-padding)', () => {
  const bytes = new Uint8Array([72, 101, 108, 108, 111]) // "Hello"
  const out = base64url(bytes)
  const padded = out.replace(/-/g, '+').replace(/_/g, '/').padEnd(out.length + ((4 - (out.length % 4)) % 4), '=')
  expect(atob(padded)).toBe('Hello')
})

test('randomVerifier returns a 43-char base64url string (32 random bytes)', () => {
  const v = randomVerifier()
  expect(v).toMatch(/^[A-Za-z0-9_-]{43}$/)
})

test('randomVerifier is different across calls', () => {
  const a = randomVerifier()
  const b = randomVerifier()
  expect(a).not.toBe(b)
})

test('challengeFromVerifier returns a 43-char base64url SHA-256 digest', async () => {
  const verifier = randomVerifier()
  const challenge = await challengeFromVerifier(verifier)
  expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/)
})

test('challengeFromVerifier is deterministic for the same verifier', async () => {
  const c1 = await challengeFromVerifier('fixed-test-verifier-value')
  const c2 = await challengeFromVerifier('fixed-test-verifier-value')
  expect(c1).toBe(c2)
})

test('challengeFromVerifier differs for different verifiers', async () => {
  const c1 = await challengeFromVerifier('verifier-a')
  const c2 = await challengeFromVerifier('verifier-b')
  expect(c1).not.toBe(c2)
})
