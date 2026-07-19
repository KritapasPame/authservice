// admin-ui/src/pages/tenant.js — หน้า 3: รายละเอียดลูกค้า (superadmin)
// GET /admin/tenants/:id ({ tenant, package, usage:{seats,companies,admins}, companies:[{id,name,status,users,admins}] })
import { route } from '../router.js'
import { api, toast, esc } from '../api.js'
import { getToken } from '../auth.js'

// module override switches (PUT /modules/tenants/:tid/:key) — no GET exists to read current
// enabled state per tenant, so these render unchecked and act as one-way "sent" toggles only.
const MODULES = [
  { key: 'hr', label: 'HR' },
  { key: 'esign', label: 'eSign' },
]

function quotaBadge(used, limit) {
  if (!limit) return ''
  const pct = (used / limit) * 100
  if (pct >= 100) return '<span class="badge b-crit">เต็ม</span>'
  if (pct >= 90) return '<span class="badge b-warn">ใกล้เต็ม</span>'
  return ''
}

function fmtMoney(n) {
  return Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })
  } catch {
    return ''
  }
}

function fmtDateTime(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return String(iso)
  }
}

function companyStatusBadge(status) {
  return status === 'active'
    ? `<span class="badge b-ok">${esc(status)}</span>`
    : `<span class="badge b-warn">${esc(status)}</span>`
}

function invoiceStatusBadge(inv) {
  return inv.status === 'paid'
    ? `<span class="badge b-ok">ชำระแล้ว ${esc(fmtDate(inv.paidAt))}</span>`
    : '<span class="badge b-warn">รอชำระ</span>'
}

/** derive a Thai label for a raw Zitadel login event — shape is loosely defined, defend on every field. */
function loginRow(e) {
  const time = fmtDateTime(e?.creationDate)
  const user = e?.editorUser?.displayName || e?.editorUser?.loginName || e?.userId || e?.aggregateID || '—'
  const type = String(e?.type ?? '')
  const failed = /fail|wrong|invalid/i.test(type)
  const result = failed
    ? `<span class="badge b-crit">ล้มเหลว</span>`
    : type
      ? `<span class="badge b-ok">สำเร็จ</span>`
      : '<span class="badge b-warn">ไม่ทราบผล</span>'
  return `<tr><td>${esc(time)}</td><td>${esc(user)}</td><td>${result}</td></tr>`
}

