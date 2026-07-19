// admin-ui/src/pages/packages.js — หน้า 2: แพ็กเกจ (superadmin)
import { route } from '../router.js'
import { api, toast } from '../api.js'
import { MODULES, PERMISSIONS } from '../constants.js'

const state = { packages: [] }

function fmtPrice(price) {
  if (!price) return 'ฟรี'
  return `${price.toLocaleString('th-TH')} บาท/เดือน`
}

function quotaRowsHtml() {
  const cell = (fn) => state.packages.map((p) => `<td style="text-align:center">${fn(p)}</td>`).join('')
  return `
    <tr><td colspan="${state.packages.length + 1}" style="font-weight:700;background:var(--surface-2)">การสมัคร / โควตา</td></tr>
    <tr><td>วิธีเริ่มใช้</td>${cell((p) => (p.selfSignup ? 'สมัครเองทันที<br><span style="color:var(--muted);font-size:12px">self-signup</span>' : 'ทีมขาย/superadmin เปิดให้'))}</tr>
    <tr><td>Users (ที่นั่ง)</td>${cell((p) => p.seatLimit)}</tr>
    <tr><td>เอกสาร / เดือน</td>${cell((p) => (p.docLimitMonthly == null ? 'ไม่จำกัด' : p.docLimitMonthly))}</tr>
    <tr><td>บริษัทในเครือ (group company)</td>${cell((p) => p.companyLimit)}</tr>
    <tr><td>แอดมิน (admin ต่อบริษัท รวมกัน)</td>${cell((p) => p.adminLimit)}</tr>
    <tr><td>groupcompanyadmin</td>${cell((p) => (p.allowGroupAdmin ? '<span style="color:var(--ok)">✓</span>' : '<span style="color:var(--muted)">—</span>'))}</tr>
    <tr><td>ราคา</td>${cell((p) => fmtPrice(p.price))}</tr>
  `
}

function functionRowsHtml() {
  return MODULES.map((mod) => {
    const perms = PERMISSIONS.filter((perm) => perm.module === mod.key)
    if (!perms.length) return ''
    const header = `<tr><td colspan="${state.packages.length + 1}" style="font-weight:700;background:var(--surface-2)">Function — ${mod.name}</td></tr>`
    const rows = perms
      .map(
        (perm) => `
      <tr>
        <td>${perm.label} <span class="key" style="font-family:var(--mono);font-size:11.5px;color:var(--muted)">${perm.key}</span></td>
        ${state.packages
          .map(
            (p) =>
              `<td style="text-align:center">${
                p.permissionKeys?.includes(perm.key)
                  ? '<span style="color:var(--ok)">✓</span>'
                  : '<span style="color:var(--muted)">—</span>'
              }</td>`
          )
          .join('')}
      </tr>`
      )
      .join('')
    return header + rows
  }).join('')
}

function usageRowsHtml() {
  const usage = `<tr><td style="font-weight:700">ลูกค้าที่ใช้อยู่</td>${state.packages
    .map((p) => `<td style="text-align:center;font-size:13px">${p.tenantCount ?? 0} ราย</td>`)
    .join('')}</tr>`
  const edit = `<tr><td></td>${state.packages
    .map((p) => `<td style="text-align:center"><button type="button" class="btn small" data-edit="${p.id}">แก้ไข</button></td>`)
    .join('')}</tr>`
  return usage + edit
}

