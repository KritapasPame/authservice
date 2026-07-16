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
| **End user** | หน้า **login กลาง** (Login V2 โดเมน/แบรนด์เรา) | **ห้าม** เห็น `/ui/login` V1 หรือ Console — ดู §4 |

Bootstrap `zitadel-admin@...` ใช้ทด wiring ได้ — **ไม่ใช่** user demo ให้ stakeholder

---

## 4. แผน Login กลาง — Self-hosted Login V2 (V1)

> **ตัดสินใจ 2026-07-16: ใช้หน้า login กลาง (self-host Login V2) แทนการฝัง login ในแต่ละแอป**
> เหตุผล: มีหลายแอปในแผน (eSign → portal → HR) — หน้ากลางทำครั้งเดียวได้ SSO ทุกแอป,
> MFA/forgot password/passkey รวมศูนย์, login PAT อยู่ที่เดียว, แอปลูกเหลือแค่ OIDC client
> (redirect + callback) — user ไม่ต้องเข้า portal ก่อน หน้ากลางโผล่เฉพาะตอน login แล้วเด้งกลับแอปเดิม

### ข้อกำหนด (non-negotiable — เดิม)

- **ห้าม** ให้ end user เห็น `/ui/login` (V1), Console, หรือ UI ที่ brand ไม่ได้ของ Zitadel
- **Credential ยังอยู่ที่ Zitadel** — แอปลูกไม่เก็บรหัสผ่าน ไม่ถือ login PAT
- หน้า login กลางอยู่บน**โดเมนเรา** + fork/brand ได้ 100% (logo, สี, copy ภาษาไทย)

### ทางเลือก (อัปเดต 2026-07-16)

| ทาง | User เห็นอะไร | สถานะ |
|-----|----------------|-------|
| **B. Self-host Login V2 — หน้า login กลาง** | `login.edmcompany.co.th` แบรนด์เรา — ทุกแอป redirect มาที่นี่ | **✅ V1 — ใช้ทางนี้** |
| A. Custom Login ฝังใน eSign (Session API) | หน้า `/login` บนโดเมน eSign | สำรอง — ถ้า Login V2 ติดข้อจำกัด branding/feature |
| ~~C. Branding บน hosted Login V1~~ | ยังเป็นหน้า Zitadel | **❌ ไม่ใช้** |
| ~~D. OIDC redirect ไป `/ui/login`~~ | flash หน้า IdP | **❌ ไม่ใช้** |

---

### Flow (หน้า login กลาง)

```text
แอปลูก (eSign / portal) unauthenticated
  → browser redirect ไป https://authservice.../oauth/v2/authorize?...&PKCE
  → Zitadel ส่งต่อไปหน้า login กลาง (Login V2 — โดเมน/แบรนด์เรา)
  → user กรอก password (/MFA/passkey ตาม policy) — Login V2 คุย Session API ให้เองทั้งหมด
  → redirect กลับแอปลูก /callback พร้อม authorization code
  → แอปแลก code → token ที่ /oauth/v2/token (PKCE)
  → access JWT มี urn:platform:* จาก entitlement (เหมือนที่ทดแล้ว)
```

**สิ่งสำคัญ:** Browser **ไม่เคย** เปิด `/ui/login` V1 — และแอปลูก**ไม่ต้อง**ทำหน้า login,
ไม่ใช้ Session API, ไม่ถือ PAT ใดๆ — เหลือแค่ authorize redirect + `/callback` + `@platform/auth`

### Deploy Login V2 (container ใหม่ 1 ตัวใน compose เดิม)

| หัวข้อ | ค่า |
|--------|-----|
| Image | `ghcr.io/zitadel/zitadel-login` (pin tag ให้ตรงกับ zitadel v4.16) |
| Port | 3000 (ภายใน compose) |
| env | `ZITADEL_API_URL=https://authservice.edmcompany.co.th`, `ZITADEL_SERVICE_USER_TOKEN` = PAT ของ SA บทบาท **IAM_LOGIN_CLIENT** (หรือ `ZITADEL_SERVICE_USER_TOKEN_FILE` mount เป็นไฟล์) |

