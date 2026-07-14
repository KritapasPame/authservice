# Auth Service V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** สร้าง Auth Service V1 = Zitadel (credential core) + Entitlement Service (Elysia) ที่ออก JWT พร้อม per-company grants ให้ระบบลูก (eSign) ใช้ร่วมกัน

**Architecture:** Zitadel self-host ทำ login/MFA/session/OIDC และออก JWT; ตอนออก token Zitadel Action ยิง webhook มาถาม Entitlement Service เพื่อฝัง custom claims (tenantId, companies, modules, grants). Entitlement Service (Elysia + Postgres) เป็น source of truth ของ tenant/company/role/permission/module + management API. service ลูก verify JWT ด้วย Zitadel JWKS ในเครื่อง

**Tech Stack:** Bun · Elysia · Drizzle ORM · PostgreSQL · jose (JWKS verify) · Zitadel (Docker) · TypeBox (Elysia built-in validation)

## Global Constraints

- **โค้ดง่ายที่สุด** — one-liner ได้ทำ ไม่ over-engineer (ดู memory `simple-code-preference`). ห้ามเพิ่ม abstraction/layer ที่ยังไม่จำเป็น
- **TypeScript strict**, ESM, Bun runtime
- **Auth ถือแค่ถึง Company** — ไม่มี branch/department/employee (อยู่ HR)
- **User ≠ Employee** — Entitlement เก็บ user projection เท่านั้น อ้าง Zitadel ด้วย `zitadel_user_id` (= JWT `sub`)
- **superadmin = platform plane** แยกจาก tenant roles — V1 metadata read-only เท่านั้น (ไม่แตะข้อมูลธุรกิจ)
- **JWT claims namespace:** `urn:platform:tenantId | companies | modules | grants | role`
- **access token TTL 5–15 นาที** (ตั้งใน Zitadel)
- ทุก secret ผ่าน `.env` (ห้าม commit) — `.gitignore` มี `.env` แล้ว
- **DB แยก 2 ตัว:** `zitadel` (ของ Zitadel) กับ `entitlement` (ของเรา) — ไม่ join ข้าม DB
- **Redis:** provision ใน compose ไว้ future (real-time revoke) — **V1 ไม่ต้องเขียนโค้ดใช้ Redis**
- Reference spec: `docs/superpowers/specs/2026-07-14-auth-service-design.md`

## Ownership legend (สำหรับการแตกงาน)

- 🔵 **main-session (central/security)** — ไฟล์กลางที่ทุก task พึ่งพา + จุด security-critical → session หลักทำเอง + รีเช็ค ไม่แตกให้ agent
- 🟢 **fannable (1 agent = 1 task)** — งาน domain module อิสระ conflict ต่ำ → แตกขนานได้ (แต่การ mount router เข้า `app.ts` ให้ main-session รวมเอง)
- 🔴 **review agent** — pass รีวิว perf + security โดยเฉพาะ

## File Structure (ล็อก decomposition)

```
authservice/
├── docker-compose.yml                 🔵 zitadel + postgres + redis + entitlement
├── .env.example                       🔵 ตัวแปรทั้งหมด (ไม่มีค่า secret จริง)
├── entitlement/
│   ├── package.json  tsconfig.json     🔵 T1
│   ├── drizzle.config.ts               🔵 T3
│   ├── src/
│   │   ├── index.ts                    🔵 entrypoint (start Elysia)
│   │   ├── config/env.ts               🔵 T1 อ่าน/validate env
│   │   ├── db/
│   │   │   ├── client.ts               🔵 T3 drizzle client
│   │   │   └── schema.ts               🔵 T3 ตารางทั้งหมด (ศูนย์กลาง — ทุก task พึ่ง)
│   │   ├── http/
│   │   │   ├── app.ts                  🔵 Elysia app + mount routers (จุดรวม central)
│   │   │   └── auth.ts                  🔵 T4 JWT verify (jose JWKS) — security-critical
│   │   ├── claims/
│   │   │   ├── resolver.ts             🔵 T11 คำนวณ claims (security-critical)
│   │   │   └── route.ts                🔵 T11 POST /internal/claims (shared-secret)
│   │   ├── zitadel/client.ts           🟢 T6 เรียก Zitadel Mgmt API (org/user)
│   │   └── modules/
│   │       ├── tenant/                 🟢 T6
│   │       ├── company/                🟢 T7
│   │       ├── role/                   🟢 T8  (role + permission + seed)
│   │       ├── module/                 🟢 T9
│   │       ├── user/                   🟢 T10 provisioning
│   │       └── admin/                  🟢 T13 superadmin metadata
│   └── tests/                          (แต่ละ module มี test ของตัวเอง)
├── zitadel/
│   ├── docker-init.md                  🔵 T2 ขั้นตอน setup instance/org/project/app
│   └── actions/token-claims.md         🔵 T12 config Action v2 webhook → /internal/claims
├── packages/contracts/
│   └── src/index.ts                    🔵 T5 type: PlatformClaims, DTO (แชร์กับ eSign/Next.js)
└── docs/superpowers/{specs,plans}/
```

