# Per-user Permissions + Packages + Billing-lite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** แทน role-based model ด้วย per-user permissions ต่อบริษัท + admin flags 2 ตัว + packages (โควตา+function gating) + presets copy-on-save + billing-lite ตาม spec `docs/superpowers/specs/2026-07-19-per-user-permissions-packages-design.md`

**Architecture:** เพิ่มตาราง/คอลัมน์ใหม่ก่อน (build เขียวตลอด) → rewrite resolver → เพิ่ม module ใหม่ทีละก้อน (แยกไฟล์ ไม่ชนกัน รัน subagent ขนานได้) → ท้ายสุดค่อยลบระบบ role เดิมทิ้งทีเดียว Pre-test ไม่มี data จริง — drop/migrate ได้เลย

**Tech Stack:** Bun + Elysia + Drizzle (Postgres) + bun:test — สไตล์เดิมของ repo ทุกอย่าง

## Global Constraints

- โค้ดเรียบง่ายที่สุด one-liner ได้ทำ ห้าม over-engineer (ผู้ใช้สั่งชัด)
- Comment ภาษาไทยตามสไตล์ repo — เขียนเฉพาะจุดที่มีเหตุผลเชิง invariant
- Error pattern เดิม: service `throw { notFound }` / `{ invalidCompany: id }` / `{ missing }` → route map เป็น status
- Test ใช้ `bearer()` จาก `tests/helpers/auth-mock.ts` + `mock.module('../src/zitadel/client', ...)` ตามแบบ `tests/user-roles.test.ts` (import route หลัง mock เสมอ)
- ทุก commit ลงท้าย `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- ห้ามเพิ่ม dependency ใหม่
- รัน test: `cd entitlement && bun test tests/<file>.test.ts` (ต้องมี Postgres จาก docker-compose รันอยู่ + migrate แล้ว)
- **Wave ขนาน** (ส่ง subagent พร้อมกันได้ ไฟล์ไม่ชนกัน): Wave1 = Task 1→2 (ตามลำดับ) · Wave2 = Task 3, 4, 5, 8, 9 ขนาน (ชนกันแค่บรรทัด mount ใน `src/http/app.ts` — ถ้าใช้ worktree ให้ merge บรรทัด mount เอง) · Wave3 = Task 6, 7 ขนาน · Wave4 = Task 10

## File Structure

```
entitlement/src/
  db/schema.ts                    Task 1 เพิ่ม / Task 10 ลบของเก่า
  claims/resolver.ts              Task 2 rewrite
  http/auth.ts                    Task 3 เพิ่ม isGroupAdmin helper
  modules/package/allowed.ts      Task 3 สร้าง (allowedKeys — ใช้ร่วม write path)
  modules/user/{route,service}.ts Task 3 (permissions/admin/list) + Task 6 (invite) + Task 10 (ลบ role endpoints)
  modules/preset/{route,service}.ts   Task 4 สร้าง
  modules/package/{route,service}.ts  Task 5 สร้าง
  modules/company/{route,service}.ts  Task 5 (quota + user counts)
  modules/admin/{route,service}.ts    Task 8 (overview/tenantDetail/logins filter)
  modules/invoice/{route,service}.ts  Task 9 สร้าง
  modules/signup/{route,service}.ts   Task 7 สร้าง
  modules/role/*                  Task 10 ลบทั้ง dir (seed permissions ย้ายไป db/seed.ts ใน Task 1)
packages/contracts/src/index.ts   Task 1 (เพิ่ม type) + Task 6 (InviteUserInput) 
tests/  permissions.test.ts(T3) preset.test.ts(T4) package.test.ts(T5) invite-v2.test.ts(T6)
        signup.test.ts(T7) admin-v2.test.ts(T8) invoice.test.ts(T9) claims.test.ts(T2 rewrite)
```

---

### Task 1: Schema additions + contracts + seed (foundation — add-only, ของเก่าคงอยู่)

**Files:**
- Modify: `entitlement/src/db/schema.ts` (เพิ่มอย่างเดียว ไม่ลบ)
- Create: `entitlement/src/db/seed.ts` (permissions + module seed — จะได้เลิกพึ่ง `modules/role/seed.ts` ตอน Task 10)
- Modify: `entitlement/src/db/seed-run.ts`, `packages/contracts/src/index.ts`
- Test: `entitlement/tests/schema.test.ts` (เพิ่มเคส)

**Interfaces (Produces):** ตาราง `packages, packagePermissions, presets, presetPermissions, userPermissions, invoices`; คอลัมน์ `users.isGroupAdmin`, `userCompanies.isAdmin`, `userCompanies.position`, `tenants.packageId`, `tenants.type`; type `PlatformClaims` (variant แรกเพิ่ม `package?: string`); fn `seedBase()`

- [ ] **Step 1: เพิ่มตารางใหม่ใน schema.ts** (ต่อท้ายไฟล์ + แก้ 3 ตารางเดิม)

```ts
// --- V2: per-user permissions + packages (spec 2026-07-19) ---
import { timestamp } from 'drizzle-orm/pg-core'  // รวมเข้า import บนสุดบรรทัดเดียวกับ boolean ฯลฯ

export const packages = pgTable('packages', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  seatLimit: integer('seat_limit').notNull(),
  companyLimit: integer('company_limit').notNull(),
  adminLimit: integer('admin_limit').notNull(),
  docLimitMonthly: integer('doc_limit_monthly'),            // null = ไม่จำกัด (ฝั่ง eSign เป็นคนนับ)
  allowGroupAdmin: boolean('allow_group_admin').notNull().default(true),
  selfSignup: boolean('self_signup').notNull().default(false),
  price: integer('price').notNull().default(0),             // บาท/เดือน
})

export const packagePermissions = pgTable('package_permissions', {
  packageId: integer('package_id').notNull().references(() => packages.id),
  permissionId: integer('permission_id').notNull().references(() => permissions.id),
}, (t) => ({ pk: primaryKey({ columns: [t.packageId, t.permissionId] }) }))

export const presets = pgTable('presets', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id), // null = system preset
  name: text('name').notNull(),
  slug: text('slug').notNull(),
}, (t) => ({ slugUq: unique('presets_tenant_slug_uq').on(t.tenantId, t.slug).nullsNotDistinct() }))

export const presetPermissions = pgTable('preset_permissions', {
  presetId: integer('preset_id').notNull().references(() => presets.id),
  permissionId: integer('permission_id').notNull().references(() => permissions.id),
}, (t) => ({ pk: primaryKey({ columns: [t.presetId, t.permissionId] }) }))

// หัวใจแบบ A — สิทธิ์รายคนต่อบริษัท (source of truth เดียว)
export const userPermissions = pgTable('user_permissions', {
  userId: integer('user_id').notNull().references(() => users.id),
  companyId: integer('company_id').notNull().references(() => companies.id),
  permissionId: integer('permission_id').notNull().references(() => permissions.id),
}, (t) => ({ pk: primaryKey({ columns: [t.userId, t.companyId, t.permissionId] }) }))

export const invoices = pgTable('invoices', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').notNull().references(() => tenants.id),
  number: text('number').notNull().unique(),
  description: text('description').notNull(),
  amount: integer('amount').notNull(),                      // บาทเต็ม
  status: text('status').notNull().default('issued'),       // 'issued' | 'paid'
  issuedAt: timestamp('issued_at').notNull().defaultNow(),
  paidAt: timestamp('paid_at'),
})
```

และแก้ตารางเดิม 3 จุด:

```ts
// ใน users เพิ่ม:
  isGroupAdmin: boolean('is_group_admin').notNull().default(false),
// ใน userCompanies เพิ่ม:
  isAdmin: boolean('is_admin').notNull().default(false),
  position: text('position'),   // ป้ายตำแหน่งแสดงผล ไม่มีผลต่อสิทธิ์
// ใน tenants เพิ่ม:
  packageId: integer('package_id').references(() => packages.id),
  type: text('type').notNull().default('org'),   // 'org' | 'personal'
```

- [ ] **Step 2: contracts — เพิ่ม type**

`packages/contracts/src/index.ts` แก้ variant แรกของ `PlatformClaims` และเพิ่ม input types:

```ts
export type PlatformClaims =
  | { tenantId: number; companies: number[]; modules: string[]; grants: Record<string, Grant>; package?: string }
  | { role: 'superadmin' }
  | Record<string, never>

export type SetPermissionsInput = { companyId: number; position?: string; permissionKeys: string[] }
export type CreatePackageInput = { name: string; slug: string; seatLimit: number; companyLimit: number; adminLimit: number; docLimitMonthly?: number; allowGroupAdmin?: boolean; selfSignup?: boolean; price?: number; permissionKeys: string[] }
export type CreatePresetInput = { tenantId: number; name: string; slug: string; permissionKeys: string[] }
```

- [ ] **Step 3: seed กลาง** — Create `entitlement/src/db/seed.ts` (ยก MODULES/PERMISSIONS มาจาก `modules/role/seed.ts` + เพิ่ม permission ใหม่ตาม mockup; ไม่ seed roles ที่นี่):

```ts
import { eq } from 'drizzle-orm'
import { db } from './client'
import { modules, permissions } from './schema'

const MODULES = [
  { key: 'core', name: 'Core' },
  { key: 'hr', name: 'HR' },
  { key: 'esign', name: 'eSign' },
]

const PERMISSIONS = [
  { key: 'tenant.company.manage', moduleKey: 'core' },
  { key: 'tenant.user.manage', moduleKey: 'core' },
  { key: 'employee.read', moduleKey: 'hr' },
  { key: 'employee.write', moduleKey: 'hr' },
  { key: 'esign.document.read', moduleKey: 'esign' },
  { key: 'esign.document.create', moduleKey: 'esign' },
  { key: 'esign.document.sign', moduleKey: 'esign' },
  { key: 'esign.document.send', moduleKey: 'esign' },
  { key: 'esign.template.manage', moduleKey: 'esign' },
  { key: 'esign.audit.report', moduleKey: 'esign' },
]

// idempotent — เรียกซ้ำได้ ไม่แตะ row เดิม
export async function seedBase() {
  const moduleByKey = new Map<string, number>()
  for (const m of MODULES) {
    const [existing] = await db.select().from(modules).where(eq(modules.key, m.key))
    const row = existing
      ?? (await db.insert(modules).values(m).onConflictDoNothing().returning())[0]
      ?? (await db.select().from(modules).where(eq(modules.key, m.key)))[0]!
    moduleByKey.set(m.key, row.id)
  }
  for (const p of PERMISSIONS) {
    const [existing] = await db.select().from(permissions).where(eq(permissions.key, p.key))
    if (!existing) await db.insert(permissions).values({ key: p.key, moduleId: moduleByKey.get(p.moduleKey)! }).onConflictDoNothing()
  }
}
```

แก้ `src/db/seed-run.ts` ให้เรียกทั้งคู่ไปก่อน (Task 10 ค่อยตัด role):

```ts
import { seedBase } from './seed'
import { seedSystemRoles } from '../modules/role/seed'
await seedBase()
await seedSystemRoles()
console.log('seeded')
```

- [ ] **Step 4: generate + migrate**

Run: `cd entitlement && bun run db:generate && bun run db:migrate && bun run db:seed`
Expected: migration ไฟล์ใหม่ใน `drizzle/` มี CREATE TABLE 6 ตาราง + ALTER 3 ตาราง, migrate ผ่าน

- [ ] **Step 5: เพิ่ม test ใน schema.test.ts** (ตามแพทเทิร์นเคสเดิมในไฟล์ — insert/read ตารางใหม่):

```ts
test('V2 tables: insert package + user_permissions + invoice ได้', async () => {
  const slug = 'pkg-' + Date.now()
  const [pkg] = await db.insert(packages).values({ name: 'Pro', slug, seatLimit: 50, companyLimit: 3, adminLimit: 3 }).returning()
  expect(pkg.allowGroupAdmin).toBe(true)
  const [inv] = await db.insert(invoices).values({ tenantId: (await mkTenant()).id, number: 'INV-' + slug, description: 'Pro ก.ค.', amount: 2990 }).returning()
  expect(inv.status).toBe('issued')
})
```
(`mkTenant` = helper insert tenants ตามแบบที่ไฟล์นั้นใช้อยู่ — ดูเคสเดิมในไฟล์แล้วใช้แบบเดียวกัน)

- [ ] **Step 6: รัน test ทั้งชุดเดิมต้องเขียวหมด (add-only ห้ามพังของเก่า)**

Run: `cd entitlement && bun test`
Expected: PASS ทุกไฟล์

- [ ] **Step 7: Commit** — `feat: V2 schema — packages/presets/user_permissions/invoices + admin flags (add-only)`

---

### Task 2: Resolver rewrite + claims tests

**Files:**
- Modify: `entitlement/src/claims/resolver.ts` (rewrite ทั้งไฟล์), `entitlement/tests/claims.test.ts`, `entitlement/tests/zitadel-claims.test.ts` (เฉพาะ expectation ที่ยึด shape เดิม)

**Interfaces:**
- Consumes: ตาราง Task 1
- Produces: `resolveClaims(zid)` shape เดิม + `package?: slug` — **ไม่มี `'*'` ต่ำกว่า superadmin**; admin ได้ allowed keys + `tenant.user.manage`,`tenant.company.manage`

- [ ] **Step 1: เขียน test ใหม่ต่อท้าย claims.test.ts** (ของเดิมที่ยึด user_roles จะแดง — rewrite เคสเก่าให้ใช้ userPermissions/flags แทนในไฟล์เดียวกัน):

```ts
test('V2: group admin ได้ทุกบริษัทใน tenant รวมที่ไม่เป็นสมาชิก, ไม่มี * ,มี management keys', async () => {
  const { tenant, user, moduleId } = await mkTenantUser()          // helper เดิมของไฟล์ (สร้าง tenant+module enabled+user)
  const [a] = await db.insert(companies).values({ tenantId: tenant.id, name: 'A' }).returning()
  const [b] = await db.insert(companies).values({ tenantId: tenant.id, name: 'B' }).returning()
  await db.update(users).set({ isGroupAdmin: true }).where(eq(users.id, user.id))
  const c = await resolveClaims(user.zitadelUserId) as any
  expect(Object.keys(c.grants).sort()).toEqual([String(a.id), String(b.id)].sort())
  expect(c.grants[String(a.id)].roles).toEqual(['groupcompanyadmin'])
  expect(c.grants[String(a.id)].permissions).not.toContain('*')
  expect(c.grants[String(a.id)].permissions).toContain('tenant.user.manage')
})

test('V2: user ธรรมดาได้ตามติ๊ก ∩ แพ็ค — เปลี่ยนแพ็คแล้ว key หายทันที', async () => {
  const { tenant, user } = await mkTenantUser()
  const [co] = await db.insert(companies).values({ tenantId: tenant.id, name: 'C' }).returning()
  await db.insert(userCompanies).values({ userId: user.id, companyId: co.id })
  const sign = (await db.select().from(permissions).where(eq(permissions.key, 'esign.document.sign')))[0]
  const send = (await db.select().from(permissions).where(eq(permissions.key, 'esign.document.send')))[0]
  await db.insert(userPermissions).values([{ userId: user.id, companyId: co.id, permissionId: sign.id }, { userId: user.id, companyId: co.id, permissionId: send.id }])
  // ไม่มีแพ็ค → ได้ทั้งคู่ (จำกัดด้วยโมดูลอย่างเดียว)
  expect((await resolveClaims(user.zitadelUserId) as any).grants[String(co.id)].permissions.sort()).toEqual(['esign.document.send', 'esign.document.sign'])
  // แพ็คที่มีแค่ sign → send หาย
  const [pkg] = await db.insert(packages).values({ name: 'B', slug: 'b-' + Date.now(), seatLimit: 20, companyLimit: 1, adminLimit: 1 }).returning()
  await db.insert(packagePermissions).values({ packageId: pkg.id, permissionId: sign.id })
  await db.update(tenants).set({ packageId: pkg.id }).where(eq(tenants.id, tenant.id))
  const c = await resolveClaims(user.zitadelUserId) as any
  expect(c.grants[String(co.id)].permissions).toEqual(['esign.document.sign'])
  expect(c.package).toBe(pkg.slug)
})

test('V2: company admin ได้ allowed ทั้งชุดเฉพาะบริษัทตัวเอง', async () => {
  const { tenant, user } = await mkTenantUser()
  const [co] = await db.insert(companies).values({ tenantId: tenant.id, name: 'C' }).returning()
  const [other] = await db.insert(companies).values({ tenantId: tenant.id, name: 'D' }).returning()
  await db.insert(userCompanies).values({ userId: user.id, companyId: co.id, isAdmin: true })
  const c = await resolveClaims(user.zitadelUserId) as any
  expect(c.grants[String(co.id)].roles).toEqual(['admin'])
  expect(c.grants[String(co.id)].permissions).toContain('esign.document.sign')
  expect(c.grants[String(other.id)]).toBeUndefined()
})
```

- [ ] **Step 2: รันให้เห็นแดง** — `bun test tests/claims.test.ts` → FAIL (resolver ยังอ่าน user_roles)

- [ ] **Step 3: rewrite resolver.ts ทั้งไฟล์**

```ts
import { db } from '../db/client'
import { users, userCompanies, userPermissions, permissions, platformAdmins, modules, tenantModules, tenants, companies, packages, packagePermissions } from '../db/schema'
import { eq, inArray, and } from 'drizzle-orm'
import type { PlatformClaims, Grant } from '@platform/contracts'

// management keys ให้ admin เสมอ (platform plane) — ไม่ผ่าน filter แพ็ค/โมดูล
const MANAGEMENT_KEYS = ['tenant.user.manage', 'tenant.company.manage']

export async function resolveClaims(zid: string): Promise<PlatformClaims> {
  const [admin] = await db.select().from(platformAdmins).where(eq(platformAdmins.zitadelUserId, zid))
  if (admin) return { role: 'superadmin' }
  const [u] = await db.select().from(users).where(eq(users.zitadelUserId, zid))
  if (!u || u.status !== 'active') return {}

  const [t] = await db.select().from(tenants).leftJoin(packages, eq(tenants.packageId, packages.id)).where(eq(tenants.id, u.tenantId))
  const pkg = t?.packages ?? null

  const [enabled, memberships, userPermRows, pkgPermRows] = await Promise.all([
    db.select({ id: modules.id, key: modules.key }).from(tenantModules)
      .innerJoin(modules, eq(tenantModules.moduleId, modules.id))
      .where(and(eq(tenantModules.tenantId, u.tenantId), eq(tenantModules.enabled, true))),
    db.select().from(userCompanies).where(eq(userCompanies.userId, u.id)),
    db.select({ companyId: userPermissions.companyId, key: permissions.key, moduleId: permissions.moduleId })
      .from(userPermissions).innerJoin(permissions, eq(userPermissions.permissionId, permissions.id))
      .where(eq(userPermissions.userId, u.id)),
    pkg ? db.select({ key: permissions.key, moduleId: permissions.moduleId })
      .from(packagePermissions).innerJoin(permissions, eq(packagePermissions.permissionId, permissions.id))
      .where(eq(packagePermissions.packageId, pkg.id)) : Promise.resolve(null),
  ])
  const enabledIds = [...new Set(enabled.map(m => m.id))]
  // allowed = แพ็ค ∩ โมดูลที่เปิด — tenant ไม่มีแพ็ค = จำกัดด้วยโมดูลอย่างเดียว
  const allowed = pkgPermRows && new Set(pkgPermRows.filter(p => enabledIds.includes(p.moduleId)).map(p => p.key))
  const ok = (p: { key: string; moduleId: number }) => enabledIds.includes(p.moduleId) && (!allowed || allowed.has(p.key))

  // admin = "ทุกอย่างเท่าที่แพ็ค+โมดูลให้" + management keys — ไม่มี '*' ต่ำกว่า superadmin (spec §Resolver ข้อ 5)
  const isAdminSomewhere = u.isGroupAdmin || memberships.some(m => m.isAdmin)
  const modulePerms = isAdminSomewhere && enabledIds.length
    ? await db.select({ key: permissions.key, moduleId: permissions.moduleId }).from(permissions).where(inArray(permissions.moduleId, enabledIds))
    : []
  const adminPerms = isAdminSomewhere ? [...new Set([...modulePerms.filter(ok).map(p => p.key), ...MANAGEMENT_KEYS])] : []

  // group admin เห็นทุกบริษัท active ใน tenant ไม่อิง membership
  const companyIds = u.isGroupAdmin
    ? (await db.select({ id: companies.id }).from(companies).where(and(eq(companies.tenantId, u.tenantId), eq(companies.status, 'active')))).map(c => c.id)
    : memberships.map(m => m.companyId)

  const grants: Record<string, Grant> = {}
  for (const c of companyIds) {
    if (u.isGroupAdmin) grants[String(c)] = { roles: ['groupcompanyadmin'], permissions: adminPerms }
    else if (memberships.find(m => m.companyId === c)!.isAdmin) grants[String(c)] = { roles: ['admin'], permissions: adminPerms }
    else grants[String(c)] = { roles: [], permissions: [...new Set(userPermRows.filter(p => p.companyId === c && ok(p)).map(p => p.key))] }
  }
  const grantsSize = JSON.stringify(grants).length
  if (grantsSize > 4096) console.warn(`resolveClaims: oversized grants for user ${u.id} (${grantsSize} bytes) — token-per-active-company may be needed (spec §5)`)
  return { tenantId: u.tenantId, companies: companyIds, modules: enabled.map(m => m.key), grants, ...(pkg ? { package: pkg.slug } : {}) }
}
```

- [ ] **Step 4: แก้เคสเก่าใน claims.test.ts / zitadel-claims.test.ts** ที่ยัง setup ด้วย `roles`/`userRoles` → เปลี่ยนเป็น `userPermissions` หรือ admin flag ให้ intent เดิมคงอยู่ (เช่นเคส disabled → `{}` ไม่ต้องแก้; เคส grantAll `'*'` → เปลี่ยนเป็น `isGroupAdmin` + expect ไม่มี `'*'` แต่มี key ครบ)

- [ ] **Step 5: รันเขียว** — `bun test tests/claims.test.ts tests/zitadel-claims.test.ts` → PASS
  (test ไฟล์อื่นที่พังเพราะ resolver ใหม่ — จด ไว้แก้ใน task ของไฟล์นั้น ห้ามแก้ resolver กลับ)

- [ ] **Step 6: Commit** — `feat: resolver V2 — admin flags + user_permissions + package gating, ไม่มี * ต่ำกว่า superadmin`

---

### Task 3: Per-user permissions API + admin flags + tenant users list

**Files:**
- Create: `entitlement/src/modules/package/allowed.ts`
- Modify: `entitlement/src/http/auth.ts`, `entitlement/src/modules/user/service.ts`, `entitlement/src/modules/user/route.ts`
- Test: `entitlement/tests/permissions.test.ts` (ใหม่)

**Interfaces:**
- Produces: `GET /users/:id/permissions?companyId=` → `{ companyId, position, permissionKeys[] }` · `PUT /users/:id/permissions` body `SetPermissionsInput` (replace ทั้งชุด) · `PATCH /users/:id/admin` body `{ groupAdmin: boolean }` หรือ `{ companyId: number, admin: boolean }` · `GET /users/tenant/:tenantId` → รายชื่อ user + memberships · fn `allowedKeys(tenantId): Promise<Set<string> | null>` · helper `isGroupAdmin(claims, tenantId)`

- [ ] **Step 1: เขียน tests/permissions.test.ts** (โครง req/bearer/mock zitadel ลอกจาก user-roles.test.ts):

```ts
test('PUT /users/:id/permissions เขียนแล้ว resolver เห็น; PUT ซ้ำ = replace ไม่ accumulate', async () => {
  const { tenant, user } = await makeUserInTenant()               // + enable esign module ให้ tenant (ดู claims.test helper)
  const [co] = await db.insert(companies).values({ tenantId: tenant.id, name: 'C' }).returning()
  await db.insert(userCompanies).values({ userId: user.id, companyId: co.id })
  const put = (keys: string[]) => req('PUT', `/users/${user.id}/permissions`, { authorization: superadmin }, { companyId: co.id, position: 'staff', permissionKeys: keys })
  expect((await put(['esign.document.read', 'esign.document.sign'])).status).toBe(200)
  expect((await resolveClaims(user.zitadelUserId) as any).grants[String(co.id)].permissions.sort()).toEqual(['esign.document.read', 'esign.document.sign'])
  expect((await put(['esign.document.read'])).status).toBe(200)   // replace
  expect((await resolveClaims(user.zitadelUserId) as any).grants[String(co.id)].permissions).toEqual(['esign.document.read'])
})

test('PUT permissions: ไม่เป็นสมาชิก company → 400, key มั่ว → 404 missing, key เกินแพ็ค → 400 overPackage', async () => { /* สามเคสตาม error map ข้างล่าง — เคสเกินแพ็ค: สร้าง package มีแค่ sign, ผูก tenant, PUT send → 400 { overPackage: ['esign.document.send'] } */ })

