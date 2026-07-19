// admin-ui/src/constants.js
// Permission + module catalog for the admin UI (packages.js, permissions.js).
// Source of truth: entitlement/src/db/seed.ts — keep in sync if the seed list changes.
// There is no `GET /modules`/permission-list endpoint yet, so this is hardcoded per the plan.

export const MODULES = [
  { key: 'core', name: 'ระบบหลัก' },
  { key: 'hr', name: 'HR' },
  { key: 'esign', name: 'eSign' },
]

export const PERMISSIONS = [
  { key: 'tenant.company.manage', module: 'core', label: 'จัดการบริษัทในเครือ' },
  { key: 'tenant.user.manage', module: 'core', label: 'จัดการผู้ใช้ในองค์กร' },
  { key: 'employee.read', module: 'hr', label: 'ดูข้อมูลพนักงาน' },
  { key: 'employee.write', module: 'hr', label: 'แก้ไขข้อมูลพนักงาน' },
  { key: 'esign.document.read', module: 'esign', label: 'ดูเอกสาร' },
  { key: 'esign.document.create', module: 'esign', label: 'สร้างเอกสาร' },
  { key: 'esign.document.sign', module: 'esign', label: 'ลงนามเอกสาร' },
  { key: 'esign.document.send', module: 'esign', label: 'ส่งเอกสารให้ผู้อื่นลงนาม' },
  { key: 'esign.template.manage', module: 'esign', label: 'จัดการเทมเพลต' },
  { key: 'esign.audit.report', module: 'esign', label: 'รายงาน / audit log' },
]
