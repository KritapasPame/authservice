# Per-Company Role Management + User Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เติม write API ที่ขาดของ entitlement service — assign/revoke role ต่อ company, จัดการ membership บริษัทในเครือ, ปิด/เปิดผู้ใช้ — ตาม spec `docs/superpowers/specs/2026-07-16-per-company-role-management-design.md`

**Architecture:** เพิ่ม endpoint ใน `entitlement/src/modules/user/` ตามแพทเทิร์นเดิม (route = guard + map error, service = logic + throw plain object) และรวม guard `canManageTenant` ที่ copy 3 ที่เป็น helper เดียวใน `http/auth.ts` ไม่แตะ schema/resolver

**Tech Stack:** Bun + Elysia 1.x + drizzle-orm (Postgres), test ด้วย `bun test`

## Global Constraints

- สไตล์โปรเจกต์: โค้ดง่ายที่สุด one-liner ได้ทำ, comment ภาษาไทยเฉพาะจุดที่โค้ดบอกเองไม่ได้
- Service throw plain object (`{ notFound }`, `{ invalidCompany }`, `{ forbiddenRole }`) → route map เป็น status
- ทุกคำสั่ง test รันจาก `/Users/kritapaswongpemdacha/Workspaces/kritapas/authservice/entitlement` — ต้องมี Postgres container `authservice-db-1` รันอยู่ (เช็คด้วย `docker ps`)
- Baseline ก่อนเริ่ม: `bun test` = 62 pass / 0 fail — ห้ามทำ test เดิมแดง
- ห้าม mock.module('jose') ซ้ำ — import `./helpers/auth-mock` อย่างเดียว (กติกาใน auth-mock.ts)
- commit ทุก task, message ลงท้าย `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: รวม guard `canManageTenant` เป็น helper เดียวใน auth.ts

Refactor ล้วน — ไม่มี behavior ใหม่ ใช้ test เดิมทั้ง suite เป็นตาข่าย (62 test ต้องเขียวเท่าเดิม)

**Files:**
- Modify: `entitlement/src/http/auth.ts`
- Modify: `entitlement/src/modules/company/route.ts`
- Modify: `entitlement/src/modules/user/route.ts`
- Modify: `entitlement/src/modules/role/route.ts`
- Modify: `entitlement/src/modules/user/service.ts`

**Interfaces:**
- Produces: `canManageTenant(claims: Record<string, any>, tenantId: number, perm?: string): boolean` export จาก `http/auth.ts` — superadmin ผ่านเสมอ; ไม่งั้นต้อง tenantId ตรง และมี grant ที่ถือ `'*'` หรือ `perm` ที่ระบุ; **ไม่ส่ง perm = เฉพาะ `'*'` ผ่าน** (semantics เดิมของ role route และ escalation guard)

- [ ] **Step 1: เพิ่ม `canManageTenant` ใน `entitlement/src/http/auth.ts`** — วางต่อจาก `isSuperadmin` (บรรทัด 17)

```ts
// tenant-scoped management guard — superadmin หรือ (tenant ตรง + grant ไหนก็ได้ถือ '*' หรือ perm ที่ระบุ)
// ไม่ส่ง perm = เฉพาะ '*' ผ่าน (role management / grantAll escalation ใช้แบบนี้)
export const canManageTenant = (c: Record<string, any>, tenantId: number, perm?: string) =>
  isSuperadmin(c) || (c['urn:platform:tenantId'] === tenantId &&
    Object.values(c['urn:platform:grants'] ?? {}).some((g: any) =>
      g.permissions.includes('*') || (perm !== undefined && g.permissions.includes(perm))))