test('PATCH /users/:id/admin ตั้ง/ถอน company admin + group admin — caller ต้องเป็น groupcompanyadmin/superadmin', async () => {
  const { tenant, user } = await makeUserInTenant()
  const [co] = await db.insert(companies).values({ tenantId: tenant.id, name: 'C' }).returning()
  await db.insert(userCompanies).values({ userId: user.id, companyId: co.id })
  expect((await req('PATCH', `/users/${user.id}/admin`, { authorization: superadmin }, { companyId: co.id, admin: true })).status).toBe(200)
  expect((await db.select().from(userCompanies).where(eq(userCompanies.userId, user.id)))[0].isAdmin).toBe(true)
  expect((await req('PATCH', `/users/${user.id}/admin`, { authorization: superadmin }, { groupAdmin: true })).status).toBe(200)
  // caller เป็นแค่ manager (ไม่ใช่ group admin) → 403
  expect((await req('PATCH', `/users/${user.id}/admin`, { authorization: managerOf(tenant.id) }, { groupAdmin: false })).status).toBe(403)
})

test('GET /users/tenant/:tenantId คืน user + position + isAdmin; caller ต่าง tenant → 403', async () => { /* insert 2 users, expect array มี email/status/memberships: [{companyId, position, isAdmin}], isGroupAdmin */ })
```
(`managerOf` มี grants ที่ roles: [] — จึงไม่ใช่ group admin; caller group admin จำลองด้วย `bearer({ ..., 'urn:platform:grants': { '1': { roles: ['groupcompanyadmin'], permissions: ['tenant.user.manage'] } } })`)

- [ ] **Step 2: รันแดง** — `bun test tests/permissions.test.ts` → FAIL (route ไม่มี)

- [ ] **Step 3: implement**

`src/modules/package/allowed.ts`:

```ts
import { db } from '../../db/client'
import { tenants, tenantModules, modules, permissions, packagePermissions } from '../../db/schema'
import { eq, and, inArray } from 'drizzle-orm'