**ขั้น demo (เร็วสุด — ไม่ต้องมี DNS/cert ใหม่):** nginx เดิมเพิ่ม route path
`/ui/v2/login` → container login:3000 (base path default ของ Login V2) แล้วเปิด
**"Use new login UI"** ที่ OIDC app ทดสอบใน Console → login ผ่านหน้าใหม่ได้ทันที claims เดิมครบ

**ขั้น production:** ย้ายไป `login.edmcompany.co.th` — ลงทะเบียน **Trusted Domain**
บน instance + https + ตั้ง Custom base URL ที่ app + fork UI ใส่ logo/สี/copy ของเรา

**งาน Auth (ops):**

- [ ] สร้าง Service Account + PAT บทบาท **`IAM_LOGIN_CLIENT`** (แยกจาก PAT ops ที่เป็น IAM_OWNER — เก็บใน compose เท่านั้น ไม่ส่งใคร)
- [ ] เพิ่ม service `login` ใน compose + nginx route (`/ui/v2/login` สำหรับ demo)
- [ ] เปิด "Use new login UI" ที่ OIDC app + ลงทะเบียน redirect URI ของแอปลูก (dev/staging/prod)
- [ ] smoke test: authorize URL → ต้องได้หน้า Login V2 ไม่ใช่ `/ui/login` → login → claims ครบ
- [ ] ส่งแอปลูก: Client ID, issuer, JWKS URL, `@platform/auth` (**ไม่มี PAT** — ไม่ต้องใช้แล้ว)

**งานแอปลูก (eSign / portal):**

- [ ] authorize redirect + PKCE (เก็บ `code_verifier`)
- [ ] หน้า `/callback` — แลก code → session ของแอป
- [ ] ใช้ `@platform/auth` ฝั่ง API — `can()`, `hasModule()`, grants ต่อ company
- [ ] user ไม่มี `urn:platform:*` → แสดง "ยังไม่ได้รับสิทธิ์" (ไม่ crash, ไม่ลิงก์ Console)
- [ ] แจ้งทีม Auth: redirect URIs ทุก env

**ไม่ทำ:**

- ฝังหน้า login / Session API ในแอปลูก (ย้ายไปหน้ากลางแล้ว — ทางสำรองเท่านั้น)
- ROPC / resource-owner password grant
- ให้ user เข้า `/ui/console` หรือ `/ui/login` V1

**อ้างอิง API (Zitadel official):**

| หัวข้อ | URL |
|--------|-----|
| Custom Login + OIDC auth request flow | https://zitadel.com/docs/guides/integrate/login-ui/oidc-standard |
| Username/password ผ่าน Session API | https://zitadel.com/docs/guides/integrate/login-ui/username-password |
| Session validation / MFA / Passkey (Phase 3–4) | https://zitadel.com/docs/guides/integrate/login-ui |
| IAM_LOGIN_CLIENT + PAT | https://zitadel.com/docs/self-hosting/manage/login-client |
| Application: Login V2 per-app + Custom base URL | https://zitadel.com/docs/guides/manage/console/applications-overview |
| Self-host Login V2 container (ทางหลัก V1) | https://zitadel.com/docs/self-hosting/manage/login-client |

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