```

- [ ] **Step 2: ใช้ใน `entitlement/src/modules/company/route.ts`** — ลบ local `canManageTenant` (บรรทัด 5-9 พร้อม comment) แล้วแก้เป็น

```ts
import { Elysia, t } from 'elysia'
import { requireAuth, canManageTenant } from '../../http/auth'
import { createCompany, listByTenant } from './service'
```

และแก้ 2 จุดที่เรียก `canManageTenant(auth.claims, ...)` เป็น `canManageTenant(auth.claims, <tenantId เดิม>, 'tenant.company.manage')`

- [ ] **Step 3: ใช้ใน `entitlement/src/modules/user/route.ts`** — ลบ local `canManageTenant` (บรรทัด 5-8) แก้ import เป็น `import { requireAuth, canManageTenant } from '../../http/auth'` และจุดเรียกใน `/invite` เป็น `canManageTenant(auth.claims, body.tenantId, 'tenant.user.manage')`

- [ ] **Step 4: ใช้ใน `entitlement/src/modules/role/route.ts`** — ลบ local `canManageTenant` (บรรทัด 5-9) แก้ import เป็น `import { requireAuth, isSuperadmin, canManageTenant } from '../../http/auth'` (role route ยังใช้ `isSuperadmin` ตรงๆ ที่เคส system role) จุดเรียกเดิม 3 จุดคงรูป `canManageTenant(auth.claims, tenantId)` — ไม่ส่ง perm, semantics '*'-only เดิม

- [ ] **Step 5: ใช้แทน escalation guard ใน `entitlement/src/modules/user/service.ts`** — logic `callerHasStar` (บรรทัด 27-32) คือ `canManageTenant(claims, tenantId)` เป๊ะ แทนที่บล็อกเดิมด้วย

```ts
  // privilege-escalation guard: แนบ role grantAll ('*') ได้เฉพาะ caller ที่ถือ '*' อยู่แล้ว (หรือ superadmin)
  const escalating = rs.filter(r => r.grantAll)
  if (escalating.length && !canManageTenant(callerClaims, i.tenantId)) throw { forbiddenRole: escalating.map(r => r.slug) }
```

แก้ import จาก `import { isSuperadmin } from '../../http/auth'` เป็น `import { canManageTenant } from '../../http/auth'` (ไฟล์นี้ไม่ใช้ `isSuperadmin` ที่อื่นแล้ว)

- [ ] **Step 6: รัน suite ทั้งหมด**

Run: `cd /Users/kritapaswongpemdacha/Workspaces/kritapas/authservice/entitlement && bun test`
Expected: `62 pass, 0 fail` (เท่า baseline)

- [ ] **Step 7: Commit**

```bash
git add entitlement/src
git commit -m "refactor(entitlement): consolidate canManageTenant guard into http/auth"
```

---

### Task 2: `PATCH /users/:id/status` + scaffold test file ใหม่

**Files:**
- Create: `entitlement/tests/user-roles.test.ts`
- Modify: `entitlement/src/modules/user/service.ts`
- Modify: `entitlement/src/modules/user/route.ts`

**Interfaces:**
- Consumes: `canManageTenant` จาก Task 1
- Produces: `getUser(id: number)` → row ของ users หรือ undefined; `setStatus(id: number, status: string)` → `{ ok: true }` — ทั้งคู่ export จาก `modules/user/service.ts` (task ถัดๆ ไปใช้ `getUser` ต่อ)

- [ ] **Step 1: สร้าง `entitlement/tests/user-roles.test.ts` พร้อม test แรก (failing)**

```ts
import { test, expect, mock } from 'bun:test'
import { Elysia } from 'elysia'
import { and, eq } from 'drizzle-orm'
import { bearer } from './helpers/auth-mock'
import { db } from '../src/db/client'
import { tenants, companies, roles, users, userCompanies, userRoles } from '../src/db/schema'

// mock zitadel client กัน side-effect ตอน import chain (กติกาเดียวกับ user.test.ts — mock ทุก export)
mock.module('../src/zitadel/client', () => ({
  createZitadelOrg: mock(async () => 'org_mock_' + Date.now()),
  createZitadelUser: mock(async () => 'user_mock_mng_' + Date.now()),
  listLoginEvents: mock(async () => ({ events: [] })),
}))

const { userRouter } = await import('../src/modules/user/route')
const { resolveClaims } = await import('../src/claims/resolver')

const app = new Elysia().use(userRouter)
const req = (method: string, path: string, headers: Record<string, string>, body?: unknown) =>
  app.handle(new Request('http://localhost' + path, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  }))

const superadmin = bearer({ sub: 'z-sa', 'urn:platform:role': 'superadmin' })
// caller ฝั่ง tenant ที่ถือ tenant.user.manage (ใช้ทดสอบ guard ข้าม tenant)
const managerOf = (tenantId: number) => bearer({
  sub: 'z-mgr', 'urn:platform:role': 'tenant_admin', 'urn:platform:tenantId': tenantId,
  'urn:platform:grants': { '1': { roles: [], permissions: ['tenant.user.manage'] } },
})

let seq = 0
async function makeUserInTenant() {
  const slug = `mng-${Date.now()}-${++seq}`
  const [tenant] = await db.insert(tenants).values({ name: 'T-' + slug, slug, zitadelOrgId: 'org_' + slug }).returning()
  const [user] = await db.insert(users).values({ zitadelUserId: 'zu_' + slug, tenantId: tenant.id, email: slug + '@example.com' }).returning()
  return { tenant, user }
}

