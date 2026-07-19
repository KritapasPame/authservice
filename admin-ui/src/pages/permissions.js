// admin-ui/src/pages/permissions.js — หน้า 4: ตั้งสิทธิ์ราย user (groupcompanyadmin/admin)
//
// Single route, one mutable module-scoped `state` object, re-rendered top-to-bottom on every
// change (innerHTML + re-attach listeners). Simplest correct approach for this data size —
// no vdom, no partial-diffing framework.
import { route } from '../router.js'
import { api, toast, esc } from '../api.js'
import { claims, isSuperadmin } from '../auth.js'
import { PERMISSIONS, MODULES } from '../constants.js'

const state = {
  viewEl: null,
  tenantId: null,
  tenants: [], // superadmin only
  users: [],
  companies: [],
  presets: [],
  selectedUserId: null,
  selectedCompanyId: null,
  selectedPresetSlug: '', // '' = กำหนดเอง (ไม่ผูก preset)
  perm: null, // { companyId, position, permissionKeys } ล่าสุดที่โหลดจากเซิร์ฟเวอร์
  checked: new Set(), // สถานะ checkbox ปัจจุบัน (client-side, copy-on-save)
}

route('#/permissions', async (view) => {
  state.viewEl = view
  view.innerHTML = `<div class="frame"><div class="framebody"><div class="placeholder">กำลังโหลด…</div></div></div>`
  if (isSuperadmin()) {
    if (!state.tenants.length) state.tenants = await api.get('/tenants')
    if (state.tenantId == null) state.tenantId = state.tenants[0]?.id ?? null
  } else {
    state.tenantId = Number(claims()?.['urn:platform:tenantId'])
  }
  await loadTenantData()
})

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

async function loadTenantData() {
  if (!state.tenantId) {
    state.users = []
    state.companies = []
    state.presets = []
    renderAll()
    return
  }
  const [users, companies, presets] = await Promise.all([
    api.get(`/users/tenant/${state.tenantId}`),
    api.get(`/companies/${state.tenantId}`),
    api.get(`/presets/${state.tenantId}`),
  ])
  state.users = users
  state.companies = companies
  state.presets = presets

  const stillThere = users.find((u) => u.id === state.selectedUserId)
  if (!stillThere) {
    await selectUser(users[0]?.id ?? null)
    return
  }
  if (!stillThere.memberships.some((m) => m.companyId === state.selectedCompanyId)) {
    state.selectedCompanyId = stillThere.memberships[0]?.companyId ?? null
    state.selectedPresetSlug = ''
  }
  await loadPermissions()
  renderAll()
}

async function loadPermissions() {
  if (!state.selectedUserId || !state.selectedCompanyId) {
    state.perm = null
    state.checked = new Set()
    state.selectedPresetSlug = ''
    return
  }
  try {
    state.perm = await api.get(`/users/${state.selectedUserId}/permissions?companyId=${state.selectedCompanyId}`)
    state.checked = new Set(state.perm.permissionKeys)
    state.selectedPresetSlug = matchingPresetSlug(state.perm.permissionKeys)
  } catch {
    state.perm = null
    state.checked = new Set()
    state.selectedPresetSlug = ''
  }
}

/** Preset slug whose permissionKeys set exactly equals `keys`, or '' (— กำหนดเอง —) if none match. */
function matchingPresetSlug(keys) {
  const sortedKeys = [...keys].sort().join(',')
  const match = state.presets.find((p) => [...p.permissionKeys].sort().join(',') === sortedKeys)
  return match?.slug ?? ''
}

async function selectUser(userId) {
  state.selectedUserId = userId
  const u = currentUser()
  state.selectedCompanyId = u?.memberships[0]?.companyId ?? null
  state.selectedPresetSlug = ''
  await loadPermissions()
  renderAll()
}

async function selectCompany(companyId) {
  state.selectedCompanyId = companyId
  state.selectedPresetSlug = ''
  await loadPermissions()
  renderAll()
}

function currentUser() {
  return state.users.find((u) => u.id === state.selectedUserId) ?? null
}

function companyName(id) {
  return state.companies.find((c) => c.id === id)?.name ?? `#${id}`
}

function selectedPreset() {
  return state.presets.find((p) => p.slug === state.selectedPresetSlug) ?? null
}

