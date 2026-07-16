# ติดตั้ง Auth Service บน pre-test ตั้งแต่ 0 — checklist เดียวจบ

> ไล่บน→ล่าง ทีละข้อ แต่ละข้อชี้ไป doc รายละเอียด อัปเดต: 2026-07-16
> เครื่องเป้าหมาย: pre-test ที่ถือ domain `authservice.edmcompany.co.th`

## 0. ของที่ต้องมีบนเครื่อง

- docker + docker compose, bun, nginx (มี ssl cert origin แล้ว), python3 (ใช้รันสคริปต์ verify)
- clone repo `authservice` แล้ว `bun install` ที่ root

## 1. Infra containers

```bash
docker compose up -d db redis zitadel
```

- [ ] **สำคัญ — ก่อน start zitadel**: เพิ่ม env ใน service `zitadel` ใน `docker-compose.yml`
  (จำเป็นสำหรับ Actions target, ดู `zitadel/actions/token-claims.md` §4):
  ```yaml
  ZITADEL_HTTPCLIENT_DENYLIST: "169.254.0.0/16,100.64.0.0/10,0.0.0.0/8"
  ```

## 2. nginx

- [ ] server block หลัก (`grpc_pass grpc://zitadel:8080`) — ตามที่ตั้งอยู่แล้ว
- [ ] เพิ่ม `location /packages/` (static + basic auth) สำหรับแจก `@platform/auth` —
  **config เต็ม + volume mounts (nginx เป็น docker) พร้อม copy อยู่ใน `docs/PACKAGE-DISTRIBUTION.md`**
- [ ] `mkdir -p ./packages` ข้าง compose + สร้าง htpasswd:
  `docker run --rm httpd:alpine htpasswd -nb esign '<password>' > htpasswd-packages`
- [ ] `docker compose exec nginx nginx -t && docker compose exec nginx nginx -s reload`

## 3. Zitadel one-time setup (Console)

ตาม `zitadel/docker-init.md`:
- [ ] login admin ครั้งแรก + เปลี่ยนรหัส
- [ ] สร้าง service user + ให้สิทธิ์ instance (Actions/Mgmt) + ออก **PAT** (เก็บในที่ปลอดภัย ห้าม commit)
- [ ] สร้าง project + Web application (PKCE, ไม่มี secret) → ได้ **Client ID**
- [ ] app → Token Settings → **Access Token Type = JWT**
- [ ] default settings → Token lifetimes → **Access Token 10 นาที** + refresh idle/absolute policy
- [ ] ลงทะเบียน redirect URIs ของแอปทดสอบ (`http://127.0.0.1:8787/callback` สำหรับ
  `scripts/oidc-pkce-test.py`) และของ eSign เมื่อได้จากทีมเขา

## 4. Entitlement service (บน host — ยังไม่ containerized, ดู backlog Phase 3)

- [ ] สร้าง `.env` ใน `entitlement/` — ค่าที่ต้องมี (`src/config/env.ts`):
  `DATABASE_URL`, `ZITADEL_ISSUER`, `ZITADEL_JWKS_URL`, `ZITADEL_AUDIENCE`,
  `CLAIMS_SHARED_SECRET`, `ZITADEL_MGMT_URL`, `ZITADEL_MGMT_TOKEN` (= PAT ข้อ 3)
  — `ZITADEL_ACTIONS_SIGNING_KEY` จะได้จากข้อ 5
- [ ] `cd entitlement && bun run db:migrate && bun run db:seed`
- [ ] insert แถว `platform_admins` ของ superadmin คนแรก (zitadel_user_id ของ admin):
  `INSERT INTO platform_admins (zitadel_user_id) VALUES ('<id>');`
- [ ] `bun run src/index.ts` (แนะนำใส่ systemd unit / pm2 กันหลุดตอน reboot)

## 5. ต่อ Actions v2 (custom claims เข้า JWT)

- [ ] `ZITADEL_PAT=<PAT> ./scripts/setup-zitadel-action.sh`
- [ ] เอา `signingKey` ที่พิมพ์ออกมา → ใส่ `ZITADEL_ACTIONS_SIGNING_KEY` ใน `.env` → restart entitlement
- รายละเอียด/debug: `zitadel/actions/token-claims.md`, ขั้นตอนเต็ม: `docs/PHASE1-PRETEST-RUNBOOK.md`

## 6. วาง package ให้ eSign

- [ ] `./scripts/pack-auth.sh` (ในเครื่อง dev) → `scp dist-packages/platform-auth-1.1.0.tgz <server>:<dir ของ compose>/packages/`
- [ ] ทดสอบ: `curl -u esign:<pass> -I https://authservice.edmcompany.co.th/packages/platform-auth-1.1.0.tgz` → 200
- [ ] ส่ง URL + credential + ตัวอย่างโค้ด (`docs/PACKAGE-DISTRIBUTION.md`) ให้ทีม eSign
  — ย้ำให้ใช้ **`canUse()`** ไม่ใช่ `can()` เดี่ยวๆ

## 7. Provision test data + verify

- [ ] สร้าง tenant + company + invite test user (ดูตัวอย่าง curl ใน `docs/PHASE1-PRETEST-RUNBOOK.md` ข้อ 7)
- [ ] `python3 scripts/oidc-pkce-test.py <CLIENT_ID>` → login → ต้องเห็น `urn:platform:*` claims
  - ไม่เห็น (exit 2) → สคริปต์พิมพ์ checklist สาเหตุให้ไล่
- [ ] เทสครบ 3 แบบ: provisioned user (เห็น grants), superadmin (เห็น role), user แปลกหน้า (`{}`)

## 8. ปิดท้าย

- [ ] อัปเดต `docs/PRETEST-AUTH-DEPLOYMENT.md` ส่วน "ยังไม่เสร็จ" ตามผลจริง
- [ ] จด: PAT, signing key, htpasswd — อยู่ที่ไหน ใครถือ (ห้ามอยู่ใน repo)

## ยังไม่อยู่ใน checklist นี้ (ตั้งใจ)

- eSign application ใน Zitadel — รอ redirect URIs จากทีม eSign (Phase 2.3)
- containerize entitlement, transaction, `/admin/logins` projection — Phase 3
- social login / passkey — Phase 4 (ดู `docs/KNOWN-LIMITATIONS-v1.md`)
