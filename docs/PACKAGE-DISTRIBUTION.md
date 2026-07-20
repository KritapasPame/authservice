# แจกจ่าย @platform/auth ให้ทีม product (eSign, ...)

> วิธี: tarball วางบน nginx ของเครื่อง pre-test — ฟรี ไม่ต้องมี npm registry
> และทีม product ได้เฉพาะ lib ไม่ต้องเข้าถึง repo authservice

## ฝั่งเรา — ออก version ใหม่

```bash
# 1. แก้โค้ดใน packages/auth แล้ว bump version ใน packages/auth/package.json (ห้ามลืม —
#    ชื่อไฟล์ .tgz ผูกกับ version ถ้าไม่ bump ฝั่ง consumer จะ cache ตัวเก่า)
# 2. pack — ตั้งแต่ v1.2.0 สคริปต์รัน `bun run build` ให้อัตโนมัติก่อน pack เสมอ
#    (สร้าง dist/index.js + dist/index.d.ts ใหม่ ไม่ต้องสั่ง build เองแยก)
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

nginx บนเครื่อง pre-test รันเป็น docker — ต้อง mount 2 อย่างเข้าคอนเทนเนอร์
(path ปลายทางของ htpasswd ต้องตรงกับ `auth_basic_user_file` ข้างบนเป๊ะ):

```yaml
# ใน service nginx ของ compose
    volumes:
      - ./htpasswd-packages:/etc/nginx/.htpasswd-packages:ro
      - ./packages:/var/www/packages:ro   # โฟลเดอร์บน host ที่ scp .tgz เข้าไป
```

```bash
# สร้าง credential ให้ทีม eSign (ทำครั้งเดียว — ใช้ docker ไม่ต้องลง apache2-utils)
docker run --rm httpd:alpine htpasswd -nb esign '<password>' > htpasswd-packages
docker compose exec nginx nginx -s reload
```

## ฝั่ง eSign — ติดตั้ง

eSign ใช้ bun + Elysia → ใช้ TS source ใน package ได้ตรงๆ ไม่มี build step:

**แนะนำ: vendor เข้า repo (เหมาะกับ docker build)** — download ครั้งเดียว commit เข้า repo eSign:

```bash
mkdir -p vendor
curl -u esign:'<password>' -o vendor/platform-auth-1.1.0.tgz \
  https://authservice.edmcompany.co.th/packages/platform-auth-1.1.0.tgz
bun add file:./vendor/platform-auth-1.1.0.tgz
```

- docker build ไม่ต้องทำอะไรพิเศษ (`COPY . .` + `bun install` — ไฟล์อยู่ใน context แล้ว)
  build offline ได้ ไม่ผูกกับ uptime ของเครื่อง pre-test และไม่มี credential ใน repo
- อัปเดต version: download ไฟล์ใหม่ → `bun add file:./vendor/platform-auth-<new>.tgz` → ลบไฟล์เก่า

**ไม่แนะนำ**: ใส่ URL แบบ `https://esign:<password>@...` ตรงๆ ใน package.json —
รหัสจะหลุดเข้า git (ทั้ง package.json และ bun.lock) และทุก build ต้องพึ่งเซิร์ฟเวอร์เรา online

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

- ตั้งแต่ v1.2.0 tarball มี `package.json` + `src/index.ts` + `dist/` (`index.js` ESM +
  `index.d.ts`) — คุมด้วย `files` ใน package.json. `exports` เป็น conditional:
  consumer ที่รันด้วย **Bun** (เช่น eSign, entitlement) ได้ `src/index.ts` ตรงๆ เหมือนเดิม
  ไม่มี build step; consumer ที่เป็น **plain Node/JS** (ไม่มี Bun/TS-aware bundler) ได้
  `dist/index.js` + type ได้จาก `dist/index.d.ts` — ดูวิธีใช้ฝั่ง product แบบละเอียด
  (ทั้ง Elysia และ framework อื่น) ที่ `docs/AUTH-LIB-INTEGRATION.md`
- ตอนนี้แจกแบบนี้เพราะมี consumer เดียว — ถ้า package แชร์เพิ่มหลายตัว/หลายทีม
  ค่อยยกไป Verdaccio หรือ GitHub Packages (ดู trade-off ในบทสนทนา 2026-07-16)
- ทดสอบ install จาก tarball แล้ว (bun add file:...tgz → import ทุก export ทำงาน;
  npm install จาก plain JS/TS project → ดูผลทดสอบใน `.superpowers/sdd/auth-lib-report.md`)