> **หมายเหตุความถูกต้องของ external tool:** โค้ด Entitlement Service (ของเรา) ในแผนนี้เขียนครบสมบูรณ์. ส่วนที่เป็น **Zitadel config/API (T2, T6 org/user create, T12 Action)** ให้ยึด "contract + ขั้นตอน" ตามแผน แต่ **ต้อง verify endpoint/field กับ Zitadel เวอร์ชันที่ติดตั้งจริง** ตอนลงมือ (Zitadel เปลี่ยน API v1→v2 บ่อย) — นี่คือ dependency ภายนอก ไม่ใช่ placeholder ของโค้ดเรา

---

## Phase 0 — Foundation (🔵 main-session ทั้งหมด · ทำก่อน แตกไม่ได้)

### Task 1: Scaffold Entitlement Service + config 🔵

**Files:**
- Create: `entitlement/package.json`, `entitlement/tsconfig.json`, `entitlement/src/index.ts`, `entitlement/src/config/env.ts`, `entitlement/src/http/app.ts`
- Test: `entitlement/tests/health.test.ts`

**Interfaces:**
- Produces: `createApp(): Elysia` (mount ทุก router), `env` object (typed config), `GET /health → { ok: true }`

- [ ] **Step 1: init project + deps**

```bash
cd entitlement && bun init -y
bun add elysia drizzle-orm postgres jose
bun add -d drizzle-kit @types/bun
```

- [ ] **Step 2: `src/config/env.ts` — อ่าน env แบบง่าย**

```ts
const need = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`missing env ${k}`); return v }
export const env = {
  DATABASE_URL: need('DATABASE_URL'),
  PORT: Number(process.env.PORT ?? 3000),
  ZITADEL_ISSUER: need('ZITADEL_ISSUER'),        // เช่น https://auth.company.com
  ZITADEL_JWKS_URL: need('ZITADEL_JWKS_URL'),    // {issuer}/oauth/v2/keys
  ZITADEL_AUDIENCE: need('ZITADEL_AUDIENCE'),    // project/client id
  ZITADEL_MGMT_URL: process.env.ZITADEL_MGMT_URL ?? '',
  ZITADEL_MGMT_TOKEN: process.env.ZITADEL_MGMT_TOKEN ?? '', // service user PAT
  CLAIMS_SHARED_SECRET: need('CLAIMS_SHARED_SECRET'),
}
```

- [ ] **Step 3: Write failing test `tests/health.test.ts`**

```ts
import { test, expect } from 'bun:test'
import { createApp } from '../src/http/app'

test('GET /health returns ok', async () => {
  const app = createApp()
  const res = await app.handle(new Request('http://x/health'))
  expect(await res.json()).toEqual({ ok: true })
})
```

- [ ] **Step 4: Run — expect FAIL** (`createApp` ยังไม่มี)

Run: `bun test tests/health.test.ts` → FAIL

- [ ] **Step 5: `src/http/app.ts` (โครง) + `src/index.ts`**

```ts
// app.ts
import { Elysia } from 'elysia'
export function createApp() {
  return new Elysia().get('/health', () => ({ ok: true }))
  // routers ของ module จะถูก .use() ต่อที่นี่ (main-session รวมเอง)
}
```
```ts
// index.ts
import { createApp } from './http/app'
import { env } from './config/env'
createApp().listen(env.PORT)
console.log(`entitlement on :${env.PORT}`)
```

- [ ] **Step 6: Run — expect PASS**; แล้ว **commit**

```bash
git add entitlement && git commit -m "feat(entitlement): scaffold Elysia app + config + health"
```

---

### Task 2: Docker infra (Zitadel + Postgres + Redis) 🔵

**Files:**
- Create: `docker-compose.yml`, `.env.example`, `zitadel/docker-init.md`

**Interfaces:**
- Produces: `docker compose up` ได้ Zitadel (พร้อม login UI), Postgres (2 DB: `zitadel`, `entitlement`), Redis

- [ ] **Step 1: `docker-compose.yml`** (โครงหลัก — verify image tag/flag กับ Zitadel docs ล่าสุด)

```yaml
services:
  db:
    image: postgres:16-alpine
    environment: { POSTGRES_USER: pg, POSTGRES_PASSWORD: pg }
    ports: ["5432:5432"]
    volumes: ["./.data/pg:/var/lib/postgresql/data", "./zitadel/initdb:/docker-entrypoint-initdb.d"]
  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
  zitadel:
    image: ghcr.io/zitadel/zitadel:latest   # ← pin เวอร์ชันจริงตอน deploy
    command: 'start-from-init --masterkeyFromEnv --tlsMode disabled'
    environment:
      ZITADEL_DATABASE_POSTGRES_HOST: db
      ZITADEL_DATABASE_POSTGRES_DATABASE: zitadel
      ZITADEL_DATABASE_POSTGRES_USER_USERNAME: pg
      ZITADEL_DATABASE_POSTGRES_USER_PASSWORD: pg
      ZITADEL_DATABASE_POSTGRES_ADMIN_USERNAME: pg
      ZITADEL_DATABASE_POSTGRES_ADMIN_PASSWORD: pg
      ZITADEL_MASTERKEY: ${ZITADEL_MASTERKEY}
      ZITADEL_EXTERNALDOMAIN: ${ZITADEL_EXTERNALDOMAIN}
    depends_on: [db]
    ports: ["8080:8080"]
```

