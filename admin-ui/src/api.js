// admin-ui/src/api.js
// Thin fetch wrapper: every call to the entitlement API goes through here so auth headers,
// 401 handling, and error toasts are consistent across all pages.
import { getToken, clearToken, login } from './auth.js'

function baseUrl() {
  return (window.EDM_CONFIG && window.EDM_CONFIG.apiBase) || ''
}

/** Escape a value for safe interpolation into innerHTML. Shared by every page that renders API data. */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
}

/** Append a toast to #toasts; auto-removed after 4s. kind: 'error' (default) | 'ok'. */
export function toast(message, kind = 'error') {
  const container = document.getElementById('toasts')
  if (!container) {
    console.error(message)
    return
  }
  const el = document.createElement('div')
  el.className = `toast ${kind}`
  el.textContent = message
  container.appendChild(el)
  setTimeout(() => el.remove(), 4000)
}

async function errorMessageFrom(res) {
  let text = ''
  try {
    text = await res.text()
  } catch {
    return `เกิดข้อผิดพลาด (${res.status})`
  }
  if (!text) return `เกิดข้อผิดพลาด (${res.status})`
  try {
    const json = JSON.parse(text)
    return json.error || json.message || text
  } catch {
    return text
  }
}

async function request(method, path, body) {
  // path must be root-relative — never let a page accidentally send the bearer token to a
  // different origin (e.g. a pasted absolute URL like "https://evil.com/x", or a bare relative
  // path like "users/1" that `fetch` would resolve against the current page instead of apiBase).
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) {  // '//' = protocol-relative → ข้าม origin ได้
    throw new Error(`api path must start with "/": ${path}`)
  }

  const token = getToken()
  const headers = {}
  if (token) headers['Authorization'] = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  let res
  try {
    res = await fetch(`${baseUrl()}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch (err) {
    toast('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้')
    throw err
  }

  if (res.status === 401) {
    clearToken()
    login()
    throw new Error('unauthorized')
  }

  if (!res.ok) {
    const message = await errorMessageFrom(res)
    toast(message)
    throw new Error(message)
  }

  if (res.status === 204) return null
  const text = await res.text()
  if (!text) return null
  return JSON.parse(text)
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body ?? {}),
  put: (path, body) => request('PUT', path, body ?? {}),
  patch: (path, body) => request('PATCH', path, body ?? {}),
  del: (path) => request('DELETE', path),
}
