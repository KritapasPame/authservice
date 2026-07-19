// admin-ui/src/pages/customers.js — หน้า 1: ลูกค้าทั้งหมด (superadmin)
import { route, navigate } from '../router.js'
import { api, toast } from '../api.js'

const state = { tenants: [], filter: 'all' }

function statusBadge(status) {
  const cls = status === 'active' ? 'b-ok' : status === 'trial' ? 'b-warn' : 'b-crit'
  return `<span class="badge ${cls}">${status}</span>`
}

function quotaCell(t) {
  const used = t.users ?? 0
  const limit = t.seatLimit
  if (!limit) return `<td class="num">${used} / ไม่จำกัด</td>`
  const ratio = used / limit
  const flag =
    ratio >= 1
      ? '<span class="badge b-crit">เต็ม</span>'
      : ratio >= 0.9
        ? '<span class="badge b-warn">ใกล้เต็ม</span>'
        : ''
  return `<td class="num">${used} / ${limit} ${flag}</td>`
}

function filteredTenants() {
  if (state.filter === 'org') return state.tenants.filter((t) => t.type !== 'personal')
  if (state.filter === 'personal') return state.tenants.filter((t) => t.type === 'personal')
  return state.tenants
}

function tilesHtml() {
  const orgCount = state.tenants.filter((t) => t.type !== 'personal').length
  const personalCount = state.tenants.filter((t) => t.type === 'personal').length
  const totalUsers = state.tenants.reduce((sum, t) => sum + (t.users ?? 0), 0)
  const nearFull = state.tenants.filter((t) => t.seatLimit && (t.users ?? 0) / t.seatLimit >= 0.9).length
  return `
    <div class="tiles">
      <div class="tile"><div class="k">ลูกค้าองค์กร</div><div class="v">${orgCount}</div></div>
      <div class="tile"><div class="k">ลูกค้า Personal</div><div class="v">${personalCount}</div></div>
      <div class="tile"><div class="k">Users ทั้งหมด</div><div class="v">${totalUsers}</div></div>
      <div class="tile"><div class="k">ใกล้เต็มโควตา</div><div class="v" style="color:var(--warn)">${nearFull} <small>ราย</small></div></div>
    </div>
  `
}

function rowsHtml() {
  const rows = filteredTenants()
  if (!rows.length) {
    return `<tr><td colspan="6" style="text-align:center;color:var(--muted)">ไม่มีข้อมูล</td></tr>`
  }
  return rows
    .map(
      (t) => `
    <tr>
      <td><strong>${t.name}</strong><br><span style="font-size:12.5px;color:var(--muted)">${t.slug}</span></td>
      <td>${t.package ? `<span class="chip">${t.package}</span>` : '<span style="color:var(--muted)">—</span>'}</td>
      ${quotaCell(t)}
      <td class="num">${t.type === 'personal' ? '<span style="color:var(--muted)">—</span>' : (t.companies ?? 0)}</td>
      <td>${statusBadge(t.status)}</td>
      <td><button class="btn small" data-view="${t.id}">ดูรายละเอียด →</button></td>
    </tr>`
    )
    .join('')
}

function html() {
  return `
    <div class="frame">
      <div class="framebar">🔐 Platform Console · ลูกค้าทั้งหมด</div>
      <div class="framebody">
        ${tilesHtml()}
        <div class="ctabs" role="tablist" aria-label="กรองประเภทลูกค้า" style="margin:0 0 10px">
          <button type="button" aria-selected="${state.filter === 'all'}" data-filter="all">ทั้งหมด</button>
          <button type="button" aria-selected="${state.filter === 'org'}" data-filter="org">องค์กร</button>
          <button type="button" aria-selected="${state.filter === 'personal'}" data-filter="personal">บุคคล (Personal)</button>
        </div>
        <div class="tblwrap">
          <table>
            <thead>
              <tr><th>ลูกค้า (tenant)</th><th>แพ็กเกจ</th><th>Users ใช้ / โควตา</th><th>บริษัทในเครือ</th><th>สถานะ</th><th></th></tr>
            </thead>
            <tbody>${rowsHtml()}</tbody>
          </table>
        </div>
        <p style="margin:14px 0 0"><button type="button" class="btn primary" id="addCustomerBtn">+ เพิ่มลูกค้าใหม่</button></p>
      </div>
    </div>

    <dialog id="customerDialog" style="border:1px solid var(--line);border-radius:10px;padding:0;width:min(420px,92vw);background:var(--surface);color:var(--ink)">
      <form id="customerForm" style="padding:20px;display:flex;flex-direction:column;gap:12px">
        <h3 style="margin:0">เพิ่มลูกค้าใหม่</h3>
        <label>ชื่อลูกค้า<br><input type="text" name="customerName" required style="width:100%"></label>
        <label>slug<br><input type="text" name="slug" required placeholder="เช่น charoen-group" style="width:100%"></label>
        <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:6px">
          <button type="button" class="btn" id="customerCancelBtn">ยกเลิก</button>
          <button type="submit" class="btn primary">บันทึก</button>
        </div>
      </form>
    </dialog>
  `
}

function bindEvents(view) {
  view.querySelectorAll('[data-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.filter = btn.dataset.filter
      renderInto(view)
    })
  })
  view.querySelectorAll('[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => navigate('#/tenant/' + btn.dataset.view))
  })

  const dialog = view.querySelector('#customerDialog')
  view.querySelector('#addCustomerBtn').addEventListener('click', () => dialog.showModal())
  view.querySelector('#customerCancelBtn').addEventListener('click', () => dialog.close())
  view.querySelector('#customerForm').addEventListener('submit', async (e) => {
    e.preventDefault()
    const form = e.target
    const name = form.customerName.value.trim()
    const slug = form.slug.value.trim()
    if (!name || !slug) return
    try {
      await api.post('/tenants', { name, slug })
      dialog.close()
      form.reset()
      toast('เพิ่มลูกค้าสำเร็จ', 'ok')
      await load(view)
    } catch {
      // toast แจ้ง error มาจาก api.js แล้ว — เปิด dialog ค้างไว้ให้แก้
    }
  })
}

function renderInto(view) {
  view.innerHTML = html()
  bindEvents(view)
}

async function load(view) {
  const data = await api.get('/admin/overview')
  state.tenants = data.tenants ?? []
  renderInto(view)
}

route('#/customers', async (view) => {
  view.innerHTML = `
    <div class="frame">
      <div class="framebar">🔐 Platform Console · ลูกค้าทั้งหมด</div>
      <div class="framebody"><div class="placeholder">กำลังโหลด…</div></div>
    </div>
  `
  await load(view)
})
