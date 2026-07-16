# คู่มือเชื่อมต่อ Auth Service (สำหรับฝั่ง API / App)

> อัปเดตล่าสุด: 2026-07-16
> Environment: EDM pre-test
> Issuer: `https://authservice.edmcompany.co.th`

เอกสารนี้สำหรับทีมที่จะเชื่อม login และตรวจ token กับ Auth Service (Zitadel)
สิ่งที่ต้องมีก่อนเริ่ม: **Client ID** ของ application ตัวเอง (ขอจากทีม Auth)
ไม่มีการใช้ client secret — flow เป็น public client + PKCE

## 1. Endpoints หลัก

ทุก endpoint อ่านได้จาก discovery (แนะนำให้ library อ่านจากตรงนี้อัตโนมัติ):

```text
https://authservice.edmcompany.co.th/.well-known/openid-configuration
```

ค่าที่ verify แล้วจาก server จริง:

| อะไร | URL |
|---|---|
| Authorize | `https://authservice.edmcompany.co.th/oauth/v2/authorize` |
| Token | `https://authservice.edmcompany.co.th/oauth/v2/token` |
| Userinfo | `https://authservice.edmcompany.co.th/oidc/v1/userinfo` |
| JWKS (public keys) | `https://authservice.edmcompany.co.th/oauth/v2/keys` |
| Logout (end session) | `https://authservice.edmcompany.co.th/oidc/v1/end_session` |
| Revoke token | `https://authservice.edmcompany.co.th/oauth/v2/revoke` |

## 2. Login — สองแบบ (เลือกตาม product)

### 2a. Custom Login UI บน app ของคุณ (V1 eSign — **ใช้แบบนี้**)

End user **ไม่เห็น** หน้า login ของ Zitadel (`/ui/login`) — เห็นแค่ UI ของ app

1. ตั้ง **Custom Login URL** ใน OIDC application (ทีม Auth ทำให้) ชี้ไป origin ของ app เช่น `https://esign.example.com`
2. App redirect browser ไป authorize ตามปกติ (PKCE)
3. Zitadel redirect กลับมา `/login?authRequest=V2_...` บน app
4. **Backend ของ app** (ถือ PAT บทบาท `IAM_LOGIN_CLIENT`) เรียก Session API + finalize auth request
5. Redirect ไป callback พร้อม code → แลก token

เอกสาร Zitadel: [Custom Login UI — OIDC](https://zitadel.com/docs/guides/integrate/login-ui/oidc-standard)

**ลำดับงาน Phase 1–4 (Zitadel vs eSign + อ้างอิงครบ):** `docs/PRETEST-PHASE1-STATUS-AND-ESIGN-PLAN.md` §5

env เพิ่มฝั่ง backend ของ app:

```env
ZITADEL_LOGIN_CLIENT_PAT=<PAT จากทีม Auth — IAM_LOGIN_CLIENT>
```

**ห้าม** ใส่ PAT ใน frontend / mobile bundle

### 2b. Hosted login redirect (ไม่ใช้สำหรับ eSign V1)

Library OIDC มาตรฐาน redirect ไป `/oauth/v2/authorize` แล้ว user เห็นหน้า IdP — **eSign ไม่ใช้แนวนี้**

---

## 3. ตรวจ token (ฝั่ง backend API)

Access token เป็น **JWT (RS256)** — verify แบบ offline ได้ ไม่ต้องยิงกลับมาที่ Auth Service ทุก request:

1. ดึง public key จาก JWKS URL (library ส่วนใหญ่ cache ให้อัตโนมัติ)
2. ตรวจ signature (RS256)
3. ตรวจ `iss` = `https://authservice.edmcompany.co.th`
4. ตรวจ `aud` มีค่า audience ของตัวเอง (ดูค่าจริงจาก claim `aud` ใน token ที่ login ครั้งแรก)
5. ตรวจ `exp`

ค่า env ที่แนะนำให้ตั้งฝั่ง API:

```env
ZITADEL_ISSUER=https://authservice.edmcompany.co.th
ZITADEL_JWKS_URL=https://authservice.edmcompany.co.th/oauth/v2/keys
ZITADEL_AUDIENCE=<ค่า aud จาก JWT access token>
```

user id ของผู้ใช้ = claim `sub`

## 4. Custom claims (สิทธิ์ / tenant)

> **สถานะ: live บน pre-test (2026-07-16)** — ต่อ Actions v2 + entitlement แล้ว; ทดด้วย `scripts/oidc-pkce-test.py`

เมื่อเปิดใช้แล้ว access token จะมี claims prefix `urn:platform:`:

| Claim | ความหมาย |
|---|---|
| `urn:platform:role` | `superadmin` (มีเฉพาะ platform admin) |
| `urn:platform:tenantId` | tenant ของ user (number) |
| `urn:platform:companies` | company id ที่ user สังกัด (number[]) |
| `urn:platform:modules` | module ที่ tenant เปิดใช้ (string[]) |
| `urn:platform:grants` | สิทธิ์ต่อ company: `{ "<companyId>": { roles: string[], permissions: string[] } }` — `permissions: ["*"]` = ได้ทุกสิทธิ์ |

User ที่ยังไม่ถูก provision ในระบบ entitlement จะไม่มี claims เหล่านี้เลย → ฝั่ง API
ควรถือว่าไม่มีสิทธิ์

## 5. สิ่งที่ต้องแจ้งกลับทีม Auth

1. **Redirect URIs** ทั้งหมด (รวม logout redirect ถ้ามี) ของทุก environment
2. **Custom Login base URL** (origin ของ app ที่ host หน้า `/login?authRequest=...`)
3. **ค่า `aud`** ที่เห็นใน token หลังทดสอบ login ครั้งแรก (เพื่อ confirm ตรงกัน)
4. Platform ของ app (web SPA / mobile / server-side) ถ้ายังไม่ได้แจ้ง

## 6. ทดสอบ

- Health check: `curl https://authservice.edmcompany.co.th/debug/healthz` → `ok`
- ตัวอย่าง script ทดสอบ full PKCE flow: `scripts/oidc-pkce-test.py` ใน repo นี้

## ข้อจำกัดปัจจุบัน (pre-test)

- ~~Custom claims (`urn:platform:*`) ยังไม่ live~~ → **live แล้ว** (ดู §4)
- Access token lifetime ยังเป็นค่า default — จะปรับเป็น 10 นาที + refresh token policy
- Passkey/biometric — ทำบน custom login UI ผ่าน Session API (Phase B)
- **Social login (Google / Apple ID)** — เปิดที่ Zitadel แล้ว implement ปุ่มบน custom login UI ของ app (ไม่ใช่หน้า `/ui/login`)