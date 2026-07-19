// admin-ui/src/router.js
// Minimal hash router. Pages self-register with `route('#/pattern/:id', renderFn)` (see
// src/pages/*.js) — importing a page module is enough to wire it up, no central registry to edit.
import { isSuperadmin } from './auth.js'

const routes = []

/** Compile a '#/foo/:id' pattern into a matching RegExp + ordered param names. Exported for tests. */
export function compile(pattern) {
  const path = pattern.replace(/^#/, '')
  const paramNames = []
  const source =
    '^' +
    path
      .split('/')
      .map((segment) => {
        if (segment.startsWith(':')) {
          paramNames.push(segment.slice(1))
          return '([^/]+)'
        }
        return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      })
      .join('/') +
    '$'
  return { regex: new RegExp(source), paramNames }
}

/** Register a page: route('#/tenant/:id', (view, params) => { ... }) */
export function route(pattern, renderFn) {
  const { regex, paramNames } = compile(pattern)
  routes.push({ pattern, regex, paramNames, renderFn })
}

function currentPath() {
  const hash = window.location.hash || '#/'
  return hash.replace(/^#/, '') || '/'
}

function updateNav() {
  const superadmin = isSuperadmin()
  document.querySelectorAll('[data-superadmin]').forEach((el) => {
    el.hidden = !superadmin
  })
  document.querySelectorAll('.sidebar nav a[href^="#/"]').forEach((el) => {
    el.classList.toggle('active', el.getAttribute('href') === window.location.hash)
  })
}

async function render() {
  const view = document.getElementById('view')
  if (!view) return
  const path = currentPath()

  for (const r of routes) {
    const match = path.match(r.regex)
    if (!match) continue
    const params = {}
    r.paramNames.forEach((name, i) => {
      params[name] = decodeURIComponent(match[i + 1])
    })
    try {
      await r.renderFn(view, params)
    } catch (err) {
      console.error(err)
      view.innerHTML = `<div class="placeholder">เกิดข้อผิดพลาดในการแสดงผลหน้านี้</div>`
    }
    updateNav()
    return
  }

  view.innerHTML = `<div class="placeholder">ไม่พบหน้านี้</div>`
  updateNav()
}

/** Change the hash (triggers a re-render via hashchange, or immediately if unchanged). */
export function navigate(hash) {
  if (window.location.hash === hash) {
    render()
    return
  }
  window.location.hash = hash
}

/** Start listening for hash changes and do the initial render. Call once on boot. */
export function startRouter() {
  window.addEventListener('hashchange', render)
  render()
}
