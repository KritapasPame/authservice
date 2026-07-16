# Central Login (Login V2) + ปิด Pretest Stage 4 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **หมายเหตุการรัน:** งานส่วนใหญ่เป็น ops — แต่ละ step กำกับว่ารันที่ไหน:
> **[local]** = เครื่อง dev (repo นี้), **[server]** = เซิร์ฟเวอร์ pre-test (ssh, มี compose รันอยู่),
> **[console]** = Zitadel Console `https://authservice.edmcompany.co.th/ui/console` (ทำมือ)

**Goal:** ปิด pretest Phase 1 ให้ครบ (Stage 4: tenant user เต็มระบบ ได้ claims + grants) และเปิดหน้า login กลาง (self-hosted Login V2) ใช้งานได้จริงบน pre-test โดย end user ไม่เห็น `/ui/login` V1

**Architecture:** ของเดิมไม่แตะเลย (Zitadel v4.16 + entitlement claims pipeline ที่ e2e ผ่านแล้ว) — เพิ่ม Login V2 container หลัง nginx ที่ path `/ui/v2/login` แล้วเปิด "Use new login UI" เป็นราย app; Stage 4 provision ผ่าน entitlement API ด้วย superadmin JWT ล้วนๆ ไม่มี SQL ตรง

**Tech Stack:** Docker Compose, nginx (h2c → Zitadel, proxy → login), Zitadel v4.16.0, `ghcr.io/zitadel/zitadel-login:v4.16.0`, entitlement (Bun/Elysia + Postgres), `scripts/oidc-pkce-test.py`

## Global Constraints