// allowed keys ของ tenant = แพ็ค ∩ โมดูลที่เปิด — null = ไม่มีแพ็ค (ไม่จำกัด, dev/legacy)
export async function allowedKeys(tenantId: number): Promise<Set<string> | null> {
  const [t] = await db.select().from(tenants).where(eq(tenants.id, tenantId))
  if (!t?.packageId) return null
  const enabled = await db.select({ id: modules.id }).from(tenantModules).innerJoin(modules, eq(tenantModules.moduleId, modules.id))
    .where(and(eq(tenantModules.tenantId, tenantId), eq(tenantModules.enabled, true)))
  const rows = enabled.length ? await db.select({ key: permissions.key }).from(packagePermissions)
    .innerJoin(permissions, eq(packagePermissions.permissionId, permissions.id))
    .where(and(eq(packagePermissions.packageId, t.packageId), inArray(permissions.moduleId, enabled.map(m => m.id)))) : []
  return new Set(rows.map(r => r.key))
}
```

`src/http/auth.ts` เพิ่ม:

```ts
import { isSuperadmin as _isSA } from '@platform/auth'
// groupcompanyadmin ของ tenant นั้น (หรือ superadmin) — guard สำหรับตั้ง admin flag
export const isGroupAdmin = (c: Record<string, any>, tenantId: number) =>
  _isSA(c) || (c['urn:platform:tenantId'] === tenantId &&
    Object.values(c['urn:platform:grants'] ?? {}).some((g: any) => g.roles?.includes('groupcompanyadmin')))