- [ ] **Step 2: `zitadel/initdb/01-create-entitlement-db.sql`** (สร้าง DB ที่สองให้เรา)

```sql
CREATE DATABASE entitlement;
```

- [ ] **Step 3: `.env.example`** — list ตัวแปรทั้งหมด (ค่าเป็น placeholder ที่ปลอดภัย เช่น `changeme`) ครอบ env จาก T1 + `ZITADEL_MASTERKEY`, `ZITADEL_EXTERNALDOMAIN`

- [ ] **Step 4: `zitadel/docker-init.md`** — เขียนขั้นตอน: `docker compose up` → เปิด console `:8080` → สร้าง service user + PAT (ใส่ `ZITADEL_MGMT_TOKEN`) → สร้าง project + OIDC app (ใส่ `ZITADEL_AUDIENCE`) → ตั้ง access token TTL 10 นาที. **verify กับ Zitadel version ที่ใช้**

- [ ] **Step 5: verify แล้ว commit**

```bash
docker compose up -d db zitadel && sleep 20 && curl -sf localhost:8080/debug/healthz && echo OK
git add docker-compose.yml .env.example zitadel && git commit -m "chore: docker infra zitadel+postgres+redis"
```

---

### Task 3: Drizzle schema (ทุกตาราง) + client + migration 🔵

**Files:**
- Create: `entitlement/drizzle.config.ts`, `entitlement/src/db/client.ts`, `entitlement/src/db/schema.ts`
- Test: `entitlement/tests/schema.test.ts`

**Interfaces:**
- Produces: `db` (drizzle client) และ table objects: `tenants, companies, users, userCompanies, roles, permissions, rolePermissions, userRoles, modules, tenantModules, platformAdmins`

- [ ] **Step 1: `src/db/schema.ts`** (ตรงตาม spec §4/§4a — เก็บง่าย ใช้ serial PK)

```ts
import { pgTable, serial, integer, text, boolean, uniqueIndex, primaryKey } from 'drizzle-orm/pg-core'

export const tenants = pgTable('tenants', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  zitadelOrgId: text('zitadel_org_id').notNull().unique(),
  status: text('status').notNull().default('active'),
})

export const companies = pgTable('companies', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').notNull().references(() => tenants.id),
  name: text('name').notNull(),
  code: text('code'),
  parentCompanyId: integer('parent_company_id'),
  status: text('status').notNull().default('active'),
})

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  zitadelUserId: text('zitadel_user_id').notNull().unique(),
  tenantId: integer('tenant_id').notNull().references(() => tenants.id),
  email: text('email').notNull(),
  status: text('status').notNull().default('active'),
})

export const userCompanies = pgTable('user_companies', {
  userId: integer('user_id').notNull().references(() => users.id),
  companyId: integer('company_id').notNull().references(() => companies.id),
}, (t) => ({ pk: primaryKey({ columns: [t.userId, t.companyId] }) }))

export const modules = pgTable('modules', {
  id: serial('id').primaryKey(),
  key: text('key').notNull().unique(),   // 'hr' | 'esign'
  name: text('name').notNull(),
})

export const tenantModules = pgTable('tenant_modules', {
  tenantId: integer('tenant_id').notNull().references(() => tenants.id),
  moduleId: integer('module_id').notNull().references(() => modules.id),
  enabled: boolean('enabled').notNull().default(true),
}, (t) => ({ pk: primaryKey({ columns: [t.tenantId, t.moduleId] }) }))

export const roles = pgTable('roles', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id), // null = system role
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  grantAll: boolean('grant_all').notNull().default(false),
})

export const permissions = pgTable('permissions', {
  id: serial('id').primaryKey(),
  key: text('key').notNull().unique(),          // 'employee.read'
  moduleId: integer('module_id').notNull().references(() => modules.id),
})

export const rolePermissions = pgTable('role_permissions', {
  roleId: integer('role_id').notNull().references(() => roles.id),
  permissionId: integer('permission_id').notNull().references(() => permissions.id),
}, (t) => ({ pk: primaryKey({ columns: [t.roleId, t.permissionId] }) }))

export const userRoles = pgTable('user_roles', {
  userId: integer('user_id').notNull().references(() => users.id),
  roleId: integer('role_id').notNull().references(() => roles.id),
  companyId: integer('company_id').references(() => companies.id), // null = ทุก company ใน tenant
}, (t) => ({ pk: primaryKey({ columns: [t.userId, t.roleId, t.companyId] }) }))

export const platformAdmins = pgTable('platform_admins', {
  zitadelUserId: text('zitadel_user_id').primaryKey(),  // superadmin (platform plane)
})
```

