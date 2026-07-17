# Login V2 fork — custom login UI (runbook)

> อัปเดต: 2026-07-17
> Fork: `github.com/KritapasPame/zitadel` branch **`custom-login`** (base tag **v4.16.0** = ตรงกับ Zitadel server)
> Local clone: `../zitadel-login-fork` (sibling ของ authservice)
> Image: **`edm/zitadel-login:v4.16.0`**

ทำไม fork: ต้องการ login UI หน้าตาของเราเอง (Figma mockup) — `apps/login/` เป็น **MIT**
(ไม่ใช่ AGPL core) fork มาแก้แล้วเก็บ private ได้ ดู [RESEARCH-BUILD-VS-BUY-AUTH.md](RESEARCH-BUILD-VS-BUY-AUTH.md) §10

---

## 1. หลักการ isolation (สำคัญ — กัน merge ชน)

> **กฎ: customization อยู่ในไฟล์ของเรา ห้ามรื้อไฟล์ upstream**

| ไฟล์ | เจ้าของ | หมายเหตุ |
|------|---------|----------|
| `apps/login/src/styles/edm-brand.scss` | **เรา** | CSS/design token ทั้งหมด — upstream ไม่มีไฟล์นี้ → merge ไม่มีทางชน |
| `apps/login/src/components/edm-login-form.tsx` | **เรา** | ฟอร์มรวม loginname+password |
| `apps/login/src/app/(login)/layout.tsx` | upstream | แตะ **1 บรรทัด** (import edm-brand.scss) |
| `apps/login/src/app/(login)/loginname/page.tsx` | upstream | แตะ ~4 บรรทัด (สลับ `UsernameForm` → `EdmLoginForm`) |

รวมแตะ upstream **~5 บรรทัด** — เช็คได้ด้วย `git diff --stat`

**สิ่งที่ต้องตั้งเป็น config ไม่ใช่ CSS** (รอด update ฟรี): สีs primary, logo, custom login text
→ ตั้งใน **Zitadel branding setting** (Console) ไม่ใช่ในโค้ด

---

## 2. Flow ที่แก้ — loginname + password จอเดียว

Zitadel default = 2 จอ เพราะขั้นถัดไปขึ้นกับ user (password/passkey/MFA/IdP)
`edm-login-form.tsx` ทำแบบ **optimistic + fallback**:

1. `sendLoginname()` → ค้น user + สร้าง session
2. ถ้าตอบว่าให้ไป `/password` → ยิง `sendPassword()` ต่อทันที = **จบจอเดียว**
3. ถ้าเป็น passkey/MFA/IdP/verify → **ปล่อยกลับ flow เดิมของ Zitadel** (ไม่พัง)

> ⚠️ **ยังไม่ได้ verify ด้วย user จริง** — เห็นแค่ว่า render ถูก chain `sendLoginname→sendPassword` ยังไม่เคยยิงจริง

---

## 3. Dev (local)

```bash
cd ../zitadel-login-fork
pnpm exec nx dev @zitadel/login       # nx จะ build @zitadel/client + proto ให้ก่อน
# → http://127.0.0.1:3000/ui/v2/login/loginname
```

ต้องมี `apps/login/.env.local` (gitignored):
```env
ZITADEL_API_URL=https://authservice.edmcompany.co.th
ZITADEL_SERVICE_USER_TOKEN=<login-client PAT>
ZITADEL_SERVICE_USER_TOKEN_FILE=          # ปิด token-file flow ของ upstream .env
CUSTOM_REQUEST_HEADERS=x-zitadel-instance-host:authservice.edmcompany.co.th,x-zitadel-public-host:authservice.edmcompany.co.th
NEXT_PUBLIC_THEME_ROUNDNESS=mid
NEXT_PUBLIC_THEME_LAYOUT=top-to-bottom
NEXT_PUBLIC_THEME_SPACING=regular
NEXT_PUBLIC_THEME_APPEARANCE=material
```

### กับดัก dev ที่เจอมาแล้ว (อย่าเสียเวลาซ้ำ)

| อาการ | สาเหตุ | แก้ |
|-------|--------|-----|
| **หน้าขาว, log ฟ้อง 404 + `fetch() returned undefined`** | dev ส่ง `host: 127.0.0.1:3000` เป็น instance host → Zitadel multi-tenant หา instance ไม่เจอ | `CUSTOM_REQUEST_HEADERS` (ต้องใส่ **ทั้ง** instance-host และ public-host — ขาดตัวใดตัวหนึ่ง = 404) |
| dev ค้าง `Awaiting file and reading token` | `apps/login/.env` ตั้ง `ZITADEL_SERVICE_USER_TOKEN_FILE=../../login-client.pat` แล้ว `entrypoint.sh` export ทับ | ตั้ง `ZITADEL_SERVICE_USER_TOKEN_FILE=` (ว่าง) ใน `.env.local` |
| `pnpm dev` ตรงๆ → `Can't resolve '@zitadel/client/node'` | workspace package ยังไม่ build | ใช้ `nx dev` (มี `dependsOn: ["^build"]`) |
| `/bin/sh: pnpm: command not found` | script เรียก `pnpm` ตรงๆ | `corepack enable pnpm` |
| **build ล้ม** `mv: .next/standalone/apps/login/server.js: No such file` | Next.js เลือก workspace root ผิดเพราะเจอ lockfile แปลกปลอมใน parent dir | ลบ lockfile ขยะนั้น (เคยมี `Workspaces/kritapas/package-lock.json` — ลบไปแล้ว 2026-07-17) |

