# Admin UI

หน้า admin จริง 4 หน้า (ลูกค้าทั้งหมด / แพ็กเกจ / รายละเอียดลูกค้า / ตั้งสิทธิ์ราย user) — vanilla HTML/JS/CSS
ไม่มี build step ไม่มี dependency ใหม่ served โดย `entitlement` service เองที่เส้น `/admin` (same-origin
กับ API เลยไม่ต้อง CORS) login ผ่าน Zitadel OIDC (Authorization Code + PKCE)

## 1. ตั้ง OIDC Application ใน Zitadel Console

1. เข้า Console → เลือก **project เดียวกับที่ตั้งเป็น `ZITADEL_AUDIENCE`** ของ `entitlement` service
   (ต้อง project เดียวกัน ไม่งั้น token ที่ได้จะ verify ไม่ผ่านฝั่ง API — ดู `entitlement/src/config/env.ts`)
2. **New Application** → type **Web**
3. **Authentication Method: PKCE** (public client — **ห้าม** เลือก Basic/POST ที่มี client secret,
   เพราะ admin-ui เป็น static SPA ฝั่ง browser เก็บ secret ไม่ได้)
4. **Redirect URIs** — ใส่ทั้งสอง:
   - prod: `https://<host>/admin`
   - dev: `http://localhost:3000/admin`
5. **Post Logout Redirect URIs** — ใส่ origin เดียวกันแบบเดียวกัน (`https://<host>/admin`,
   `http://localhost:3000/admin`) — ใช้ตอนกด "ออกจากระบบ" (`/oidc/v1/end_session` redirect กลับมา)
6. **Access Token Type: JWT** (ให้ตรงกับที่ entitlement API verify แบบ offline ผ่าน JWKS)
7. Scope ที่ authorize ขอ: `openid profile urn:zitadel:iam:org:projects:roles` (ตั้งไว้แล้วใน
   `src/auth.js`, ไม่ต้องตั้งอะไรเพิ่มฝั่ง Console)
8. หลังสร้างเสร็จ copy **Client ID** → ใส่ใน `admin-ui/config.js` (`window.EDM_CONFIG.clientId`)
9. **Custom Login URL**: ปล่อยว่าง/ไม่ตั้ง (ต่างจาก eSign — admin-ui ใช้ hosted login ปกติของ Zitadel
   ตรงๆ ผู้ใช้เห็นหน้า `/ui/login` ของ Zitadel ก่อน redirect กลับ ไม่ใช่ custom login UI)
10. Endpoint จริงของ instance นี้ (อ้างอิง `docs/API-INTEGRATION.md`):

    | อะไร | URL |
    |---|---|
    | Authorize | `{issuer}/oauth/v2/authorize` |
    | Token | `{issuer}/oauth/v2/token` |
    | Logout (end session) | `{issuer}/oidc/v1/end_session` |

## 2. รัน local

```bash
cd entitlement
bun src/index.ts
```

ต้องตั้ง env ให้ครบก่อน (ดู `entitlement/src/config/env.ts` — `DATABASE_URL`, `ZITADEL_ISSUER`,
`ZITADEL_JWKS_URL`, `ZITADEL_AUDIENCE`, `CLAIMS_SHARED_SECRET` เป็นอย่างน้อย) พอร์ต default คือ
`3000` (ตั้งด้วย env `PORT` ถ้าต้องการเปลี่ยน) → เปิด **http://localhost:3000/admin**

## 3. Dev token fallback (ไม่ผ่านหน้า login จริง)

ถ้ายังไม่ได้ตั้ง OIDC application หรืออยาก test เร็วด้วย token ที่มีอยู่แล้ว (เช่นจาก
`scripts/oidc-pkce-test.py`) ใส่ token ตรงเข้า sessionStorage ผ่าน devtools console ที่หน้า
`/admin` แล้ว reload:

```js
sessionStorage.setItem('edm_admin_token', '<ACCESS_TOKEN JWT>')
```

Key อื่นที่ auth.js ใช้ (`src/auth.js`):
- `edm_admin_token` — access token (สิ่งเดียวที่จำเป็นสำหรับ dev fallback ข้างต้น)
- `edm_admin_id_token` — id token, ใช้เป็น `id_token_hint` ตอนกด logout (ไม่ใส่ก็ logout ได้ แค่
  fallback ไปส่ง `client_id` แทน)
- `edm_admin_verifier`, `edm_admin_state` — ใช้ระหว่าง PKCE flow เท่านั้น (ลบทิ้งหลัง callback)

## 4. Manual test checklist

**Login**
- [ ] ไม่มี token → เห็นหน้า login กลางจอ ("เข้าสู่ระบบ")
- [ ] กด "เข้าสู่ระบบ" → redirect ไป Zitadel → login สำเร็จ → กลับมาที่ `/admin` ไม่มี `?code=` ค้างใน URL
      แล้วเข้าแอปตรง (ไม่ใช่หน้า login อีก)
- [ ] login เป็น **superadmin** → เด้งไปหน้า `#/customers` อัตโนมัติ
- [ ] login เป็น **admin ปกติ** (ไม่ใช่ superadmin) → เด้งไปหน้า `#/permissions` อัตโนมัติ, เมนู
      "ลูกค้าทั้งหมด"/"แพ็กเกจ" **ไม่แสดง** ในแถบข้าง (เห็นเฉพาะ "ตั้งสิทธิ์ผู้ใช้")