```

`src/modules/user/service.ts` เพิ่ม:

```ts
import { allowedKeys } from '../package/allowed'
import { userPermissions, permissions } from '../../db/schema'   // รวมเข้า import เดิม

export async function getPermissions(userId: number, companyId: number) {
  const [m] = await db.select().from(userCompanies).where(and(eq(userCompanies.userId, userId), eq(userCompanies.companyId, companyId)))
  if (!m) throw { invalidCompany: companyId }
  const rows = await db.select({ key: permissions.key }).from(userPermissions)
    .innerJoin(permissions, eq(userPermissions.permissionId, permissions.id))
    .where(and(eq(userPermissions.userId, userId), eq(userPermissions.companyId, companyId)))
  return { companyId, position: m.position, permissionKeys: rows.map(r => r.key) }
}

// replace ทั้งชุด (copy-on-save จาก preset เกิดฝั่ง UI — server เห็นแค่ list สุดท้าย)
export async function setPermissions(user: { id: number; tenantId: number }, i: { companyId: number; position?: string; permissionKeys: string[] }) {
  const [m] = await db.select().from(userCompanies).where(and(eq(userCompanies.userId, user.id), eq(userCompanies.companyId, i.companyId)))
  if (!m) throw { invalidCompany: i.companyId }
  const rows = i.permissionKeys.length ? await db.select().from(permissions).where(inArray(permissions.key, i.permissionKeys)) : []
  const missing = i.permissionKeys.filter(k => !rows.some(r => r.key === k))
  if (missing.length) throw { missing }
  const allowed = await allowedKeys(user.tenantId)
  const over = allowed ? i.permissionKeys.filter(k => !allowed.has(k)) : []
  if (over.length) throw { overPackage: over }
  await db.delete(userPermissions).where(and(eq(userPermissions.userId, user.id), eq(userPermissions.companyId, i.companyId)))
  if (rows.length) await db.insert(userPermissions).values(rows.map(r => ({ userId: user.id, companyId: i.companyId, permissionId: r.id })))
  await db.update(userCompanies).set({ position: i.position ?? null }).where(and(eq(userCompanies.userId, user.id), eq(userCompanies.companyId, i.companyId)))
  return { ok: true }
}

export async function setAdmin(user: { id: number; tenantId: number }, i: { groupAdmin?: boolean; companyId?: number; admin?: boolean }) {
  if (i.groupAdmin !== undefined) { await db.update(users).set({ isGroupAdmin: i.groupAdmin }).where(eq(users.id, user.id)); return { ok: true } }
  const [m] = await db.select().from(userCompanies).where(and(eq(userCompanies.userId, user.id), eq(userCompanies.companyId, i.companyId!)))
  if (!m) throw { invalidCompany: i.companyId }
  await db.update(userCompanies).set({ isAdmin: i.admin! }).where(and(eq(userCompanies.userId, user.id), eq(userCompanies.companyId, i.companyId!)))
  return { ok: true }
}

export async function listTenantUsers(tenantId: number) {
  const us = await db.select().from(users).where(eq(users.tenantId, tenantId))
  const ms = us.length ? await db.select().from(userCompanies).where(inArray(userCompanies.userId, us.map(u => u.id))) : []
  return us.map(u => ({ id: u.id, email: u.email, status: u.status, isGroupAdmin: u.isGroupAdmin,
    memberships: ms.filter(m => m.userId === u.id).map(m => ({ companyId: m.companyId, position: m.position, isAdmin: m.isAdmin })) }))
}
```

`src/modules/user/route.ts` เพิ่ม (แพทเทิร์น lookup→guard→try/catch เดิมของไฟล์):

```ts
  .get('/tenant/:tenantId', ({ auth, params, set }) => {
    const tenantId = Number(params.tenantId)
    if (!canManageTenant(auth.claims, tenantId, 'tenant.user.manage')) { set.status = 403; return 'forbidden' }
    return listTenantUsers(tenantId)
  })
  .get('/:id/permissions', async ({ auth, params, query, set }) => {
    const user = await getUser(Number(params.id))
    if (!user) { set.status = 404; return 'user not found' }
    if (!canManageTenant(auth.claims, user.tenantId, 'tenant.user.manage')) { set.status = 403; return 'forbidden' }
    try { return await getPermissions(user.id, Number(query.companyId)) }
    catch (e: any) { if (e?.invalidCompany !== undefined) { set.status = 400; return { invalidCompany: e.invalidCompany } } throw e }
  })
  .put('/:id/permissions', async ({ auth, params, body, set }) => {
    const user = await getUser(Number(params.id))
    if (!user) { set.status = 404; return 'user not found' }
    if (!canManageTenant(auth.claims, user.tenantId, 'tenant.user.manage')) { set.status = 403; return 'forbidden' }
    try { return await setPermissions(user, body) }
    catch (e: any) {
      if (e?.invalidCompany !== undefined) { set.status = 400; return { invalidCompany: e.invalidCompany } }
      if (e?.missing) { set.status = 404; return { missing: e.missing } }
      if (e?.overPackage) { set.status = 400; return { overPackage: e.overPackage } }
      throw e
    }
  }, { body: t.Object({ companyId: t.Number(), position: t.Optional(t.String()), permissionKeys: t.Array(t.String()) }) })
  .patch('/:id/admin', async ({ auth, params, body, set }) => {
    const user = await getUser(Number(params.id))
    if (!user) { set.status = 404; return 'user not found' }
    if (!isGroupAdmin(auth.claims, user.tenantId)) { set.status = 403; return 'forbidden' }   // เข้มกว่า user.manage — ตั้ง admin ได้เฉพาะ group admin ขึ้นไป
    try { return await setAdmin(user, body) }
    catch (e: any) { if (e?.invalidCompany !== undefined) { set.status = 400; return { invalidCompany: e.invalidCompany } } throw e }
  }, { body: t.Union([t.Object({ groupAdmin: t.Boolean() }), t.Object({ companyId: t.Number(), admin: t.Boolean() })]) })