function isDrift() {
  const preset = selectedPreset()
  if (!preset) return false
  const a = [...state.checked].sort().join(',')
  const b = [...preset.permissionKeys].sort().join(',')
  return a !== b
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

async function onTenantChange(e) {
  state.tenantId = Number(e.target.value)
  state.selectedUserId = null
  state.selectedCompanyId = null
  state.selectedPresetSlug = ''
  await loadTenantData()
}

async function onToggleGroupAdmin(e) {
  const u = currentUser()
  if (!u) return
  try {
    await api.patch(`/users/${u.id}/admin`, { groupAdmin: e.target.checked })
  } catch {
    renderAll() // revert checkbox to state truth
    return
  }
  toast('อัปเดตสิทธิ์แอดมินทั้งเครือแล้ว', 'ok')
  await loadTenantData()
}

async function onToggleCompanyAdmin(e) {
  const u = currentUser()
  if (!u || !state.selectedCompanyId) return
  try {
    await api.patch(`/users/${u.id}/admin`, { companyId: state.selectedCompanyId, admin: e.target.checked })
  } catch {
    renderAll()
    return
  }
  toast('อัปเดตสิทธิ์แอดมินบริษัทแล้ว', 'ok')
  await loadTenantData()
}

function onPresetChange(e) {
  state.selectedPresetSlug = e.target.value
  const preset = selectedPreset()
  if (preset) state.checked = new Set(preset.permissionKeys)
  renderAll()
}

function onPermCheckboxChange(e) {
  const key = e.target.dataset.key
  if (e.target.checked) state.checked.add(key)
  else state.checked.delete(key)
  const driftEl = state.viewEl?.querySelector('#drift')
  if (driftEl) driftEl.innerHTML = isDrift() ? '<span class="badge b-warn">แก้จาก preset แล้ว</span>' : ''
}

async function onSavePermissions() {
  const u = currentUser()
  if (!u || !state.selectedCompanyId) return
  const preset = selectedPreset()
  const position = preset ? preset.name : (state.perm?.position ?? undefined)
  try {
    await api.put(`/users/${u.id}/permissions`, {
      companyId: state.selectedCompanyId,
      position,
      permissionKeys: [...state.checked],
    })
  } catch {
    return // api.js already toasted (incl. overPackage key list)
  }
  toast('บันทึกสิทธิ์แล้ว', 'ok')
  await loadTenantData()
}

async function onToggleStatus() {
  const u = currentUser()
  if (!u) return
  const next = u.status === 'active' ? 'disabled' : 'active'
  try {
    await api.patch(`/users/${u.id}/status`, { status: next })
  } catch {
    return
  }
  toast(next === 'active' ? 'เปิดใช้งานผู้ใช้แล้ว' : 'ปิดใช้งานผู้ใช้แล้ว', 'ok')
  await loadTenantData()
}

// ---------------------------------------------------------------------------
// Dialogs (native <dialog> — no extra CSS needed)
// ---------------------------------------------------------------------------

function openDialog(innerHtml, wire) {
  const dlg = document.createElement('dialog')
  dlg.style.cssText = 'background:var(--surface);color:var(--ink);border:1px solid var(--line);border-radius:10px'
  dlg.innerHTML = innerHtml
  document.body.appendChild(dlg)
  dlg.addEventListener('close', () => dlg.remove())
  dlg.querySelector('[data-cancel]')?.addEventListener('click', () => dlg.close())
  wire(dlg)
  dlg.showModal()
  return dlg
}

function openInviteDialog() {
  const companyOptions =
    state.companies
      .map((c) => `<label style="display:block;font-weight:400"><input type="checkbox" name="company" value="${c.id}"> ${esc(c.name)}</label>`)
      .join('') || '<span style="color:var(--muted)">ยังไม่มีบริษัท</span>'
  const presetOptions = state.presets.map((p) => `<option value="${esc(p.slug)}">${esc(p.name)}</option>`).join('')

  const dlg = openDialog(
    `
    <form method="dialog" style="min-width:280px;display:flex;flex-direction:column;gap:10px">
      <h3 style="margin:0">เชิญผู้ใช้ใหม่</h3>
      <label style="font-weight:600">อีเมล
        <input type="email" id="inviteEmail" required style="width:100%;margin-top:4px" />
      </label>
      <div>
        <div style="font-weight:600;margin-bottom:4px">บริษัท</div>
        ${companyOptions}
      </div>
      <label style="font-weight:600">ตำแหน่ง (preset)
        <select id="invitePreset" style="width:100%;margin-top:4px">
          <option value="">— ไม่กำหนด —</option>
          ${presetOptions}
        </select>
      </label>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:6px">
        <button type="button" class="btn" data-cancel>ยกเลิก</button>
        <button type="submit" class="btn primary">เชิญผู้ใช้</button>
      </div>
    </form>
  `,
    (dlg) => {
      dlg.querySelector('form').addEventListener('submit', async (ev) => {
        ev.preventDefault()
        const email = dlg.querySelector('#inviteEmail').value.trim()
        const companyIds = [...dlg.querySelectorAll('input[name=company]:checked')].map((el) => Number(el.value))
        const presetSlug = dlg.querySelector('#invitePreset').value || undefined
        try {
          await api.post('/users/invite', { tenantId: state.tenantId, email, companyIds, presetSlug })
        } catch {
          return
        }
        toast('เชิญผู้ใช้แล้ว', 'ok')
        dlg.close()
        await loadTenantData()
      })
    }
  )
  return dlg
}

function slugify(s) {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function openSavePresetDialog() {
  openDialog(
    `
    <form method="dialog" style="min-width:260px;display:flex;flex-direction:column;gap:10px">
      <h3 style="margin:0">บันทึกเป็น preset ใหม่</h3>
      <label style="font-weight:600">ชื่อ
        <input type="text" id="presetName" required style="width:100%;margin-top:4px" />
      </label>
      <label style="font-weight:600">slug
        <input type="text" id="presetSlug" required style="width:100%;margin-top:4px" />
      </label>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:6px">
        <button type="button" class="btn" data-cancel>ยกเลิก</button>
        <button type="submit" class="btn primary">บันทึก</button>
      </div>
    </form>
  `,
    (dlg) => {
      const nameInput = dlg.querySelector('#presetName')
      const slugInput = dlg.querySelector('#presetSlug')
      nameInput.addEventListener('input', () => {
        if (!slugInput.dataset.touched) slugInput.value = slugify(nameInput.value)
      })
      slugInput.addEventListener('input', () => {
        slugInput.dataset.touched = '1'
      })
      dlg.querySelector('form').addEventListener('submit', async (ev) => {
        ev.preventDefault()
        try {
          const preset = await api.post('/presets', {
            tenantId: state.tenantId,
            name: nameInput.value.trim(),
            slug: slugInput.value.trim(),
            permissionKeys: [...state.checked],
          })
          state.presets.push(preset)
          state.selectedPresetSlug = preset.slug
        } catch {
          return
        }
        toast('บันทึก preset แล้ว', 'ok')
        dlg.close()
        renderAll()
      })
    }
  )
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function frameBarHtml() {
  const c = claims() || {}
  const tenantName = state.tenants.find((t) => t.id === state.tenantId)?.name
  const role = isSuperadmin() ? 'superadmin' : c['urn:platform:role'] || 'admin'
  const who = c.email || c.preferred_username || c.name || ''
  return `🏢 ${esc(tenantName || 'จัดการผู้ใช้')} · จัดการผู้ใช้ <span class="who">login เป็น: ${esc(role)}${who ? ' (' + esc(who) + ')' : ''}</span>`
}

function tenantPickerHtml() {
  return `
    <div style="margin-bottom:14px;display:flex;align-items:center;gap:8px">
      <label for="tenantPicker" style="font-weight:600">ลูกค้า:</label>
      <select id="tenantPicker">
        ${state.tenants.map((t) => `<option value="${t.id}" ${t.id === state.tenantId ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
      </select>
    </div>
  `
}

function userListItemHtml(u) {
  const subtitle = u.isGroupAdmin ? 'แอดมินทั้งเครือ' : u.memberships[0]?.position || '—'
  return `
    <button aria-selected="${u.id === state.selectedUserId}" data-user="${u.id}" type="button">
      ${esc(u.email)}
      <span class="em">${esc(subtitle)}${u.status !== 'active' ? ' · ปิดใช้งาน' : ''}</span>
    </button>
  `
}

function permGroupsHtml() {
  const visible = PERMISSIONS.filter((p) => !p.key.startsWith('tenant.'))
  const byModule = new Map()
  for (const p of visible) {
    if (!byModule.has(p.module)) byModule.set(p.module, [])
    byModule.get(p.module).push(p)
  }
  return [...byModule.entries()]
    .map(
      ([mod, perms]) => `
    <fieldset class="pgroup">
      <legend>${esc(MODULES.find((m) => m.key === mod)?.name ?? mod)}</legend>
      ${perms
        .map(
          (p) => `
        <div class="perm">
          <input type="checkbox" id="perm-${esc(p.key)}" data-key="${esc(p.key)}" ${state.checked.has(p.key) ? 'checked' : ''} />
          <label for="perm-${esc(p.key)}">${esc(p.label)} <span class="key">${esc(p.key)}</span></label>
        </div>`
        )
        .join('')}
    </fieldset>`
    )
    .join('')
}

function detailHtml(u) {
  const curMembership = u.memberships.find((m) => m.companyId === state.selectedCompanyId)
  return `
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap">
      <div>
        <h3 style="margin:0 0 2px;font-size:17px">${esc(u.email)}</h3>
        <p style="margin:0 0 6px;font-size:13.5px;color:var(--muted)">สมาชิก ${u.memberships.length} บริษัท — สิทธิ์ตั้งแยกต่อบริษัท</p>
      </div>
      <button class="btn small" id="toggleStatusBtn" type="button">${u.status === 'active' ? 'ปิดใช้งานผู้ใช้' : 'เปิดใช้งานผู้ใช้'}</button>
    </div>

    <div class="adminbox">
      <label class="toggle"><input type="checkbox" id="grpadmin" ${u.isGroupAdmin ? 'checked' : ''} /><span class="tk"></span> แอดมินทั้งเครือ (groupcompanyadmin)</label>
      <div class="note">เปิดแล้วได้สิทธิ์ <code style="font-family:var(--mono)">*</code> ทุกบริษัทในเครือ — ช่องติ๊กด้านล่างจะไม่มีผล</div>
    </div>

    ${
      u.memberships.length
        ? `
      <div class="ctabs" role="tablist" aria-label="เลือกบริษัท">
        ${u.memberships
          .map((m) => `<button aria-selected="${m.companyId === state.selectedCompanyId}" data-company="${m.companyId}" type="button">${esc(companyName(m.companyId))}</button>`)
          .join('')}
      </div>

      <div class="adminbox">
        <label class="toggle"><input type="checkbox" id="coadmin" ${curMembership?.isAdmin ? 'checked' : ''} /><span class="tk"></span> แอดมินบริษัทนี้ (admin)</label>
      </div>

      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px">
        <label for="preset" style="font-weight:600">ตำแหน่ง (preset):</label>
        <select id="preset">
          <option value="">— กำหนดเอง —</option>
          ${state.presets
            .map((p) => `<option value="${esc(p.slug)}" ${p.slug === state.selectedPresetSlug ? 'selected' : ''}>${esc(p.name)} (${p.permissionKeys.length} สิทธิ์)</option>`)
            .join('')}
        </select>
        <button class="btn small" id="savePresetBtn" type="button">บันทึกเป็น preset ใหม่</button>
        <span class="drift" id="drift">${isDrift() ? '<span class="badge b-warn">แก้จาก preset แล้ว</span>' : ''}</span>
      </div>

      ${permGroupsHtml()}

      <div class="savebar">
        <button class="btn primary" id="saveBtn" type="button">บันทึกสิทธิ์</button>
        <span style="font-size:13px;color:var(--muted)">save = copy ลงรายคน — แก้ preset ทีหลังไม่กระทบคนนี้</span>
      </div>
    `
        : '<p class="placeholder">ผู้ใช้นี้ยังไม่ได้อยู่บริษัทไหน</p>'
    }
  `
}

function mainHtml() {
  const u = currentUser()
  return `
    <div class="frame">
      <div class="framebar">${frameBarHtml()}</div>
      <div class="framebody">
        ${isSuperadmin() ? tenantPickerHtml() : ''}
        ${
          state.tenantId
            ? `
        <div class="perm-layout">
          <div>
            <div class="userlist" role="tablist" aria-label="รายชื่อผู้ใช้">
              ${state.users.length ? state.users.map(userListItemHtml).join('') : '<div style="padding:14px;color:var(--muted);font-size:13.5px">ยังไม่มีผู้ใช้</div>'}
            </div>
            <p style="margin:10px 0 0"><button class="btn small" id="inviteBtn" type="button">+ เชิญผู้ใช้ใหม่</button></p>
          </div>
          <div>
            ${u ? detailHtml(u) : '<p class="placeholder">เลือกผู้ใช้ทางซ้าย</p>'}
          </div>
        </div>
        `
            : '<div class="placeholder">เลือกลูกค้าก่อน</div>'
        }
      </div>
    </div>
  `
}

function attachListeners(view) {
  view.querySelector('#tenantPicker')?.addEventListener('change', onTenantChange)
  view.querySelector('#inviteBtn')?.addEventListener('click', openInviteDialog)
  view.querySelectorAll('.userlist button[data-user]').forEach((btn) => btn.addEventListener('click', () => selectUser(Number(btn.dataset.user))))
  view.querySelectorAll('.ctabs button[data-company]').forEach((btn) => btn.addEventListener('click', () => selectCompany(Number(btn.dataset.company))))
  view.querySelector('#grpadmin')?.addEventListener('change', onToggleGroupAdmin)
  view.querySelector('#coadmin')?.addEventListener('change', onToggleCompanyAdmin)
  view.querySelector('#preset')?.addEventListener('change', onPresetChange)
  view.querySelector('#savePresetBtn')?.addEventListener('click', openSavePresetDialog)
  view.querySelectorAll('.perm input[type=checkbox]').forEach((cb) => cb.addEventListener('change', onPermCheckboxChange))
  view.querySelector('#saveBtn')?.addEventListener('click', onSavePermissions)
  view.querySelector('#toggleStatusBtn')?.addEventListener('click', onToggleStatus)
}

function renderAll() {
  const view = state.viewEl
  if (!view) return
  view.innerHTML = mainHtml()
  attachListeners(view)
}