function tableHtml() {
  if (!state.packages.length) {
    return `<div class="placeholder">ยังไม่มีแพ็กเกจ</div>`
  }
  return `
    <div class="tblwrap">
      <table>
        <thead>
          <tr>
            <th style="min-width:200px"></th>
            ${state.packages.map((p) => `<th style="text-align:center">${p.name}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${quotaRowsHtml()}
          ${functionRowsHtml()}
          ${usageRowsHtml()}
        </tbody>
      </table>
    </div>
  `
}

function permGroupsHtml(selectedKeys) {
  const selected = new Set(selectedKeys ?? [])
  return MODULES.map((mod) => {
    const perms = PERMISSIONS.filter((p) => p.module === mod.key)
    if (!perms.length) return ''
    return `
      <fieldset class="pgroup">
        <legend>${mod.name}</legend>
        ${perms
          .map(
            (p) => `
          <div class="perm">
            <input type="checkbox" id="perm-${p.key}" value="${p.key}" ${selected.has(p.key) ? 'checked' : ''}>
            <label for="perm-${p.key}">${p.label} <span class="key">${p.key}</span></label>
          </div>`
          )
          .join('')}
      </fieldset>`
  }).join('')
}

function dialogHtml() {
  return `
    <dialog id="packageDialog" style="border:1px solid var(--line);border-radius:10px;padding:0;width:min(560px,94vw);background:var(--surface);color:var(--ink)">
      <form id="packageForm" style="padding:20px;display:flex;flex-direction:column;gap:12px;max-height:85vh;overflow:auto">
        <h3 id="packageDialogTitle" style="margin:0">สร้างแพ็กเกจใหม่</h3>
        <input type="hidden" name="packageId">
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <label style="flex:1;min-width:160px">ชื่อแพ็กเกจ<br><input type="text" name="packageName" required style="width:100%"></label>
          <label style="flex:1;min-width:160px">slug<br><input type="text" name="slug" required style="width:100%"></label>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <label style="flex:1;min-width:120px">Users (ที่นั่ง)<br><input type="number" name="seatLimit" min="0" required style="width:100%"></label>
          <label style="flex:1;min-width:120px">บริษัทในเครือ<br><input type="number" name="companyLimit" min="0" required style="width:100%"></label>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <label style="flex:1;min-width:120px">แอดมิน (รวม)<br><input type="number" name="adminLimit" min="0" required style="width:100%"></label>
          <label style="flex:1;min-width:120px">เอกสาร/เดือน<br><input type="number" name="docLimitMonthly" min="0" placeholder="ว่าง = ไม่จำกัด" style="width:100%"></label>
        </div>
        <label>ราคา (บาท/เดือน)<br><input type="number" name="price" min="0" style="width:100%"></label>
        <label class="toggle"><input type="checkbox" name="allowGroupAdmin"><span class="tk"></span> อนุญาต groupcompanyadmin</label>
        <label class="toggle"><input type="checkbox" name="selfSignup"><span class="tk"></span> เปิดให้สมัครเอง (self-signup)</label>
        <div>
          <div style="font-weight:700;margin-bottom:6px">สิทธิ์ที่ใช้ได้ในแพ็กเกจนี้</div>
          <div id="permFields">${permGroupsHtml([])}</div>
        </div>
        <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:6px">
          <button type="button" class="btn" id="packageCancelBtn">ยกเลิก</button>
          <button type="submit" class="btn primary">บันทึก</button>
        </div>
      </form>
    </dialog>
  `
}

function html() {
  return `
    <div class="frame">
      <div class="framebar">🔐 Platform Console · แพ็กเกจ</div>
      <div class="framebody">
        ${tableHtml()}
        <p style="margin:14px 0 0"><button type="button" class="btn primary" id="addPackageBtn">+ สร้างแพ็กเกจใหม่</button></p>
      </div>
    </div>
    ${dialogHtml()}
  `
}

function openDialog(view, pkg) {
  const dialog = view.querySelector('#packageDialog')
  const form = view.querySelector('#packageForm')
  form.reset()
  view.querySelector('#packageDialogTitle').textContent = pkg ? `แก้ไขแพ็กเกจ: ${pkg.name}` : 'สร้างแพ็กเกจใหม่'
  form.packageId.value = pkg ? pkg.id : ''
  form.packageName.value = pkg?.name ?? ''
  form.slug.value = pkg?.slug ?? ''
  form.seatLimit.value = pkg?.seatLimit ?? ''
  form.companyLimit.value = pkg?.companyLimit ?? ''
  form.adminLimit.value = pkg?.adminLimit ?? ''
  form.docLimitMonthly.value = pkg?.docLimitMonthly ?? ''
  form.price.value = pkg?.price ?? 0
  form.allowGroupAdmin.checked = pkg?.allowGroupAdmin ?? false
  form.selfSignup.checked = pkg?.selfSignup ?? false
  view.querySelector('#permFields').innerHTML = permGroupsHtml(pkg?.permissionKeys ?? [])
  dialog.showModal()
}

function bindEvents(view) {
  view.querySelectorAll('[data-edit]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const pkg = state.packages.find((p) => String(p.id) === btn.dataset.edit)
      openDialog(view, pkg)
    })
  })

  const dialog = view.querySelector('#packageDialog')
  view.querySelector('#addPackageBtn').addEventListener('click', () => openDialog(view, null))
  view.querySelector('#packageCancelBtn').addEventListener('click', () => dialog.close())
  view.querySelector('#packageForm').addEventListener('submit', async (e) => {
    e.preventDefault()
    const form = e.target
    const id = form.packageId.value
    const permissionKeys = Array.from(form.querySelectorAll('#permFields input[type="checkbox"]:checked')).map(
      (el) => el.value
    )
    const body = {
      name: form.packageName.value.trim(),
      slug: form.slug.value.trim(),
      seatLimit: Number(form.seatLimit.value),
      companyLimit: Number(form.companyLimit.value),
      adminLimit: Number(form.adminLimit.value),
      docLimitMonthly: form.docLimitMonthly.value === '' ? undefined : Number(form.docLimitMonthly.value),
      allowGroupAdmin: form.allowGroupAdmin.checked,
      selfSignup: form.selfSignup.checked,
      price: form.price.value === '' ? 0 : Number(form.price.value),
      permissionKeys,
    }
    try {
      if (id) {
        await api.put(`/admin/packages/${id}`, body)
      } else {
        await api.post('/admin/packages', body)
      }
      dialog.close()
      toast('บันทึกแพ็กเกจสำเร็จ', 'ok')
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
  state.packages = await api.get('/admin/packages')
  renderInto(view)
}

route('#/packages', async (view) => {
  view.innerHTML = `
    <div class="frame">
      <div class="framebar">🔐 Platform Console · แพ็กเกจ</div>
      <div class="framebody"><div class="placeholder">กำลังโหลด…</div></div>
    </div>
  `
  await load(view)
})