- [ ] **Step 2: `src/db/client.ts`**

```ts
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { env } from '../config/env'
export const db = drizzle(postgres(env.DATABASE_URL), { schema: await import('./schema') })
```

- [ ] **Step 3: `drizzle.config.ts`** (dialect postgres, schema path, out `./drizzle`) + generate/migrate scripts ใน package.json

- [ ] **Step 4: Write failing test `tests/schema.test.ts`** — insert tenant + company แล้ว select กลับมาได้ (ต้องชี้ DATABASE_URL ไป `entitlement` DB)

```ts
import { test, expect } from 'bun:test'
import { db } from '../src/db/client'
import { tenants } from '../src/db/schema'

test('insert + read tenant', async () => {
  const [t] = await db.insert(tenants).values({ name: 'SC Group', slug: 'sc-'+Date.now(), zitadelOrgId: 'org_'+Date.now() }).returning()
  expect(t.id).toBeGreaterThan(0)
})
```

- [ ] **Step 5: generate + migrate + run test — expect PASS**

```bash
bun run db:generate && bun run db:migrate && bun test tests/schema.test.ts
```

- [ ] **Step 6: commit** `feat(entitlement): drizzle schema + client + migration`

---

### Task 4: JWT verify middleware (jose JWKS) 🔵 security-critical

**Files:**
- Create: `entitlement/src/http/auth.ts`
- Test: `entitlement/tests/auth.test.ts`

**Interfaces:**
- Produces: `requireAuth` (Elysia plugin) ที่ verify Bearer JWT ด้วย Zitadel JWKS แล้ว derive `auth = { sub, claims }`; ถ้า fail → 401. `getGrant(claims, companyId)` helper อ่าน `urn:platform:grants[companyId]`

- [ ] **Step 1: `src/http/auth.ts`**

```ts
import { Elysia } from 'elysia'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { env } from '../config/env'

const JWKS = createRemoteJWKSet(new URL(env.ZITADEL_JWKS_URL))

export const requireAuth = new Elysia({ name: 'requireAuth' }).derive(async ({ headers, set }) => {
  const token = headers.authorization?.replace('Bearer ', '')
  if (!token) { set.status = 401; throw new Error('unauthorized') }
  const { payload } = await jwtVerify(token, JWKS, { issuer: env.ZITADEL_ISSUER, audience: env.ZITADEL_AUDIENCE })
  return { auth: { sub: payload.sub as string, claims: payload as Record<string, any> } }
})

export const isSuperadmin = (c: Record<string, any>) => c['urn:platform:role'] === 'superadmin'
export const getGrant = (c: Record<string, any>, companyId: number) =>
  (c['urn:platform:grants'] ?? {})[String(companyId)] ?? { roles: [], permissions: [] }
export const can = (c: Record<string, any>, companyId: number, perm: string) => {
  const g = getGrant(c, companyId); return g.permissions.includes('*') || g.permissions.includes(perm)
}
```

- [ ] **Step 2: failing test `tests/auth.test.ts`** — no token → 401 (unit test `requireAuth` ผ่าน `app.handle`)

```ts
import { test, expect } from 'bun:test'
import { Elysia } from 'elysia'
import { requireAuth } from '../src/http/auth'

test('no token → 401', async () => {
  const app = new Elysia().use(requireAuth).get('/x', () => 'ok')
  const res = await app.handle(new Request('http://x/x'))
  expect(res.status).toBe(401)
})
```

- [ ] **Step 3: run — expect PASS** (โค้ดใน step 1 ทำให้ผ่าน) — ถ้า framework ต้อง tweak ให้ 401 return ให้แก้ให้ throw map เป็น 401

- [ ] **Step 4: commit** `feat(entitlement): JWT verify middleware + grant helpers`

> 🔵 review-note: `can()` / `getGrant()` เป็นหัวใจ authz — review agent ต้องตรวจว่า service ลูกใช้ผ่าน helper นี้เท่านั้น ไม่ตีความ claims เอง

---

### Task 5: Shared contracts package 🔵

**Files:**
- Create: `packages/contracts/src/index.ts`, `packages/contracts/package.json`

**Interfaces:**
- Produces: type `PlatformClaims`, `Grant`, และ DTO (`CreateTenantInput`, `InviteUserInput`, ...) ที่ resolver + modules + eSign import ได้

- [ ] **Step 1: `packages/contracts/src/index.ts`**

```ts
export type Grant = { roles: string[]; permissions: string[] }
export type PlatformClaims =
  | { tenantId: number; companies: number[]; modules: string[]; grants: Record<string, Grant> }
  | { role: 'superadmin' }
  | Record<string, never> // unprovisioned

export type CreateTenantInput = { name: string; slug: string }
export type CreateCompanyInput = { tenantId: number; name: string; code?: string; parentCompanyId?: number }
export type InviteUserInput = { tenantId: number; email: string; companyIds: number[]; roleSlugs: string[] }
```