- **ห้าม** end user เห็น `/ui/login` V1 หรือ `/ui/console` (design non-negotiable — status doc §4)
- **PAT / token / password ห้าม commit หรือจดลงเอกสาร** — อยู่ได้แค่ `.env` บนเซิร์ฟเวอร์
- Access token TTL = **10 นาที** (design spec §10)
- **ห้าม copy `docker-compose.yml` จาก repo ทับทั้งไฟล์บนเซิร์ฟเวอร์** — TLS env บนเซิร์ฟเวอร์ต่างจาก repo (`ZITADEL_TLS_ENABLED=false`, cert อยู่ที่ nginx) ให้เพิ่มเฉพาะ block `login`
- claims เข้าเฉพาะ **token ที่ออกใหม่** — เปลี่ยนสิทธิ์/provision แล้วต้อง login ใหม่เสมอ (incognito กัน session ค้าง)
- ค่าที่ต้องหยิบจาก Console (ไม่อยู่ใน repo): `<CLIENT_ID>` ของ OIDC app ทดสอบ (Console → Project → Application)
- ทุก Zitadel login ที่เทส ให้ใช้ **incognito window** — session cookie ค้างทำให้ได้ user ผิด (บทเรียน #9 ใน status doc §2)

---

### Task 1: Commit ร่าง Login V2 + docs ที่แก้ไว้

งานที่ร่างค้างใน working tree (compose service `login`, `.env.example`, docs 4 ไฟล์) ยังไม่ commit

**Files:**
- Modify (มีอยู่แล้วใน working tree): `docker-compose.yml`, `.env.example`, `docs/PRETEST-PHASE1-STATUS-AND-ESIGN-PLAN.md`, `docs/PRETEST-AUTH-DEPLOYMENT.md`, `docs/PHASE1-PRETEST-RUNBOOK.md`, `docs/LOGIN-E2E-TEST.md`
- Create (ไฟล์นี้เอง): `docs/superpowers/plans/2026-07-16-central-login-v2-and-stage4.md`

**Interfaces:**
- Produces: compose service `login` (profile `"login"`, image `ghcr.io/zitadel/zitadel-login:v4.16.0`, env `ZITADEL_API_URL`, `ZITADEL_SERVICE_USER_TOKEN=${LOGIN_CLIENT_PAT:-}`) — Task 4 ใช้ block นี้บนเซิร์ฟเวอร์

- [ ] **Step 1: [local] ตรวจว่า compose ยัง valid และ diff ตรงที่ตั้งใจ**

Run: `docker compose config --quiet && echo OK && git status --short`
Expected: `OK` + รายการไฟล์ modified 6 ไฟล์ + ไฟล์แผนใหม่ (ไม่มีไฟล์แปลกปลอม, ไม่มี secret)

- [ ] **Step 2: [local] Commit**

```bash
git add docker-compose.yml .env.example docs/
git commit -m "feat: draft Login V2 central login service + update pretest docs

- compose: service login (profile \"login\") ghcr.io/zitadel/zitadel-login:v4.16.0
- plan docs: central login (Login V2) เป็นทางหลัก V1 แทน embed ใน eSign
- fix ports entitlement 3000→3020, module enable ใช้ API แทน SQL ตรง

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

Expected: commit ผ่าน, `git status` clean

---

### Task 2: Stage 4 — Tenant user เต็มระบบ (ปิด claims pipeline ครบทุกเคส)

พิสูจน์เส้น invite → login → claims แบบ grants ต่อ company (ตาม `docs/LOGIN-E2E-TEST.md` Stage 4)

**Files:**
- อ้างอิง: `docs/LOGIN-E2E-TEST.md` (Stage 4), `entitlement/src/modules/*/route.ts` (สัญญา API ด้านล่างตรวจกับ source แล้ว)
- Modify (หลังผ่าน): `docs/LOGIN-E2E-TEST.md` (บันทึกผล), `docs/PHASE1-PRETEST-RUNBOOK.md` (เช็คลิสต์)

**Interfaces (entitlement API — superadmin JWT เท่านั้น, ตรวจกับ source แล้ว):**
- `POST /tenants` body `{name: string, slug: string}` → tenant row `{id, name, slug, zitadelOrgId, ...}` (สร้าง Zitadel org ให้ + เปิด module `core` อัตโนมัติ)
- `POST /companies` body `{tenantId: number, name: string}` → company row `{id, tenantId, name, ...}`
- `PUT /modules/tenants/{tenantId}/esign` body `{"enabled":true}` → `{ok: true}`
- `POST /users/invite` body `{tenantId, email, companyIds: number[], roleSlugs: string[]}` → user row `{id, zitadelUserId, tenantId, email, ...}` (สร้าง Zitadel human user ให้ด้วย)
- role slugs ที่ seed ไว้: `group_admin`, `company_admin` (ทั้งคู่ grantAll → permissions `["*"]`)

- [ ] **Step 1: [local] เอา superadmin access token สดๆ**

Run: `python3 scripts/oidc-pkce-test.py <CLIENT_ID>` → login ด้วย admin user (incognito)
Expected: exit 0, token มี `"urn:platform:role": "superadmin"` — copy access token ไว้เป็น `$T` บนเซิร์ฟเวอร์ (อายุ token จำกัด — ทำ Step 2–5 ให้จบในรอบเดียว, หมดอายุก็รันซ้ำ)

- [ ] **Step 2: [server] สร้าง tenant**

```bash
T="<access token จาก Step 1>"
curl -s -X POST localhost:3020/tenants -H "Authorization: Bearer $T" -H "Content-Type: application/json" \
  -d '{"name":"EDM Test","slug":"edm-test"}'
```

Expected: JSON มี `"id"` (จดเป็น `<TENANT_ID>`) และ `"zitadelOrgId"` ไม่ว่าง — เช็คใน Console ว่ามี org "EDM Test" โผล่
ถ้า 401 → token หมดอายุ/ไม่ใช่ superadmin; ถ้า 500 → ดู `docker compose logs entitlement` (มักเป็น `ZITADEL_MGMT_TOKEN` ใช้ไม่ได้)

- [ ] **Step 3: [server] สร้าง company**

```bash
curl -s -X POST localhost:3020/companies -H "Authorization: Bearer $T" -H "Content-Type: application/json" \
  -d '{"tenantId":<TENANT_ID>,"name":"บริษัท A"}'
```

Expected: JSON มี `"id"` (จดเป็น `<COMPANY_ID>`)

- [ ] **Step 4: [server] เปิด module esign**

```bash
curl -s -X PUT localhost:3020/modules/tenants/<TENANT_ID>/esign \
  -H "Authorization: Bearer $T" -H "Content-Type: application/json" -d '{"enabled":true}'
```

Expected: `{"ok":true}` (404 = ยังไม่ได้ seed module `esign` → `docker compose logs entitlement | grep -i seed`)

- [ ] **Step 5: [server] invite test user**

```bash
curl -s -X POST localhost:3020/users/invite -H "Authorization: Bearer $T" -H "Content-Type: application/json" \
  -d '{"tenantId":<TENANT_ID>,"email":"test-user@edmcompany.co.th","companyIds":[<COMPANY_ID>],"roleSlugs":["company_admin"]}'
```

Expected: JSON user row มี `"zitadelUserId"` — Console ต้องเห็น human user ใหม่ใน org "EDM Test"

- [ ] **Step 6: [local] login ด้วย test user → เช็ค claims เต็ม**

Run: `python3 scripts/oidc-pkce-test.py <CLIENT_ID>` (incognito) → login `test-user@edmcompany.co.th` → ตั้งรหัสครั้งแรกตาม flow Zitadel
Expected: exit 0 และ claims มีครบ:

```json
"urn:platform:tenantId": <TENANT_ID>,
"urn:platform:companies": [<COMPANY_ID>],
"urn:platform:modules": ["core", "esign"],
"urn:platform:grants": { "<COMPANY_ID>": { "roles": ["company_admin"], "permissions": ["*"] } }
```

(รูปทรงตรวจกับ `entitlement/src/claims/resolver.ts` แล้ว: `grants[companyId] = {roles, permissions}`; `company_admin` เป็น grantAll → permissions = `["*"]`; `modules` มี `core` ติดมาจากตอนสร้าง tenant เสมอ)

- [ ] **Step 7: [local] บันทึกผล + commit**

แก้ `docs/LOGIN-E2E-TEST.md` บรรทัดหัว (`> อัปเดตล่าสุด:`) เป็น "Stage 0–4 ผ่านครบ <วันที่จริง>" + ติ๊กเช็คลิสต์ "ปิด Phase 1" ใน `docs/PHASE1-PRETEST-RUNBOOK.md` ข้อ `oidc-pkce-test.py เห็น claims ครบ`

```bash
git add docs/LOGIN-E2E-TEST.md docs/PHASE1-PRETEST-RUNBOOK.md
git commit -m "docs: pretest stage 4 ผ่าน — tenant user claims + grants ครบ

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Token lifetime policy

**Files:**
- Modify (หลังผ่าน): `docs/PHASE1-PRETEST-RUNBOOK.md` (ติ๊กเช็คลิสต์ TTL), `docs/PRETEST-AUTH-DEPLOYMENT.md` (ย้ายออกจาก "ยังไม่เสร็จ")

- [ ] **Step 1: [console] ตั้ง lifetimes**

Console → Default settings (instance) → **OIDC token lifetimes**: Access Token = **10 นาที** (ค่าหลักคุม staleness ของสิทธิ์), Refresh Token idle = 30 วัน, absolute = 90 วัน

- [ ] **Step 2: [local] verify จาก token จริง**

Run: `python3 scripts/oidc-pkce-test.py <CLIENT_ID>` → login ใครก็ได้ → decode access token (สคริปต์พิมพ์ payload)
Expected: `exp - iat = 600`

- [ ] **Step 3: [local] ติ๊กเช็คลิสต์ 2 ไฟล์ + commit**

```bash
git add docs/PHASE1-PRETEST-RUNBOOK.md docs/PRETEST-AUTH-DEPLOYMENT.md
git commit -m "docs: access token TTL 10m + refresh policy ตั้งแล้วบน pre-test

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Login V2 demo บน pre-test (หน้า login กลาง)

**Files:**
- อ้างอิง: `docker-compose.yml` (block `login` จาก Task 1), `docs/PRETEST-AUTH-DEPLOYMENT.md` (nginx block), `.env.example` (`LOGIN_CLIENT_PAT`)
- Modify (หลังผ่าน): `docs/PRETEST-AUTH-DEPLOYMENT.md`, `docs/PRETEST-PHASE1-STATUS-AND-ESIGN-PLAN.md` §1

**Interfaces:**
- Consumes: compose block `login` จาก Task 1 (คัดลอกเฉพาะ block ไปเพิ่มบนเซิร์ฟเวอร์ — ดู Global Constraints)
- Produces: หน้า login กลางที่ `https://authservice.edmcompany.co.th/ui/v2/login` — แผน production/branding แยกไปแผนหน้า

- [ ] **Step 1: [console] สร้าง Service Account + PAT บทบาท IAM_LOGIN_CLIENT**

Console → Users → Service Users → New (เช่น username `login-client`) → Memberships → Add → scope **Instance** → role **IAM_LOGIN_CLIENT** → แท็บ Personal Access Tokens → New → copy (โชว์ครั้งเดียว)
**PAT นี้ลง `.env` บนเซิร์ฟเวอร์เท่านั้น** — คนละตัวกับ PAT ops (IAM_OWNER)

- [ ] **Step 2: [server] เพิ่ม env + compose block + start**

1. `.env` เพิ่มบรรทัด: `LOGIN_CLIENT_PAT=<PAT จาก Step 1>`
2. `docker-compose.yml` บนเซิร์ฟเวอร์ เพิ่มเฉพาะ block นี้ใต้ `services:` (**ห้าม copy ทั้งไฟล์จาก repo ทับ**):

```yaml
  login:
    image: ghcr.io/zitadel/zitadel-login:v4.16.0
    profiles: ["login"]
    environment:
      ZITADEL_API_URL: https://${ZITADEL_EXTERNALDOMAIN}
      ZITADEL_SERVICE_USER_TOKEN: ${LOGIN_CLIENT_PAT:-}
    restart: unless-stopped
    expose:
      - "3000"
    networks:
      - default
      - proxy
```

3. Run: `docker compose --profile login up -d login && docker compose logs login | tail -20`
Expected: log Next.js ขึ้น `Ready`/listening บน 3000 — ไม่มี error เรื่อง token (ถ้ามี = PAT ผิด/ไม่ใช่ IAM_LOGIN_CLIENT)

- [ ] **Step 3: [server] เพิ่ม nginx route + reload**

เพิ่มใน server block ของ `authservice.edmcompany.co.th` **ก่อน** `location /` (block เต็มอยู่ใน `docs/PRETEST-AUTH-DEPLOYMENT.md` § nginx route):

```nginx
    location /ui/v2/login {
        proxy_pass http://login:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-Host $host;
    }
```

Run: `docker exec <nginx-container> nginx -t && docker exec <nginx-container> nginx -s reload`
Expected: `syntax is ok` / `test is successful`
Verify: `curl -s -o /dev/null -w "%{http_code}\n" https://authservice.edmcompany.co.th/ui/v2/login` → `200` (หรือ 30x — ไม่ใช่ 502; 502 = nginx หา `login:3000` ไม่เจอ → เช็คว่า login อยู่ใน network `proxy`)

- [ ] **Step 4: [console] เปิด new login UI ที่ app ทดสอบ**

Console → Project → Application (ตัวที่ใช้ `<CLIENT_ID>`) → Login UI settings → เปิด **Use new login UI** (Custom base URL เว้นว่าง = ใช้ `/ui/v2/login` บน external domain)

- [ ] **Step 5: [local] E2E ผ่านหน้า login กลาง**

Run: `python3 scripts/oidc-pkce-test.py <CLIENT_ID>` (incognito)
Expected: browser ไปหน้า **`/ui/v2/login`** (ดู URL bar — ต้องไม่ใช่ `/ui/login`) → login test user จาก Task 2 → exit 0, claims ครบเหมือน Task 2 Step 6 ทุก field

**Rollback ถ้าหน้าใหม่มีปัญหา:** ปิด toggle "Use new login UI" ที่ app → กลับ V1 ทันที ไม่กระทบอะไร

- [ ] **Step 6: [local] อัปเดต docs + commit**

1. `docs/PRETEST-AUTH-DEPLOYMENT.md` — ย้ายข้อ Login V2 ออกจาก "ยังไม่เสร็จ" ไปเพิ่มใน "สิ่งที่ verify แล้วบน pre-test" (หนึ่งบรรทัด: Login V2 ที่ `/ui/v2/login` ผ่าน e2e)
2. `docs/PRETEST-PHASE1-STATUS-AND-ESIGN-PLAN.md` §1 — เพิ่มแถวตาราง: `| Login V2 container (หน้า login กลาง demo) | ✅ | docker-compose.yml (profile login), deployment doc |`

```bash
git add docs/PRETEST-AUTH-DEPLOYMENT.md docs/PRETEST-PHASE1-STATUS-AND-ESIGN-PLAN.md
git commit -m "docs: Login V2 demo ผ่านบน pre-test — หน้า login กลางแทน /ui/login

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: แจ้งทีม eSign (handoff — ปิดงานฝั่งเรา)

**Files:**
- อ้างอิง: `docs/API-INTEGRATION.md`, `docs/PACKAGE-DISTRIBUTION.md`, `docs/PRETEST-PHASE1-STATUS-AND-ESIGN-PLAN.md` §5 (ตารางฝั่งแอปลูก)

- [ ] **Step 1: [local] ร่างข้อความ handoff ส่งทีม eSign** — เนื้อหาตามนี้ (ค่าจริงเติมจาก Console):

> ฝั่ง auth พร้อมแล้ว — eSign ทำแค่ OIDC client (ไม่ต้องทำหน้า login / Session API / ไม่มี PAT):
> 1. Redirect ไป authorize + PKCE → user จะเจอหน้า login กลางของเรา แล้วเด้งกลับ `/callback` ของ eSign
> 2. `/callback` แลก code → access JWT มี `urn:platform:*` — verify ด้วย `@platform/auth` (คู่มือ: `docs/API-INTEGRATION.md`, แพ็กเกจ: `docs/PACKAGE-DISTRIBUTION.md`)
> 3. Config: issuer `https://authservice.edmcompany.co.th`, Client ID `<CLIENT_ID ของ app eSign>`, JWKS `/oauth/v2/keys`
> 4. ขอ redirect URIs ทุก env (dev/pre-test/prod) ส่งกลับมา เราจะลงทะเบียนให้
> 5. User ไม่มี `urn:platform:*` = ยังไม่ provision → แสดง "ยังไม่ได้รับสิทธิ์" ห้าม crash/ห้ามลิงก์ Console

- [ ] **Step 2: ส่งข้อความ + รอ redirect URIs กลับมา** → พอได้แล้วลงทะเบียนใน Console (app eSign) — จบ scope แผนนี้

---

## นอก scope แผนนี้ (แผนถัดไปเมื่อถึงเวลา)

- **Production login domain**: `login.edmcompany.co.th` — Cloudflare hostname ใหม่ + nginx server block + Trusted Domain + Custom base URL ต่อ app
- **Branding fork Login V2**: fork repo login ของ Zitadel ใส่ logo/สี/copy ไทย + build image เอง (แทน image official)
- **Mobile**: app type Native + deep link redirect URI + `offline_access` (สรุปไว้ในบทสนทนา 2026-07-16 — ไม่มีงานฝั่ง auth เพิ่มตอนนี้)
- **Portal กลาง**: OIDC client ใหม่ + UI จัดการ tenant/user (มีแผน per-company role management แยกอยู่แล้ว)