```

- [ ] **Step 4: รันเขียว** — `bun test tests/permissions.test.ts` → PASS
- [ ] **Step 5: Commit** — `feat: per-user permissions API + admin flags + tenant users list`

---

### Task 4: Presets module (copy-on-save — server เก็บ template อย่างเดียว)

**Files:**
- Create: `entitlement/src/modules/preset/service.ts`, `entitlement/src/modules/preset/route.ts`
- Modify: `entitlement/src/http/app.ts` (mount `.use(presetRouter)`)
- Test: `entitlement/tests/preset.test.ts`

**Interfaces:**
- Produces: `GET /presets/:tenantId` → `[{ id, tenantId, name, slug, permissionKeys[] }]` (system ∪ tenant) · `POST /presets` body `CreatePresetInput` · `PUT /presets/:id` body `{ name?, permissionKeys? }` · `DELETE /presets/:id` — guard `canManageTenant(claims, tenantId, 'tenant.user.manage')`; system preset (tenantId null) แก้/ลบได้เฉพาะ superadmin

- [ ] **Step 1: เขียน tests/preset.test.ts** — เคส: create+list เห็น permissionKeys ครบ / key มั่ว → 404 missing / update replace keys / delete แล้วหาย / caller ต่าง tenant → 403 / slug ซ้ำใน tenant → 500→ ใช้ onConflict ไม่ได้เพราะต้องการ error → ปล่อย unique constraint แล้ว route จับ map 409:

```ts
test('POST /presets + GET list — permissionKeys ครบ, system preset โผล่ทุก tenant', async () => {
  const { tenant } = await makeTenant()
  const res = await req('POST', '/presets', { authorization: superadmin }, { tenantId: tenant.id, name: 'Staff', slug: 'staff', permissionKeys: ['esign.document.read', 'esign.document.sign'] })
  expect(res.status).toBe(200)
  const list = await (await req('GET', `/presets/${tenant.id}`, { authorization: superadmin })).json()
  expect(list.find((p: any) => p.slug === 'staff').permissionKeys.sort()).toEqual(['esign.document.read', 'esign.document.sign'])
})
```

- [ ] **Step 2: รันแดง** → FAIL
- [ ] **Step 3: implement service** (แพทเทิร์น role/service เดิม):

```ts
import { db } from '../../db/client'
import { presets, presetPermissions, permissions } from '../../db/schema'
import { eq, inArray, isNull, or, and } from 'drizzle-orm'
import type { CreatePresetInput } from '@platform/contracts'

const resolveKeys = async (keys: string[]) => {
  const rows = keys.length ? await db.select().from(permissions).where(inArray(permissions.key, keys)) : []
  const missing = keys.filter(k => !rows.some(r => r.key === k))
  if (missing.length) throw { missing }
  return rows
}

export async function listPresets(tenantId: number) {
  const ps = await db.select().from(presets).where(or(isNull(presets.tenantId), eq(presets.tenantId, tenantId)))
  const rows = ps.length ? await db.select({ presetId: presetPermissions.presetId, key: permissions.key })
    .from(presetPermissions).innerJoin(permissions, eq(presetPermissions.permissionId, permissions.id))
    .where(inArray(presetPermissions.presetId, ps.map(p => p.id))) : []
  return ps.map(p => ({ ...p, permissionKeys: rows.filter(r => r.presetId === p.id).map(r => r.key) }))
}

export async function createPreset(i: CreatePresetInput) {
  const rows = await resolveKeys(i.permissionKeys)
  const [p] = await db.insert(presets).values({ tenantId: i.tenantId, name: i.name, slug: i.slug }).returning()
  if (rows.length) await db.insert(presetPermissions).values(rows.map(r => ({ presetId: p.id, permissionId: r.id })))
  return { ...p, permissionKeys: rows.map(r => r.key) }
}

export const getPreset = async (id: number) => (await db.select().from(presets).where(eq(presets.id, id)))[0]

export async function updatePreset(id: number, i: { name?: string; permissionKeys?: string[] }) {
  if (i.name) await db.update(presets).set({ name: i.name }).where(eq(presets.id, id))
  if (i.permissionKeys) {
    const rows = await resolveKeys(i.permissionKeys)
    await db.delete(presetPermissions).where(eq(presetPermissions.presetId, id))
    if (rows.length) await db.insert(presetPermissions).values(rows.map(r => ({ presetId: id, permissionId: r.id })))
  }
  return { ok: true }
}

export async function deletePreset(id: number) {
  await db.delete(presetPermissions).where(eq(presetPermissions.presetId, id))
  await db.delete(presets).where(eq(presets.id, id))
  return { ok: true }
}
```

route (guard: POST/GET ด้วย tenantId จาก body/params; PUT/DELETE lookup ก่อน — system preset → `isSuperadmin` เท่านั้น) + mount ใน app.ts

- [ ] **Step 4: รันเขียว** → PASS · **Step 5: Commit** — `feat: presets module (ตำแหน่ง template สำหรับ copy-on-save)`

---

### Task 5: Packages module + tenant package + company quota/counts

**Files:**
- Create: `entitlement/src/modules/package/service.ts`, `entitlement/src/modules/package/route.ts`
- Modify: `entitlement/src/modules/company/service.ts`, `entitlement/src/modules/company/route.ts`, `entitlement/src/http/app.ts`
- Test: `entitlement/tests/package.test.ts`

**Interfaces:**
- Produces: `GET /admin/packages` → รวม `permissionKeys` + `tenantCount` · `POST /admin/packages` body `CreatePackageInput` · `PUT /admin/packages/:id` · `PATCH /admin/tenants/:id/package` body `{ packageSlug }` (ทั้งหมด superadmin) · fn `tenantPackage(tenantId)` · fn `checkQuota(tenantId, 'seat'|'company'|'admin')` → throw `{ quota, limit }` · `GET /companies/:tenantId` เพิ่ม field `users: number` ต่อบริษัท

- [ ] **Step 1: เขียน tests/package.test.ts** — เคส: CRUD package + permissionKeys / ผูก tenant ด้วย PATCH แล้ว claims มี package slug (เรียก resolveClaims ตรง) / `POST /companies` เกิน companyLimit → 403 `{ quota: 'company', limit }` / tenant ไม่มีแพ็ค → สร้าง company ได้ไม่จำกัด / GET companies มี users count

- [ ] **Step 2: รันแดง** → FAIL
- [ ] **Step 3: implement**

`package/service.ts`:

```ts
import { db } from '../../db/client'
import { packages, packagePermissions, permissions, tenants, users, companies, userCompanies } from '../../db/schema'
import { eq, inArray, and, count } from 'drizzle-orm'
import type { CreatePackageInput } from '@platform/contracts'

const resolveKeys = async (keys: string[]) => { /* เหมือน preset/service — copy ได้ ไฟล์ละ 4 บรรทัด ไม่ต้อง shared */ }

export async function listPackages() {
  const ps = await db.select().from(packages)
  const perms = ps.length ? await db.select({ packageId: packagePermissions.packageId, key: permissions.key })
    .from(packagePermissions).innerJoin(permissions, eq(packagePermissions.permissionId, permissions.id)) : []
  const counts = await db.select({ packageId: tenants.packageId, n: count() }).from(tenants).groupBy(tenants.packageId)
  return ps.map(p => ({ ...p, permissionKeys: perms.filter(r => r.packageId === p.id).map(r => r.key),
    tenantCount: counts.find(c => c.packageId === p.id)?.n ?? 0 }))
}