- [ ] **Step 2: commit** `feat(contracts): shared PlatformClaims + DTO types`

---

## Phase 1 — Domain modules (🟢 แตกให้ agent ขนานได้ · ทุก task พึ่ง T1,T3,T4,T5)

> **บรีฟมาตรฐานสำหรับทุก agent ใน phase นี้:** โค้ดง่ายที่สุด (memory `simple-code-preference`) · ใช้ Drizzle + TypeBox validation (`t`) ของ Elysia · export router เป็น `export const xRouter = new Elysia({ prefix: '/...' })` แล้ว **หยุด** — การ `.use(xRouter)` เข้า `app.ts` ให้ main-session รวมเอง (กัน conflict) · เขียน test เป็น `bun test` ต่อ module

### Task 6: Tenant module + Zitadel client 🟢

**Files:**
- Create: `entitlement/src/zitadel/client.ts`, `entitlement/src/modules/tenant/route.ts`, `entitlement/src/modules/tenant/service.ts`
- Test: `entitlement/tests/tenant.test.ts`

**Interfaces:**
- Consumes: `db`, `tenants` (T3), `requireAuth`/`isSuperadmin` (T4), `CreateTenantInput` (T5)
- Produces: `POST /tenants` (superadmin only) → สร้าง Zitadel org + tenant row; `GET /tenants` list. `createZitadelOrg(name): Promise<string orgId>`

- [ ] **Step 1: `src/zitadel/client.ts`** — เรียก Zitadel Mgmt API สร้าง org (**verify path v1/v2 กับเวอร์ชันจริง**)

```ts
import { env } from '../config/env'
const call = (path: string, body: unknown) => fetch(env.ZITADEL_MGMT_URL + path, {
  method: 'POST',
  headers: { authorization: `Bearer ${env.ZITADEL_MGMT_TOKEN}`, 'content-type': 'application/json' },
  body: JSON.stringify(body),
}).then(async r => { if (!r.ok) throw new Error(`zitadel ${path} ${r.status} ${await r.text()}`); return r.json() })

export const createZitadelOrg = (name: string) => call('/v2/organizations', { name }).then((r: any) => r.organizationId)
export const createZitadelUser = (orgId: string, email: string) =>
  call('/v2/users/human', { organization: { orgId }, email: { email, isVerified: false }, username: email })
    .then((r: any) => r.userId)
```

- [ ] **Step 2: `src/modules/tenant/service.ts`**

```ts
import { db } from '../../db/client'
import { tenants } from '../../db/schema'
import { createZitadelOrg } from '../../zitadel/client'
import type { CreateTenantInput } from '@contracts'

export async function createTenant(input: CreateTenantInput) {
  const orgId = await createZitadelOrg(input.name)
  const [row] = await db.insert(tenants).values({ ...input, zitadelOrgId: orgId }).returning()
  return row
}
export const listTenants = () => db.select().from(tenants)
```

- [ ] **Step 3: `src/modules/tenant/route.ts`**

```ts
import { Elysia, t } from 'elysia'
import { requireAuth, isSuperadmin } from '../../http/auth'
import { createTenant, listTenants } from './service'

export const tenantRouter = new Elysia({ prefix: '/tenants' }).use(requireAuth)
  .onBeforeHandle(({ auth, set }) => { if (!isSuperadmin(auth.claims)) { set.status = 403; return 'forbidden' } })
  .get('/', () => listTenants())
  .post('/', ({ body }) => createTenant(body), { body: t.Object({ name: t.String(), slug: t.String() }) })
```

- [ ] **Step 4: test `tests/tenant.test.ts`** — mock `createZitadelOrg` (หรือ inject) → POST /tenants ด้วย superadmin claims สร้าง row ได้; ไม่ใช่ superadmin → 403. **Step: run FAIL → implement → run PASS**

- [ ] **Step 5: commit** `feat(entitlement): tenant module + zitadel org create`

---

### Task 7: Company module 🟢

**Files:**
- Create: `entitlement/src/modules/company/{route,service}.ts`
- Test: `entitlement/tests/company.test.ts`

**Interfaces:**
- Consumes: `db`, `companies`, `requireAuth`, `isSuperadmin`/`can`, `CreateCompanyInput`
- Produces: `POST /companies`, `GET /tenants/:tenantId/companies`, รองรับ `parentCompanyId`

- [ ] **Step 1: `service.ts`** — `createCompany(input)`, `listByTenant(tenantId)` (Drizzle insert/select แบบตรงไปตรงมา)
- [ ] **Step 2: `route.ts`** — guard: superadmin หรือ group_admin ของ tenant นั้น (ตรวจ `can(claims, ?, 'tenant.company.manage')` — permission `tenant.company.manage`)
- [ ] **Step 3: failing test → implement → pass** (สร้าง company ใต้ tenant; ตั้ง parent ได้)
- [ ] **Step 4: commit** `feat(entitlement): company module + hierarchy`

