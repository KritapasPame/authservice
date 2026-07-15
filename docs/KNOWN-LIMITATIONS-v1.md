# Auth Service V1 — Known Limitations & Post-V1 Follow-ups

> จากผล final whole-branch review (T15, 2026-07-15). สิ่งเหล่านี้ **จงใจเลื่อน** ออกจาก V1
> ไม่ใช่ bug ที่ลืม — บันทึกไว้ให้ operator/ผู้ integrate เห็นชัด และเป็น backlog ของ V2.

## Write API ยังไม่ครบ spec §6 (per-company role management)
- `POST /users/invite` แนบ role ได้แบบ **tenant-wide เท่านั้น** (`user_roles.company_id = null`).
  ยัง**ไม่มี** endpoint สำหรับ:
  - assign role ให้ user ที่มีอยู่แล้ว แบบ scope ต่อ company (เคส Somchai = admin ที่ A, HR ที่ B
    ปัจจุบันต้อง **insert `user_roles` ตรงใน DB**)
  - ปิดผู้ใช้ (`users.status = 'disabled'`) — resolver เช็ค status แล้ว แต่ยังไม่มี API set
  - ถอน role / ถอน company ออกจาก user
- claims resolver รองรับ per-company grant เต็มแล้ว — ขาดแค่ฝั่ง write API
- **V2 task #1**: เพิ่ม `POST /users/:id/roles { roleSlug, companyId }` + `PATCH /users/:id/status` +
  ตอน assign **ต้อง re-validate** ว่า role อยู่ system∪tenant เดียวกัน และ company อยู่ใน tenant
  (resolver เชื่อ invariant นี้จาก write path — ดู comment ใน resolver.ts)

## Deployment / ops
- Entitlement Service **ยังไม่ containerized** — `docker-compose.yml` มีแค่ db/redis/zitadel,
  ไม่มี Dockerfile / ไม่มี service `entitlement` (spec §8 วาดไว้เป็น target state)
  → dev รันด้วย `bun run src/index.ts` (host) ยิงเข้า Zitadel ผ่าน `host.docker.internal`
- ตอนต่อ Zitadel Action target **ต้องตั้ง** `ZITADEL_HTTPCLIENT_DENYLIST` override (ดู
  `zitadel/actions/token-claims.md` §4) ไม่งั้น target ยิง endpoint ใน private net ไม่ได้
- runbook ฝั่ง entitlement (`db:migrate`, `db:seed`, insert `platform_admins` row) —
  ดู `.superpowers/sdd/` reports; ควรรวมเป็น operator doc เดียวตอน containerize
- Zitadel Action e2e (สร้าง PAT/OIDC app/target + login จริง + decode token) = **MANUAL VERIFY**
  ทั้งหมด ยังไม่ทดสอบกับ instance จริง (ดู token-claims.md §6/§7)
- V1 **ยังไม่มี Zitadel Project Grant automation**: shared product projects ต้องปิด
  **Check for Project on Authentication** และให้ `tenant_modules` + JWT claims คุม product
  access. Future defense-in-depth ค่อย sync ซื้อ/ยกเลิก module → create/revoke Project Grant
  โดยให้ Entitlement เป็น source of truth เพียงชุดเดียว (ดู design spec §3a).

## eSign integration (client ตัวแรก) — สิ่งที่จะเจอทันที
- `getGrant`/`can`/`hasModule` + `requireAuth` อยู่ใน `entitlement/src/http/auth.ts` แต่
  `@platform/contracts` เป็น **types-only** → eSign import logic ไม่ได้ ต้อง copy `auth.ts`
  → **V2 task**: ย้าย helper + requireAuth ไป `@platform/auth` (หรือใส่ใน contracts package)
- guard `canManageTenant` ถูก copy 3 ที่ (company/user/role route) ต่างกันแค่ permission key —
  ตอนแตะครั้งหน้าให้รวมเป็น helper เดียวข้าง `isSuperadmin`
- consumer **ต้องจำ**: `can()` ไม่ bound ด้วย module — ต้องเรียก `hasModule()` คู่เสมอ
  (grant_all → `['*']` ผ่าน can ได้แม้ module ปิด) — พิจารณา filter `'*'` ด้วย enabled modules
  ฝั่ง server ใน V2

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