test('PATCH /users/:id/status disabled → resolver คืน {} ; กลับ active → สิทธิ์กลับมา', async () => {
  const { user } = await makeUserInTenant()
  const res = await req('PATCH', `/users/${user.id}/status`, { authorization: superadmin }, { status: 'disabled' })
  expect(res.status).toBe(200)
  expect(await resolveClaims(user.zitadelUserId)).toEqual({})

  const res2 = await req('PATCH', `/users/${user.id}/status`, { authorization: superadmin }, { status: 'active' })
  expect(res2.status).toBe(200)
  const claims = await resolveClaims(user.zitadelUserId) as { tenantId: number }
  expect(claims.tenantId).toBe(user.tenantId)
})

test('PATCH status: user ไม่มีจริง → 404 / caller ต่าง tenant → 403 / status นอก union → 422', async () => {
  const { tenant, user } = await makeUserInTenant()
  expect((await req('PATCH', '/users/999999/status', { authorization: superadmin }, { status: 'disabled' })).status).toBe(404)
  expect((await req('PATCH', `/users/${user.id}/status`, { authorization: managerOf(tenant.id + 1) }, { status: 'disabled' })).status).toBe(403)
  expect((await req('PATCH', `/users/${user.id}/status`, { authorization: superadmin }, { status: 'banned' })).status).toBe(422)
})
```

- [ ] **Step 2: รันให้เห็นว่า fail**

Run: `cd /Users/kritapaswongpemdacha/Workspaces/kritapas/authservice/entitlement && bun test tests/user-roles.test.ts`
Expected: FAIL — PATCH คืน 404 จาก Elysia (route ไม่มี) ทำให้ expect(200) ไม่ผ่าน

- [ ] **Step 3: เพิ่ม service functions ใน `entitlement/src/modules/user/service.ts`** (ต่อท้ายไฟล์)

```ts
export async function getUser(id: number) {
  const [u] = await db.select().from(users).where(eq(users.id, id))
  return u
}

export async function setStatus(id: number, status: string) {
  await db.update(users).set({ status }).where(eq(users.id, id))
  return { ok: true }
}
```

- [ ] **Step 4: เพิ่ม route ใน `entitlement/src/modules/user/route.ts`** — แก้ import service เป็น `import { inviteUser, getUser, setStatus } from './service'` แล้วต่อ chain หลัง `/invite`:

```ts
  .patch('/:id/status', async ({ auth, params, body, set }) => {
    const user = await getUser(Number(params.id))
    if (!user) { set.status = 404; return 'user not found' }
    if (!canManageTenant(auth.claims, user.tenantId, 'tenant.user.manage')) { set.status = 403; return 'forbidden' }
    return setStatus(user.id, body.status)
  }, { body: t.Object({ status: t.Union([t.Literal('active'), t.Literal('disabled')]) }) })
```

- [ ] **Step 5: รันให้ผ่าน**

Run: `cd /Users/kritapaswongpemdacha/Workspaces/kritapas/authservice/entitlement && bun test tests/user-roles.test.ts`
Expected: PASS ทั้ง 2 test

- [ ] **Step 6: Commit**

```bash
git add entitlement/src entitlement/tests
git commit -m "feat(entitlement): PATCH /users/:id/status enable/disable user"
```

---

### Task 3: membership บริษัทในเครือ — `POST /users/:id/companies` + `DELETE /users/:id/companies/:companyId`

**Files:**
- Modify: `entitlement/tests/user-roles.test.ts`
- Modify: `entitlement/src/modules/user/service.ts`
- Modify: `entitlement/src/modules/user/route.ts`

**Interfaces:**
- Consumes: `getUser` จาก Task 2
- Produces: `addCompany(user: { id: number; tenantId: number }, companyId: number)` → `{ ok: true }` throw `{ invalidCompany }`; `removeCompany(userId: number, companyId: number)` → `{ ok: true }` (ลบ scoped roles ด้วย)

- [ ] **Step 1: เพิ่ม failing tests ใน `entitlement/tests/user-roles.test.ts`**

```ts
test('POST /users/:id/companies เพิ่ม membership; ยิงซ้ำ → row เดียว (idempotent)', async () => {
  const { tenant, user } = await makeUserInTenant()
  const [co] = await db.insert(companies).values({ tenantId: tenant.id, name: 'Co M' }).returning()
  expect((await req('POST', `/users/${user.id}/companies`, { authorization: superadmin }, { companyId: co.id })).status).toBe(200)
  expect((await req('POST', `/users/${user.id}/companies`, { authorization: superadmin }, { companyId: co.id })).status).toBe(200)
  const rows = await db.select().from(userCompanies).where(eq(userCompanies.userId, user.id))
  expect(rows.map(r => r.companyId)).toEqual([co.id])
})