---

### Task 8: Role + Permission module + seed 🟢

**Files:**
- Create: `entitlement/src/modules/role/{route,service,seed}.ts`
- Test: `entitlement/tests/role.test.ts`

**Interfaces:**
- Consumes: `db`, `roles,permissions,rolePermissions`
- Produces: CRUD role (มี `grantAll`), assign permission→role; `seedSystemRoles()` สร้าง `group_admin`(grantAll), `company_admin`(grantAll) เป็น system role (tenantId null)

- [ ] **Step 1: `seed.ts`** — `seedSystemRoles()` upsert group_admin/company_admin (grantAll true) + seed permission ตัวอย่าง (`employee.read`, `employee.write`, `esign.document.sign`) ผูก module
- [ ] **Step 2: `service.ts`** — createRole, assignPermission, listRoles
- [ ] **Step 3: `route.ts`** — guard superadmin/group_admin
- [ ] **Step 4: failing test → implement → pass** — ทดสอบ grantAll role ถูก mark; assign permission ได้
- [ ] **Step 5: commit** `feat(entitlement): role+permission module + system role seed`

---

### Task 9: Module + tenant_modules 🟢

**Files:**
- Create: `entitlement/src/modules/module/{route,service}.ts`
- Test: `entitlement/tests/module.test.ts`

**Interfaces:**
- Produces: `GET /modules`, `PUT /tenants/:id/modules/:key { enabled }` (superadmin) → upsert `tenantModules`; `enabledModuleKeys(tenantId): Promise<string[]>` (ใช้โดย resolver T11)

- [ ] **Step 1: `service.ts`** — `enabledModuleKeys(tenantId)` = select join `tenantModules`×`modules` where enabled; `setTenantModule(tenantId, key, enabled)` upsert
- [ ] **Step 2: `route.ts`** — superadmin only
- [ ] **Step 3: failing test → implement → pass** — เปิด/ปิด module แล้ว `enabledModuleKeys` เปลี่ยน
- [ ] **Step 4: commit** `feat(entitlement): module + tenant_modules toggle`

---

### Task 10: User provisioning 🟢

**Files:**
- Create: `entitlement/src/modules/user/{route,service}.ts`
- Test: `entitlement/tests/user.test.ts`

**Interfaces:**
- Consumes: `createZitadelUser` (T6), `db`, `users,userCompanies,userRoles,roles`
- Produces: `POST /users/invite` (InviteUserInput) → สร้าง Zitadel user + users row + user_companies + user_roles (map roleSlugs→roleId)

- [ ] **Step 1: `service.ts` — `inviteUser(input)`** (ง่าย ตรงไปตรงมา)

```ts
import { db } from '../../db/client'
import { users, userCompanies, userRoles, roles, tenants } from '../../db/schema'
import { createZitadelUser } from '../../zitadel/client'
import { eq, inArray } from 'drizzle-orm'
import type { InviteUserInput } from '@contracts'

export async function inviteUser(i: InviteUserInput) {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, i.tenantId))
  const zid = await createZitadelUser(tenant.zitadelOrgId, i.email)
  const [u] = await db.insert(users).values({ zitadelUserId: zid, tenantId: i.tenantId, email: i.email }).returning()
  if (i.companyIds.length) await db.insert(userCompanies).values(i.companyIds.map(companyId => ({ userId: u.id, companyId })))
  const rs = i.roleSlugs.length ? await db.select().from(roles).where(inArray(roles.slug, i.roleSlugs)) : []
  if (rs.length) await db.insert(userRoles).values(rs.map(r => ({ userId: u.id, roleId: r.id, companyId: null })))
  return u
}
```

- [ ] **Step 2: `route.ts`** — `POST /users/invite` guard superadmin/group_admin/company_admin (`can(..., 'tenant.user.manage')`)
- [ ] **Step 3: failing test → implement → pass** — mock `createZitadelUser`; invite แล้ว user+companies+roles ครบ
- [ ] **Step 4: commit** `feat(entitlement): user provisioning invite`

---

## Phase 2 — Claims (🔵 main-session · security-critical · ทำหลัง Phase 1)

### Task 11: Claims resolver + internal endpoint 🔵

**Files:**
- Create: `entitlement/src/claims/resolver.ts`, `entitlement/src/claims/route.ts`
- Test: `entitlement/tests/claims.test.ts`

**Interfaces:**
- Consumes: ทุกตาราง + `enabledModuleKeys` (T9)
- Produces: `resolveClaims(zitadelUserId): Promise<PlatformClaims>`; `POST /internal/claims { zitadelUserId }` (ตรวจ header `x-claims-secret === env.CLAIMS_SHARED_SECRET`)

- [ ] **Step 1: `resolver.ts`** (หัวใจ authz — ง่ายแต่ถูก)

