import { test, expect } from 'bun:test'
import { can, canUse, hasModule } from '../src'

// tenant เปิดแค่ esign — user ถือ '*' (grant_all) ที่ company 5
const starClaims = {
  'urn:platform:tenantId': 1,
  'urn:platform:modules': ['esign'],
  'urn:platform:grants': { '5': { roles: ['group_admin'], permissions: ['*'] } },
}

test("ช่องโหว่เดิม: can() เดี่ยวๆ ปล่อย '*' ทะลุ module ที่ tenant ไม่ได้เปิด", () => {
  // hr ไม่ได้เปิด แต่ can() ไม่รู้เรื่อง module — ผ่าน (นี่คือเหตุผลที่ product ต้องใช้ canUse)
  expect(can(starClaims, 5, 'employee.read')).toBe(true)
  expect(hasModule(starClaims, 'hr')).toBe(false)
})

test("canUse ปิดช่อง: '*' ผ่านเฉพาะ module ที่เปิด", () => {
  expect(canUse(starClaims, 5, 'esign', 'esign.document.sign')).toBe(true)
  expect(canUse(starClaims, 5, 'hr', 'employee.read')).toBe(false)      // module ปิด → ไม่ผ่านแม้ถือ '*'
  expect(canUse(starClaims, 5, 'esign', 'esign.document.sign')).toBe(true)
  expect(canUse(starClaims, 99, 'esign', 'esign.document.sign')).toBe(false) // ไม่มี grant ที่ company 99
})

test('canUse กับ permission ตรงตัว (ไม่มี *)', () => {
  const claims = {
    'urn:platform:modules': ['esign', 'hr'],
    'urn:platform:grants': { '7': { roles: ['signer'], permissions: ['esign.document.sign'] } },
  }
  expect(canUse(claims, 7, 'esign', 'esign.document.sign')).toBe(true)
  expect(canUse(claims, 7, 'hr', 'employee.read')).toBe(false)  // ไม่มี perm นี้
})