async function printInvoice(number, type, btn) {
  const original = btn ? btn.textContent : ''
  if (btn) { btn.disabled = true; btn.textContent = '…' }
  try {
    const base = (window.EDM_CONFIG && window.EDM_CONFIG.apiBase) || ''
    const token = getToken()
    const res = await fetch(`${base}/admin/invoices/${encodeURIComponent(number)}/print?type=${type}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (res.status === 401) { toast('กรุณาเข้าสู่ระบบใหม่'); return }
    if (!res.ok) {
      let message = `พิมพ์ไม่สำเร็จ (${res.status})`
      try {
        const body = await res.json()
        if (body.notPaid) message = 'ต้องบันทึกรับเงินก่อนพิมพ์ใบเสร็จ'
        else if (body.notFound) message = 'ไม่พบใบแจ้งหนี้นี้'
      } catch {
        /* ignore parse error, keep generic message */
      }
      toast(message)
      return
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    window.open(url, '_blank')
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  } catch {
    toast('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้')
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = original }
  }
}

function packageOptions(packages, currentSlug) {
  if (!packages.length) return '<option value="">— ไม่มีแพ็กเกจ —</option>'
  return packages
    .map((p) => `<option value="${esc(p.slug)}" ${p.slug === currentSlug ? 'selected' : ''}>${esc(p.name)}</option>`)
    .join('')
}

function render(detail, packages, invoices, loginsHtml) {
  const { tenant, package: pkg, usage, companies } = detail

  const usageLine = pkg
    ? `Users: <strong>${usage.seats} / ${pkg.seatLimit}</strong> ${quotaBadge(usage.seats, pkg.seatLimit)}
       · บริษัทในเครือ: <strong>${usage.companies} / ${pkg.companyLimit}</strong> ${quotaBadge(usage.companies, pkg.companyLimit)}
       · แอดมิน: <strong>${usage.admins} / ${pkg.adminLimit}</strong> ${quotaBadge(usage.admins, pkg.adminLimit)}
       — เกินโควตาแล้วระบบไม่ให้เพิ่ม (invite/สร้างบริษัท/ตั้งแอดมิน จะได้ 403 พร้อมเหตุผล)`
    : `Users: <strong>${usage.seats}</strong> · บริษัทในเครือ: <strong>${usage.companies}</strong> · แอดมิน: <strong>${usage.admins}</strong>`

  const companyRows = companies.length
    ? companies
        .map(
          (c) => `<tr>
            <td>${esc(c.name)}</td>
            <td class="num">${c.users}</td>
            <td class="num">${c.admins}</td>
            <td>${companyStatusBadge(c.status)}</td>
          </tr>`,
        )
        .join('')
    : '<tr><td colspan="4" class="placeholder">ยังไม่มีบริษัทในเครือ</td></tr>'

  const invoiceRows = invoices.length
    ? invoices
        .map((inv) => {
          const paid = inv.status === 'paid'
          return `<tr>
            <td>${esc(inv.number)}</td>
            <td>${esc(inv.description)}</td>
            <td class="num">${fmtMoney(inv.amount)}</td>
            <td>${invoiceStatusBadge(inv)}</td>
            <td style="white-space:nowrap">
              <button class="btn small" data-print="invoice" data-number="${esc(inv.number)}">🖨 Invoice</button>
              <button class="btn small" data-print="receipt" data-number="${esc(inv.number)}" ${paid ? '' : 'disabled title="บันทึกรับเงินก่อนถึงพิมพ์ใบเสร็จได้"'}>🖨 ใบเสร็จ</button>
              ${paid ? '' : `<button class="btn small" data-mark-paid="${esc(inv.number)}">✓ บันทึกรับเงิน</button>`}
            </td>
          </tr>`
        })
        .join('')
    : '<tr><td colspan="5" class="placeholder">ยังไม่มีบิล</td></tr>'

  return `
    <div class="frame">
      <div class="framebar">🔐 Platform Console · ลูกค้า: <strong>${esc(tenant.name)}</strong></div>
      <div class="framebody">
        <p style="margin:0 0 12px"><a href="#/customers">&larr; กลับไปหน้าลูกค้าทั้งหมด</a></p>

        <h3 style="margin:18px 0 8px;font-size:15px">แพ็กเกจที่ซื้อ</h3>
        <div class="adminbox">
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
            <span class="chip" style="font-size:14px;padding:3px 12px">${pkg ? esc(pkg.name) : 'ยังไม่กำหนด'}</span>
            <select id="pkgSelect">${packageOptions(packages, pkg?.slug)}</select>
            <button id="changePkgBtn" class="btn small">เปลี่ยนแพ็กเกจ</button>
          </div>
          <div class="note">การใช้เทียบโควตา — ${usageLine}</div>
          ${MODULES.map(
            (m) => `<label class="toggle">
              <input type="checkbox" data-module="${m.key}"><span class="tk"></span>
              ${m.label} — เปิดเพิ่มรายเจ้า (override นอกแพ็กเกจ)
            </label>`,
          ).join('')}
          <div class="note">สถานะสวิตช์ด้านบนไม่มีเส้น API อ่านค่าปัจจุบัน — คลิกเพื่อสั่งเปิด/ปิดเท่านั้น</div>
        </div>

        <h3 style="margin:18px 0 8px;font-size:15px">บริษัทในเครือ + จำนวนผู้ใช้</h3>
        <div class="tblwrap">
          <table>
            <thead><tr><th>บริษัท</th><th>Users</th><th>แอดมินบริษัท</th><th>สถานะ</th></tr></thead>
            <tbody>${companyRows}</tbody>
          </table>
        </div>

        <h3 style="margin:18px 0 8px;font-size:15px">บิล / ใบเสร็จ</h3>
        <div class="tblwrap">
          <table>
            <thead><tr><th>เลขที่</th><th>รายการ</th><th>ยอด</th><th>สถานะ</th><th></th></tr></thead>
            <tbody>${invoiceRows}</tbody>
          </table>
        </div>
        <details style="margin-top:8px">
          <summary class="btn small" style="display:inline-block;cursor:pointer">+ ออก invoice ใหม่</summary>
          <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            <input type="text" id="invDesc" placeholder="รายการ เช่น Pro · ก.ค. 2026" />
            <input type="number" id="invAmount" placeholder="ยอด (บาท)" min="0" step="1" />
            <button id="createInvBtn" class="btn primary small">บันทึก</button>
          </div>
        </details>

        <h3 style="margin:20px 0 8px;font-size:15px">Login ล่าสุด (customer service ใช้ตอบปัญหา "เข้าระบบไม่ได้")</h3>
        ${loginsHtml}
      </div>
    </div>
  `
}

async function loadLogins(id) {
  try {
    const data = await api.get(`/admin/logins?tenantId=${id}`)
    const events = Array.isArray(data) ? data : (data?.events ?? [])
    if (!events.length) return '<div class="placeholder">ยังไม่มี login</div>'
    return `<div class="tblwrap"><table>
      <thead><tr><th>เวลา</th><th>ผู้ใช้</th><th>ผล</th></tr></thead>
      <tbody>${events.map(loginRow).join('')}</tbody>
    </table></div>`
  } catch (err) {
    const message = String(err?.message ?? '')
    if (/not configured/i.test(message)) {
      return '<div class="placeholder">ยังไม่ตั้งค่า Zitadel mgmt PAT</div>'
    }
    return `<div class="placeholder">โหลด login ล่าสุดไม่สำเร็จ${message ? ': ' + esc(message) : ''}</div>`
  }
}

function wire(view, id, reload) {
  const pkgSelect = view.querySelector('#pkgSelect')
  const changePkgBtn = view.querySelector('#changePkgBtn')
  if (changePkgBtn) {
    changePkgBtn.addEventListener('click', async () => {
      const slug = pkgSelect?.value
      if (!slug) return toast('เลือกแพ็กเกจก่อน')
      changePkgBtn.disabled = true
      try {
        await api.patch(`/admin/tenants/${id}/package`, { packageSlug: slug })
        toast('เปลี่ยนแพ็กเกจแล้ว', 'ok')
        await reload()
      } catch {
        /* api.js already toasted the error */
      } finally {
        changePkgBtn.disabled = false
      }
    })
  }

  view.querySelectorAll('[data-module]').forEach((input) => {
    input.addEventListener('change', async () => {
      const key = input.dataset.module
      const enabled = input.checked
      input.disabled = true
      try {
        await api.put(`/modules/tenants/${id}/${key}`, { enabled })
        toast(`${enabled ? 'เปิด' : 'ปิด'}โมดูล ${key} แล้ว`, 'ok')
      } catch {
        input.checked = !enabled
      } finally {
        input.disabled = false
      }
    })
  })

  view.querySelectorAll('[data-print]').forEach((btn) => {
    btn.addEventListener('click', () => printInvoice(btn.dataset.number, btn.dataset.print, btn))
  })

  view.querySelectorAll('[data-mark-paid]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true
      try {
        await api.patch(`/admin/invoices/${encodeURIComponent(btn.dataset.markPaid)}/paid`)
        toast('บันทึกรับเงินแล้ว', 'ok')
        await reload()
      } catch {
        btn.disabled = false
      }
    })
  })

  const createInvBtn = view.querySelector('#createInvBtn')
  if (createInvBtn) {
    createInvBtn.addEventListener('click', async () => {
      const descEl = view.querySelector('#invDesc')
      const amountEl = view.querySelector('#invAmount')
      const description = descEl?.value.trim()
      const amount = Number(amountEl?.value)
      if (!description) return toast('กรอกรายการก่อน')
      if (!Number.isFinite(amount) || amount <= 0) return toast('กรอกยอดเงินให้ถูกต้อง')
      createInvBtn.disabled = true
      try {
        await api.post(`/admin/tenants/${id}/invoices`, { description, amount })
        toast('ออก invoice ใหม่แล้ว', 'ok')
        await reload()
      } catch {
        createInvBtn.disabled = false
      }
    })
  }
}

async function renderTenant(view, id) {
  view.innerHTML = `<div class="frame"><div class="framebar">🔐 Platform Console</div><div class="framebody"><div class="placeholder">กำลังโหลด…</div></div></div>`

  let detail, packages, invoices
  try {
    ;[detail, packages, invoices] = await Promise.all([
      api.get(`/admin/tenants/${id}`),
      api.get('/admin/packages'),
      api.get(`/admin/tenants/${id}/invoices`),
    ])
  } catch {
    view.innerHTML = `<div class="frame"><div class="framebar">🔐 Platform Console</div><div class="framebody"><div class="placeholder">โหลดข้อมูลลูกค้าไม่สำเร็จ</div></div></div>`
    return
  }

  const loginsHtml = await loadLogins(id)

  const reload = () => renderTenant(view, id)
  view.innerHTML = render(detail, packages, invoices, loginsHtml)
  wire(view, id, reload)
}

route('#/tenant/:id', (view, params) => renderTenant(view, params.id))