- [ ] กด "ออกจากระบบ" → เคลียร์ session ฝั่ง app แล้ว redirect ไป Zitadel end_session → กลับมาหน้า
      login (ไม่มี token ค้างใน sessionStorage)

**หน้า 1 — ลูกค้าทั้งหมด** (`#/customers`, superadmin เท่านั้น)
- [ ] stat tiles ตัวเลขตรงกับข้อมูลจริง, filter ทั้งหมด/องค์กร/บุคคล ทำงาน
- [ ] "เพิ่มลูกค้าใหม่" → กรอก name+slug → สร้างสำเร็จ ขึ้นในตารางทันที
- [ ] "ดูรายละเอียด" ของแถวใดก็ได้ → ไปหน้า `#/tenant/:id` ถูก tenant

**หน้า 2 — แพ็กเกจ** (`#/packages`, superadmin เท่านั้น)
- [ ] ตารางเทียบแพ็กเกจแสดงโควตา + permission ✓/— ครบ
- [ ] สร้างแพ็กเกจใหม่ (ชื่อ, slug, โควตา 4 ช่อง, permission checkbox, selfSignup, price) → บันทึกสำเร็จ
- [ ] แก้ไขแพ็กเกจเดิม → เปลี่ยนค่าแล้วบันทึก → ตารางอัปเดต

**หน้า 3 — รายละเอียดลูกค้า** (`#/tenant/:id`, superadmin เท่านั้น)
- [ ] ส่วนแพ็กเกจ+usage ขึ้น badge "ใกล้เต็ม"/"เต็ม" ถูกต้องเมื่อ ≥90%/100%
- [ ] ส่วนบริษัท+จำนวน user ตรง
- [ ] ออก invoice ใหม่ → ขึ้นในตาราง, บันทึกรับเงิน → สถานะเปลี่ยนเป็นจ่ายแล้ว
- [ ] ปุ่มพิมพ์ invoice (ทั้ง 2 ปุ่ม/ประเภท) → เปิดแท็บใหม่แสดงเอกสารได้ (ใช้ blob URL เพราะแนบ
      Authorization header ผ่าน `window.open` ตรงๆ ไม่ได้)
- [ ] ส่วน login ล่าสุด แสดงรายการถูกต้อง

**หน้า 4 — ตั้งสิทธิ์ราย user** (`#/permissions`, ทุก admin เห็น)
- [ ] superadmin เห็น dropdown เลือก tenant ก่อน, admin ปกติ (ไม่ใช่ superadmin) ไม่เห็น dropdown
      (ใช้ tenant ของตัวเองจาก claims ตรงๆ)
- [ ] เลือก user ซ้าย → รายละเอียดขวาโหลดถูกคน, สลับ tab บริษัทแล้วสิทธิ์เปลี่ยนตามบริษัทนั้น
- [ ] toggle "แอดมินทั้งเครือ" / "แอดมินบริษัทนี้" ทำงาน (PATCH สำเร็จ + toast ยืนยัน)
- [ ] เลือก preset จาก dropdown → ติ๊ก permission เปลี่ยนตาม preset, แก้ติ๊กเพิ่ม/ลบ → badge
      "แก้จาก preset แล้ว" ขึ้น
- [ ] "บันทึกเป็น preset ใหม่" จากติ๊กปัจจุบัน → preset ใหม่ขึ้นใน dropdown
- [ ] กด "บันทึกสิทธิ์" ติ๊ก permission เกินโควตาแพ็กเกจ (`overPackage`) → **toast แสดง error พร้อม
      รายชื่อ key ที่เกิน** (403 จาก server, ไม่ใช่ 500) แทนที่จะ silent fail
- [ ] "เชิญผู้ใช้ใหม่" (อีเมล + บริษัท + preset) → user ใหม่ขึ้นในลิสต์ซ้าย
- [ ] ปุ่มเปิด/ปิดผู้ใช้ → สถานะเปลี่ยน, label ปุ่มสลับตาม

**Cross-cutting**
- [ ] error จาก API ใดๆ (400/403/404/500) ขึ้น toast ข้อความจาก response body ไม่ใช่ raw JSON/stack
- [ ] token หมดอายุ/401 ระหว่างใช้งาน → เด้งกลับหน้า login อัตโนมัติ (ไม่ใช่ error เงียบๆ)

## 5. Automated checks

```bash
find admin-ui -name "*.js" -not -path "*/node_modules/*" -exec node --check {} \;  # syntax sweep ทุกไฟล์
bun test admin-ui/tests/                                                           # PKCE helpers + router pattern-compile
cd entitlement && bun test                                                         # API suite ทั้งหมด (รวม static.ts serving)
```

## Known gaps (จดไว้ ไม่ทำใน scope นี้)

- `DELETE /presets` — ยังไม่มีปุ่มลบ preset ใน UI (สร้าง/แก้ได้ ลบยังไม่มี)
- `POST`/`DELETE /users/:id/companies` — ย้าย/เพิ่ม-ลบ user จากบริษัทยังไม่มี UI (จัดการผ่าน invite
  ตอนสร้าง user ครั้งแรกเท่านั้น)
