// admin-ui/src/auth.js
// OIDC Authorization Code + PKCE (S256) against Zitadel. Token decode only — never verify
// client-side (the entitlement API verifies every request via its own JWKS check).
//
// NOTE: every browser-only global (window/sessionStorage/location/history/fetch) is accessed
// lazily inside function bodies, never at module top level, so this file can be `import`-ed
// under `bun test` (no DOM there) to unit-test the pure PKCE helpers below.

const TOKEN_KEY = 'edm_admin_token'
const ID_TOKEN_KEY = 'edm_admin_id_token'
const VERIFIER_KEY = 'edm_admin_verifier'
const STATE_KEY = 'edm_admin_state'

// ---------------------------------------------------------------------------
// Pure PKCE helpers (unit tested in tests/auth.test.js)
// ---------------------------------------------------------------------------

/** base64url-encode raw bytes (ArrayBuffer | TypedArray), no padding. */
export function base64url(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let bin = ''
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** 32 random bytes, base64url-encoded — PKCE code_verifier. */
export function randomVerifier() {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return base64url(bytes)
}

/** SHA-256(verifier), base64url-encoded — PKCE code_challenge (S256). */
export async function challengeFromVerifier(verifier) {
  const data = new TextEncoder().encode(verifier)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return base64url(digest)
}

// ---------------------------------------------------------------------------
// Browser-only auth flow
// ---------------------------------------------------------------------------

function config() {
  return window.EDM_CONFIG
}

function redirectUri() {
  return `${window.location.origin}/admin`
}

export function getToken() {
  try {
    return window.sessionStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function clearToken() {
  try {
    window.sessionStorage.removeItem(TOKEN_KEY)
    window.sessionStorage.removeItem(ID_TOKEN_KEY)
  } catch {
    /* ignore */
  }
}

/** Decode the JWT payload (base64url) without verifying — server verifies on every call. */
export function claims() {
  const token = getToken()
  if (!token) return null
  const payload = token.split('.')[1]
  if (!payload) return null
  try {
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    return JSON.parse(json)
  } catch {
    return null
  }
}

export function isSuperadmin() {
  const c = claims()
  return !!c && c['urn:platform:role'] === 'superadmin'
}

/** Strip ?code=&state= from the URL (keeps any other query params + the hash) via history.replaceState. */
function stripAuthParams(url) {
  url.searchParams.delete('code')
  url.searchParams.delete('state')
  window.history.replaceState({}, '', url.pathname + url.search + url.hash)
}

/** Kick off the authorize redirect with a fresh PKCE pair + anti-CSRF state. */
export async function login() {
  const cfg = config()
  const verifier = randomVerifier()
  const challenge = await challengeFromVerifier(verifier)
  const state = randomVerifier() // any opaque random string works — reuse the same helper
  window.sessionStorage.setItem(VERIFIER_KEY, verifier)
  window.sessionStorage.setItem(STATE_KEY, state)
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: 'openid profile urn:zitadel:iam:org:projects:roles',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  })
  window.location.href = `${cfg.issuer}/oauth/v2/authorize?${params.toString()}`
}

/**
 * Called on boot. If the URL carries `?code=...`, verify the `state` round-trip, exchange the
 * code for a token, store it, and strip the query string. Returns true if a callback was handled.
 * Throws (leaving no token stored, i.e. clean login state) on state mismatch or exchange failure.
 */
export async function handleCallback() {
  const url = new URL(window.location.href)
  const code = url.searchParams.get('code')
  if (!code) return false

  const returnedState = url.searchParams.get('state')
  const expectedState = window.sessionStorage.getItem(STATE_KEY)
  window.sessionStorage.removeItem(STATE_KEY)
  if (!expectedState || returnedState !== expectedState) {
    window.sessionStorage.removeItem(VERIFIER_KEY)
    stripAuthParams(url)
    throw new Error('login state mismatch — เริ่มเข้าสู่ระบบใหม่')
  }

  const cfg = config()
  const verifier = window.sessionStorage.getItem(VERIFIER_KEY) ?? ''
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(),
    client_id: cfg.clientId,
    code_verifier: verifier,
  })
  window.sessionStorage.removeItem(VERIFIER_KEY)

  let res
  try {
    res = await fetch(`${cfg.issuer}/oauth/v2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
  } finally {
    stripAuthParams(url)
  }
  if (!res.ok) throw new Error(`token exchange failed (${res.status})`)
  const json = await res.json()
  window.sessionStorage.setItem(TOKEN_KEY, json.access_token)
  if (json.id_token) window.sessionStorage.setItem(ID_TOKEN_KEY, json.id_token)
  return true
}

/** Clear local session + end the Zitadel session too (RP-initiated logout). */
export function logout() {
  const cfg = config()
  const idToken = window.sessionStorage.getItem(ID_TOKEN_KEY)
  clearToken()
  const params = new URLSearchParams({ post_logout_redirect_uri: `${window.location.origin}/admin` })
  if (idToken) params.set('id_token_hint', idToken)
  else params.set('client_id', cfg.clientId)
  window.location.href = `${cfg.issuer}/oidc/v1/end_session?${params.toString()}`
}