test('POST /users/:id/companies ด้วย company ของ tenant อื่น → 400 invalidCompany', async () => {
  const { user } = await makeUserInTenant()
  const { tenant: otherTenant } = await makeUserInTenant()
  const [alien] = await db.insert(companies).values({ tenantId: otherTenant.id, name: 'Alien Co' }).returning()
  const res = await req('POST', `/users/${user.id}/companies`, { authorization: superadmin }, { companyId: alien.id })
  expect(res.status).toBe(400)
  expect(await res.json()).toEqual({ invalidCompany: alien.id })
  expect((await db.select().from(userCompanies).where(eq(userCompanies.userId, user.id))).length).toBe(0)
})

test('DELETE /users/:id/companies/:companyId ถอน membership + role ที่ scope company นั้น แต่ role tenant-wide อยู่ครบ', async () => {
  const { tenant, user } = await makeUserInTenant()
  const [co] = await db.insert(companies).values({ tenantId: tenant.id, name: 'Co D' }).returning()
  const [role] = await db.insert(roles).values({ tenantId: tenant.id, name: 'R', slug: `rm-co-${Date.now()}-${seq}` }).returning()
  await db.insert(userCompanies).values({ userId: user.id, companyId: co.id })
  await db.insert(userRoles).values([
    { userId: user.id, roleId: role.id, companyId: co.id },   // scoped — ต้องหาย
    { userId: user.id, roleId: role.id, companyId: null },    // tenant-wide — ต้องอยู่
  ])
  expect((await req('DELETE', `/users/${user.id}/companies/${co.id}`, { authorization: superadmin })).status).toBe(200)
  expect((await db.select().from(userCompanies).where(eq(userCompanies.userId, user.id))).length).toBe(0)
  const ur = await db.select().from(userRoles).where(eq(userRoles.userId, user.id))
  expect(ur.length).toBe(1)
  expect(ur[0].companyId).toBeNull()
  // idempotent: ลบซ้ำได้
  expect((await req('DELETE', `/users/${user.id}/companies/${co.id}`, { authorization: superadmin })).status).toBe(200)
})
```

- [ ] **Step 2: รันให้เห็นว่า fail**

Run: `cd /Users/kritapaswongpemdacha/Workspaces/kritapas/authservice/entitlement && bun test tests/user-roles.test.ts`
Expected: FAIL — 3 test ใหม่แดง (route ไม่มี → 404), 2 test เดิมเขียว

- [ ] **Step 3: เพิ่ม service functions ใน `entitlement/src/modules/user/service.ts`** (ต่อท้ายไฟล์)

```ts
export async function addCompany(user: { id: number; tenantId: number }, companyId: number) {
  const [c] = await db.select().from(companies).where(and(eq(companies.id, companyId), eq(companies.tenantId, user.tenantId)))
  if (!c) throw { invalidCompany: companyId }
  await db.insert(userCompanies).values({ userId: user.id, companyId }).onConflictDoNothing()
  return { ok: true }
}

// ถอน membership แล้วลบ role ที่ scope company นั้นด้วย — กัน role ผีกลับมาทำงานถ้า add membership กลับ
export async function removeCompany(userId: number, companyId: number) {
  await db.delete(userRoles).where(and(eq(userRoles.userId, userId), eq(userRoles.companyId, companyId)))
  await db.delete(userCompanies).where(and(eq(userCompanies.userId, userId), eq(userCompanies.companyId, companyId)))
  return { ok: true }
}
```

- [ ] **Step 4: เพิ่ม routes ใน `entitlement/src/modules/user/route.ts`** — เพิ่ม `addCompany, removeCompany` ใน import แล้วต่อ chain:

```ts
  .post('/:id/companies', async ({ auth, params, body, set }) => {
    const user = await getUser(Number(params.id))
    if (!user) { set.status = 404; return 'user not found' }
    if (!canManageTenant(auth.claims, user.tenantId, 'tenant.user.manage')) { set.status = 403; return 'forbidden' }
    try {
      return await addCompany(user, body.companyId)
    } catch (e: any) {
      if (e?.invalidCompany !== undefined) { set.status = 400; return { invalidCompany: e.invalidCompany } }
      throw e
    }
  }, { body: t.Object({ companyId: t.Number() }) })
  .delete('/:id/companies/:companyId', async ({ auth, params, set }) => {
    const user = await getUser(Number(params.id))
    if (!user) { set.status = 404; return 'user not found' }
    if (!canManageTenant(auth.claims, user.tenantId, 'tenant.user.manage')) { set.status = 403; return 'forbidden' }
    return removeCompany(user.id, Number(params.companyId))
  })
