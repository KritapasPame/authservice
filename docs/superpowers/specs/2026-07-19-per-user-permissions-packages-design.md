# Per-user permissions + Packages + Billing-lite (V2 rework)

> อนุมัติ 2026-07-19 (จาก brainstorm + mockup)
> Mockup 4 หน้า: https://claude.ai/code/artifact/12242c48-d5cb-416a-952c-649af10558c8
> แทนที่ role-based model จาก `2026-07-16-per-company-role-management-design.md` — spec นั้นถือว่า superseded

## หลักการ

Zitadel ทำแค่ authentication (login/token) — permission ทั้งหมดอยู่ DB เรา เปลี่ยนได้อิสระ

**แบบ A**: role ตายตัวมีแค่ 3 ตัว ที่เหลือมอง permission รายคนต่อบริษัท

| Role | เก็บที่ | ความหมาย |
|---|---|---|
| superadmin | `platform_admins` (เดิม) | ฝั่งแพลตฟอร์มเรา |
| groupcompanyadmin | `users.is_group_admin` | `'*'` ทุกบริษัทในเครือ (ไม่ต้องเป็นสมาชิกบริษัท) |
| admin | `user_companies.is_admin` | `'*'` เฉพาะบริษัทนั้น |

User ทั่วไป: สิทธิ์อ่านจาก `user_permissions` ตรงๆ ต่อ (user, company)

**ตำแหน่ง = preset (copy-on-save)**: admin เลือก preset เช่น "staff" → UI เติมติ๊ก →
แก้รายคนได้ → กด save เขียนลง `user_permissions` จบ ไม่ link กับ preset
(แก้ preset ทีหลังไม่กระทบคนที่ save ไปแล้ว) ป้ายตำแหน่งเก็บไว้แสดงผลเฉยๆ

**แพ็กเกจ**: นิยามได้อิสระหลายแพ็ค (เช่น Personal 2-3 ระดับ + Enterprise ติดต่อฝ่ายขาย)
แต่ละแพ็คกำหนด (1) โควตา (2) function ที่ใช้ได้ ลูกค้า 1 เจ้าผูก 1 แพ็ค

**Personal = tenant ขนาด 1 คน**: `tenants.type = 'personal'` สมัครเองผ่าน
`POST /signup/personal` — resolver/guard ใช้โค้ดเดียวกับ org ทุกบรรทัด ไม่มี special case
อัปเกรดเป็นแพ็ค org = เปลี่ยน `package_id` ไม่ย้ายข้อมูล

## Schema

**ลบ**: `roles`, `role_permissions`, `user_roles` (pre-test ไม่มี data จริง — drop แล้ว
migrate ใหม่ + reseed ได้เลย)

**เพิ่ม**:

```
user_permissions   (user_id, company_id, permission_id)         PK 3 คอลัมน์ — หัวใจของระบบ
presets            (id, tenant_id null=system, name, slug)
preset_permissions (preset_id, permission_id)
packages           (id, name, slug, seat_limit, company_limit, admin_limit,
                    doc_limit_monthly null=ไม่จำกัด, allow_group_admin, self_signup, price)
package_permissions(package_id, permission_id)                  function ที่แพ็คนี้ใช้ได้
invoices           (id, tenant_id, number unique, description, amount,
                    status 'issued'|'paid', issued_at, paid_at)
```

**แก้**:
- `users` + `is_group_admin boolean default false`
- `user_companies` + `is_admin boolean default false`, `position text` (ป้ายแสดงผล)
- `tenants` + `package_id references packages`, `type text 'org'|'personal' default 'org'`

`tenant_modules` คงไว้ — เป็น override รายเจ้า (เช่นเปิด HR ให้เจ้าเดียวนอกแพ็ค)

## Resolver (`claims/resolver.ts`)

ลำดับใหม่ ต่อ 1 user:

1. `platform_admins` → `{ role: 'superadmin' }` (เดิม)
2. user ไม่มี/`status != 'active'` → `{}` (เดิม)
3. โหลด: package ของ tenant, enabled modules, memberships, permission rows
4. **allowed keys** = permission ที่อยู่ใน `package_permissions` ∩ module ที่เปิด
   (กรอง 2 ชั้น: แพ็กเกจ + tenant_modules override)
5. grants ต่อ company — **ไม่มี `'*'` ต่ำกว่า superadmin** (ไม่งั้น admin ทะลุ package gating):
   - `is_group_admin` → ทุก company active ใน tenant (ไม่อิง membership) ได้
     allowed keys ทั้งชุด + management keys (`tenant.user.manage`, `tenant.company.manage`)
   - `user_companies.is_admin` → เหมือนกันแต่เฉพาะ company นั้น
   - อื่นๆ → `user_permissions` ของ (user, company) ∩ allowed keys
   = "admin ทำได้ทุกอย่าง" หมายถึง *ทุกอย่างเท่าที่แพ็คให้* — gating คุม admin ด้วย
6. shape `PlatformClaims` เดิมทุกอย่าง (`tenantId, companies, modules, grants`) —
   **consumer ฝั่ง app ไม่ต้องแก้อะไร** เพิ่ม optional: `package: slug`, `positions`

Guard `canManageTenant` ใน `http/auth.ts` ใช้ต่อได้ — ทุกจุดเรียกส่ง perm ชัดเจน
(`tenant.user.manage` ฯลฯ) ซึ่ง admin ถือแล้วจาก management keys; เคสเช็ค `'*'`
อย่างเดียว (role route เดิม) ถูกลบไปพร้อม route

