# เทส login end-to-end เป็นสเตจ — จาก "ยังไม่มี user" ถึง "claims เต็ม"

> สถานะตั้งต้น: มี project + application (eSign) ใน Zitadel แล้ว ได้ Client ID + redirect URI
> หลักคิด: **ไม่ต้องรอสร้าง user ใหม่** — Zitadel admin (คนที่ใช้เข้า Console) เป็น human user
> อยู่แล้ว ใช้ login เทสได้ทุกสเตจ แต่ละสเตจ fail ตรงไหน = รู้ทันทีว่าอะไรยังไม่ต่อ
> อัปเดตล่าสุด: 2026-07-16 (Stage 0 ผ่านครบจากภายนอกแล้ว)

## Stage 0: Public surface (ไม่ต้อง login) — ✅ ผ่านแล้ว 2026-07-16

รันจากเครื่องไหนก็ได้:

```bash
curl -sf https://authservice.edmcompany.co.th/.well-known/openid-configuration | head -c 300  # → JSON, issuer ตรง domain
curl -sf https://authservice.edmcompany.co.th/oauth/v2/keys                                    # → keys RS256 อย่างน้อย 1
curl -s -o /dev/null -w "%{http_code}\n" https://authservice.edmcompany.co.th/debug/healthz   # → 200
curl -s -o /dev/null -w "%{http_code}\n" https://authservice.edmcompany.co.th/oauth/v2/authorize  # → 400 (endpoint ทำงาน แค่ไม่มี param)
curl -s -o /dev/null -w "%{http_code}\n" https://authservice.edmcompany.co.th/packages/platform-auth-1.1.0.tgz  # → 401 (basic auth ทำงาน)
```

ผลรอบล่าสุด: discovery ✓, JWKS 2 keys (RS256) ✓, healthz 200 ✓, authorize 400 ✓, packages 401 ✓

## Stage 1: Token round-trip ด้วย admin user (ยังไม่ต้อง provision อะไร)

**พิสูจน์**: authorize → login → code → token แลกได้จริง และ access token เป็น JWT

1. เพิ่ม redirect URI สำหรับเทสใน app (Console → app → Redirect URIs):
   `http://127.0.0.1:8787/callback` (เปิด Development Mode ของ app ถ้า Zitadel ไม่ยอม http)
2. จากเครื่อง dev:
   ```bash
   python3 scripts/oidc-pkce-test.py <CLIENT_ID>
   ```
3. login ด้วย **Zitadel admin user** ในหน้า browser ที่เด้งขึ้น

| ผลที่เจอ | แปลว่า |
|---|---|
| ได้ token, สคริปต์บอก "Access token is opaque" | ยังไม่ได้ตั้ง Access Token Type = JWT ที่ app |
| ได้ JWT, ไม่มี `urn:platform:*`, exit 2 | **ถูกต้องสำหรับสเตจนี้** — token ออกได้ แต่ Actions ยังไม่ต่อ (หรือต่อแล้วแต่ user ยังไม่ provision → ไป Stage 2/3) |
| login แล้ว error ตอนแลก token | ถ้า Actions ต่อแล้ว (interruptOnError=true) + entitlement ตาย/ยิงไม่ถึง → token จะออกไม่ได้ทั้งเส้น — ดู log zitadel + entitlement |

## Stage 2: Actions v2 wiring (claims pipeline)

**พิสูจน์**: ตอนออก token, Zitadel ยิง POST มาที่ entitlement จริง

1. ต่อ Actions ตาม `docs/PHASE1-PRETEST-RUNBOOK.md` ข้อ 5 (สคริปต์ + signing key + restart)
2. เปิด log entitlement ค้างไว้ แล้ว login ใหม่ (Stage 1 ซ้ำ)
3. ต้องเห็น `POST /internal/zitadel/token-claims` ใน log ทุกครั้งที่ login
   - ไม่เห็น → เช็ค target/execution มีจริงไหม (POST `/v2/actions/targets/search` +
     `/v2/actions/executions/search` ด้วย PAT — ดู runbook), DENYLIST, และ endpoint ของ target
     (Linux server ไม่มี `host.docker.internal` — ใช้ IP docker bridge เช่น `172.17.0.1`)
   - เห็นแต่ entitlement ตอบ 401 → signing key ใน env ไม่ตรง (token จะออกไม่ได้ด้วย)
   - เห็น + ตอบ 200 แต่ claims ยังว่าง → ปกติ! admin ยังไม่ provision → Stage 3

## Stage 3: Superadmin claims (เทส claims โผล่ใน token แบบเร็วสุด — 1 SQL)

**พิสูจน์**: resolver ทำงาน + claims เข้า token จริง โดยยังไม่ต้องมี tenant

1. เอา `sub` จาก token ใน Stage 1/2 (คือ zitadel user id ของ admin)
2. บนเซิร์ฟเวอร์:
   ```bash
   docker compose exec db psql -U <user> <db> -c \
     "INSERT INTO platform_admins (zitadel_user_id) VALUES ('<sub>') ON CONFLICT DO NOTHING;"
   ```
3. login ใหม่ → token ต้องมี `"urn:platform:role": "superadmin"` → สคริปต์ exit 0 ✅

## Stage 4: Tenant user เต็มระบบ (claims + grants ต่อ company)

**พิสูจน์**: ทั้งเส้น invite → login → grants ต่อ company → `canUse()` ฝั่ง eSign

ใช้ JWT superadmin จาก Stage 3 ยิง API ของ entitlement (รันบนเซิร์ฟเวอร์ — entitlement ไม่ public):

```bash
T="<superadmin access token>"
# 1. tenant (สร้าง Zitadel org ให้ด้วย)
curl -s -X POST localhost:3000/tenants -H "Authorization: Bearer $T" -H "Content-Type: application/json" \
  -d '{"name":"EDM Test","slug":"edm-test"}'
# 2. company ในเครือ
curl -s -X POST localhost:3000/companies -H "Authorization: Bearer $T" -H "Content-Type: application/json" \
  -d '{"tenantId":1,"name":"บริษัท A"}'
# 3. เปิด module esign ให้ tenant (ตอนนี้ยังไม่มี API — insert ตรง: tenant_modules)
docker compose exec db psql -U <user> <db> -c \
  "INSERT INTO tenant_modules (tenant_id, module_id) SELECT 1, id FROM modules WHERE key='esign' ON CONFLICT DO NOTHING;"
# 4. invite user (สร้าง Zitadel human user + provision ครบ)
curl -s -X POST localhost:3000/users/invite -H "Authorization: Bearer $T" -H "Content-Type: application/json" \
  -d '{"tenantId":1,"email":"test-user@edmcompany.co.th","companyIds":[1],"roleSlugs":["company_admin"]}'
```

แล้ว login ด้วย user ใหม่ (ตั้งรหัสผ่านครั้งแรกตาม flow ของ Zitadel) →
token ต้องมี `tenantId`, `companies:[1]`, `modules:["esign"]`, `grants:{"1":{...permissions:["*"]}}`
→ จากนั้นฝั่ง eSign: `GET /me` เห็น claims เต็ม และ `canUse(claims, 1, 'esign', 'esign.document.sign')` = true

## หมายเหตุ

- claims เข้าเฉพาะ **token ที่ออกใหม่** — เปลี่ยนสิทธิ์/provision แล้วต้อง login ใหม่เสมอ
- ยังแก้ไม่ได้จาก stage ไหนก็ตาม: แปะ log zitadel + entitlement ณ วินาที login มาดูพร้อมกัน