```

- [ ] **Step 5: รันให้ผ่าน**

Run: `cd /Users/kritapaswongpemdacha/Workspaces/kritapas/authservice/entitlement && bun test tests/user-roles.test.ts`
Expected: PASS ทั้ง 5 test

- [ ] **Step 6: Commit**

```bash
git add entitlement/src entitlement/tests
git commit -m "feat(entitlement): add/remove user company membership (cascade scoped roles)"
```

---

### Task 4: `POST /users/:id/roles` — assign role (tenant-wide / per-company)

**Files:**
- Modify: `entitlement/tests/user-roles.test.ts`
- Modify: `entitlement/src/modules/user/service.ts`
- Modify: `entitlement/src/modules/user/route.ts`

**Interfaces:**
- Consumes: `getUser` (Task 2), `canManageTenant` (Task 1)
- Produces: `assignRole(user: { id: number; tenantId: number }, roleSlug: string, companyId: number | null, callerClaims: Record<string, any>)` → `{ ok: true }` throw `{ notFound: 'role' }` / `{ forbiddenRole }` / `{ invalidCompany }`

- [ ] **Step 1: เพิ่ม failing tests**

```ts
test('POST /users/:id/roles ไม่ส่ง companyId → row companyId null; ยิงซ้ำ → idempotent', async () => {
  const { tenant, user } = await makeUserInTenant()
  const slug = `asgn-tw-${Date.now()}-${seq}`
  await db.insert(roles).values({ tenantId: tenant.id, name: 'R', slug })
  expect((await req('POST', `/users/${user.id}/roles`, { authorization: superadmin }, { roleSlug: slug })).status).toBe(200)
  expect((await req('POST', `/users/${user.id}/roles`, { authorization: superadmin }, { roleSlug: slug })).status).toBe(200)
  const rows = await db.select().from(userRoles).where(eq(userRoles.userId, user.id))
  expect(rows.length).toBe(1)
  expect(rows[0].companyId).toBeNull()
})

test('POST /users/:id/roles scope company: สมาชิกแล้ว → 200, ไม่ใช่สมาชิก → 400 invalidCompany', async () => {
  const { tenant, user } = await makeUserInTenant()
  const [coIn] = await db.insert(companies).values({ tenantId: tenant.id, name: 'In' }).returning()
  const [coOut] = await db.insert(companies).values({ tenantId: tenant.id, name: 'Out' }).returning()
  await db.insert(userCompanies).values({ userId: user.id, companyId: coIn.id })
  const slug = `asgn-co-${Date.now()}-${seq}`
  await db.insert(roles).values({ tenantId: tenant.id, name: 'R', slug })
  const ok = await req('POST', `/users/${user.id}/roles`, { authorization: superadmin }, { roleSlug: slug, companyId: coIn.id })
  expect(ok.status).toBe(200)
  const bad = await req('POST', `/users/${user.id}/roles`, { authorization: superadmin }, { roleSlug: slug, companyId: coOut.id })
  expect(bad.status).toBe(400)
  expect(await bad.json()).toEqual({ invalidCompany: coOut.id })
  const rows = await db.select().from(userRoles).where(eq(userRoles.userId, user.id))
  expect(rows.map(r => r.companyId)).toEqual([coIn.id])
})

test('POST /users/:id/roles slug ไม่มี หรือเป็นของ tenant อื่น → 404', async () => {
  const { user } = await makeUserInTenant()
  const { tenant: otherTenant } = await makeUserInTenant()
  const alienSlug = `asgn-alien-${Date.now()}-${seq}`
  await db.insert(roles).values({ tenantId: otherTenant.id, name: 'Alien', slug: alienSlug })
  expect((await req('POST', `/users/${user.id}/roles`, { authorization: superadmin }, { roleSlug: 'no-such-slug' })).status).toBe(404)
  expect((await req('POST', `/users/${user.id}/roles`, { authorization: superadmin }, { roleSlug: alienSlug })).status).toBe(404)
})

