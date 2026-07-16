# แจกจ่าย @platform/auth ให้ทีม product (eSign, ...)

> วิธี: tarball วางบน nginx ของเครื่อง pre-test — ฟรี ไม่ต้องมี npm registry
> และทีม product ได้เฉพาะ lib ไม่ต้องเข้าถึง repo authservice

## ฝั่งเรา — ออก version ใหม่

```bash
# 1. แก้โค้ดใน packages/auth แล้ว bump version ใน packages/auth/package.json (ห้ามลืม —
#    ชื่อไฟล์ .tgz ผูกกับ version ถ้าไม่ bump ฝั่ง consumer จะ cache ตัวเก่า)
# 2. pack
./scripts/pack-auth.sh          # → dist-packages/platform-auth-<version>.tgz
# 3. วางบนเซิร์ฟเวอร์
scp dist-packages/platform-auth-<version>.tgz <server>:/var/www/packages/
```

## nginx บนเครื่อง pre-test (ตั้งครั้งเดียว)

```nginx
# /etc/nginx/... ใน server block ของ authservice.edmcompany.co.th
location /packages/ {
    alias /var/www/packages/;
    autoindex off;                       # ไม่ list ไฟล์
    auth_basic "platform packages";      # กันคนนอก — แจก user/pass ให้ทีม product
    auth_basic_user_file /etc/nginx/.htpasswd-packages;
}
```

```bash
# สร้าง credential ให้ทีม eSign (ทำครั้งเดียว)
htpasswd -c /etc/nginx/.htpasswd-packages esign
nginx -s reload
```

## ฝั่ง eSign — ติดตั้ง

eSign ใช้ bun + Elysia → ใช้ TS source ใน package ได้ตรงๆ ไม่มี build step:

```bash
bun add https://esign:<password>@authservice.edmcompany.co.th/packages/platform-auth-1.0.0.tgz
```

ใช้งาน (ค่า env ดู `docs/API-INTEGRATION.md`):

```ts
import { createRequireAuth, can, hasModule } from '@platform/auth'

const requireAuth = createRequireAuth({
  jwksUrl: process.env.ZITADEL_JWKS_URL!,   // https://authservice.edmcompany.co.th/oauth/v2/keys
  issuer: process.env.ZITADEL_ISSUER!,      // https://authservice.edmcompany.co.th
  audience: process.env.ZITADEL_AUDIENCE!,  // client ID ของแอป eSign (ดูจาก claim aud)
})

app.use(requireAuth).post('/documents/:id/sign', ({ auth, set }) => {
  // ต้องเช็คคู่เสมอ: tenant เปิด module + user มี permission ที่ company นั้น
  if (!hasModule(auth.claims, 'esign') || !can(auth.claims, companyId, 'esign.document.sign')) {
    set.status = 403; return 'forbidden'
  }
  // ...
})
```

อัปเดต version: เปลี่ยน URL ใน package.json ของ eSign เป็นไฟล์ version ใหม่แล้ว `bun install`

## หมายเหตุ

- tarball มีแค่ `package.json` + `src/index.ts` (คุมด้วย `files` ใน package.json)
- ตอนนี้แจกแบบนี้เพราะมี consumer เดียว — ถ้า package แชร์เพิ่มหลายตัว/หลายทีม
  ค่อยยกไป Verdaccio หรือ GitHub Packages (ดู trade-off ในบทสนทนา 2026-07-16)
- ทดสอบ install จาก tarball แล้ว (bun add file:...tgz → import ทุก export ทำงาน)
