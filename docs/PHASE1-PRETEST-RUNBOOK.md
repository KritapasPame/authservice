# Phase 1 Runbook — เปิด custom claims e2e บน pre-test

> เป้าหมาย: login แล้ว access token (JWT) มี `urn:platform:*` claims ครบ
> Environment: `https://authservice.edmcompany.co.th` (Zitadel v4.16.0)
> รายละเอียด/ที่มาแต่ละขั้นดู `zitadel/actions/token-claims.md` (§ อ้างในแต่ละข้อ)

ทำตามลำดับบนเซิร์ฟเวอร์ pre-test:

## 1. Service user + PAT (ถ้ายังไม่มี)

Console → Users → Service Users → สร้าง service user แล้วให้สิทธิ์ instance-level
ที่ครอบ Actions (เช่น IAM_OWNER สำหรับ pre-test) → แท็บ *Personal Access Tokens*
→ New → copy PAT (ดู `zitadel/docker-init.md` ข้อ 3)

- PAT ห้าม commit / ห้ามจดลงเอกสาร
- PAT ตัวเดียวกันใช้เป็น `ZITADEL_MGMT_TOKEN` ของ entitlement ด้วย (invite user ต้องใช้)

## 2. ตั้ง deny-list override บน zitadel container (§4)

default ของ Zitadel บล็อก private CIDR ทั้งหมด → target ยิงเข้า entitlement ไม่ได้
เพิ่มใน environment ของ service `zitadel` ใน compose แล้ว restart:

```yaml
# แทนที่ default ทั้งชุด — คงบล็อก cloud-metadata + CGNAT ไว้
ZITADEL_HTTPCLIENT_DENYLIST: "169.254.0.0/16,100.64.0.0/10,0.0.0.0/8"
```

โปรดตัดให้แคบที่สุดเท่าที่ network layout อนุญาต (block ทุกอย่างยกเว้น subnet
ของ entitlement) — override นี้ลด SSRF protection ของ Zitadel

## 3. รัน entitlement service ให้ Zitadel ยิงถึง

entitlement ยังไม่ containerized (Phase 3) — รันบน host:

```bash
cd entitlement && bun run src/index.ts
```

env ที่ต้องมี (`entitlement/src/config/env.ts`): `DATABASE_URL`, `ZITADEL_ISSUER`,
`ZITADEL_JWKS_URL`, `ZITADEL_AUDIENCE`, `CLAIMS_SHARED_SECRET`, `ZITADEL_MGMT_URL`,
`ZITADEL_MGMT_TOKEN` (PAT จากข้อ 1) — ส่วน `ZITADEL_ACTIONS_SIGNING_KEY` จะได้จากข้อ 4

## 4. สร้าง Actions v2 target + execution (§5)

```bash
ZITADEL_PAT=<PAT จากข้อ 1> ./scripts/setup-zitadel-action.sh
# default: ZITADEL_URL=https://authservice.edmcompany.co.th
#          endpoint=http://host.docker.internal:3000/internal/zitadel/token-claims
```

- สคริปต์พิมพ์ `signingKey` **ครั้งเดียว** → ใส่ env `ZITADEL_ACTIONS_SIGNING_KEY`
  ของ entitlement แล้ว restart entitlement
- target เป็น `restCall` + `interruptOnError: true` = fail-closed: ถ้า entitlement
  ล่ม token จะไม่ออกเลย (Console ไม่กระทบเพราะใช้ opaque token)

## 5. ตั้ง OIDC app เป็น JWT access token (§5.3)

Console → project → application (ของแอปทดสอบ/eSign) → Token Settings →
**Access Token Type = JWT** — ถ้าไม่ตั้ง trigger ไม่ทำงาน ได้ opaque token

## 6. ตั้ง token lifetime

Console → default settings (instance) → Token lifetimes:
- **Access Token: 10 นาที** — เป็นกลไกหลักคุม staleness (revoke role / disable user
  มีผลตอน token หมดอายุ ไม่ใช่ทันที)
- Refresh Token idle/absolute: ตามนโยบาย (แนะนำ idle 30 วัน / absolute 90 วัน เป็นจุดเริ่ม)

## 7. Provision test user

ต้องมีครบ: Zitadel human user + แถวใน entitlement DB ที่ `zitadel_user_id` ตรงกัน
พร้อม company membership + role — ผ่าน API ก็ได้:

```bash
# invite (สร้าง zitadel user + users row + membership + tenant-wide role)
curl -X POST http://localhost:3000/users/invite -H "Authorization: Bearer <superadmin JWT>" \
  -H "Content-Type: application/json" \
  -d '{"tenantId":1,"email":"test@example.com","companyIds":[1],"roleSlugs":["group_admin"]}'
# หรือ assign role ต่อ company (endpoint ใหม่)
curl -X POST http://localhost:3000/users/<id>/roles -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" -d '{"roleSlug":"hr_admin","companyId":2}'
```

## 8. Verify end-to-end

```bash
python3 scripts/oidc-pkce-test.py <CLIENT_ID>   # default issuer = pre-test domain
```

login ด้วย test user จากข้อ 7 — สคริปต์จะ decode access token แล้วพิมพ์
`urn:platform:*` claims:

- **ผ่าน**: เห็น `urn:platform:tenantId / companies / modules / grants` (superadmin
  เห็น `urn:platform:role: superadmin`) → Phase 1 จบ ✅
- **ไม่ผ่าน** (exit 2): สคริปต์พิมพ์ checklist สาเหตุ — ไล่ตามลำดับ: target/execution
  สร้างหรือยัง → DENYLIST override แล้วยัง → signing key ใส่แล้วยัง → user provision แล้วยัง
- debug ฝั่ง Zitadel: `docker compose logs zitadel | grep -i target` และฝั่ง entitlement
  ดู log ว่ามี POST `/internal/zitadel/token-claims` เข้ามาไหม
- เช็คว่า target/execution ถูกสร้างจริง (API v2 ใช้ **POST ที่ /search** ไม่ใช่ GET):
  ```bash
  curl -s -X POST "$ZITADEL_URL/v2/actions/targets/search"    -H "Authorization: Bearer $ZITADEL_PAT" -H "Content-Type: application/json" -d '{}'
  curl -s -X POST "$ZITADEL_URL/v2/actions/executions/search" -H "Authorization: Bearer $ZITADEL_PAT" -H "Content-Type: application/json" -d '{}'
  ```
- บนเซิร์ฟเวอร์ Linux ไม่มี `host.docker.internal` แบบ Docker Desktop — ถ้า target ยิงไม่ถึง
  entitlement ที่รันบน host ให้ใช้ IP ของ docker bridge แทน (ปกติ `172.17.0.1` — เช็คด้วย
  `docker network inspect bridge | grep Gateway`) แล้ว UpdateTarget หรือสร้าง target ใหม่

## เช็คลิสต์ปิด Phase 1

- [ ] service user + PAT ใช้งานได้ (ยิง `GET /v2/actions/executions/functions` ผ่าน)
- [ ] target + execution สร้างแล้ว, signing key อยู่ใน env entitlement
- [ ] OIDC app = JWT access token
- [ ] access token TTL 10 นาที + refresh policy ตั้งแล้ว
- [ ] `oidc-pkce-test.py` เห็น claims ครบ (provisioned user + superadmin + unprovisioned = `{}`)
- [ ] อัปเดต `docs/PRETEST-AUTH-DEPLOYMENT.md` ส่วน "ยังไม่เสร็จ" หลังผ่าน
