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
- **Claims injection**: Zitadel Action ยิงถาม Entitlement Service แล้วฝัง claims ลง JWT (per-company grants, ดู §5)
- **eSign เป็น client ตัวแรก**: ผูก Zitadel + Entitlement ตั้งแต่วันแรก ไม่มี user table ของตัวเอง
- **superadmin metadata console** (read-only): ดู tenant/จำนวน user-company/module status/login log — **ไม่เห็นข้อมูลธุรกิจของลูกค้า** (ดู §4a)

### V1 — ไม่ทำ (future)
- **HR migration** — ไว้ทีหลัง (กลยุทธ์ strangler, ดู §9) เพื่อไม่ให้ V1 บวมเกินไป
- **Branch / Department / Employee** — อยู่ที่ HR ไม่เข้า Auth (Auth ถือแค่ถึง **Company**)
- **Billing / payment จริง** — V1 `module` เป็นแค่ on/off flag ต่อ tenant
- **Break-glass support access** (superadmin เข้าไปแก้ข้อมูลลูกค้า) — future phase, ดู §4a + §12
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

### 3a. สินค้าใหม่: Zitadel Project / Application / Organization access

อย่าปน resource 3 ระดับนี้:

- **Organization** = identity boundary ของ tenant ลูกค้า (user, login policy, branding)
- **Project** = product/security boundary เช่น `EDM eSign`, `EDM HR`
- **Application** = OIDC client ของ product เดิม เช่น Web, Mobile, Admin หรือ environment แยก

สินค้าใหม่ที่มี security lifecycle/audience แยกควรสร้าง **Project ใหม่**; ถ้าเป็นเพียง client
อีกชนิดของสินค้าเดิม (เช่น eSign Mobile เพิ่มจาก eSign Web) ให้สร้าง Application ใต้ Project เดิม.
Project/Application เป็นของ platform org กลาง ไม่ต้องสร้างซ้ำต่อ tenant.

การสร้าง Application ไม่ได้ทำให้ทุก Organization ใช้ Project ได้โดยอัตโนมัติเสมอ:

1. **V1 (เลือกใช้):** ปิด Zitadel setting **Check for Project on Authentication** เพื่อให้ user
   จากทุก org ผ่าน authentication ได้ แล้วให้ Entitlement เป็น source of truth ว่า tenant ซื้อ
   module ใด (`tenant_modules`) และ API บังคับ `modules`/`permissions` จาก JWT; user ที่ไม่มี
   entitlement login สำเร็จได้แต่ API ต้องตอบ 403.
2. **Future defense-in-depth:** เปิด setting ดังกล่าว แล้วสร้าง **Project Grant** ให้แต่ละ
   Organization เมื่อซื้อ module; ตอนยกเลิกให้ถอน Grant ควบคู่กับปิด `tenant_modules`.

V1 ยังไม่มี Project Grant automation และต้องไม่ใช้ Zitadel project roles เป็น source of truth
ซ้ำกับ Entitlement เพราะจะเกิดสิทธิ์สองชุดที่ drift กัน. หากเพิ่ม automation ภายหลัง ให้
`tenant_modules` เป็นต้นทางและ Project Grant เป็น projection เท่านั้น.

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
  name, slug, description,
  grant_all (bool)          -- true = ให้ทุก permission ของ module ที่ tenant เปิด
                            --        (ไม่ต้อง list permission เป็นร้อยตัว)

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

### role มี 2 ระนาบ — อย่าปนกัน

```
ระนาบ PLATFORM (ของเรา — EDM)  อยู่เหนือทุก tenant
   superadmin  → ไม่ใช่ row ใน tenant ลูกค้า เป็น identity แยกที่ระนาบ platform
                 (Zitadel instance / platform org). JWT ไม่มี tenantId
ระนาบ TENANT (ของลูกค้า)  scope อยู่ใน tenant เดียว
   group_admin   = role grant_all + company_id NULL  → ทุก company ทุก module ในเครือ
   company_admin = role grant_all + company_id = X    → ทุก module เฉพาะบริษัท X
   hr_manager / esign_signer / ...  = grant_all false + explicit permission list
```

เคสตัวอย่าง (user เป็น admin เต็มของ A แต่ที่ B แตะได้แค่ HR):
```
user_roles: (user=1, company_admin, company_id=10)   → ทุก module ใน A
            (user=1, hr_staff,      company_id=11)   → เฉพาะ HR ใน B
```

## 4a. superadmin (platform plane) — ขอบเขตการเข้าถึง

**หลักการ: least privilege + break-glass, ไม่ใช่ god-mode ถาวร** — เพราะ (1) PDPA: ไม่ถือข้อมูล
ส่วนบุคคล/เงินเดือนลูกค้าโดยไม่จำเป็น, (2) ลด blast radius: account superadmin หลุด = ไม่ทำให้
ข้อมูลทุกลูกค้ารั่วพร้อมกัน, (3) จุดขาย B2B: ตอบลูกค้าได้ว่า "พนักงานเราไม่เห็นข้อมูลคุณ"

