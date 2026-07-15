# คู่มือเชื่อมต่อ Auth Service (สำหรับฝั่ง API / App)

> อัปเดตล่าสุด: 2026-07-15
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

## 2. Login (ฝั่ง frontend / app)

- Flow: **OIDC Authorization Code + PKCE** (ห้ามใช้ implicit)
- Scopes: `openid profile email` และเพิ่ม `offline_access` ถ้าต้องการ refresh token
- **Redirect URI ต้องแจ้งทีม Auth ให้ลงทะเบียนใน Zitadel ก่อน** ไม่งั้น login จะ error
  ตอน authorize — แจ้งทั้ง URI ของ dev/pre-test/prod
- ใช้ OIDC library มาตรฐานของแต่ละ platform ได้เลย (เช่น `oidc-client-ts`,
  AppAuth, `openid-client`) โดย config แค่ issuer + client ID + redirect URI

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

> **สถานะ: ยังไม่เปิดใช้บน pre-test** — ต้องต่อ Actions v2 target เข้า Entitlement
> Service ก่อน จะแจ้งอีกครั้งเมื่อ live

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
2. **ค่า `aud`** ที่เห็นใน token หลังทดสอบ login ครั้งแรก (เพื่อ confirm ตรงกัน)
3. Platform ของ app (web SPA / mobile / server-side) ถ้ายังไม่ได้แจ้ง

## 6. ทดสอบ

- Health check: `curl https://authservice.edmcompany.co.th/debug/healthz` → `ok`
- ตัวอย่าง script ทดสอบ full PKCE flow: `scripts/oidc-pkce-test.py` ใน repo นี้

## ข้อจำกัดปัจจุบัน (pre-test)

- Custom claims (`urn:platform:*`) ยังไม่ live (ดู §4)
- Access token lifetime ยังเป็นค่า default — จะปรับเป็น 10 นาที + refresh token policy
- Passkey/biometric login ยังไม่เปิดใช้
