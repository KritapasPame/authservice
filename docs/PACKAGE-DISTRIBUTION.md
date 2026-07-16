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

server block ปัจจุบันใช้ `location / { grpc_pass grpc://zitadel:8080; }` เป็น catch-all —
เพิ่ม `location /packages/` **เป็น location แยกใน server block เดียวกัน** (nginx เลือก
prefix ที่ยาวกว่า จึงชนะ `/` โดยไม่ต้องย้ายอะไร) ถ้าไม่เพิ่ม request จะวิ่งเข้า Zitadel แล้ว 404:

```nginx
server {
    listen 443 ssl http2;
    server_name authservice.edmcompany.co.th;

    ssl_certificate     /etc/nginx/ssl/authservice-origin.pem;
    ssl_certificate_key /etc/nginx/ssl/authservice-origin-key.pem;

    # เพิ่มอันนี้ ก่อน/หลัง location / ก็ได้ (prefix ยาวกว่าชนะเสมอ)
    location /packages/ {
        alias /var/www/packages/;            # ระวัง: ใช้ alias (ไม่ใช่ root) เพราะ path ไม่ตรงชื่อ dir
        autoindex off;                       # ไม่ list ไฟล์
        auth_basic "platform packages";      # กันคนนอก — แจก user/pass ให้ทีม product
        auth_basic_user_file /etc/nginx/.htpasswd-packages;
    }

    location / {
        grpc_pass grpc://zitadel:8080;
        grpc_set_header Host $host;
        grpc_set_header X-Forwarded-Proto https;
        grpc_buffer_size 8k;
    }
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
bun add https://esign:<password>@authservice.edmcompany.co.th/packages/platform-auth-1.1.0.tgz
# ถ้า credential-in-URL มีปัญหา: curl -u esign:<password> -O <url> แล้ว bun add file:./platform-auth-1.1.0.tgz
```

ใช้งาน (ค่า env ดู `docs/API-INTEGRATION.md`):

```ts
import { createRequireAuth, canUse } from '@platform/auth'

const requireAuth = createRequireAuth({
  jwksUrl: process.env.ZITADEL_JWKS_URL!,   // https://authservice.edmcompany.co.th/oauth/v2/keys
  issuer: process.env.ZITADEL_ISSUER!,      // https://authservice.edmcompany.co.th
  audience: process.env.ZITADEL_AUDIENCE!,  // client ID ของแอป eSign (ดูจาก claim aud)
})

app.use(requireAuth).post('/documents/:id/sign', ({ auth, set }) => {
  // canUse = hasModule + can ในตัวเดียว — ใช้ตัวนี้เสมอฝั่ง product
  // (อย่าใช้ can() เดี่ยวๆ — มันไม่รู้เรื่อง module, user ที่ถือ '*' จะทะลุ module ที่ tenant ไม่ได้ซื้อ)
  if (!canUse(auth.claims, companyId, 'esign', 'esign.document.sign')) {
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