```ts
import { db } from '../db/client'
import { users, userCompanies, userRoles, roles, rolePermissions, permissions, platformAdmins, modules, tenantModules } from '../db/schema'
import { eq, inArray, and } from 'drizzle-orm'
import type { PlatformClaims, Grant } from '@contracts'

export async function resolveClaims(zid: string): Promise<PlatformClaims> {
  const [admin] = await db.select().from(platformAdmins).where(eq(platformAdmins.zitadelUserId, zid))
  if (admin) return { role: 'superadmin' }
  const [u] = await db.select().from(users).where(eq(users.zitadelUserId, zid))
  if (!u) return {}

  const enabled = await db.select({ id: modules.id, key: modules.key }).from(tenantModules)
    .innerJoin(modules, eq(tenantModules.moduleId, modules.id))
    .where(and(eq(tenantModules.tenantId, u.tenantId), eq(tenantModules.enabled, true)))
  const enabledIds = enabled.map(m => m.id)

  const companyIds = (await db.select().from(userCompanies).where(eq(userCompanies.userId, u.id))).map(r => r.companyId)
  const urs = await db.select({ roleId: userRoles.roleId, companyId: userRoles.companyId, slug: roles.slug, grantAll: roles.grantAll })
    .from(userRoles).innerJoin(roles, eq(userRoles.roleId, roles.id)).where(eq(userRoles.userId, u.id))

  const roleIds = urs.map(r => r.roleId)
  const permRows = roleIds.length ? await db.select({ roleId: rolePermissions.roleId, key: permissions.key })
    .from(rolePermissions).innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .where(and(inArray(rolePermissions.roleId, roleIds), enabledIds.length ? inArray(permissions.moduleId, enabledIds) : eq(permissions.moduleId, -1))) : []
  const permByRole = new Map<number, string[]>()
  for (const p of permRows) permByRole.set(p.roleId, [...(permByRole.get(p.roleId) ?? []), p.key])

  const grants: Record<string, Grant> = {}
  for (const c of companyIds) {
    const rs = urs.filter(r => r.companyId === null || r.companyId === c)
    const permissionsForC = rs.some(r => r.grantAll) ? ['*'] : [...new Set(rs.flatMap(r => permByRole.get(r.roleId) ?? []))]
    grants[String(c)] = { roles: rs.map(r => r.slug), permissions: permissionsForC }
  }
  return { tenantId: u.tenantId, companies: companyIds, modules: enabled.map(m => m.key), grants }
}
```

- [ ] **Step 2: `route.ts`**

```ts
import { Elysia, t } from 'elysia'
import { env } from '../config/env'
import { resolveClaims } from './resolver'

export const claimsRouter = new Elysia({ prefix: '/internal' })
  .post('/claims', async ({ body, headers, set }) => {
    if (headers['x-claims-secret'] !== env.CLAIMS_SHARED_SECRET) { set.status = 401; return 'no' }
    return resolveClaims(body.zitadelUserId)
  }, { body: t.Object({ zitadelUserId: t.String() }) })
```

- [ ] **Step 3: failing test `tests/claims.test.ts`** — เคส spec: user admin ที่ company A, hr_staff ที่ B → `grants["A"].permissions=['*']`, `grants["B"]` มีแค่ hr; superadmin → `{role:'superadmin'}`; unknown → `{}`; ปิด module → permission ของ module นั้นหลุด. **run FAIL → implement → run PASS**
- [ ] **Step 4: commit** `feat(entitlement): claims resolver + internal endpoint`

> 🔵 review-note: task นี้ + T4 คือจุดที่ review agent ต้องเพ่งที่สุด (per-company scope leak, module filter, superadmin bypass, shared-secret timing)

---

### Task 12: Zitadel Action → ฝัง claims เข้า JWT 🔵

**Files:**
- Create: `zitadel/actions/token-claims.md`

**Interfaces:**
- Produces: config ที่ทำให้ access token มี `urn:platform:*` claims จากผล `/internal/claims`

- [ ] **Step 1: เขียนขั้นตอน config Action v2** (webhook/execution target ยิงตอน `preAccessTokenCreation` → เรียก `POST {entitlement}/internal/claims` พร้อม header secret → map ผลลัพธ์เป็น custom claims `urn:platform:tenantId/companies/modules/grants` หรือ `urn:platform:role`). **verify กลไก Action ของ Zitadel เวอร์ชันจริง** (v1 script `complementToken` vs v2 execution target)
- [ ] **Step 2: manual verify** — login test user → decode access token → เห็น claims ครบ. บันทึกผลใน md
- [ ] **Step 3: commit** `docs(zitadel): token claims action config`

---

## Phase 3 — Superadmin metadata console (🟢 fannable · หลัง T11)

### Task 13: superadmin metadata endpoints 🟢

**Files:**
- Create: `entitlement/src/modules/admin/{route,service}.ts`
- Test: `entitlement/tests/admin.test.ts`