```
ระดับปกติ (V1 — ทำ):  superadmin metadata console (read-only)
   • รายชื่อ tenant + จำนวน user/company
   • module ที่แต่ละ tenant เปิด + สถานะ subscription
   • login log / audit (จาก Zitadel)
   • health / error rate
   → ไม่เห็น employee, เงินเดือน, เอกสาร eSign

ระดับ break-glass (FUTURE phase — ยังไม่ทำ แต่ design เผื่อไว้):
   superadmin เข้าไปแก้ข้อมูลลูกค้าตอนมีปัญหา โดยต้อง:
   • ระบุเหตุผล → สร้าง "support session" scoped เฉพาะ tenant นั้น
   • time-boxed (หมดอายุตามเวลาที่กำหนด เช่น 1 ชม.)
   • audit ทุก action + บันทึกว่า "เข้าเมื่อไหร่ / ทำอะไร" → ลูกค้าเห็น log ได้
   • (ดีขึ้นอีก: group_admin ฝั่งลูกค้าต้อง approve ก่อน)
```

> 📌 **NOTE ไว้เตือนตอนทำ feature อนาคต:** break-glass นี้เป็นทั้ง feature ช่วยเหลือลูกค้าและ
> **จุดขายด้านความน่าเชื่อถือ** — เราแจ้งลูกค้าได้ว่า "ถ้ามีปัญหา เรามีระบบเข้าช่วยที่จำกัดตามเวลา
> และเก็บ log ทุกครั้งว่าเข้าไปทำอะไรตอนไหน" ตอนออกแบบ feature นี้ **ห้ามลืม** 3 อย่าง: time-box,
> audit log ที่ลูกค้าดูได้, และ (ถ้าเป็นไปได้) customer approval. อย่าทำเป็น standing full access เด็ดขาด

## 5. Auth flow & claims injection

### Login flow
1. Client (eSign/Next.js) ส่ง user ไป Zitadel hosted login (OIDC Authorization Code + PKCE)
2. Zitadel ตรวจ credential/MFA → กำลังจะออก access token
3. **Zitadel Action** (custom code ตอนออก token) เรียก
   `POST {entitlement}/internal/claims` ด้วย `zitadel_user_id = sub`
4. Entitlement Service คืน claims (resolve จาก DB §4) แบบ **per-company grants**:
   - `tenantId`
   - `companies[]` — company ที่ user เข้าได้
   - `modules[]` — module ที่ tenant เปิด
   - `grants` — **สิทธิ์แยกต่อ company** (สำคัญ: admin ที่ A ≠ สิทธิ์ที่ B แบน list เดียวเข้ารหัสไม่ได้)
     - แต่ละ company: `roles[]` + `permissions[]` (union จาก role, กรองด้วย module ที่เปิด;
       role `grant_all` → ขยายเป็น `["*"]`)
5. Zitadel ฝัง claims ลง access token → คืน token ให้ client

### JWT shape (ตัวอย่าง — Somchai: admin เต็มที่ A=10, แค่ HR ที่ B=11)
```json
{
  "sub": "z-somchai-abc",
  "email": "somchai@sc.co.th",
  "urn:platform:tenantId": 1,
  "urn:platform:companies": [10, 11],
  "urn:platform:modules": ["hr", "esign"],
  "urn:platform:grants": {
    "10": { "roles": ["company_admin"], "permissions": ["*"] },
    "11": { "roles": ["hr_staff"], "permissions": ["employee.read", "employee.write"] }
  }
}
```
> service เลือก active company แล้วเช็ค `grants[activeCompanyId]` — อยู่ B (11) ยิง eSign → 403
> เพราะ `esign.doc.sign` ไม่อยู่ใน grants["11"]. superadmin (platform plane) จะไม่มี `tenantId`/`grants`
> แต่มี `urn:platform:role = "superadmin"` แทน
> **future:** ถ้า user มีบริษัทเยอะจน token ใหญ่ ค่อยเปลี่ยนเป็น "ออก token ต่อ active company" — V1 nested พอ

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
- **superadmin metadata API** (platform plane, read-only): list tenant + counts + module status +
  login log — **ไม่แตะข้อมูลธุรกิจ** (ดู §4a)
- ทุก endpoint ต้องผ่าน JWT + permission check:
  - tenant-plane → permission เช่น `tenant.user.manage` ผ่าน `grants`
  - platform-plane → claim `urn:platform:role = "superadmin"`

## 7. eSign integration (client ตัวแรก)

- eSign backend (Elysia) **verify JWT ด้วย Zitadel JWKS** — ไม่มี user table ของตัวเอง
- อ้าง user ด้วย `sub`; เลือก active company แล้ว gate ด้วย `grants[activeCompanyId]`:
  - `modules` ต้องมี `'esign'`
  - `grants[activeCompanyId].permissions` มี `'esign.document.sign'` (หรือ `"*"`)
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
- **Break-glass support access (superadmin เข้าไปแก้ข้อมูลลูกค้า)** — ดู §4a. ⚠️ ตอนทำ **ห้ามลืม**:
  time-box, audit log ที่ลูกค้าดูได้ ("เข้าเมื่อไหร่/ทำอะไร"), และ customer approval. เป็นทั้ง feature
  ช่วยเหลือและจุดขายด้านความน่าเชื่อถือ — ต้องไม่ใช่ standing full access
- SAML/SSO ต่อ org ต่อลูกค้า — เปิดเมื่อมีลูกค้าองค์กรร้องขอ
- Real-time revoke via Redis cache — เมื่อ TTL สั้นยังไม่พอ
- module → subscription/billing จริง — เมื่อเริ่มเก็บเงินอัตโนมัติ
- per-company module enablement (`company_modules`) — ถ้าบริษัทในเครือซื้อ module ต่างกัน (V1 ใช้ tenant-level)
- HR strangler migration — เมื่อ eSign นิ่งแล้ว
