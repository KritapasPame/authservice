# Auth Service V1 — Known Limitations & Post-V1 Follow-ups

> จากผล final whole-branch review (T15, 2026-07-15). สิ่งเหล่านี้ **จงใจเลื่อน** ออกจาก V1
> ไม่ใช่ bug ที่ลืม — บันทึกไว้ให้ operator/ผู้ integrate เห็นชัด และเป็น backlog ของ V2.

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

## Deployment / ops
- Entitlement Service **ยังไม่ containerized** — `docker-compose.yml` มีแค่ db/redis/zitadel,
  ไม่มี Dockerfile / ไม่มี service `entitlement` (spec §8 วาดไว้เป็น target state)
  → dev รันด้วย `bun run src/index.ts` (host) ยิงเข้า Zitadel ผ่าน `host.docker.internal`
- ตอนต่อ Zitadel Action target **ต้องตั้ง** `ZITADEL_HTTPCLIENT_DENYLIST` override (ดู
  `zitadel/actions/token-claims.md` §4) ไม่งั้น target ยิง endpoint ใน private net ไม่ได้
- runbook ฝั่ง entitlement (`db:migrate`, `db:seed`, insert `platform_admins` row) —
  ดู `.superpowers/sdd/` reports; ควรรวมเป็น operator doc เดียวตอน containerize
- OIDC discovery/JWKS, Web app Authorization Code + PKCE, JWT issuance และ decode
  `aud`/`iss`/`sub` **verify แล้วบน pre-test** (2026-07-15); ส่วน service-user PAT,
  Actions v2 target/execution และ custom-claims e2e ยังเป็น **MANUAL VERIFY**
  (ดู `docs/PRETEST-AUTH-DEPLOYMENT.md` และ token-claims.md §6/§7).
- V1 **ยังไม่มี Zitadel Project Grant automation**: shared product projects ต้องปิด
  **Check for Project on Authentication** และให้ `tenant_modules` + JWT claims คุม product
  access. Future defense-in-depth ค่อย sync ซื้อ/ยกเลิก module → create/revoke Project Grant
  โดยให้ Entitlement เป็น source of truth เพียงชุดเดียว (ดู design spec §3a).

## eSign integration (client ตัวแรก) — สิ่งที่จะเจอทันที
- `getGrant`/`can`/`hasModule` + `requireAuth` อยู่ใน `entitlement/src/http/auth.ts` แต่
  `@platform/contracts` เป็น **types-only** → eSign import logic ไม่ได้ ต้อง copy `auth.ts`
  → **V2 task**: ย้าย helper + requireAuth ไป `@platform/auth` (หรือใส่ใน contracts package)
- consumer **ต้องจำ**: `can()` ไม่ bound ด้วย module — ต้องเรียก `hasModule()` คู่เสมอ
  (grant_all → `['*']` ผ่าน can ได้แม้ module ปิด) — พิจารณา filter `'*'` ด้วย enabled modules
  ฝั่ง server ใน V2

## Social login (Google / Apple ID) — ยังไม่เปิด, เปิดหลังเทส flow หลักผ่าน

Zitadel รองรับ federated IdP ในตัวอยู่แล้ว การเปิดใช้**ไม่กระทบสัญญากับฝั่ง client**
(ปุ่มโผล่บนหน้า login ของ Zitadel เอง, OIDC flow เดิม) — จงใจเลื่อนไว้หลัง custom-claims
e2e ผ่าน สิ่งที่ต้องทำตอนเปิด:

- **Google**: สร้าง OAuth client ใน Google Cloud Console (ฟรี) → ใส่ client ID/secret ใน
  Zitadel Console → Identity Providers + ลงทะเบียน callback URL ฝั่ง Google
- **Apple**: ต้องมี **Apple Developer account ($99/ปี)** — สร้าง Services ID + Team ID +
  Key ID + private key (.p8). **App Store rule**: ถ้าแอป iOS มี social login อื่น (เช่น Google)
  จะถูกบังคับให้มี Sign in with Apple ด้วย → ตัดสินใจงบก่อนเปิด Google บน iOS
- เปิด provider ใน login policy ของ instance/org
- **สำคัญกับ entitlement**: user ที่ login ผ่าน Google ครั้งแรก = user ใหม่ใน Zitadel ที่ยังไม่ถูก
  provision → ไม่มีสิทธิ์ (ถูกต้องตาม design) แต่ถ้าอยากให้คนที่ถูก invite ด้วย email ใช้
  Google login เข้า account เดิมได้ ต้องเปิด **auto-linking by email** ใน Zitadel
  ไม่งั้นจะกลายเป็นคนละ `zitadel_user_id` แล้วสิทธิ์ที่ invite ไว้หาย

## Robustness (post-V1, ยอมรับได้ใต้ "โค้ดง่ายที่สุด")
- **ไม่มี transaction**: `createTenant` (Zitadel org → tenant → tenant_modules) และ `inviteUser`
  (user → user_companies → user_roles) partial-fail ได้ → เหลือ orphan. invite validate ก่อน
  ยิง Zitadel แล้ว (กัน orphan ฝั่ง Zitadel). wrap `db.transaction` เมื่อเริ่มเจ็บ
- `Number(params.x)` ที่ path param ไม่ validate → non-numeric = NaN → DB error → 500
  (เข้าถึงได้เฉพาะ authenticated caller, ไม่ใช่ DoS)
- webhook replay ภายในหน้าต่าง 300s (ไม่มี nonce cache) — มาตรฐานของ scheme นี้
- JWT staleness: revoke role / disable user ไม่ล้ม token ที่ออกไปแล้ว — คุมด้วย access-token TTL
  สั้น (5–15 นาที ตั้งใน Zitadel) ตาม design
- `/admin/logins` เป็น raw passthrough ของ Zitadel event (superadmin-only, auth-plane metadata) —
  ควร project เฉพาะ field ที่ console ใช้ใน V2
