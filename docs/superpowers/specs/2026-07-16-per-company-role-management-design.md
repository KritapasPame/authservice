# Per-company role management + user status (V2 task #1)

> อนุมัติ 2026-07-16. ปิด gap จาก `docs/KNOWN-LIMITATIONS-v1.md` §"Write API ยังไม่ครบ spec §6"
> แนวทาง: Explicit membership — endpoint เล็กๆ แยกหน้าที่ ไม่มี side effect ซ่อน

## เป้าหมาย

Claims resolver รองรับ per-company grant เต็มแล้ว แต่ write API ขาด: assign/revoke role
ต่อ company, จัดการ membership บริษัทในเครือ, และปิดผู้ใช้ งานนี้เติม write path ให้ครบ
โดยไม่แตะ schema (โครงรองรับอยู่แล้ว) และไม่แตะ resolver

Invariant สำคัญจาก resolver (`claims/resolver.ts`): grant ถูกสร้างเฉพาะ company ที่ user
เป็นสมาชิกใน `user_companies` — ดังนั้น assign role แบบ scope company **ต้อง** เป็น company
ที่ user เป็นสมาชิกอยู่แล้ว ไม่งั้น 400 (กัน no-op เงียบ)

## 1. Guard รวมศูนย์

ย้าย `canManageTenant` ที่ถูก copy 3 ที่ (company/user/role route) ไป `http/auth.ts`:

```ts
// perm ไม่ส่ง = เฉพาะ '*' ผ่าน (role route ใช้แบบนี้)
export const canManageTenant = (c: Record<string, any>, tenantId: number, perm?: string) =>
  isSuperadmin(c) || (c['urn:platform:tenantId'] === tenantId &&
    Object.values(c['urn:platform:grants'] ?? {}).some((g: any) =>
      g.permissions.includes('*') || (perm !== undefined && g.permissions.includes(perm))))
```

- company route → `canManageTenant(claims, tenantId, 'tenant.company.manage')`
- user route → `canManageTenant(claims, tenantId, 'tenant.user.manage')`
- role route → `canManageTenant(claims, tenantId)` (คง semantics เดิม: '*' เท่านั้น)

## 2. Endpoints ใหม่ (modules/user/)

ทุกตัว: lookup user จาก `:id` ก่อน (404 ถ้าไม่เจอ) → guard `canManageTenant(claims,
user.tenantId, 'tenant.user.manage')` (403)

### POST /users/:id/roles — body `{ roleSlug: string, companyId?: number }`
assign role ให้ user ที่มีอยู่ (ไม่ส่ง companyId = tenant-wide, `user_roles.company_id = null`)
- role lookup แบบเดียวกับ invite: slug ∈ system (tenantId null) ∪ tenant ของ user → ไม่เจอ 404
- grantAll escalation guard เหมือน invite: role ที่ `grant_all` ต้องให้ caller ถือ `'*'`
  ใน tenant นั้นหรือเป็น superadmin → ไม่งั้น 403 `{ forbiddenRole }`
- ถ้าส่ง companyId: ต้องมีแถวใน `user_companies` (user เป็นสมาชิก) → ไม่งั้น 400
  `{ invalidCompany }` (membership อยู่ tenant เดียวกันโดยนิยาม เพราะ invite/add validate แล้ว)
- ซ้ำ → `onConflictDoNothing` (idempotent, unique `user_roles_uq` nullsNotDistinct รองรับ)

### DELETE /users/:id/roles — body `{ roleSlug: string, companyId?: number }`
ถอน role แถวที่ตรง (userId, roleId, companyId) — companyId ไม่ส่ง = ลบแถว tenant-wide (null)
- role slug ไม่เจอ → 404; แถวไม่มีอยู่ → `{ ok: true }` เฉยๆ (idempotent)

### POST /users/:id/companies — body `{ companyId: number }`
เพิ่ม user เข้าบริษัทในเครือ
- company ต้องอยู่ tenant เดียวกับ user → ไม่งั้น 400 `{ invalidCompany }`
- ซ้ำ → `onConflictDoNothing`

### DELETE /users/:id/companies/:companyId
ถอน user ออกจากบริษัท **และลบ `user_roles` ที่ scope company นั้นทิ้งด้วย**
(กัน role ผีกลับมาทำงานถ้า add membership กลับ) — idempotent

### PATCH /users/:id/status — body `{ status: 'active' | 'disabled' }`
- validate ด้วย `t.Union([t.Literal('active'), t.Literal('disabled')])`
- resolver เช็ค status อยู่แล้ว (disabled → claims ว่าง) มีผลตอน token ใหม่
  JWT เดิมอยู่จน TTL หมด — ตาม design เดิม (access-token TTL สั้น)

## 3. ไม่แตะ

- `POST /users/invite` — คง tenant-wide ตามเดิม (invite แล้วค่อย assign per-company)
- resolver, schema, migration — ไม่ต้องเปลี่ยน

## 4. Error handling

แพทเทิร์นเดิมของ repo: service throw plain object (`{ notFound }`, `{ invalidCompany }`,
`{ forbiddenRole }`) → route map เป็น status code (404/400/403)

## 5. Tests

เพิ่ม `tests/user-roles.test.ts` (แยกไฟล์ กัน user.test.ts บวม):
- assign tenant-wide + per-company สำเร็จ
- เคสสมชาย: admin ที่ A, HR ที่ B → resolver คืน grants ถูก per company
- role ข้าม tenant / slug ไม่มี → 404
- grantAll escalation โดย caller ไม่มี '*' → 403
- companyId ที่ user ไม่เป็นสมาชิก → 400
- assign ซ้ำ → idempotent
- revoke role → grant หาย; revoke แถวที่ไม่มี → ok
- add/remove company membership; remove แล้ว scoped role หายด้วย
- PATCH status disabled → resolver คืน `{}`; กลับ active ได้
- caller ไม่มีสิทธิ์ → 403 ทุก endpoint
- regression: company/user/role route เดิมยังผ่านหลังรวม guard (test เดิมต้อง green)