export async function createPackage(i: CreatePackageInput) {
  const rows = await resolveKeys(i.permissionKeys)
  const { permissionKeys, ...cols } = i
  const [p] = await db.insert(packages).values(cols).returning()
  if (rows.length) await db.insert(packagePermissions).values(rows.map(r => ({ packageId: p.id, permissionId: r.id })))
  return { ...p, permissionKeys: rows.map(r => r.key) }
}

export async function updatePackage(id: number, i: Partial<CreatePackageInput>) {
  const { permissionKeys, ...cols } = i
  if (Object.keys(cols).length) await db.update(packages).set(cols).where(eq(packages.id, id))
  if (permissionKeys) {
    const rows = await resolveKeys(permissionKeys)
    await db.delete(packagePermissions).where(eq(packagePermissions.packageId, id))
    if (rows.length) await db.insert(packagePermissions).values(rows.map(r => ({ packageId: id, permissionId: r.id })))
  }
  return { ok: true }
}

export async function setTenantPackage(tenantId: number, packageSlug: string) {
  const [p] = await db.select().from(packages).where(eq(packages.slug, packageSlug))
  if (!p) throw { notFound: 'package' }
  await db.update(tenants).set({ packageId: p.id }).where(eq(tenants.id, tenantId))
  return { ok: true }
}

export const tenantPackage = async (tenantId: number) =>
  (await db.select({ p: packages }).from(tenants).innerJoin(packages, eq(tenants.packageId, packages.id)).where(eq(tenants.id, tenantId)))[0]?.p ?? null

// เช็คตอนจะ "เพิ่ม" — usage ปัจจุบัน >= limit → 403 (tenant ไม่มีแพ็ค = ไม่จำกัด)
export async function checkQuota(tenantId: number, kind: 'seat' | 'company' | 'admin') {
  const pkg = await tenantPackage(tenantId)
  if (!pkg) return
  const usage = kind === 'seat'
    ? (await db.select({ n: count() }).from(users).where(and(eq(users.tenantId, tenantId), eq(users.status, 'active'))))[0].n
    : kind === 'company'
      ? (await db.select({ n: count() }).from(companies).where(and(eq(companies.tenantId, tenantId), eq(companies.status, 'active'))))[0].n
      : (await db.select({ n: count() }).from(userCompanies).innerJoin(companies, eq(userCompanies.companyId, companies.id))
          .where(and(eq(companies.tenantId, tenantId), eq(userCompanies.isAdmin, true))))[0].n
  const limit = kind === 'seat' ? pkg.seatLimit : kind === 'company' ? pkg.companyLimit : pkg.adminLimit
  if (usage >= limit) throw { quota: kind, limit }
}
```

`package/route.ts` — Elysia instance ใหม่ prefix `/admin` + `onBeforeHandle` superadmin (ลอกโครง adminRouter) routes: `GET/POST /packages`, `PUT /packages/:id`, `PATCH /tenants/:id/package`; error map: `{ notFound }`→404, `{ missing }`→404 — mount ใน app.ts

`company/service.ts`: `createCompany` เพิ่ม `await checkQuota(input.tenantId, 'company')` บรรทัดแรก; `listByTenant` เพิ่ม users count:

```ts
export async function listByTenant(tenantId: number) {
  const cos = await db.select().from(companies).where(eq(companies.tenantId, tenantId))
  const counts = cos.length ? await db.select({ companyId: userCompanies.companyId, n: count() }).from(userCompanies)
    .where(inArray(userCompanies.companyId, cos.map(c => c.id))).groupBy(userCompanies.companyId) : []
  return cos.map(c => ({ ...c, users: counts.find(x => x.companyId === c.id)?.n ?? 0 }))
}
```

`company/route.ts` POST catch เพิ่ม: `if (e?.quota) { set.status = 403; return { quota: e.quota, limit: e.limit } }`

- [ ] **Step 4: รันเขียว** — `bun test tests/package.test.ts tests/company.test.ts` (company.test เดิมต้องยังผ่าน — ไม่มีแพ็ค = ไม่จำกัด)
- [ ] **Step 5: Commit** — `feat: packages module + quota + company user counts`

---

### Task 6: Invite rework + quota wiring (seat + admin)

**Files:**
- Modify: `packages/contracts/src/index.ts`, `entitlement/src/modules/user/service.ts` (`inviteUser` rewrite, `setAdmin` เพิ่ม quota), `entitlement/src/modules/user/route.ts` (invite body + `/admin` catch), `entitlement/tests/user.test.ts` (เคส invite เดิม)
- Test: `entitlement/tests/invite-v2.test.ts`

**Interfaces:**
- Consumes: `checkQuota`, `allowedKeys`, `listPresets` ไม่ใช้ — query preset ตรง
- Produces: `InviteUserInput = { tenantId, email, companyIds, presetSlug?, permissionKeys? }` — สิทธิ์เริ่มต้นเขียนลง `user_permissions` ทุก company ที่ระบุ (position = ชื่อ preset ถ้าใช้ preset); `PATCH /users/:id/admin` เช็ค `admin` quota + `allowGroupAdmin`

- [ ] **Step 1: เขียน tests/invite-v2.test.ts** — เคส: invite ด้วย presetSlug → user_permissions ครบทุก company + position ตั้งเป็นชื่อ preset / invite ด้วย permissionKeys ตรง (ชนะ preset ถ้าส่งทั้งคู่) / seat เต็ม → 403 `{ quota: 'seat' }` / admin เต็ม → PATCH admin 403 / `allowGroupAdmin=false` → PATCH groupAdmin=true 403 `{ quota: 'groupAdmin' }` / preset slug มั่ว → 404

- [ ] **Step 2: รันแดง** → FAIL
- [ ] **Step 3: rewrite `inviteUser`** (แทน logic role เดิมทั้งก้อน — ลบ roleSlugs path ทิ้งเลย):

```ts
export async function inviteUser(i: InviteUserInput, callerClaims: Record<string, any>) {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, i.tenantId))
  if (!tenant) throw { notFound: 'tenant' }
  await checkQuota(i.tenantId, 'seat')
  const companyIds = [...new Set(i.companyIds)]
  if (companyIds.length) {   // validate ownership ก่อนสร้าง zitadel user — กัน orphan (invariant เดิม)
    const owned = await db.select().from(companies).where(and(inArray(companies.id, companyIds), eq(companies.tenantId, i.tenantId)))
    if (owned.length !== companyIds.length) {
      const ownedIds = new Set(owned.map(c => c.id))
      throw { invalidCompanies: companyIds.filter(id => !ownedIds.has(id)) }
    }
  }
  // สิทธิ์เริ่มต้น: permissionKeys ตรงชนะ preset — preset เป็นแค่ template (copy-on-save)
  const preset = i.presetSlug
    ? (await db.select().from(presets).where(and(eq(presets.slug, i.presetSlug), or(isNull(presets.tenantId), eq(presets.tenantId, i.tenantId)))))[0]
    : undefined
  if (i.presetSlug && !preset) throw { notFound: 'preset' }
  const keys = i.permissionKeys ?? (preset
    ? (await db.select({ key: permissions.key }).from(presetPermissions).innerJoin(permissions, eq(presetPermissions.permissionId, permissions.id)).where(eq(presetPermissions.presetId, preset.id))).map(r => r.key)
    : [])
  const rows = keys.length ? await db.select().from(permissions).where(inArray(permissions.key, keys)) : []
  const missing = keys.filter(k => !rows.some(r => r.key === k))
  if (missing.length) throw { missing }
  const allowed = await allowedKeys(i.tenantId)
  const over = allowed ? keys.filter(k => !allowed.has(k)) : []
  if (over.length) throw { overPackage: over }
  const zid = await createZitadelUser(tenant.zitadelOrgId, i.email)
  const [u] = await db.insert(users).values({ zitadelUserId: zid, tenantId: i.tenantId, email: i.email }).returning()
  if (companyIds.length) await db.insert(userCompanies).values(companyIds.map(companyId => ({ userId: u.id, companyId, position: preset?.name ?? null })))
  if (rows.length && companyIds.length) await db.insert(userPermissions).values(companyIds.flatMap(companyId => rows.map(r => ({ userId: u.id, companyId, permissionId: r.id }))))
  return u
}
```
(ลบ `callerClaims` grantAll guard เดิม — ไม่มี role แล้ว; เก็บ param ไว้เผื่ออนาคตหรือถอดออกพร้อม route — ถอดออกเลยง่ายกว่า: signature ใหม่ `inviteUser(i)`)

`setAdmin` เพิ่มก่อน update: `if (i.groupAdmin === true) { const pkg = await tenantPackage(user.tenantId); if (pkg && !pkg.allowGroupAdmin) throw { quota: 'groupAdmin', limit: 0 } }` และ `if (i.admin === true) await checkQuota(user.tenantId, 'admin')`

route: invite body → `t.Object({ tenantId: t.Number(), email: t.String({ format: 'email' }), companyIds: t.Array(t.Number()), presetSlug: t.Optional(t.String()), permissionKeys: t.Optional(t.Array(t.String())) })` + catch เพิ่ม `{ quota }`→403, `{ overPackage }`→400; `/admin` catch เพิ่ม `{ quota }`→403

- [ ] **Step 4: แก้เคส invite ใน user.test.ts** (roleSlugs → presetSlug/permissionKeys — intent เดิม: invalid companies, escalation เคสเดิมแทนด้วย overPackage) แล้วรันเขียว: `bun test tests/invite-v2.test.ts tests/user.test.ts tests/permissions.test.ts`
- [ ] **Step 5: Commit** — `feat: invite V2 (preset/permissions) + seat/admin quota`

---

### Task 7: Personal signup

**Files:**
- Create: `entitlement/src/modules/signup/service.ts`, `entitlement/src/modules/signup/route.ts`
- Modify: `entitlement/src/http/app.ts`
- Test: `entitlement/tests/signup.test.ts`

**Interfaces:**
- Consumes: `createTenant` จาก `modules/tenant/service` (สร้าง Zitadel org ให้แล้ว), `createZitadelUser`
- Produces: `POST /signup/personal` body `{ email, packageSlug }` — **public ไม่ต้อง auth** → `{ tenantId, userId }`; สร้าง tenant type=personal + company แฝง + membership `isAdmin=true` + เปิดโมดูลตามแพ็ค
- หมายเหตุ deviation จาก spec: ไม่รับ `password` — pretest ไม่มี SMTP, Zitadel invite flow เดิม (email verified) จัดการรหัสตอน first login เหมือน `POST /users/invite`

- [ ] **Step 1: เขียน tests/signup.test.ts** — เคส: signup แล้ว resolveClaims ได้ grants `['admin']` + allowed keys ของแพ็ค + `package` slug / packageSlug ที่ `selfSignup=false` → 400 `{ invalidPackage }` / email ซ้ำ → 409 `{ emailTaken }` / tenant ที่ได้ `type='personal'`

- [ ] **Step 2: รันแดง** → FAIL
- [ ] **Step 3: implement**

```ts
import { db } from '../../db/client'
import { packages, packagePermissions, permissions, tenants, companies, users, userCompanies, tenantModules } from '../../db/schema'
import { eq, and } from 'drizzle-orm'
import { createTenant } from '../tenant/service'
import { createZitadelUser } from '../../zitadel/client'