test('grantAll role: caller ไม่มี * → 403 forbiddenRole, superadmin → 200', async () => {
  const { tenant, user } = await makeUserInTenant()
  const slug = `asgn-ga-${Date.now()}-${seq}`
  await db.insert(roles).values({ tenantId: tenant.id, name: 'GA', slug, grantAll: true })
  const res = await req('POST', `/users/${user.id}/roles`, { authorization: managerOf(tenant.id) }, { roleSlug: slug })
  expect(res.status).toBe(403)
  expect(await res.json()).toEqual({ forbiddenRole: [slug] })
  expect((await req('POST', `/users/${user.id}/roles`, { authorization: superadmin }, { roleSlug: slug })).status).toBe(200)
})
```

- [ ] **Step 2: รันให้เห็นว่า fail**

Run: `cd /Users/kritapaswongpemdacha/Workspaces/kritapas/authservice/entitlement && bun test tests/user-roles.test.ts`
Expected: FAIL — 4 test ใหม่แดง (route ไม่มี), test เดิมเขียว

- [ ] **Step 3: เพิ่ม `assignRole` ใน `entitlement/src/modules/user/service.ts`** — ต้อง import เพิ่ม: `canManageTenant` จาก `'../../http/auth'` (มีอยู่แล้วจาก Task 1)

```ts
export async function assignRole(user: { id: number; tenantId: number }, roleSlug: string, companyId: number | null, callerClaims: Record<string, any>) {
  // system ∪ tenant เดียวกัน (invariant เดียวกับ invite — resolver เชื่อ write path นี้)
  const matches = await db.select().from(roles).where(and(eq(roles.slug, roleSlug), or(isNull(roles.tenantId), eq(roles.tenantId, user.tenantId))))
  const role = matches.find(r => r.tenantId !== null) ?? matches[0]  // slug ชนระหว่าง system/tenant → เลือก tenant role
  if (!role) throw { notFound: 'role' }
  if (role.grantAll && !canManageTenant(callerClaims, user.tenantId)) throw { forbiddenRole: [role.slug] }
  if (companyId !== null) {
    // ต้องเป็นสมาชิก company อยู่แล้ว — resolver สร้าง grant เฉพาะ company ใน user_companies, กัน assign แล้ว no-op เงียบ
    const [m] = await db.select().from(userCompanies).where(and(eq(userCompanies.userId, user.id), eq(userCompanies.companyId, companyId)))
    if (!m) throw { invalidCompany: companyId }
  }
  await db.insert(userRoles).values({ userId: user.id, roleId: role.id, companyId }).onConflictDoNothing()
  return { ok: true }
}
```

- [ ] **Step 4: เพิ่ม route** — เพิ่ม `assignRole` ใน import แล้วต่อ chain:

```ts
  .post('/:id/roles', async ({ auth, params, body, set }) => {
    const user = await getUser(Number(params.id))
    if (!user) { set.status = 404; return 'user not found' }
    if (!canManageTenant(auth.claims, user.tenantId, 'tenant.user.manage')) { set.status = 403; return 'forbidden' }
    try {
      return await assignRole(user, body.roleSlug, body.companyId ?? null, auth.claims)
    } catch (e: any) {
      if (e?.notFound) { set.status = 404; return `${e.notFound} not found` }
      if (e?.invalidCompany !== undefined) { set.status = 400; return { invalidCompany: e.invalidCompany } }
      if (e?.forbiddenRole) { set.status = 403; return { forbiddenRole: e.forbiddenRole } }
      throw e
    }
  }, { body: t.Object({ roleSlug: t.String(), companyId: t.Optional(t.Number()) }) })
