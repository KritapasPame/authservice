# Auth Service (Identity Platform) — Design Spec

> วันที่: 2026-07-14
> สถานะ: V1 design (approved) — พร้อมทำ implementation plan
> เจ้าของ: solo dev (+ พี่ดูแล server) · self-host Docker บน server บริษัท

## 1. ภาพรวมและเป้าหมาย

สร้าง **Auth Service** เป็นแกนกลาง identity ของ platform (HR, eSign, และระบบในอนาคต) แบบ
service อิสระ **ไม่ผูกกับ Laravel HR** — เพื่อให้ eSign ที่จะขาย และระบบใหม่ทุกตัวใช้ identity
เดียวกันได้ โดยไม่ต้องพึ่ง HR เป็นแกน

หลักการตัดสินใจสำคัญ: **แยก Auth เป็น 2 ชั้น** แล้ว "ซื้อชั้นที่พลาดแล้วเจ็บ, เขียนเองเฉพาะชั้นที่เป็น business"

| ชั้น | หน้าที่ | เลือกทำอะไร |
|---|---|---|
| **A. Credential core** | login, password, MFA, session, refresh, OIDC, social, audit | **ใช้ Zitadel** (self-host, open source Apache-2.0) — มีทีม maintain security ให้ |
| **B. Business / entitlement** | tenant, company, role, permission, module | **เขียนเอง** (Elysia + Postgres) — ไม่มี engine ไหนรู้จักโมเดลนี้ |

เหตุผลที่ไม่เขียนชั้น A เอง: ทีมเป็น solo dev และกำลังจะ **ขาย** ระบบ — subtle auth bug =
ลูกค้าโดน breach = ความเสี่ยงระดับ existential ที่ควรยกให้ engine ที่มีคน patch CVE ให้

## 2. Scope

### V1 — ทำ
- **Zitadel** self-host: login, MFA (TOTP), email verify, password reset, session/device,
  refresh rotation, OIDC, audit log, (SAML/SSO เปิดไว้ใช้ตอนขายองค์กร)
- **Entitlement Service** (เขียนเอง): tenant, company, user↔company, role, permission, module
- **Claims injection**: Zitadel Action ยิงถาม Entitlement Service แล้วฝัง claims ลง JWT
- **eSign เป็น client ตัวแรก**: ผูก Zitadel + Entitlement ตั้งแต่วันแรก ไม่มี user table ของตัวเอง

### V1 — ไม่ทำ (future)
- **HR migration** — ไว้ทีหลัง (กลยุทธ์ strangler, ดู §9) เพื่อไม่ให้ V1 บวมเกินไป
- **Branch / Department / Employee** — อยู่ที่ HR ไม่เข้า Auth (Auth ถือแค่ถึง **Company**)
- **Billing / payment จริง** — V1 `module` เป็นแค่ on/off flag ต่อ tenant
- Real-time permission revoke, SCIM provisioning, fine-grained ABAC

## 3. สถาปัตยกรรม

```
                         ┌─────────────────────────────────┐
   Next.js / eSign  ───▶ │  Zitadel (ชั้น A, self-host)      │  login UI, password,
   (future: HR)     ───▶ │  identity + credential core       │  MFA, session, OIDC,
                         │  ออก JWT (OIDC) พร้อม custom claims│  social, SAML, audit
                         └───────────────┬─────────────────┘
                                         │ Action/webhook ตอนออก token
                                         │ (ถาม claims ด้วย zitadel_user_id)
                                         ▼
                         ┌─────────────────────────────────┐
                         │  Entitlement Service (เขียนเอง)   │  Elysia (Bun) + Postgres + Redis
                         │  tenant / company / user_companies│  "สมองด้าน authz ของ platform"
                         │  role / permission / module       │  + management API (CRUD)
                         │  + internal claims endpoint       │  + orchestrate Zitadel Mgmt API
                         └─────────────────────────────────┘
```

- **Zitadel** = source of truth ของ "ตัวตน + credential"
- **Entitlement Service** = source of truth ของ "สิทธิ์เชิงธุรกิจ"
- ผูกกันด้วย `users.zitadel_user_id` (= `sub` ใน JWT)
- **Tenant ↔ Zitadel Organization**: 1 tenant (บริษัทลูกค้า/เครือ) = 1 Zitadel org → ได้ isolation
  ของ user ต่อลูกค้า + รองรับ org-level SSO/branding ตอนขายองค์กร
