# Login V2 fork — custom login UI (runbook)

> อัปเดต: 2026-07-17
> Fork: `github.com/KritapasPame/zitadel` branch **`custom-login`** (base tag **v4.16.0** = ตรงกับ Zitadel server)
> Local clone (dev): `~/Workspaces/kritapas/zitadel-login-fork` (sibling ของ authservice)
> Path บน pre-test server: **`/opt/zitadel-login-fork`**
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
| `apps/login/Dockerfile.edm` | **เรา** | build ครบจบในตัว (ดู §4 ว่าทำไมไม่ใช้ `nx pack`) |
| `.dockerignore` (repo root) | **เรา** | กัน secret/ของหนักออกจาก build context |

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

> ❗ **ใช้ `apps/login/Dockerfile.edm` เท่านั้น — อย่าใช้ `nx pack`**

```bash
cd ../zitadel-login-fork
docker build -f apps/login/Dockerfile.edm -t edm/zitadel-login:v4.16.0 .   # context = repo root
```

### ทำไมห้ามใช้ `nx pack` (upstream)

`nx pack` → `apps/login/Dockerfile` ซึ่ง **COPY `.next/standalone` ที่ build จาก host เข้ามา**
→ build บน Mac แล้วได้ **binary ของ macOS** ติดไปใน image linux:

```
.next/standalone/node_modules/.pnpm/@img+sharp-darwin-arm64@0.34.5/...   ❌
```

อาการบน server: `The requested image's platform (linux/arm64) does not match
the detected host platform (linux/amd64/v3)` — และใส่ `--platform linux/amd64` **ก็ไม่ช่วย**
เพราะ binary ข้างในยังเป็น darwin อยู่ดี

`Dockerfile.edm` build **ข้างใน container** → deps ตรง arch เป้าหมายเสมอ:

| build ด้วย | sharp ที่ได้ |
|-----------|-------------|
| `nx pack` บน Mac | `@img+sharp-darwin-arm64` ❌ |
| `Dockerfile.edm` | `@img+sharp-linuxmusl-<arch>` ✅ |

### ข้าม arch จากเครื่อง Mac (ช้า — qemu emulation)

```bash
docker buildx build --platform linux/amd64 -f apps/login/Dockerfile.edm \
  -t edm/zitadel-login:v4.16.0 --load .
```
> Colima บน Apple Silicon = arm64 → amd64 ต้อง emulate **ช้ามาก** แนะนำ build บน server แทน (§5.1)

### กับดักตอน build (เจอมาแล้วบน server)

| อาการ | สาเหตุ | แก้ |
|-------|--------|-----|
| `exec /app/entrypoint.sh: exec format error` | รัน image **arm64** บนเครื่อง amd64 (เผลอ `docker save\|load` จาก Mac) | build บน server, ยืนยันด้วย `docker image inspect ... --format '{{.Architecture}}'` ต้องได้ `amd64`; ลบ image เก่าก่อน `docker rmi -f` |
| `Corepack ... Error: EAI_AGAIN` ตอน `nx build` | repo มี `packageManager` 2 เวอร์ชัน (root `10.30.3`, `apps/login` `10.28.2`) → corepack โหลด pnpm ใหม่กลางคัน | Dockerfile.edm ใช้ `npm i -g pnpm` + `COREPACK_ENABLE_STRICT=0` แทน corepack (แก้แล้ว) |
| `EAI_AGAIN registry.npmjs.org` ตอน `pnpm install` (โหลดไปเกือบครบแล้วตาย) | **musl (Alpine)** — ดู "ทำไมต้อง slim" ข้างล่าง | ใช้ base `node:24-slim` (glibc) + `--network-concurrency=4` (แก้แล้ว) |
| `x509: certificate signed by unknown authority` ตอน `buf generate` | `node:*-slim` **ไม่มี `ca-certificates`** ติดมา (alpine มี) | `apt-get install ca-certificates` — ต้องลง **ทั้ง builder และ runtime** (runtime ก็ใช้ `SSL_CERT_FILE`) (แก้แล้ว) |

### ทำไมต้อง `node:24-slim` ไม่ใช่ `-alpine`

**อาการ:** `pnpm install` โหลดสำเร็จ **2158 จาก 2160** package แล้วตายที่ตัวท้าย โดย
`EAI_AGAIN` โผล่กระปริดกระปรอยตลอดทาง — ขณะที่ `docker pull` / `apt` บนเครื่องเดียวกันปกติดี