**Interfaces:**
- Consumes: `db`, `requireAuth`, `isSuperadmin`
- Produces: `GET /admin/overview` → `[{ tenantId, name, userCount, companyCount, enabledModules }]`; `GET /admin/logins` → passthrough login log จาก Zitadel (read-only). **ไม่มี endpoint ที่คืนข้อมูลธุรกิจ (employee/salary/document)**

- [ ] **Step 1: `service.ts` — `overview()`** count users/companies ต่อ tenant + enabled modules (Drizzle group/count)
- [ ] **Step 2: `route.ts`** — guard `isSuperadmin` เท่านั้น; `/admin/logins` เรียก Zitadel audit API (read-only)
- [ ] **Step 3: failing test → implement → pass** — superadmin เห็น overview; non-superadmin → 403; ยืนยันไม่มี field ข้อมูลธุรกิจหลุด
- [ ] **Step 4: commit** `feat(entitlement): superadmin metadata console (read-only)`

> 📌 break-glass (เข้าไปแก้ข้อมูลลูกค้า) = **ไม่อยู่ใน V1** — ดู spec §4a/§12. ตอนทำ future phase ห้ามลืม time-box + audit ที่ลูกค้าดูได้ + customer approval

---

## Phase 4 — รวม router + verify + review

### Task 14: Mount routers + end-to-end verify 🔵

**Files:**
- Modify: `entitlement/src/http/app.ts` (main-session รวม `.use()` ทุก router)
- Test: `entitlement/tests/e2e.test.ts`

- [ ] **Step 1: main-session แก้ `app.ts`** — `.use(tenantRouter).use(companyRouter).use(roleRouter).use(moduleRouter).use(userRouter).use(claimsRouter).use(adminRouter)` (ตรวจ prefix ไม่ชน)
- [ ] **Step 2: e2e test (mock Zitadel calls)** — seed → create tenant → enable modules → create companies → invite user (admin@A, hr@B) → `resolveClaims` ได้ grants ตรง spec → เรียก management API ด้วย token ปลอมที่มี grants แล้ว authz ถูก
- [ ] **Step 3: manual verify กับ Zitadel จริง** — login → token → decode → เรียก `GET /tenants` ด้วย superadmin token = 200, ด้วย token ธรรมดา = 403
- [ ] **Step 4: commit** `feat(entitlement): mount routers + e2e verify`

### Task 15: 🔴 Security + Performance review pass (review agent เฉพาะทาง)

**ไม่แก้โค้ด — ออกรายงาน findings จัดลำดับความรุนแรง แล้ว main-session ตัดสินใจแก้**

- [ ] **Security checklist:**
  - JWT verify: ตรวจ issuer + audience + signature จริง (T4) — ไม่มีทางข้าม verify
  - per-company scope: `resolveClaims` (T11) ไม่ leak permission ข้าม company; `grant_all` ขยายถูก และถูก bound ด้วย enabled modules
  - `/internal/claims`: shared-secret เทียบแบบไม่ leak timing; endpoint ไม่ออก public (network policy)
  - superadmin: metadata endpoints (T13) ไม่มี field ข้อมูลธุรกิจ; guard `isSuperadmin` ทุกเส้น
  - management API ทุกเส้นมี guard (ไม่มี endpoint เปลือย); tenant isolation (query ผูก tenantId เสมอ)
  - secret ไม่ถูก log / ไม่ commit
- [ ] **Performance checklist:**
  - `resolveClaims` ไม่มี N+1 (รวม query ต่อ user ให้น้อย — ปัจจุบัน ~5 query คงที่ ไม่วนตาม company/role)
  - index: `zitadel_user_id`, `user_companies(user_id)`, `user_roles(user_id)`, `tenant_modules(tenant_id)` — เพิ่ม index ถ้าขาด
  - token size: grants ใหญ่ไปไหมเมื่อ company เยอะ → ยืนยัน threshold + note future "token ต่อ active company"
- [ ] **ออกรายงาน** → main-session review → เปิด task แก้เฉพาะที่จำเป็น (โค้ดง่ายที่สุด)

---

## Self-Review (ผู้เขียน plan ตรวจกับ spec)

- **Spec coverage:** §3 arch→T2/T4/T11/T12 · §4 model→T3 · §4a superadmin→T13(+§12 break-glass noted) · §5 claims/JWT grants→T11/T12 · §6 mgmt API→T6-10/T13 · §7 eSign→**plan แยก (noted)** · §8 stack/structure→T1-3 · §10 error/security→T4/T11/T15 · §11 testing→ทุก task TDD + T14/T15 ✅
- **Placeholder scan:** โค้ด Entitlement Service ครบ; จุด Zitadel API/Action มี "verify กับเวอร์ชันจริง" = external dependency ระบุชัด ไม่ใช่ TODO ลอย ✅
- **Type consistency:** `resolveClaims`/`PlatformClaims`/`Grant`/`getGrant`/`can`/`enabledModuleKeys`/`createZitadelOrg`/`createZitadelUser`/`inviteUser` ชื่อตรงกันข้าม task ✅