export async function signupPersonal(i: { email: string; packageSlug: string }) {
  const [pkg] = await db.select().from(packages).where(and(eq(packages.slug, i.packageSlug), eq(packages.selfSignup, true)))
  if (!pkg) throw { invalidPackage: i.packageSlug }
  if ((await db.select().from(users).where(eq(users.email, i.email))).length) throw { emailTaken: i.email }
  const t = await createTenant({ name: i.email, slug: 'p-' + crypto.randomUUID().slice(0, 8) })
  await db.update(tenants).set({ packageId: pkg.id, type: 'personal' }).where(eq(tenants.id, t.id))
  const [co] = await db.insert(companies).values({ tenantId: t.id, name: i.email }).returning()
  const zid = await createZitadelUser(t.zitadelOrgId, i.email)
  const [u] = await db.insert(users).values({ zitadelUserId: zid, tenantId: t.id, email: i.email }).returning()
  await db.insert(userCompanies).values({ userId: u.id, companyId: co.id, isAdmin: true })   // เจ้าของ space ตัวเอง → resolver เดินเส้น admin ปกติ
  const mods = await db.selectDistinct({ moduleId: permissions.moduleId }).from(packagePermissions)
    .innerJoin(permissions, eq(packagePermissions.permissionId, permissions.id)).where(eq(packagePermissions.packageId, pkg.id))
  if (mods.length) await db.insert(tenantModules).values(mods.map(m => ({ tenantId: t.id, moduleId: m.moduleId }))).onConflictDoNothing()
  return { tenantId: t.id, userId: u.id }
}
```

route — **ไม่ .use(requireAuth)**:

```ts
export const signupRouter = new Elysia({ prefix: '/signup' })
  .post('/personal', async ({ body, set }) => {
    try { return await signupPersonal(body) }
    catch (e: any) {
      if (e?.invalidPackage) { set.status = 400; return { invalidPackage: e.invalidPackage } }
      if (e?.emailTaken) { set.status = 409; return { emailTaken: e.emailTaken } }
      throw e
    }
  }, { body: t.Object({ email: t.String({ format: 'email' }), packageSlug: t.String() }) })
```

- [ ] **Step 4: รันเขียว** → PASS · **Step 5: Commit** — `feat: personal signup — tenant ขนาด 1 คน ใช้เส้น resolver เดียวกับ org`

---

### Task 8: Admin console read APIs

**Files:**
- Modify: `entitlement/src/modules/admin/service.ts` (rewrite `overview`, เพิ่ม `tenantDetail`, `loginEvents` รับ filter), `entitlement/src/modules/admin/route.ts`
- Test: `entitlement/tests/admin-v2.test.ts` (ใหม่ — `admin.test.ts` เดิมแก้ expectation overview)

**Interfaces:**
- Produces: `GET /admin/overview` → `{ tenants: [{ id, name, slug, type, status, package, seatLimit, users, companies }] }` · `GET /admin/tenants/:id` → `{ tenant, package, usage: { seats, companies, admins }, companies: [{ id, name, users, admins }] }` · `GET /admin/logins?tenantId=` (ส่งต่อ filter — Zitadel client เดิม, กรองฝั่งเราจาก events ถ้า client ไม่รองรับ)

- [ ] **Step 1: เขียน tests/admin-v2.test.ts** — เคส: overview คืน users/companies count + package slug / tenantDetail usage ตรงกับ data ที่ seed ในเทส / ไม่ใช่ superadmin → 403

- [ ] **Step 2: รันแดง** → FAIL
- [ ] **Step 3: implement** (ดูโครง query ใน Task 5 `listPackages` — groupBy + map):

```ts
export async function overview() {
  const ts = await db.select({ id: tenants.id, name: tenants.name, slug: tenants.slug, type: tenants.type,
    status: tenants.status, pkg: packages.slug, seatLimit: packages.seatLimit })
    .from(tenants).leftJoin(packages, eq(tenants.packageId, packages.id))
  const userCounts = await db.select({ tenantId: users.tenantId, n: count() }).from(users).where(eq(users.status, 'active')).groupBy(users.tenantId)
  const companyCounts = await db.select({ tenantId: companies.tenantId, n: count() }).from(companies).groupBy(companies.tenantId)
  return { tenants: ts.map(t => ({ ...t, package: t.pkg, users: userCounts.find(c => c.tenantId === t.id)?.n ?? 0, companies: companyCounts.find(c => c.tenantId === t.id)?.n ?? 0 })) }
}