**ทำไมมีแค่ build นี้ที่พัง** — คำนวณจากหลักฐาน: 2158/2160 → อัตราพลาดต่อ lookup ≈ **0.05%**

| งาน | DNS lookup | โอกาสสำเร็จ |
|------|-----------|-------------|
| `docker pull` | ~1 | 99.95% (ไม่มีทางสังเกตเห็น) |
| `pnpm install` (2160 pkg) | หลายพัน | **~34%** → พัง 2 ใน 3 ครั้ง |

→ **DNS ของ server ไม่ได้พัง** มันดี 99.95% (monitoring บอก healthy) แต่แพ้ทางสถิติเมื่อยิงหลายพันครั้ง
**อย่าไปไล่แก้ DNS server — ผิดทาง**

**ต้นเหตุจริง = musl ของ Alpine:**
- musl ยิง **A + AAAA query ขนานกัน** จาก UDP socket เดียว
- ตั้งแต่ [musl commit `5cf1ac24`](https://git.musl-libc.org/cgit/musl/commit/src/network/lookup_name.c?id=5cf1ac2443ad0dba263559a3fe043d929e0e5c4c) (2020) — **ถ้าตัวใดตัวหนึ่ง fail = ทั้ง lookup พังเป็น `EAI_AGAIN`** แม้อีกตัวจะสำเร็จ
- musl **ใช้ `single-request-reopen` ไม่ได้** (ทางแก้มาตรฐานของ glibc) — [musl wiki](https://wiki.musl-libc.org/functional-differences-from-glibc.html)
- แพ็กเก็ตหายเป็นครั้งคราวจาก conntrack NAT race บน bridge network ([k8s#56903](https://github.com/kubernetes/kubernetes/issues/56903))

glibc ทน scenario เดียวกันได้ → เปลี่ยน base = แก้ที่ต้นเหตุ (แลกกับ image ใหญ่ขึ้น ~130MB)

> **โบนัส:** `sharp` บน Alpine ต้อง rebuild เอง ([sharp docs](https://sharp.pixelplumbing.com/install/)) — ใช้ glibc แล้วหมดปัญหานี้ด้วย

**⚠️ 2 อย่างที่อย่าทำ (เคยแนะนำผิด):**
- **`docker build --network=host`** — BuildKit driver แบบ container อ่าน host resolv.conf ไม่เจอ แล้ว
  **fallback ไป `8.8.8.8` เงียบๆ** ([moby/buildkit#5009](https://github.com/moby/buildkit/issues/5009)) ถ้า firewall บล็อก = แย่กว่าเดิม
- **แก้ `/etc/docker/daemon.json` ใส่ DNS** — ไม่ใช่ต้นเหตุ และ **ไม่ propagate ไป BuildKit worker**
  แบบ `docker-container` ([moby/buildkit#734](https://github.com/moby/buildkit/issues/734))

> เกร็ด: pnpm ≥10.24 สเกล network-concurrency อัตโนมัติ **16→64** ตามจำนวน worker
> ([pnpm 10.24](https://pnpm.io/blog/releases/10.24)) — บนเครื่อง core เยอะยิ่งยิงหนัก จึงล็อกไว้ที่ 4

> เกร็ด 2: ข้อมูลที่ว่า "Docker embedded DNS จำกัด 100 concurrent" เป็น**ข้อมูลเก่า** —
> ปัจจุบัน `maxConcurrent = 1024` ตั้งแต่ Docker 24.0 ([moby PR#44664](https://github.com/moby/moby/pull/44664)) สูงกว่า pnpm มาก

> 💡 ทดสอบ Dockerfile ต้องใช้ `--no-cache` เสมอ — ไม่งั้นเครื่อง dev ที่ cache ไว้แล้วจะไม่เจอบั๊กที่ server (เครื่องสะอาด) เจอ

### หมายเหตุ build

- ต้องมี **เน็ต** ตอน build (`buf generate` ดึง proto deps ตาม `proto/buf.lock`)
- `NEXT_PUBLIC_*` (theme) ถูก **inline ตอน build** → เปลี่ยน theme = ต้อง rebuild
  (ส่งตอน runtime ไม่มีผลกับ client bundle) — ปรับผ่าน `--build-arg` ได้:
  ```bash
  docker build -f apps/login/Dockerfile.edm --build-arg NEXT_PUBLIC_THEME_ROUNDNESS=full ...
  ```
- `.dockerignore` กัน `.env.local` / `login-client.pat` ออกจาก build context → **PAT ไม่มีทางเข้า image**
  (verify แล้ว: `grep` ทั้ง image ไม่เจอ token)

---

## 5. Deploy ขึ้น pre-test (`10.7.219.156`)

Topology: Cloudflare Tunnel → `10.7.219.156:443` → nginx (TLS) → `zitadel:8080` / `login:3000`
(ดู [PRETEST-AUTH-DEPLOYMENT.md](PRETEST-AUTH-DEPLOYMENT.md))

### 5.1 เอา image ขึ้นเครื่อง — **build บน server (แนะนำ)**

server เป็น **amd64 native** → build ที่นั่นเร็วและถูก arch, ส่งแค่ ~160MB (gzip, LAN)
และ **โค้ดเราไม่ต้อง push ขึ้น fork สาธารณะ**

> **path บน server: `/opt/zitadel-login-fork`** (project รวมอยู่ใต้ `/opt` ทั้งหมด)
> เข้ากับคอมเมนต์ใน `docker-compose.yml` (`../zitadel-login-fork`) พอดี ถ้า authservice อยู่ `/opt/authservice`

> ❗ **server ไม่มี `rsync`** → ใช้ **tar over ssh** (ต้องการแค่ `ssh` + `tar`)
> ❗ **อย่า `sudo tar xzf -`** — stdin ถูก tarball ยึด sudo ขอ password ไม่ได้ → สร้าง dir + chown ก่อน

```bash
# 1) เตรียม dir (แยก step ให้ sudo ขอ password ได้)
ssh <user>@10.7.219.156 'sudo mkdir -p /opt/zitadel-login-fork && sudo chown $(whoami) /opt/zitadel-login-fork'

# 2) ส่ง source
cd ~/Workspaces/kritapas/zitadel-login-fork
tar czf - \
  --exclude='./.git' \
  --exclude='./node_modules' \
  --exclude='*/node_modules' \
  --exclude='*/.next' \
  --exclude='./.nx' \
  --exclude='*/.env.local' \
  --exclude='./login-client.pat' \
  . | ssh <user>@10.7.219.156 'tar xzf - -C /opt/zitadel-login-fork'

# 3) build บน server (มีแค่ docker ก็พอ ไม่ต้องลง node/pnpm — ต้องมีเน็ต)
ssh <user>@10.7.219.156 'cd /opt/zitadel-login-fork && docker build -f apps/login/Dockerfile.edm -t edm/zitadel-login:v4.16.0 .'
```

ถ้า user ไม่มีสิทธิ์ sudo → ส่งไป `~/` ก่อนแล้วย้าย:
```bash
tar czf - ... . | ssh <user>@10.7.219.156 'mkdir -p ~/zlf && tar xzf - -C ~/zlf'
ssh <user>@10.7.219.156 'sudo mv ~/zlf /opt/zitadel-login-fork'
```

> ตรวจแล้วว่า tar นี้: **ไม่มี** `.env.local`/`login-client.pat` (PAT ปลอดภัย), ไม่มี `node_modules`/`.git`/`.next`
> และ **มี** `Dockerfile.edm`, `.dockerignore`, `edm-*`, `pnpm-lock.yaml`, `proto/buf.lock` ครบ (11,320 ไฟล์)

**ทางเลือกอื่น:**

| วิธี | ข้อดี | ข้อเสีย |
|------|-------|---------|
| `docker save \| ssh docker load` | ไม่ต้อง build ที่ server | ต้อง build amd64 บน Mac ก่อน = qemu **ช้ามาก** |
| ghcr.io push/pull | ดีถ้า deploy บ่อย | ต้อง build amd64 ก่อนเหมือนกัน + ต้อง login registry 2 ฝั่ง |

> ⚠️ **fork `KritapasPame/zitadel` เป็น public** (fork ของ repo public บังคับ public)
> ถ้า push custom UI ขึ้นไป = เปิดเผยต่อสาธารณะ ทั้งที่ MIT ให้สิทธิ์เก็บ private ได้
> อยากเก็บ private → สร้าง repo **private** แยก แล้ว `git remote add upstream https://github.com/zitadel/zitadel.git` เอง
> (ไม่ใช่กดปุ่ม Fork) — ตอนนี้ **ยังไม่ได้ push อะไรขึ้น fork**

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