---

## 4. Build image

```bash
cd ../zitadel-login-fork
pnpm exec nx pack @zitadel/login                                  # → zitadel/zitadel-login:local
docker tag zitadel/zitadel-login:local edm/zitadel-login:v4.16.0  # retag ให้ชัดว่าไม่ใช่ official
```

- `NEXT_PUBLIC_*` (theme) ถูก **inline ตอน build** → เปลี่ยน theme = ต้อง rebuild
- `ZITADEL_SERVICE_USER_TOKEN` เป็น server-side → **ไม่ถูกอบเข้า image** (verify แล้วด้วย `grep` ทั้ง image ไม่เจอ)

---

## 5. Deploy ขึ้น pre-test (`10.7.219.156`)

Topology: Cloudflare Tunnel → `10.7.219.156:443` → nginx (TLS) → `zitadel:8080` / `login:3000`
(ดู [PRETEST-AUTH-DEPLOYMENT.md](PRETEST-AUTH-DEPLOYMENT.md))

### 5.1 ส่ง image ขึ้นเครื่อง

**วิธี A — docker save/load ผ่าน ssh** (ง่ายสุด อยู่ LAN เดียวกัน ไม่ต้องมี registry):
```bash
docker save edm/zitadel-login:v4.16.0 | gzip | \
  ssh <user>@10.7.219.156 'gunzip | docker load'
```

**วิธี B — ghcr.io** (ดีกว่าถ้า deploy บ่อย):
```bash
docker tag edm/zitadel-login:v4.16.0 ghcr.io/kritapaspame/zitadel-login:v4.16.0
echo $GITHUB_TOKEN | docker login ghcr.io -u KritapasPame --password-stdin
docker push ghcr.io/kritapaspame/zitadel-login:v4.16.0
# บนเครื่อง: docker login ghcr.io && docker pull ... (+ แก้ image ใน compose)
```

### 5.2 ตั้ง env บนเครื่อง (`authservice/.env` ของ **server**)

```env
ZITADEL_EXTERNALDOMAIN=authservice.edmcompany.co.th   # ควรตั้งอยู่แล้ว
LOGIN_CLIENT_PAT=<PAT ของ SA บทบาท IAM_LOGIN_CLIENT>  # ← ตัวที่ยังขาด
```

> ❗ **prod ไม่ต้องใส่ `CUSTOM_REQUEST_HEADERS`** — nginx ส่ง `Host: authservice.edmcompany.co.th`
> อยู่แล้ว → instance host ถูกเอง (ต่างจาก local ที่เป็น `127.0.0.1:3000`)

### 5.3 รัน

```bash
docker compose --profile login up -d login
docker compose logs -f login          # ดูว่า boot ผ่าน
```

### 5.4 nginx route

`docs/PRETEST-AUTH-DEPLOYMENT.md` มี block นี้อยู่แล้ว — **ต้องเช็คว่าถูก apply บนเครื่องจริงหรือยัง**
(nginx config ไม่ได้อยู่ใน repo นี้):

```nginx
location /ui/v2/login {
    proxy_pass http://login:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-Host $host;
}
```
- prefix ยาวกว่าจึงชนะ `location /` (ที่เป็น grpc_pass)
- nginx กับ login ต้องอยู่ network `proxy` ด้วยกัน (compose ตั้งไว้แล้ว)
- ถ้า login container ไม่รัน → **502**

### 5.5 เปิด Login V2 ให้แอป

compose ตั้ง `ZITADEL_DEFAULTINSTANCE_FEATURES_LOGINV2_REQUIRED=false` (Console/ops ยังใช้ V1)
→ เปิด **per-application** ที่ Console: แอป OIDC → **"Use new login UI"**
(ดู [Applications overview](https://zitadel.com/docs/guides/manage/console/applications-overview))

### 5.6 ทดสอบ

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://authservice.edmcompany.co.th/ui/v2/login/loginname   # คาดหวัง 200
```
แล้ว login จริงด้วย user ทดสอบ → เช็คว่า chain `sendLoginname→sendPassword` จบสวย

---

## 6. Merge อัปเดตจาก upstream

```bash
cd ../zitadel-login-fork
git fetch upstream
git merge v4.17.0            # หรือ tag ที่ตรงกับ Zitadel server version
# conflict คาดว่าจะมีแค่ layout.tsx / loginname/page.tsx (ไฟล์ที่เราแตะ ~5 บรรทัด)
pnpm exec nx pack @zitadel/login && docker tag zitadel/zitadel-login:local edm/zitadel-login:v4.16.0
```

> **สำคัญ: version ของ login ควรตรงกับ Zitadel server** — ถ้าอัป server เป็น v4.17 ก็ merge tag v4.17 แล้ว rebuild

---

## 7. ค้างอยู่ (TODO)

- [ ] **verify login จริงด้วย user จริง** (chain `sendLoginname→sendPassword`)
- [ ] ใส่ `LOGIN_CLIENT_PAT` ใน `.env` ของ server
- [ ] deploy image ขึ้น pre-test + เช็ค nginx route ถูก apply
- [ ] ตั้ง branding (สีส้ม, logo, custom login text ไทย) ใน Zitadel Console
- [ ] แต่ง CSS ตาม mockup ใน `edm-brand.scss` (ปุ่ม pill, icon ใน input, ฟอนต์ไทย)
- [ ] ตั้ง Google/Apple IdP (prod ยังไม่มี → ปุ่ม social ไม่ขึ้น) — ดู memory `social-login-deferred`