```

- [ ] **Step 5: รันให้ผ่าน**

Run: `cd /Users/kritapaswongpemdacha/Workspaces/kritapas/authservice/entitlement && bun test tests/user-roles.test.ts`
Expected: PASS ทั้ง 9 test

- [ ] **Step 6: Commit**

```bash
git add entitlement/src entitlement/tests
git commit -m "feat(entitlement): POST /users/:id/roles per-company role assignment"
```

---

### Task 5: `DELETE /users/:id/roles` — revoke role

**Files:**
- Modify: `entitlement/tests/user-roles.test.ts`
- Modify: `entitlement/src/modules/user/service.ts`
- Modify: `entitlement/src/modules/user/route.ts`

**Interfaces:**
- Consumes: `getUser`, `canManageTenant`
- Produces: `revokeRole(user: { id: number; tenantId: number }, roleSlug: string, companyId: number | null)` → `{ ok: true }` throw `{ notFound: 'role' }`

- [ ] **Step 1: เพิ่ม failing tests**

```ts
test('DELETE /users/:id/roles ลบเฉพาะ scope ที่ระบุ; แถวไม่มี → ok เฉยๆ; slug ไม่มี → 404', async () => {
  const { tenant, user } = await makeUserInTenant()
  const [co] = await db.insert(companies).values({ tenantId: tenant.id, name: 'Rv' }).returning()
  await db.insert(userCompanies).values({ userId: user.id, companyId: co.id })
  const slug = `rvk-${Date.now()}-${seq}`
  const [role] = await db.insert(roles).values({ tenantId: tenant.id, name: 'R', slug }).returning()
  await db.insert(userRoles).values([
    { userId: user.id, roleId: role.id, companyId: null },
    { userId: user.id, roleId: role.id, companyId: co.id },
  ])
  // ลบ tenant-wide (ไม่ส่ง companyId) → เหลือแถว scoped
  expect((await req('DELETE', `/users/${user.id}/roles`, { authorization: superadmin }, { roleSlug: slug })).status).toBe(200)
  let rows = await db.select().from(userRoles).where(eq(userRoles.userId, user.id))
  expect(rows.map(r => r.companyId)).toEqual([co.id])
  // ลบ scoped → หมด
  expect((await req('DELETE', `/users/${user.id}/roles`, { authorization: superadmin }, { roleSlug: slug, companyId: co.id })).status).toBe(200)
  rows = await db.select().from(userRoles).where(eq(userRoles.userId, user.id))
  expect(rows.length).toBe(0)
  // idempotent + slug ไม่มีจริง
  expect((await req('DELETE', `/users/${user.id}/roles`, { authorization: superadmin }, { roleSlug: slug })).status).toBe(200)
  expect((await req('DELETE', `/users/${user.id}/roles`, { authorization: superadmin }, { roleSlug: 'no-such-slug' })).status).toBe(404)
})
```

- [ ] **Step 2: รันให้เห็นว่า fail**

Run: `cd /Users/kritapaswongpemdacha/Workspaces/kritapas/authservice/entitlement && bun test tests/user-roles.test.ts`
Expected: FAIL — test ใหม่แดง (route ไม่มี)

- [ ] **Step 3: เพิ่ม `revokeRole` ใน service** — ต้อง import `inArray, isNull` จาก drizzle (มีอยู่แล้วในไฟล์)

```ts
export async function revokeRole(user: { id: number; tenantId: number }, roleSlug: string, companyId: number | null) {
  const matches = await db.select().from(roles).where(and(eq(roles.slug, roleSlug), or(isNull(roles.tenantId), eq(roles.tenantId, user.tenantId))))
  if (!matches.length) throw { notFound: 'role' }
  await db.delete(userRoles).where(and(eq(userRoles.userId, user.id), inArray(userRoles.roleId, matches.map(r => r.id)),
    companyId === null ? isNull(userRoles.companyId) : eq(userRoles.companyId, companyId)))
  return { ok: true }
}
```

- [ ] **Step 4: เพิ่ม route** — เพิ่ม `revokeRole` ใน import แล้วต่อ chain:

```ts
  .delete('/:id/roles', async ({ auth, params, body, set }) => {
    const user = await getUser(Number(params.id))
    if (!user) { set.status = 404; return 'user not found' }
    if (!canManageTenant(auth.claims, user.tenantId, 'tenant.user.manage')) { set.status = 403; return 'forbidden' }
    try {
      return await revokeRole(user, body.roleSlug, body.companyId ?? null)
    } catch (e: any) {
      if (e?.notFound) { set.status = 404; return `${e.notFound} not found` }
      throw e
    }
  }, { body: t.Object({ roleSlug: t.String(), companyId: t.Optional(t.Number()) }) })