export async function tenantDetail(id: number) {
  const [t] = await db.select().from(tenants).leftJoin(packages, eq(tenants.packageId, packages.id)).where(eq(tenants.id, id))
  if (!t) throw { notFound: 'tenant' }
  const cos = await db.select().from(companies).where(eq(companies.tenantId, id))
  const ms = cos.length ? await db.select().from(userCompanies).where(inArray(userCompanies.companyId, cos.map(c => c.id))) : []
  const seats = (await db.select({ n: count() }).from(users).where(and(eq(users.tenantId, id), eq(users.status, 'active'))))[0].n
  return { tenant: t.tenants, package: t.packages,
    usage: { seats, companies: cos.filter(c => c.status === 'active').length, admins: ms.filter(m => m.isAdmin).length },
    companies: cos.map(c => ({ id: c.id, name: c.name, status: c.status,
      users: ms.filter(m => m.companyId === c.id).length, admins: ms.filter(m => m.companyId === c.id && m.isAdmin).length })) }
}
```
route เพิ่ม `.get('/tenants/:id', ...)` map `{ notFound }`→404; `/logins` รับ `query.tenantId` → กรอง events ด้วย org ของ tenant (lookup `zitadelOrgId` แล้ว filter ฝั่งเรา — Zitadel client ไม่ต้องแก้)

- [ ] **Step 4: รันเขียว + แก้ admin.test.ts เดิมให้ตรง shape ใหม่** · **Step 5: Commit** — `feat: admin console read APIs (overview/tenant detail/logins filter)`

---

### Task 9: Invoices (billing-lite)

**Files:**
- Create: `entitlement/src/modules/invoice/service.ts`, `entitlement/src/modules/invoice/route.ts`
- Modify: `entitlement/src/http/app.ts`
- Test: `entitlement/tests/invoice.test.ts`

**Interfaces:**
- Produces: `GET /admin/tenants/:id/invoices` · `POST /admin/tenants/:id/invoices` body `{ description, amount }` → เลขรัน `INV-<ปี>-<id 4 หลัก>` · `PATCH /admin/invoices/:number/paid` · `GET /admin/invoices/:number/print?type=invoice|receipt` → HTML (`content-type: text/html`); receipt ก่อนจ่าย → 400

- [ ] **Step 1: เขียน tests/invoice.test.ts** — เคส: ออก invoice ได้เลข `INV-` + status issued / paid แล้ว `paidAt` ไม่ null / print invoice ได้ HTML มีชื่อ tenant + ยอด / print receipt ก่อนจ่าย → 400 / หลังจ่าย → 200 / ไม่ใช่ superadmin → 403

- [ ] **Step 2: รันแดง** → FAIL
- [ ] **Step 3: implement**

```ts
import { db } from '../../db/client'
import { invoices, tenants } from '../../db/schema'
import { eq } from 'drizzle-orm'

export const listInvoices = (tenantId: number) => db.select().from(invoices).where(eq(invoices.tenantId, tenantId))

export async function createInvoice(tenantId: number, i: { description: string; amount: number }) {
  const [t] = await db.select().from(tenants).where(eq(tenants.id, tenantId))
  if (!t) throw { notFound: 'tenant' }
  const [row] = await db.insert(invoices).values({ tenantId, number: 'PENDING', ...i }).returning()
  const number = `INV-${new Date().getFullYear()}-${String(row.id).padStart(4, '0')}`   // เลขรันจาก id — ชนกันไม่ได้
  await db.update(invoices).set({ number }).where(eq(invoices.id, row.id))
  return { ...row, number }
}

export async function markPaid(number: string) {
  const [inv] = await db.select().from(invoices).where(eq(invoices.number, number))
  if (!inv) throw { notFound: 'invoice' }
  await db.update(invoices).set({ status: 'paid', paidAt: new Date() }).where(eq(invoices.id, inv.id))
  return { ok: true }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export async function printHtml(number: string, type: 'invoice' | 'receipt') {
  const [inv] = await db.select().from(invoices).where(eq(invoices.number, number))
  if (!inv) throw { notFound: 'invoice' }
  if (type === 'receipt' && inv.status !== 'paid') throw { notPaid: number }
  const [t] = await db.select().from(tenants).where(eq(tenants.id, inv.tenantId))
  const title = type === 'receipt' ? 'ใบเสร็จรับเงิน / Receipt' : 'ใบแจ้งหนี้ / Invoice'
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title} ${inv.number}</title>
<style>body{font-family:sans-serif;max-width:640px;margin:40px auto;padding:0 20px}table{width:100%;border-collapse:collapse}td,th{padding:8px;border-bottom:1px solid #ddd;text-align:left}.r{text-align:right}@media print{button{display:none}}</style></head>
<body><h1>${title}</h1><p>เลขที่ ${inv.number}<br>ลูกค้า: ${esc(t.name)}</p>
<table><tr><th>รายการ</th><th class="r">จำนวนเงิน (บาท)</th></tr><tr><td>${esc(inv.description)}</td><td class="r">${inv.amount.toLocaleString()}</td></tr></table>
<p>${type === 'receipt' ? 'ชำระเมื่อ ' + inv.paidAt!.toISOString().slice(0, 10) : 'ออกเมื่อ ' + inv.issuedAt.toISOString().slice(0, 10)}</p>
<button onclick="print()">พิมพ์</button></body></html>`
}
```

route — prefix `/admin`, superadmin guard เหมือน package/route; print route set `headers['content-type'] = 'text/html; charset=utf-8'`; map `{ notPaid }`→400

- [ ] **Step 4: รันเขียว** → PASS · **Step 5: Commit** — `feat: billing-lite — invoices + print invoice/receipt`

---

### Task 10: Cleanup — ลบระบบ role เดิม + drop tables + regression เต็ม

**Files:**
- Delete: `entitlement/src/modules/role/` (ทั้ง dir), `entitlement/tests/role.test.ts`
- Modify: `entitlement/src/db/schema.ts` (ลบ `roles`, `rolePermissions`, `userRoles`), `entitlement/src/http/app.ts` (ถอด roleRouter), `entitlement/src/modules/user/service.ts` + `route.ts` (ลบ `assignRole`/`revokeRole` + POST·DELETE `/users/:id/roles`; `removeCompany` เปลี่ยนไปลบ `userPermissions` ของ company นั้นแทน `userRoles`), `entitlement/src/db/seed-run.ts` (ตัด seedSystemRoles), `packages/contracts/src/index.ts` (InviteUserInput เก่าถ้ายังเหลือ field ไหน), `entitlement/tests/user-roles.test.ts` (ลบเคส role — เคส status/companies ยังอยู่ ย้ายชื่อไฟล์เป็น `user-mgmt.test.ts`), `entitlement/tests/e2e.test.ts` (rewrite flow)

- [ ] **Step 1: ลบ role code + แก้ removeCompany**

```ts
// removeCompany ใหม่ — ถอน membership + สิทธิ์ scope company นั้น (กันสิทธิ์ผีกลับมาเมื่อ add กลับ)
export async function removeCompany(userId: number, companyId: number) {
  await db.delete(userPermissions).where(and(eq(userPermissions.userId, userId), eq(userPermissions.companyId, companyId)))
  await db.delete(userCompanies).where(and(eq(userCompanies.userId, userId), eq(userCompanies.companyId, companyId)))
  return { ok: true }
}
```

- [ ] **Step 2: ลบ 3 ตารางจาก schema.ts → generate + migrate**

Run: `cd entitlement && bun run db:generate && bun run db:migrate`
Expected: migration DROP TABLE `user_roles`, `role_permissions`, `roles`

- [ ] **Step 3: rewrite e2e.test.ts** — flow ใหม่: superadmin สร้าง tenant → สร้าง package + ผูก → เปิด module → สร้าง 2 companies → invite user (preset) → ตั้ง admin คนนึง → PUT permissions รายคน (เคสสมชาย: สิทธิ์ต่างกัน 2 บริษัท) → resolveClaims ตรวจ grants แยกบริษัทถูก → แก้ preset → สิทธิ์คนเดิมไม่เปลี่ยน (copy-on-save) → disable user → claims `{}`

- [ ] **Step 4: regression เต็ม**

Run: `cd entitlement && bun test`
Expected: PASS ทุกไฟล์ — ไฟล์ไหนยังอ้าง roles จะ fail ตอน import → ตามแก้ให้หมด (ห้ามข้าม)

- [ ] **Step 5: Commit** — `refactor: ลบ role system เดิม — V2 per-user permissions เป็น source of truth เดียว`

---

## Self-Review (ทำแล้ว)

- Spec coverage: model แบบ A (T1-3), presets (T4), packages+gating+quota (T5,6), personal (T7), admin console (T8), billing (T9), ลบของเก่า (T10) — ครบ; `GET /admin-ui/tenants/:id/users` ใน spec implement เป็น `GET /users/tenant/:tenantId` (prefix /admin เป็น superadmin-only ทั้ง router — ย้าย path ให้ guard ถูกระดับ)
- Deviation ที่จดไว้: signup ไม่รับ password (Zitadel invite flow เดิม, pretest ไม่มี SMTP) — จดใน T7
- Type consistency: `checkQuota`/`tenantPackage`/`allowedKeys` นิยามที่เดียว (T5/T3) ใช้ข้าม task ตรง signature แล้ว