> **หมายเหตุ instance ปัจจุบัน:** compose ตั้ง `ZITADEL_DEFAULTINSTANCE_FEATURES_LOGINV2_REQUIRED=false` (Console/ops ยังใช้ V1 ได้ตามเดิม) — Phase 1 จะ deploy container Login V2 เพิ่ม แล้วเปิด **per-application** "Use new login UI" เฉพาะแอปลูก ตาม [Applications overview](https://zitadel.com/docs/guides/manage/console/applications-overview)

---

### Phase 1 — Login กลาง MVP (บังคับ V1)

**เป้าหมาย:** User login บนหน้า login กลาง (แบรนด์เรา) → ได้ JWT พร้อม `urn:platform:*` — **ไม่เห็น** `/ui/login` V1

#### ฝั่ง Zitadel (ทีม Auth) — 1, 2, 3, 4

| # | งาน | รายละเอียด | อ้างอิง |
|---|------|------------|---------|
| **1** | สร้าง Service Account **`IAM_LOGIN_CLIENT`** + PAT | Machine user ใหม่ แยกจาก PAT ops (`IAM_OWNER`) → grant บทบาท **Instance Login Client** → PAT ใส่ env ของ login container เท่านั้น (ไม่ส่งทีมแอป) | [Connect self-hosted Login UI](https://zitadel.com/docs/self-hosting/manage/login-client) |
| **2** | Deploy **Login V2 container** | เพิ่ม service ใน compose: `ghcr.io/zitadel/zitadel-login` + `ZITADEL_API_URL` + `ZITADEL_SERVICE_USER_TOKEN` → nginx route `/ui/v2/login` (demo) หรือ `login.edmcompany.co.th` + Trusted Domain (prod) | §4 ด้านบน, [Login App](https://zitadel.com/docs/guides/integrate/login-ui/login-app) |
| **3** | เปิด **Use new login UI** ต่อ app + Redirect URIs | Console → Project → Application → เปิด new login UI; ลงทะเบียน Redirect + Post-logout URI ทุก env — Auth method = Authorization Code + **PKCE**, Access Token Type = **JWT** (ตั้งแล้ว) | [Applications overview](https://zitadel.com/docs/guides/manage/console/applications-overview), repo: `zitadel/docker-init.md` §4 |
| **4** | Smoke test + ส่ง config ให้แอปลูก | เปิด authorize URL → ต้องได้หน้า Login V2 **ไม่ใช่** `/ui/login` → login → claims ครบ → ส่ง Client ID, issuer, JWKS URL, `@platform/auth` (**ไม่มี PAT**) | repo: `scripts/oidc-pkce-test.py` |

**แอปลูกไม่ต้องเรียก Session API เลย** — Login V2 จัดการ auth request + session + finalize ให้ทั้งหมด
แอปลูกแตะแค่ endpoint OIDC มาตรฐาน: `/oauth/v2/authorize` (redirect) + `POST /oauth/v2/token` (แลก code)

#### ฝั่งแอปลูก (eSign) — 1, 2, 3

| # | งาน | รายละเอียด | อ้างอิง |
|---|------|------------|---------|
| **1** | authorize redirect + **`/callback`** + PKCE | เก็บ `code_verifier` ตั้งแต่เริ่ม authorize → แลก token ที่ issuer → เก็บ session แอป | [OIDC discovery](https://authservice.edmcompany.co.th/.well-known/openid-configuration), repo: `scripts/oidc-pkce-test.py` |
| **2** | อ่าน claims + UX ไม่มีสิทธิ์ | ใช้ `@platform/auth` — ถ้าไม่มี `urn:platform:*` แสดง "ยังไม่ได้รับสิทธิ์" — **ไม่** ลิงก์ `/ui/console` | repo: `docs/API-INTEGRATION.md` §4, `docs/PACKAGE-DISTRIBUTION.md` |
| **3** | แจ้ง redirect URIs ทุก env ให้ทีม Auth | local / pre-test / prod | — |

**ส่งกลับทีม Auth ก่อนปิด Phase 1:** Redirect URIs + ค่า `aud` จาก JWT ครั้งแรก

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

#### ฝั่งแอปลูก (eSign)

> MFA / forgot password / account picker เป็น UI ของ **Login V2 อยู่แล้ว** — งานฝั่งแอปลูกหายไป
> เหลือเปิด policy ฝั่ง Zitadel + งาน **fork/brand Login V2** (logo, สี, copy ไทย) ซึ่งเป็นของทีม Auth

| # | งาน | รายละเอียด | อ้างอิง |
|---|------|------------|---------|
| **1** | Invite-only flow | invite ผ่าน entitlement (`/users/invite`) → user ตั้งรหัสครั้งแรกบนหน้า login กลาง | design spec §5, §9; `docs/LOGIN-E2E-TEST.md` Stage 4 |
| **2** | ทดสอบ MFA / reset จากมุมแอป | login ผ่านหน้ากลางครบทุกเคสแล้วกลับมา `/callback` ปกติ | — |

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

#### ฝั่งแอปลูก (eSign)

> Passkey / Social login เป็นปุ่มบนหน้า login กลาง (Login V2 มีให้) — เปิด policy/IdP ฝั่ง Zitadel พอ

| # | งาน | รายละเอียด | อ้างอิง |
|---|------|------------|---------|
| **1** | E2E test ทุก env | login → claims → API 403/200 → logout — CI ถ้ามี | repo: `scripts/oidc-pkce-test.py` |

---

### ทางสำรอง (ถ้า Login V2 ติดข้อจำกัด branding/feature) — ฝัง Custom Login ในแอป

| ฝั่ง | งาน | อ้างอิง |
|------|------|---------|
| แอปลูก | ทำหน้า `/login?authRequest=...` เอง + backend Session API (`GET auth_requests` → `POST/PATCH sessions` → finalize) + ถือ login PAT server-side | [OIDC in Custom Login UI](https://zitadel.com/docs/guides/integrate/login-ui/oidc-standard), [Username & Password](https://zitadel.com/docs/guides/integrate/login-ui/username-password) |
| Zitadel | ตั้ง Custom Login URL ของ app ชี้ origin แอปลูกแทนหน้ากลาง | [Applications overview](https://zitadel.com/docs/guides/manage/console/applications-overview) |

---

## 6. Checklist ทีม Auth (ops) — สรุปรวม

- [ ] Phase 1 #1–4 (IAM_LOGIN_CLIENT PAT, deploy Login V2 container + nginx route, Use new login UI + redirect URIs, smoke test)
- [ ] Phase 2 #1–4 (token TTL, refresh, logout URI, human superadmin + provision test user)
- [ ] ทด human `superadmin` + `platform_admins` ตรง `sub` (incognito)
- [ ] Provision test user ใน entitlement (tenant + company + role) → claims แบบ grants
- [ ] อัปเดต `docs/PRETEST-AUTH-DEPLOYMENT.md` — ย้ายรายการ "ยังไม่เสร็จ" ที่ทำแล้ว
- [ ] (Optional) systemd/compose restart policy สำหรับ entitlement + zitadel

---

## 7. Checklist ทีม eSign — สรุปรวม

- [ ] Phase 1 #1–3 (authorize redirect + PKCE, `/callback`, claims UX) — **ไม่ต้องทำหน้า login / Session API**
- [ ] Phase 2 #1–4 (`@platform/auth`, refresh, logout, errors)
- [ ] อ่าน `docs/API-INTEGRATION.md` + ติด `@platform/auth`
- [ ] ส่ง redirect URIs ทุก env ให้ทีม Auth
- [ ] หลัง login: อ่าน `sub`, `urn:platform:tenantId`, `urn:platform:grants`
- [ ] User ไม่ provision → ไม่มี platform claims → แสดง "ยังไม่ได้รับสิทธิ์" (ไม่ crash)
- [ ] ไม่ลิงก์ไป `/ui/console` ใน UI ใดๆ

---

## 8. สรุป one-liner ให้ stakeholder

> Auth ทำงานแล้วบน pre-test: OIDC + custom claims live  
> V1 ใช้ **หน้า login กลาง** (self-host Login V2 บนโดเมนเรา แบรนด์เรา) — ทุกแอปเด้งมา login ที่นี่แล้วกลับแอปเดิม, user ไม่เห็นหน้า Zitadel, แอปลูกเป็นแค่ OIDC client

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