- **User ≠ Employee** ยังคงเดิม — Employee เป็น profile ใน HR ที่ผูกกับ user (via `zitadel_user_id`)

## 4. Data model — Entitlement Service (Postgres, DB แยกจาก Zitadel)

```
tenants
  id, name, slug, zitadel_org_id (unique), status, created_at, updated_at

companies
  id, tenant_id → tenants.id, name, code,
  parent_company_id → companies.id (nullable, รองรับบริษัทแม่-ลูก),
  status, created_at, updated_at

users                         -- projection ของ Zitadel user + ผูก tenant
  id, zitadel_user_id (unique), tenant_id → tenants.id,
  email (mirror จาก Zitadel), status, created_at, updated_at

user_companies                -- user เข้าได้หลาย company
  user_id → users.id, company_id → companies.id
  PK (user_id, company_id)

roles
  id, tenant_id → tenants.id (nullable = system role กลาง),
  name, slug, description

permissions                   -- ผูกกับ module: ปิด module = permission หายจาก claims
  id, key (unique เช่น 'employee.read', 'esign.document.sign'),
  module_id → modules.id, description

role_permissions
  role_id → roles.id, permission_id → permissions.id
  PK (role_id, permission_id)

user_roles                    -- role scope ต่อ company ได้ (nullable = ทุก company ใน tenant)
  user_id → users.id, role_id → roles.id,
  company_id → companies.id (nullable)

modules
  id, key (unique เช่น 'hr', 'esign'), name

tenant_modules                -- tenant ซื้อ/เปิด module ไหน
  tenant_id → tenants.id, module_id → modules.id, enabled (bool)
  PK (tenant_id, module_id)
```

หมายเหตุ design:
- `user_roles.company_id` nullable → รองรับ "HR Manager เฉพาะ company 2" (Cursor scenario Somchai/Ann)
- `permissions.module_id` → **ปิด module = permission ของ module นั้นหลุดจาก claims อัตโนมัติ**
- V1 เริ่มง่ายได้: role scope ทั้ง tenant (company_id = null) ก่อน แล้วค่อยใช้ per-company ทีหลัง

## 5. Auth flow & claims injection

### Login flow
1. Client (eSign/Next.js) ส่ง user ไป Zitadel hosted login (OIDC Authorization Code + PKCE)
2. Zitadel ตรวจ credential/MFA → กำลังจะออก access token
3. **Zitadel Action** (custom code ตอนออก token) เรียก
   `POST {entitlement}/internal/claims` ด้วย `zitadel_user_id = sub`
4. Entitlement Service คืน claims (resolve จาก DB §4):
   - `tenantId`
   - `companies[]` — company ที่ user เข้าได้
   - `roles[]`
   - `permissions[]` — union ของ permission จาก roles **กรองด้วย module ที่ tenant เปิด**
   - `modules[]` — module ที่ tenant เปิด
5. Zitadel ฝัง claims ลง access token → คืน token ให้ client

### JWT shape (ตัวอย่าง)
```json
{
  "sub": "z-user-abc123",
  "email": "boss@abc.com",
  "urn:platform:tenantId": 1,
  "urn:platform:companies": [2, 4],
  "urn:platform:roles": ["hr_manager"],
  "urn:platform:permissions": ["employee.read", "employee.write", "salary.view"],
  "urn:platform:modules": ["hr", "esign"]
}
```

### การใช้ที่ service ปลายทาง
- verify JWT ด้วย **Zitadel JWKS ในเครื่อง** (ไม่ยิง API ทุก request)
- **access token อายุสั้น 5–15 นาที** → เปลี่ยน permission/ปิด module มีผลภายในเวลา token หมดอายุ
- refresh token rotation จัดการโดย Zitadel
- **future:** ถ้าต้องการ revoke ทันที ค่อยเพิ่ม "ถาม Entitlement API ผ่าน Redis cache"

### ความปลอดภัยของ internal claims endpoint
- `/internal/claims` เข้าได้เฉพาะ network ภายใน + shared secret / mTLS (Zitadel Action เท่านั้น)
- ไม่ expose ออก public

## 6. Management API (Entitlement Service)

CRUD + orchestrate Zitadel Management API:
- **Tenant**: create tenant → สร้าง Zitadel org + tenant row
- **User provisioning**: invite user → สร้าง Zitadel user ใน org + users row + user_companies
- **Company / user_companies / role / permission / role_permission / user_role**: CRUD
- **Module**: `tenant_modules` เปิด/ปิด module ต่อ tenant
- ทุก endpoint ต้องผ่าน JWT + permission check (เช่น `platform.tenant.manage`)

