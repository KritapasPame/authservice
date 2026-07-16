# Pre-test Phase 1 — สรุปสิ่งที่ setup แล้ว + แผน eSign (หน้ากาก custom)

> อัปเดต: 2026-07-16  
> Environment: `https://authservice.edmcompany.co.th`  
> เป้าหมายถัดไป: **end user ไม่เห็น Zitadel Console / open-source UI** — เห็นแค่หน้ากาก eSign; auth ทำงานผ่าน OIDC/API หลังบ้าน

---

## 1. สิ่งที่ setup ครบแล้ว (Phase 1 infra)

| หัวข้อ | สถานะ | อ้างอิง |
|--------|--------|---------|
| Zitadel v4.16.0 + Postgres + nginx + Cloudflare | ✅ | `docker-compose.yml`, `docs/PRETEST-AUTH-DEPLOYMENT.md` |
| Entitlement ใน Docker (`entitlement:3000`, host `:3020`) | ✅ | `docker-compose.yml`, `entitlement/Dockerfile` |
| DB `entitlement` migrate + seed | ✅ | `entitlement/src/db/` |
| Service Account + PAT (IAM_OWNER) | ✅ | `zitadel/docker-init.md` §3, pre-test setup §2 |
| Actions v2 target `entitlement-token-claims` | ✅ | `zitadel/actions/token-claims.md`, `scripts/setup-zitadel-action.sh` |
| Execution `preaccesstoken` → entitlement | ✅ | [Zitadel Actions v2](https://zitadel.com/docs/apis/actions/introduction) |
| `ZITADEL_HTTPCLIENT_DENYLIST` บน zitadel container | ✅ | §2 #5–6; Zitadel outbound HTTP policy |
| `ZITADEL_ACTIONS_SIGNING_KEY` ใน entitlement | ✅ | `zitadel/actions/token-claims.md` |
| OIDC app Access Token Type = **JWT** | ✅ | `zitadel/docker-init.md` §4 |
| Custom claims e2e (`urn:platform:*`) | ✅ | `scripts/oidc-pkce-test.py`, design spec §5 |
| `@platform/auth` package + runbook distribute | ✅ | `docs/PACKAGE-DISTRIBUTION.md` |

**หลักการ architecture (ไม่เปลี่ยน):**

- **Zitadel** = ชั้น credential (login, MFA, OIDC, token) — user **ไม่** ใช้ Console
- **Entitlement** = ชั้น business (tenant, role, grants) — inject claims ตอนออก token
- **eSign / แอปลูก** = หน้ากากที่ user เห็น + verify JWT ด้วย JWKS

---

## 2. เคส/ปัญหาที่เจอระหว่าง setup (และวิธีแก)

| # | อาการ | สาเหตุ | วิธีแก |
|---|--------|--------|--------|
| 1 | `setup-zitadel-action.sh` หยุดที่ `== 1/2` เงียบๆ | `curl -sf` fail ไม่โชว์ error | รัน curl ไม่ใส่ `-sf`; ดู HTTP code |
| 2 | `Authorization: Bearer` ว่าง | ไม่ได้ `export ZITADEL_PAT` | `export ZITADEL_PAT='...'` ก่อนรัน |
| 3 | POST target **403** | Service account มีแค่ **Org Owner** | ต้อง **IAM_OWNER** (instance) + PAT ใหม่ |
| 4 | POST target **409** | target ชื่อซ้ำ | ใช้ `targets/search` + bind execution ต่อ หรือ DELETE ด้วย ID จริง |
| 5 | `grep DENYLIST` ว่าง | compose บน server ยังไม่มี env | เพิ่ม `ZITADEL_HTTPCLIENT_DENYLIST` + `--force-recreate zitadel` |
| 6 | entitlement ไม่ได้รับ POST | denylist / JWT opaque / execution ไม่ bind | แก้ denylist, ตั้ง JWT, bind execution, signing key เต็ม |
| 7 | signing key สั้นเกินไป | copy ไม่ครบจาก API | เอา `signingKey` เต็มจาก `targets/search` |
| 8 | `(none)` claims แต่ login ได้ | `sub` ไม่ตรง `platform_admins` / ไม่ provision | insert ด้วย **`sub` ของ user ที่ login จริง** |
| 9 | ไม่ขึ้นหน้า login / ได้ zitadel-admin ตลอด | session cookie ค้าง | incognito หรือ `prompt=login`; login human user แยกจาก bootstrap admin |
| 10 | `Errors.App.NotFound` | Client ID ผิด / redirect URI ไม่ลงทะเบียน | copy Client ID จาก Console + ใส่ `http://127.0.0.1:8787/callback` |

---

## 3. สิ่งที่ operator ใช้ vs end user ใช้ (สำคัญ)

| ใคร | URL / หน้า | ห้าม/ควร |
|-----|------------|----------|
| **ทีม ops / dev** | `/ui/console` | ตั้งค่า PAT, app, user — **ไม่ให้ลูกค้าเข้า** |
| **End user** | ไม่เปิด authservice โดยตรง | เข้าผ่าน **eSign** เท่านั้น |
| **End user** | หน้า login ของ **eSign เท่านั้น** | **ห้าม** redirect ไป `/ui/login` หรือหน้า Zitadel ใดๆ — ดู §4 |

Bootstrap `zitadel-admin@...` ใช้ทด wiring ได้ — **ไม่ใช่** user demo ให้ stakeholder

---

## 4. แผน eSign — Custom Login V1 (บังคับ)

### ข้อกำหนด (non-negotiable)

- **Login V1 ของ Zitadel เปลี่ยน logo ได้จำกัด** — ไม่ใช่หน้ากากของบริษัท
- **ห้าม** ให้ end user เห็น `/ui/login`, Console, หรือ UI open-source ของ Zitadel แม้ชั่วครู่
- **V1 ต้องเป็น custom login ของ eSign 100%** — Zitadel อยู่หลังบ้านเท่านั้น (credential + OIDC + claims)

> แนวทางเดิม "redirect OIDC แล้ว flash หน้า Zitadel login" **ยกเลิก** — ไม่ใช้

### หลักการที่ยึด

1. **ไม่ให้ user เข้า Console / ไม่ bookmark authservice**
2. **Credential ยังอยู่ที่ Zitadel** (Session API) — eSign **ไม่เก็บรหัสผ่านถาวร**
3. **eSign เป็น OIDC client + เป็น Custom Login UI** — verify JWT ด้วย `@platform/auth`
4. **UI ที่ user เห็นทั้งหมด = eSign** (logo, สี, copy, forgot password, MFA)

### ทางเลือกที่ใช้ได้ (V1)

| ทาง | User เห็นอะไร | แนะนำ |
|-----|----------------|-------|
| **A. eSign Custom Login + Session API** | หน้า `/login` บนโดเมน eSign เท่านั้น | **✅ V1 — ใช้ทางนี้** |
| B. Self-host Login V2 (fork Next.js ของ Zitadel) | หน้า `login.edmcompany.co.th` แยกจาก eSign | สำรอง — ถ้าไม่อยาก implement Session API ใน eSign |
| ~~C. Branding บน hosted Login V1~~ | ยังเป็นหน้า Zitadel | **❌ ไม่ใช้** |
| ~~D. OIDC redirect ไป `/ui/login`~~ | flash หน้า IdP | **❌ ไม่ใช้** |

---

### Phase A — Custom Login บน eSign (V1)

**User เห็น:** หน้า login/register/forgot-password ของ eSign เท่านั้น — ไม่มี redirect ไป authservice UI

**Flow (OIDC + Custom Login UI ตาม [Zitadel docs](https://zitadel.com/docs/guides/integrate/login-ui/oidc-standard)):**

```text
eSign (unauthenticated)
  → browser redirect ไป https://authservice.../oauth/v2/authorize?...&PKCE
  → Zitadel parse auth request (ไม่แสดง UI)
  → 302 กลับ eSign: /login?authRequest=V2_xxx   ← ตั้ง Custom Login URL ใน OIDC app
  → eSign แสดงฟอร์ม login ของตัวเอง (100% branding)
  → eSign backend (server-side, ถือ PAT ของ IAM_LOGIN_CLIENT):
       GET  /v2/oidc/auth_requests/{id}
       POST /v2/sessions  (username + password / WebAuthn ตาม policy)
       POST /v2/oidc/auth_requests/{id}  finalize ด้วย sessionToken
  → redirect browser ไป callbackUrl (มี authorization code)
  → eSign /callback แลก code → token ที่ /oauth/v2/token (PKCE)
  → access JWT มี urn:platform:* จาก entitlement (เหมือนที่ทดแล้ว)
```

**สิ่งสำคัญ:** Browser **ไม่เคย** เปิด `/ui/login` — authorize endpoint ส่ง user กลับมาที่ eSign ทันที

**งาน eSign (frontend + backend):**

- [ ] หน้า `/login?authRequest=...` — UI 100% ของ eSign (ไม่มีลิงก์ไป Console)
- [ ] Backend route ที่เรียก Zitadel **Session API v2** + finalize auth request (PAT เก็บ server-side เท่านั้น)
- [ ] หน้า `/callback` — แลก code + PKCE verifier → session ของ eSign
- [ ] (Optional แต่แนะนำ) proxy OIDC endpoints บางตัวถ้าต้องการ issuer เดียวกับ login domain — ไม่บังคับถ้า token แลกตรง authservice
- [ ] env: `ZITADEL_ISSUER`, Client ID, redirect URIs, **`ZITADEL_LOGIN_CLIENT_PAT`** (IAM_LOGIN_CLIENT)
- [ ] ใช้ `@platform/auth` ฝั่ง API — `can()`, `hasModule()`, grants ต่อ company
- [ ] แจ้งทีม Auth: redirect URIs + Custom Login base URL + ค่า `aud` หลัง login ครั้งแรก

**งาน Auth (ops):**

- [ ] สร้าง Service Account + PAT บทบาท **`IAM_LOGIN_CLIENT`** (แยกจาก PAT ops ที่เป็น IAM_OWNER)
- [ ] OIDC app eSign: ตั้ง **Custom Login URL** = origin ของ eSign (เช่น `https://esign.edmcompany.co.th`)
- [ ] ลงทะเบียน redirect URI ของ eSign (dev/staging/prod)
- [ ] ยืนยัน auth request redirect ไป eSign ไม่ไป `/ui/login` (ทดด้วย authorize URL ใน browser)
- [ ] ส่ง eSign: Client ID, issuer, JWKS, login-client PAT (secure channel), `@platform/auth`

**ไม่ทำ:**

- ส่ง username/password จาก browser ตรงไป Zitadel โดยไม่มี server (PAT ห้ามอยู่ frontend)
- ROPC / resource-owner password grant
- ให้ user เข้า `/ui/console` หรือ `/ui/login`

**อ้างอิง API (Zitadel official):**

| หัวข้อ | URL |
|--------|-----|
| Custom Login + OIDC auth request flow | https://zitadel.com/docs/guides/integrate/login-ui/oidc-standard |
| Username/password ผ่าน Session API | https://zitadel.com/docs/guides/integrate/login-ui/username-password |
| Session validation / MFA / Passkey (Phase 3–4) | https://zitadel.com/docs/guides/integrate/login-ui |
| IAM_LOGIN_CLIENT + PAT | https://zitadel.com/docs/self-hosting/manage/login-client |
| Application: Login V2 per-app + Custom base URL | https://zitadel.com/docs/guides/manage/console/applications-overview |
| Hosted Login V2 (ทางสำรอง Phase C) | https://zitadel.com/docs/guides/integrate/login/hosted-login |

**อ้างอิงใน repo นี้:**

| หัวข้อ | ไฟล์ |
|--------|------|
| Architecture + login flow design | `docs/superpowers/specs/2026-07-14-auth-service-design.md` §5 |
| คู่มือ integrate สำหรับ eSign | `docs/API-INTEGRATION.md` §2a |
| Custom claims (Actions v2) | `zitadel/actions/token-claims.md` |
| Instance ใช้ legacy Login V1 container (ไม่ deploy Login V2 app) | `docker-compose.yml` (`LOGINV2_REQUIRED=false`), `zitadel/docker-init.md` |
| ทด OIDC + claims e2e | `scripts/oidc-pkce-test.py` |

---

## 5. Phase ถัดไป — ลำดับงาน 1–4 (Zitadel vs eSign)

> **หมายเหตุ instance ปัจจุบัน:** compose ตั้ง `ZITADEL_DEFAULTINSTANCE_FEATURES_LOGINV2_REQUIRED=false` — ยังไม่ deploy container Login V2 ของ Zitadel แต่ **per-application** เปิด "Use new login UI" + Custom base URL ชี้ eSign ได้ (Session API flow) ตาม [Applications overview](https://zitadel.com/docs/guides/manage/console/applications-overview)

---

### Phase 1 — Custom Login MVP (บังคับ V1)

**เป้าหมาย:** User login บนหน้า eSign เท่านั้น → ได้ JWT พร้อม `urn:platform:*` — **ไม่เห็น** `/ui/login`

#### ฝั่ง Zitadel (ทีม Auth) — 1, 2, 3, 4

| # | งาน | รายละเอียด | อ้างอิง |
|---|------|------------|---------|
| **1** | สร้าง Service Account **`IAM_LOGIN_CLIENT`** + PAT | Machine user ใหม่ แยกจาก PAT ops (`IAM_OWNER`) → grant บทบาท **Instance Login Client** → สร้าง PAT เก็บไฟล์/ส่ง eSign ทางช่องทางปลอดภัย | [Connect self-hosted Login UI](https://zitadel.com/docs/self-hosting/manage/login-client) |
| **2** | ตั้ง OIDC app eSign — Login UI + Custom base URL | Console → Project → Application eSign → เปิด **Use new login UI** → **Custom base URL** = origin eSign (เช่น `https://esign.edmcompany.co.th`) — *ไม่* ใช้ `/ui/login` V1 | [Applications — Use New Login UI](https://zitadel.com/docs/guides/manage/console/applications-overview) |
| **3** | ลงทะเบียน Redirect URI + Post-logout URI | ทุก env ที่ eSign แจ้ง (local / pre-test / prod) — Auth method = Authorization Code + **PKCE**, Access Token Type = **JWT** (ตั้งแล้ว) | [OIDC authorize](https://zitadel.com/docs/guides/integrate/login-ui/oidc-standard), repo: `zitadel/docker-init.md` §4 |
| **4** | Smoke test redirect + ส่ง config ให้ eSign | เปิด authorize URL ใน browser → ต้องไป `https://esign.../login?authRequest=V2_...` **ไม่ใช่** `/ui/login` → ส่ง Client ID, issuer, JWKS URL, login-client PAT, `@platform/auth` | [Get Auth Request By ID](https://zitadel.com/docs/guides/integrate/login-ui/oidc-standard) |

**Zitadel API ที่ eSign backend จะเรียก (Auth ไม่ต้องเปิด endpoint เพิ่ม — ใช้ของ Zitadel โดยตรง):**

| Endpoint | ใช้เมื่อ |
|----------|----------|
| `GET /v2/oidc/auth_requests/{id}` | อ่าน clientId, scope, redirectUri จาก authRequest |
| `POST /v2/sessions` + `PATCH /v2/sessions/{id}` | ตรวจ username + password |
| `POST /v2/oidc/auth_requests/{id}` | finalize ด้วย sessionId + sessionToken → ได้ callbackUrl |
| `POST /oauth/v2/token` | แลก code + PKCE (จาก eSign `/callback`) |

#### ฝั่ง eSign — 1, 2, 3, 4

| # | งาน | รายละเอียด | อ้างอิง |
|---|------|------------|---------|
| **1** | หน้า **`/login?authRequest=...`** | UI 100% branding eSign — รับ query `authRequest` หลัง redirect จาก authorize | [OIDC in Custom Login UI](https://zitadel.com/docs/guides/integrate/login-ui/oidc-standard) |
| **2** | **Backend** Session API (ถือ PAT server-side) | `GET auth_requests` → `POST/PATCH sessions` (password) → `POST finalize` → redirect browser ไป `callbackUrl` | [Username & Password](https://zitadel.com/docs/guides/integrate/login-ui/username-password), env: `ZITADEL_LOGIN_CLIENT_PAT` ใน `docs/API-INTEGRATION.md` |
| **3** | หน้า **`/callback`** + PKCE | เก็บ `code_verifier` ตั้งแต่เริ่ม authorize → แลก token ที่ issuer → เก็บ session แอpp | [OIDC discovery](https://authservice.edmcompany.co.th/.well-known/openid-configuration), repo: `scripts/oidc-pkce-test.py` |
| **4** | อ่าน claims + UX ไม่มีสิทธิ์ | ใช้ `@platform/auth` — ถ้าไม่มี `urn:platform:*` แสดง "ยังไม่ได้รับสิทธิ์" — **ไม่** ลิงก์ `/ui/console` | repo: `docs/API-INTEGRATION.md` §4, `docs/PACKAGE-DISTRIBUTION.md` |

**ส่งกลับทีม Auth ก่อนปิด Phase 1:** Redirect URIs, Custom Login base URL, ค่า `aud` จาก JWT ครั้งแรก

---

### Phase 2 — Token policy + logout + ทดสิทธิ์จริง

**เป้าหมาย:** Production-like session — token หมดอายุถูกต้อง, logout ได้, ทด user ที่ provision ใน entitlement

#### ฝั่ง Zitadel — 1, 2, 3, 4

| # | งาน | รายละเอียด | อ้างอิง |
|---|------|------------|---------|
| **1** | Access token TTL **10 นาที** | Console → Token Settings (app หรือ instance) | repo: `zitadel/docker-init.md` §5, design spec §10 |
| **2** | Refresh token policy | เปิด `offline_access` scope ถ้า eSign ต้องการ refresh — กำหนด rotation/reuse | [OIDC token endpoint](https://authservice.edmcompany.co.th/.well-known/openid-configuration) |
| **3** | Post-logout redirect URI | ลงทะเบียน URI ที่ eSign ใช้ logout | [Logout in Custom Login UI](https://zitadel.com/docs/guides/integrate/login-ui/logout) |
| **4** | ทด human user + provision DB | Incognito login superadmin — ยืนยัน `sub` ตรง `platform_admins`; สร้าง test tenant user ใน entitlement | repo: §2 ของเอกสารนี้ (#8, #9), `entitlement` seed |

#### ฝั่ง eSign — 1, 2, 3, 4

| # | งาน | รายละเอียด | อ้างอิง |
|---|------|------------|---------|
| **1** | ติด **`@platform/auth`** ทุก API route | verify JWT offline — `can()`, `hasModule()`, grants ต่อ company | repo: `docs/API-INTEGRATION.md` §3–4 |
| **2** | Refresh token flow | ก่อน access token หมดอายุ → เรียก `/oauth/v2/token` grant `refresh_token` | OIDC standard |
| **3** | Logout | ล้าง app session + redirect `/oidc/v1/end_session` (proxy หรือ redirect ตรง authservice) | [Logout](https://zitadel.com/docs/guides/integrate/login-ui/logout) |
| **4** | Error states | wrong password, expired authRequest, network fail — ข้อความภาษาไทยบนหน้า eSign ไม่ expose Zitadel UI | UX ภายใน eSign |

---

### Phase 3 — MFA + Forgot password + Register/Invite

**เป้าหมาย:** ครบ lifecycle บนหน้า eSign — ยังไม่ redirect ไป IdP

#### ฝั่ง Zitadel — 1, 2, 3, 4

| # | งาน | รายละเอียด | อ้างอิง |
|---|------|------------|---------|
| **1** | เปิด/บังคับ MFA policy | Instance หรือ org login policy — TOTP | [MFA in Custom Login UI](https://zitadel.com/docs/guides/integrate/login-ui/mfa) |
| **2** | SMTP / email templates | verification, password reset email (ถ้าใช้ Zitadel ส่ง) | Zitadel Console → Notifications |
| **3** | Password complexity settings | ให้ eSign อ่าน policy ก่อน validate ฝั่ง UI | [Username & Password — settings](https://zitadel.com/docs/guides/integrate/login-ui/username-password) |
| **4** | User creation API (ถ้า self-register) | สิทธิ์ PAT สำหรับ create human user — หรือ ops สร้างใน Console แล้ว provision entitlement | `POST /v2/users/human` ใน doc เดียวกัน |

#### ฝั่ง eSign — 1, 2, 3, 4

| # | งาน | รายละเอียด | อ้างอิง |
|---|------|------------|---------|
| **1** | Step MFA บน custom login | หลัง password → `PATCH /v2/sessions` เพิ่ม TOTP check ก่อน finalize | [MFA](https://zitadel.com/docs/guides/integrate/login-ui/mfa) |
| **2** | Forgot / reset password UI | เรียก User/Session API หรือ deep link template ที่ branding eSign | [Password Reset](https://zitadel.com/docs/guides/integrate/login-ui/password-reset) |
| **3** | Register หรือ invite-only | ตาม product — หลังสร้าง user ใน Zitadel → webhook/ops provision entitlement | design spec §5, §9 |
| **4** | Account picker (optional) | หลาย session — cookie เก็บ sessionIds + `POST /v2/sessions/search` | [Select Account](https://zitadel.com/docs/guides/integrate/login-ui/select-account) |

---

### Phase 4 — Passkey, Social login, Production hardening

**เป้าหมาย:** Biometric / Google-Apple + พร้อม prod

#### ฝั่ง Zitadel — 1, 2, 3, 4

| # | งาน | รายละเอียด | อ้างอิง |
|---|------|------------|---------|
| **1** | เปิด WebAuthn / Passkey policy | Instance login settings | [Passkey](https://zitadel.com/docs/guides/integrate/login-ui/passkey) |
| **2** | ตั้ง External IdP (Google / Apple) | Console → Identity Providers | [External Login](https://zitadel.com/docs/guides/integrate/login-ui/external-login) |
| **3** | Trusted Domains (ถ้าต้อง proxy OIDC บนโดเมน eSign) | ลงทะเบียน domain ที่ login UI ใช้ | [Login App — trusted domains](https://zitadel.com/docs/guides/integrate/login-ui/login-app) |
| **4** | Monitoring + backup PAT | เก็บ IAM_OWNER PAT สำรองกรณี lockout; audit login จาก Zitadel | [Login client setup — IAM_OWNER backup](https://zitadel.com/docs/self-hosting/manage/login-client) |

#### ฝั่ง eSign — 1, 2, 3, 4

| # | งาน | รายละเอียด | อ้างอิง |
|---|------|------------|---------|
| **1** | ปุ่ม Passkey บนหน้า login | Session API WebAuthn checks — ไม่ redirect IdP | [Passkey](https://zitadel.com/docs/guides/integrate/login-ui/passkey) |
| **2** | ปุ่ม Social login | External IdP flow บน custom UI | [External Login](https://zitadel.com/docs/guides/integrate/login-ui/external-login) |
| **3** | Rate limit / lockout UX | แสดงข้อความเมื่อ Zitadel ตอบ locked / too many attempts | Session API responses |
| **4** | E2E test ทุก env | login → claims → API 403/200 → logout — CI ถ้ามี | repo: `scripts/oidc-pkce-test.py` (adapt สำหรับ custom login) |

---

### ทางสำรอง (ถ้า Phase 1 eSign ล่าช้า) — Login V2 container แยก

| ฝั่ง | งาน | อ้างอิง |
|------|------|---------|
| Zitadel | Deploy Login V2 Next.js + enable instance feature + base URI `login.edmcompany.co.th` | [Login App](https://zitadel.com/docs/guides/integrate/login-ui/login-app), [Hosted Login V2](https://zitadel.com/docs/guides/integrate/login/hosted-login) |
| eSign | ยังเป็น OIDC client — redirect ไป custom login domain แทน implement Session API เอง | §4 Phase C ด้านบน |

---

## 6. Checklist ทีม Auth (ops) — สรุปรวม

- [ ] Phase 1 #1–4 (IAM_LOGIN_CLIENT, Custom base URL, redirect URIs, smoke test)
- [ ] Phase 2 #1–4 (token TTL, refresh, logout URI, human superadmin + provision test user)
- [ ] ทด human `superadmin` + `platform_admins` ตรง `sub` (incognito)
- [ ] Provision test user ใน entitlement (tenant + company + role) → claims แบบ grants
- [ ] อัปเดต `docs/PRETEST-AUTH-DEPLOYMENT.md` — ย้ายรายการ "ยังไม่เสร็จ" ที่ทำแล้ว
- [ ] (Optional) systemd/compose restart policy สำหรับ entitlement + zitadel

---

## 7. Checklist ทีม eSign — สรุปรวม

- [ ] Phase 1 #1–4 (custom login, Session API backend, callback, claims UX)
- [ ] Phase 2 #1–4 (`@platform/auth`, refresh, logout, errors)
- [ ] อ่าน `docs/API-INTEGRATION.md` + ติด `@platform/auth`
- [ ] ส่ง redirect URIs + Custom Login base URL ให้ทีม Auth
- [ ] หลัง login: อ่าน `sub`, `urn:platform:tenantId`, `urn:platform:grants`
- [ ] User ไม่ provision → ไม่มี platform claims → แสดง "ยังไม่ได้รับสิทธิ์" (ไม่ crash)
- [ ] ไม่ลิงก์ไป `/ui/console` ใน UI ใดๆ
- [ ] (Phase 3–4) MFA, forgot password, passkey, social — ตามตาราง §5

---

## 8. สรุป one-liner ให้ stakeholder

> Auth ทำงานแล้วบน pre-test: OIDC + custom claims live  
> V1 บังคับ **eSign custom login** (Session API) — user ไม่เห็นหน้า Zitadel; Zitadel เป็น backend credential + token เท่านั้น

---

## 9. อ้างอิงรวม

### สิ่งที่ setup แล้ว (§1) — ที่มา

| หัวข้อ | อ้างอิง |
|--------|---------|
| Zitadel v4.16 + legacy Login V1 ใน compose | `docker-compose.yml`, `zitadel/docker-init.md` |
| Actions v2 → entitlement claims | `zitadel/actions/token-claims.md`, `scripts/setup-zitadel-action.sh` |
| HTTP client denylist (private IP) | Zitadel self-hosting; แก้ปัญหา Action ยิง `entitlement:3000` ไม่ได้ — บันทึกใน §2 #5–6 |
| Custom claims `urn:platform:*` | design spec §5; ทด `scripts/oidc-pkce-test.py` |
| `@platform/auth` | `docs/PACKAGE-DISTRIBUTION.md` |

### ข้อกำหนด "ห้ามเห็น Zitadel UI" — ที่มา

| ข้อกำหนด | อ้างอิง |
|----------|---------|
| Login V1 branding จำกัด ไม่พอ | ประสบการณ์ pre-test + [Hosted Login](https://zitadel.com/docs/guides/integrate/login/hosted-login) (V2/custom แทน V1) |
| Custom Login UI 100% บน app | [OIDC in Custom Login UI](https://zitadel.com/docs/guides/integrate/login-ui/oidc-standard) |
| Credential ยังอยู่ Zitadel (ไม่ ROPC) | [Username & Password Session API](https://zitadel.com/docs/guides/integrate/login-ui/username-password); design spec §5 |

### เอกสารภายใน repo

- Design: `docs/superpowers/specs/2026-07-14-auth-service-design.md` §5 (Login flow)
- Integration: `docs/API-INTEGRATION.md`
- Actions wiring: `zitadel/actions/token-claims.md`
- Install checklist: `docs/INSTALL-PRETEST-FROM-ZERO.md`
- Pre-test deploy: `docs/PRETEST-AUTH-DEPLOYMENT.md`