## Quota enforcement (เช็คตอน write, 403 พร้อมเหตุผล)

| จุดเช็ค | โควตา |
|---|---|
| `POST /users/invite`, `POST /signup/*` | `seat_limit` (นับ users active ใน tenant) |
| `POST /companies` | `company_limit` |
| `PATCH /users/:id/admin` | `admin_limit` (นับ is_admin รวมทั้ง tenant), `allow_group_admin` |
| `doc_limit_monthly` | **ไม่เช็คที่นี่** — entitlement เก็บ limit ไว้ใน claims/API, ฝั่ง app eSign เป็นคนนับ usage |

## API

### ใหม่
| Endpoint | Guard | หน้าที่ |
|---|---|---|
| `GET/POST/PUT /admin/packages(/:id)` | superadmin | นิยามแพ็กเกจ + function |
| `PATCH /admin/tenants/:id/package` | superadmin | ผูกลูกค้ากับแพ็ค |
| `GET /admin/tenants/:id` | superadmin | รายละเอียดลูกค้า: package, usage เทียบโควตา, companies+จำนวน user |
| `GET·POST /admin/tenants/:id/invoices` | superadmin | list/ออก invoice |
| `GET /admin/invoices/:no/print?type=invoice\|receipt` | superadmin | หน้า HTML สำหรับพิมพ์ (receipt ได้เฉพาะ status=paid) |
| `PATCH /admin/invoices/:no/paid` | superadmin | บันทึกรับเงิน (manual) |
| `POST /signup/personal` | public | body `{email, password, packageSlug}` — packageSlug ต้องเป็นแพ็ค `self_signup=true` ไม่งั้น 400; Zitadel register → สร้าง tenant type=personal + company แฝง 1 แถว (ชื่อผู้ใช้) + membership `is_admin=true` — resolver เดินเส้นเดียวกับ org เป๊ะ |
| `GET /users/:id/permissions?companyId=` | tenant.user.manage | อ่านสิทธิ์รายคน |
| `PUT /users/:id/permissions` | tenant.user.manage | เขียนทับสิทธิ์ (user, company) ทั้งชุด `{companyId, position, permissionKeys[]}` — replace semantics, กรองด้วย allowed keys ของแพ็ค (เกิน → 400 บอก key) |
| `PATCH /users/:id/admin` | groupcompanyadmin/superadmin | `{groupAdmin}` หรือ `{companyId, admin}` |
| `GET/POST/PUT/DELETE /presets` | tenant.user.manage | จัดการตำแหน่ง preset |
| `GET /admin-ui/tenants/:id/users` | tenant.user.manage | รายชื่อ user + ตำแหน่ง + admin flag + สถานะ (จอเดียวจบ) |

### แก้
- `POST /users/invite` — `roleSlugs` → `{companyIds, presetSlug? , permissionKeys?}` + เช็ค seat_limit
- `GET /admin/overview` — เพิ่มสรุปราย tenant (users, package, quota) + แยก org/personal
- `GET /companies/:tenantId` — เพิ่มจำนวน user ต่อบริษัท
- `GET /admin/logins` — filter ราย tenant

### คงเดิม
`GET/POST /tenants`, `PUT /modules/tenants/:tid/:key`, `PATCH /users/:id/status`,
`POST·DELETE /users/:id/companies` (เพิ่มเช็ค company_limit ตอน add)

### ลบ
`/roles/*` ทั้งหมด, `POST·DELETE /users/:id/roles`

## Admin UI (ตาม mockup)

4 หน้า: (1) ลูกค้าทั้งหมด — filter องค์กร/บุคคล (2) แพ็กเกจ — ตารางเทียบ + ลูกค้าต่อแพ็ค
(3) รายละเอียดลูกค้า — แพ็ค/usage/บริษัท/บิล+ปุ่มพิมพ์/logins (4) ตั้งสิทธิ์ราย user —
เลือก user → tab ต่อบริษัท → admin toggle → preset → ติ๊ก → save
Function เกินแพ็ค → disable ช่องติ๊กพร้อมป้าย

หน้า 1-3 guard superadmin, หน้า 4 guard groupcompanyadmin/admin ของ tenant นั้น
(แยก plane ชัดเจน — CS ฝั่งเรา vs จัดการสิทธิ์ฝั่งลูกค้า)

## ไม่ทำใน phase นี้

- Payment gateway — เก็บเงิน manual, ปุ่ม "บันทึกรับเงิน" พอ
- ตัวนับเอกสาร/เดือน — ฝั่ง app eSign
- ภาษี/เลขผู้เสียภาษีบน invoice — ใส่ description ไปก่อน ค่อยเติม field
- HR module (เลื่อนตามเดิม)

## Tests

- rewrite: `role.test.ts`, `user-roles.test.ts` → `permissions.test.ts`, `preset.test.ts`
- ใหม่: `package.test.ts` (gating + quota 403 ทุกจุด), `signup.test.ts`, `invoice.test.ts`
- resolver: group admin ได้ `'*'` ทุกบริษัทรวมที่ไม่เป็นสมาชิก / admin เฉพาะบริษัท /
  user ธรรมดาได้ตามติ๊ก ∩ แพ็ค / เปลี่ยนแพ็คแล้ว key หายทันที / personal tenant ทำงานเหมือน org
- เคสสมชาย (ใหม่): ติ๊กสิทธิ์ต่างกัน 2 บริษัท → grants แยกถูกต้อง
- preset copy-on-save: แก้ preset หลัง save → สิทธิ์คนเดิมไม่เปลี่ยน