## 7. eSign integration (client ตัวแรก)

- eSign backend (Elysia) **verify JWT ด้วย Zitadel JWKS** — ไม่มี user table ของตัวเอง
- อ้าง user ด้วย `sub`; gate ด้วย claims:
  - `modules` ต้องมี `'esign'`
  - permission เช่น `'esign.document.sign'`, `'esign.document.approve'`
- **External signer** (vendor/ลูกค้า/auditor ที่ไม่ใช่พนักงาน): เป็น Zitadel user เหมือนกัน
  แต่ role `external_signer` ไม่ผูก company/tenant ปกติ (หรืออยู่ tenant พิเศษ) — ตอกย้ำ User ≠ Employee

## 8. Tech stack & repo structure

```
authservice/
├── docker-compose.yml         # zitadel + postgres(zitadel) + postgres(entitlement) + redis + entitlement
├── zitadel/
│   ├── init/                  # setup org, project, oidc app, service user
│   └── actions/               # Action code สำหรับยิง claims เข้า JWT
├── entitlement/               # Elysia (Bun) app — ชั้น B
│   ├── src/
│   │   ├── modules/           # tenant / company / role / permission / module (แต่ละตัวแยก)
│   │   ├── db/                # Drizzle schema + migrations
│   │   ├── claims/            # POST /internal/claims (ให้ Zitadel Action เรียก)
│   │   ├── zitadel/           # client เรียก Zitadel Management API
│   │   └── http/              # management API routes + auth middleware (verify JWT)
│   └── ...
├── packages/contracts/        # DTO/type แชร์ (ใช้ร่วมกับ Next.js / eSign)
└── docs/
    └── superpowers/specs/     # spec นี้ + ADR
```

- **Stack**: Elysia (Bun) + PostgreSQL + Redis + Drizzle ORM, TypeScript ล้วน
- **Deploy**: Docker บน server บริษัท (Zitadel + Entitlement รวมใน compose เดียว); ถ้าโหลดเยอะ
  ค่อยแยก server ทีหลัง

## 9. HR migration (future — strangler, ไม่ใช่ V1)

ไม่ทำใน V1 แต่ design เผื่อไว้:
1. HR เพิ่มปุ่ม "Login ผ่าน Auth (OIDC)" ข้างของเดิม — HR เก็บ `users` เดิม + ผูก `zitadel_user_id`
2. ช่วงแรก spatie roles/permissions ยังอยู่ HR ตามเดิม → **ระบบไม่พัง**
3. ค่อยย้าย authority ของ role/permission มา Entitlement ทีละ module
- เข้ากับงาน `employee_id → user_id` ที่ HR กำลังทำอยู่ (users เป็น identity กลางแล้ว)

## 10. Error handling & security

- Entitlement `/internal/claims`: ถ้า user ไม่มีใน Entitlement (login ได้แต่ยังไม่ provision)
  → คืน claims ว่าง (tenantId null) → service ปลายทาง treat เป็น "ยังไม่มีสิทธิ์"
- JWT verify fail / หมดอายุ → 401, ให้ client refresh ผ่าน Zitadel
- ทุก mutation ใน management API → audit (Zitadel audit ครอบ credential; Entitlement log
  business change เอง)
- rate-limit / lockout / brute-force → พึ่ง Zitadel
- secret (Zitadel service-user key, claims shared secret) → env / secret manager, ไม่ commit

## 11. Testing strategy

- **Entitlement Service**: unit test claims resolution (role→permission→module filtering,
  per-company scope), integration test management API + Zitadel Mgmt API (mock/สนามทดสอบ)
- **Claims contract test**: JWT ที่ Zitadel ออกมี custom claims ครบตาม shape §5
- **eSign integration**: verify JWT + gate ด้วย module/permission ถูกต้อง
- โฟกัส test ที่ "ปิด module แล้ว permission หลุด" และ "user เห็นเฉพาะ company ที่ผูก"

## 12. Open questions / future
- SAML/SSO ต่อ org ต่อลูกค้า — เปิดเมื่อมีลูกค้าองค์กรร้องขอ
- Real-time revoke via Redis cache — เมื่อ TTL สั้นยังไม่พอ
- module → subscription/billing จริง — เมื่อเริ่มเก็บเงินอัตโนมัติ
- HR strangler migration — เมื่อ eSign นิ่งแล้ว
