# Pre-test Auth Deployment

> อัปเดตล่าสุด: 2026-07-15  
> Environment: EDM pre-test  
> Public URL: `https://authservice.edmcompany.co.th`

เอกสารนี้บันทึก topology และการแก้ปัญหาที่ทำให้ Zitadel v4.16.0 ใช้งานผ่าน
Cloudflare + nginx ได้จริง โดยไม่บันทึก password, PAT, token, master key หรือ TLS private key.

## Topology ปัจจุบัน

```text
Browser
  → Cloudflare Tunnel (HTTPS)
  → 10.7.219.156:443
  → nginx container (TLS termination, Cloudflare Origin Certificate)
  → h2c grpc://zitadel:8080
  → Zitadel container
  → PostgreSQL
```

- Cloudflare public hostname: `authservice.edmcompany.co.th`
- Tunnel origin type ต้องเป็น **HTTPS**, URL `10.7.219.156:443`; การใช้ HTTP กับ port
  443 จะได้ `400 The plain HTTP request was sent to HTTPS port`.
- nginx และ Zitadel อยู่ใน external Docker network ชื่อ `proxy`; nginx ต้องเรียก upstream
  ด้วย Docker DNS (`zitadel:8080`) ไม่ใช่ `127.0.0.1:8080` เพราะ loopback ใน nginx
  container ชี้กลับ nginx เอง.
- nginx เป็น service เดียวที่ bind host `:443`; Zitadel expose `8080` เฉพาะ Docker network
  และไม่ถือ TLS certificate เอง.
- Cloudflare Origin Certificate/private key mount เข้า nginx แบบ read-only และห้าม commit.

## Zitadel production-facing settings

```env
ZITADEL_EXTERNALDOMAIN=authservice.edmcompany.co.th
ZITADEL_EXTERNALSECURE=true
ZITADEL_EXTERNALPORT=443
ZITADEL_TLSMODE=external
```

Startup command:

```yaml
command: "start-from-init --masterkeyFromEnv --tlsMode external"
```

เมื่อ nginx terminate TLS แล้ว Zitadel ต้องใช้:

```yaml
ZITADEL_TLS_ENABLED: "false"
```

ห้ามใช้ `--tlsMode disabled` หลัง HTTPS proxy: mode นั้นบังคับ `External Secure=false`
และทำให้ Console สร้าง API URL เป็น `http://...`; browser จะ block ด้วย CSP/mixed content.
ห้ามใส่ scheme ใน `ZITADEL_EXTERNALDOMAIN` (เช่น `https://...`) เพราะจะกลายเป็น
`http://https://...`.

ค่าที่ตรวจจาก startup banner แล้ว:

```text
TLS enabled               : false
External Secure           : true
Management Console URL    : https://authservice.edmcompany.co.th:443/ui/console
Health Check URL          : https://authservice.edmcompany.co.th:443/debug/healthz
```

## nginx route

server block ของ hostname นี้ terminate TLS แล้ว forward ทุก Zitadel HTTP/gRPC-Web/gRPC
request ผ่าน h2c:

```nginx
server {
    listen 443 ssl http2;
    server_name authservice.edmcompany.co.th;

    ssl_certificate     /etc/nginx/ssl/authservice-origin.pem;
    ssl_certificate_key /etc/nginx/ssl/authservice-origin-key.pem;

    # Login V2 (หน้า login กลาง) — HTTP ธรรมดา ไม่ใช่ gRPC; prefix ยาวกว่าจึงชนะ location /
    # service `login` ใน compose (profile "login") ต้องรันก่อน ไม่งั้น 502
    location /ui/v2/login {
        proxy_pass http://login:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-Host $host;
    }

    location / {
        grpc_pass grpc://zitadel:8080;
        grpc_set_header Host $host;
        grpc_set_header X-Forwarded-Proto https;
        grpc_buffer_size 8k;
    }
}
```

Zitadel service ต้องอยู่ทั้ง default network (คุยกับ `db`) และ `proxy` network (คุยกับ nginx):

```yaml
networks:
  - default
  - proxy
```

## ปัญหาที่แก้แล้ว

1. `http://https://authservice...:8080` — เอา `https://` ออกจาก
   `ZITADEL_EXTERNALDOMAIN`.
2. Console ยิง API ไป `http://authservice...` แล้ว CSP block — เปลี่ยนเป็น
   `--tlsMode external`, `ExternalSecure=true`, `ExternalPort=443`.
3. nginx ส่ง request ไป Laravel 404 — Cloudflare เคยส่ง HTTP เข้า port 80; เปลี่ยน
   Tunnel origin เป็น HTTPS port 443.
4. nginx หา Zitadel ไม่เจอ — เชื่อม external Docker network `proxy` และใช้
   `grpc://zitadel:8080`.
5. nginx/Zitadel แย่ง port 443 — ให้ nginx bind 443 เพียง service เดียว; Zitadel ใช้
   internal port 8080.
6. Zitadel TLS config ขัดกัน — certificate อยู่ที่ nginx; Zitadel ใช้ external TLS mode
   และ `ZITADEL_TLS_ENABLED=false`.

## สิ่งที่ verify แล้วบน pre-test

```bash
curl -s https://authservice.edmcompany.co.th/debug/healthz
curl -s https://authservice.edmcompany.co.th/.well-known/openid-configuration
curl -s https://authservice.edmcompany.co.th/oauth/v2/keys
```

- Health endpoint ตอบ `ok`.
- OIDC discovery ประกาศ issuer และ endpoints เป็น HTTPS ถูกต้อง.
- JWKS คืน RS256 public keys.
- Management Console login และเปลี่ยน bootstrap admin password สำเร็จ.
- สร้าง OIDC Web application, Authorization Code + PKCE สำเร็จ.
- ตั้ง Access Token Type = JWT และทดสอบ code exchange/อ่าน `aud`, `iss`, `sub`
  ด้วย `scripts/oidc-pkce-test.py` สำเร็จ.

## ค่าฝั่ง API

```env
ZITADEL_ISSUER=https://authservice.edmcompany.co.th
ZITADEL_JWKS_URL=https://authservice.edmcompany.co.th/oauth/v2/keys
ZITADEL_AUDIENCE=<ค่า aud จาก JWT access token — คือ Project ID ของ project ที่ app สังกัด>
ZITADEL_MGMT_URL=https://authservice.edmcompany.co.th
```

`ZITADEL_AUDIENCE` ต้องใช้ค่าจริงจาก claim `aud`; Client ID เป็น public identifier
แต่ PAT, access/refresh token และ client secret ห้ามบันทึกในเอกสารหรือ commit.

## ยังไม่เสร็จ

- Login V2 (หน้า login กลาง): สร้าง SA + PAT บทบาท `IAM_LOGIN_CLIENT` → ใส่ `LOGIN_CLIENT_PAT`
  ใน `.env` → `docker compose --profile login up -d login` → เพิ่ม nginx location
  `/ui/v2/login` (ดูด้านบน) → เปิด "Use new login UI" ที่ OIDC app — ดู
  `docs/PRETEST-PHASE1-STATUS-AND-ESIGN-PLAN.md` §4–5.
- ตั้ง access-token lifetime 10 นาที และกำหนด refresh-token idle/absolute policy.
- ลงทะเบียนและทดสอบ Passkey/biometric login.
- Cloudflare Tunnel มีข้อจำกัดเรื่องการ force HTTP/2 ไป origin ตามเอกสาร Zitadel;
  Console และ OIDC browser flow ผ่านแล้ว แต่ต้องทดสอบ native gRPC client แยกก่อนถือว่า
  topology นี้รองรับทุก protocol.