```

- [ ] **Step 5: รันให้ผ่าน**

Run: `cd /Users/kritapaswongpemdacha/Workspaces/kritapas/authservice/entitlement && bun test tests/user-roles.test.ts`
Expected: PASS ทั้ง 10 test

- [ ] **Step 6: Commit**

```bash
git add entitlement/src entitlement/tests
git commit -m "feat(entitlement): DELETE /users/:id/roles revoke role by scope"
```

---

### Task 6: เคสสมชาย e2e ผ่าน resolver + full suite + อัปเดต docs

**Files:**
- Modify: `entitlement/tests/user-roles.test.ts`
- Modify: `docs/KNOWN-LIMITATIONS-v1.md`

**Interfaces:**
- Consumes: ทุก endpoint จาก Task 2-5 + `resolveClaims`

- [ ] **Step 1: เพิ่ม e2e test (ต้องเขียวเลยถ้า Task ก่อนหน้าถูก — เป็น integration check)**

```ts
test('เคสสมชาย: admin ที่ A + HR ที่ B → resolver ออก grants แยกต่อ company', async () => {
  const { tenant, user } = await makeUserInTenant()
  const [a] = await db.insert(companies).values({ tenantId: tenant.id, name: 'A' }).returning()
  const [b] = await db.insert(companies).values({ tenantId: tenant.id, name: 'B' }).returning()
  const adminSlug = `somchai-admin-${Date.now()}`, hrSlug = `somchai-hr-${Date.now()}`
  await db.insert(roles).values([{ tenantId: tenant.id, name: 'Admin', slug: adminSlug }, { tenantId: tenant.id, name: 'HR', slug: hrSlug }])

  for (const [companyId, roleSlug] of [[a.id, adminSlug], [b.id, hrSlug]] as const) {
    expect((await req('POST', `/users/${user.id}/companies`, { authorization: superadmin }, { companyId })).status).toBe(200)
    expect((await req('POST', `/users/${user.id}/roles`, { authorization: superadmin }, { roleSlug, companyId })).status).toBe(200)
  }

  const claims = await resolveClaims(user.zitadelUserId) as { grants: Record<string, { roles: string[] }> }
  expect(claims.grants[String(a.id)].roles).toEqual([adminSlug])
  expect(claims.grants[String(b.id)].roles).toEqual([hrSlug])
})
```

- [ ] **Step 2: เพิ่ม guard sweep — caller ต่าง tenant ต้อง 403 ทุก endpoint ใหม่**

```ts
test('guard sweep: caller ถือ tenant.user.manage ของ tenant อื่น → 403 ทุก endpoint ใหม่', async () => {
  const { tenant, user } = await makeUserInTenant()
  const alien = managerOf(tenant.id + 9999)
  const calls: [string, string, unknown?][] = [
    ['PATCH', `/users/${user.id}/status`, { status: 'disabled' }],
    ['POST', `/users/${user.id}/companies`, { companyId: 1 }],
    ['DELETE', `/users/${user.id}/companies/1`, undefined],
    ['POST', `/users/${user.id}/roles`, { roleSlug: 'x' }],
    ['DELETE', `/users/${user.id}/roles`, { roleSlug: 'x' }],
  ]
  for (const [method, path, body] of calls) expect((await req(method, path, { authorization: alien }, body)).status).toBe(403)
})
```

- [ ] **Step 3: รัน full suite**

Run: `cd /Users/kritapaswongpemdacha/Workspaces/kritapas/authservice/entitlement && bun test`
Expected: PASS ทั้งหมด (62 เดิม + 12 ใหม่ = 74 pass, 0 fail)

- [ ] **Step 4: อัปเดต `docs/KNOWN-LIMITATIONS-v1.md`** — แทนที่ section "## Write API ยังไม่ครบ spec §6 (per-company role management)" ทั้ง section (บรรทัด 6-16) ด้วย

```markdown
## Write API per-company role management — ✅ ปิดแล้ว (2026-07-16)

V2 task #1 เสร็จแล้ว (ดู spec `docs/superpowers/specs/2026-07-16-per-company-role-management-design.md`):
- `POST /users/:id/roles { roleSlug, companyId? }` — assign role ต่อ company (companyId ต้องเป็น
  company ที่ user เป็นสมาชิกใน `user_companies` แล้ว) หรือ tenant-wide (ไม่ส่ง companyId)
- `DELETE /users/:id/roles { roleSlug, companyId? }` — ถอน role ตาม scope
- `POST /users/:id/companies` / `DELETE /users/:id/companies/:companyId` — จัดการ membership
  บริษัทในเครือ (ถอนแล้ว cascade ลบ role ที่ scope company นั้น)
- `PATCH /users/:id/status { active|disabled }` — ปิด/เปิดผู้ใช้
- ทุกตัว re-validate: role ∈ system∪tenant, company ∈ tenant, grantAll escalation guard เดียวกับ invite
- ที่เหลือของเดิม: `POST /users/invite` ยังแนบ role แบบ tenant-wide เท่านั้น (ตั้งใจ — invite แล้ว
  assign per-company ต่อด้วย endpoint ใหม่)
```

และลบ bullet "guard `canManageTenant` ถูก copy 3 ที่..." ใน section eSign integration (ปิดแล้วใน task นี้ — รวมเป็น helper เดียวใน `http/auth.ts` แล้ว)

- [ ] **Step 5: Commit**

```bash
git add entitlement/tests docs/KNOWN-LIMITATIONS-v1.md
git commit -m "test(entitlement): Somchai per-company grants e2e + docs: close V2 task #1"
```
