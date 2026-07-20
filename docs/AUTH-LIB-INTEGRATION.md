# คู่มือผนวก `@platform/auth` เข้า API ฝั่ง product (เริ่มจาก eSign)

> อัปเดตล่าสุด: 2026-07-20 · เวอร์ชันปัจจุบันของ lib: **1.2.0**
> อ่านคู่กับ `docs/API-INTEGRATION.md` (ภาพรวม endpoint/claims ทั่วไป) และ
> `docs/PACKAGE-DISTRIBUTION.md` (กลไกแจกจ่าย tarball) — เอกสารนี้โฟกัสเฉพาะการเอา
> `@platform/auth` ไปต่อกับ API ของ product จริง ๆ

Audience: ทีม backend ที่ทำ API (เช่น eSign) ซึ่งรับ **access token (JWT) ของ platform**
มาจาก frontend/mobile แล้วต้องตรวจว่า login แล้วหรือยัง (authentication) และมีสิทธิ์ทำ
action นั้นไหม (authorization)

---

## 1. ติดตั้ง

Lib แจกเป็น tarball บนเครื่อง pre-test (ไม่มี npm registry ส่วนกลาง) — รายละเอียดเต็มดู
`docs/PACKAGE-DISTRIBUTION.md`, สรุปเฉพาะที่ต้องรู้:

```text
https://authservice.edmcompany.co.th/packages/platform-auth-<version>.tgz
```

(basic auth — ขอ user/password จากทีม Auth)

**แนะนำ: vendor เข้า repo ของ product** (ไม่ผูก build กับ uptime ของเครื่อง pre-test):

```bash
mkdir -p vendor
curl -u esign:'<password>' -o vendor/platform-auth-1.2.0.tgz \
  https://authservice.edmcompany.co.th/packages/platform-auth-1.2.0.tgz
```

ติดตั้งจากไฟล์ vendor:

```bash
# โปรเจกต์ที่ใช้ Bun (เช่น eSign เดิม)
bun add file:./vendor/platform-auth-1.2.0.tgz

# โปรเจกต์ที่ใช้ plain Node/npm (ไม่มี Bun) — ใช้ npm/yarn/pnpm ได้ตรง ๆ เหมือนกัน
npm install ./vendor/platform-auth-1.2.0.tgz
```

ตั้งแต่ v1.2.0 ทั้งสองแบบใช้ได้จาก tarball เดียวกัน — package มี conditional `exports`:
Bun ได้ TS source ตรง ๆ (`src/index.ts`, เหมือนเดิมไม่มี build step), ส่วน Node/npm/bundler
ทั่วไปได้ build แล้ว (`dist/index.js` ESM + `dist/index.d.ts`) อัตโนมัติ — **ไม่ต้อง
ตั้งค่าอะไรเพิ่มฝั่ง product**, `import`/`require` เหมือนเดิม

อัปเดตเวอร์ชัน: download ไฟล์ .tgz version ใหม่ทับ → รัน install command เดิมอีกครั้ง

## 2. Environment variables

API ของ product ต้องตั้ง env 3 ตัวนี้เพื่อตรวจ JWT (ชื่อเดียวกับที่ entitlement ใช้เอง —
ดู `entitlement/src/config/env.ts` และ `entitlement/src/http/auth.ts`):

| Env | ความหมาย | ตัวอย่างค่า |
|---|---|---|
| `ZITADEL_JWKS_URL` | URL public key สำหรับ verify signature (RS256) | `https://authservice.edmcompany.co.th/oauth/v2/keys` |
| `ZITADEL_ISSUER` | ค่า `iss` ที่ต้องตรงเป๊ะ | `https://authservice.edmcompany.co.th` |
| `ZITADEL_AUDIENCE` | ค่า `aud` ของแอปตัวเอง (ขอจากทีม Auth ตอนสร้าง OIDC application, หรือดูจาก claim `aud` ใน token จริงตอนทดสอบ login ครั้งแรก) | client ID ของแอป eSign |

ทั้งสามค่านี้คือ 3 ฟิลด์ที่ `createRequireAuth({ jwksUrl, issuer, audience })` ต้องการตรงตัว
(ดู §3)

## 3. ใช้กับ Elysia — `createRequireAuth` ตรง ๆ

ถ้า API ของ product เป็น Elysia (เหมือน entitlement) ใช้ factory ที่ lib ให้มาได้เลย
ไม่ต้อง verify JWT เอง

**TypeScript**

```ts
import { Elysia } from 'elysia'
import { createRequireAuth, canUse } from '@platform/auth'

const requireAuth = createRequireAuth({
  jwksUrl: process.env.ZITADEL_JWKS_URL!,
  issuer: process.env.ZITADEL_ISSUER!,
  audience: process.env.ZITADEL_AUDIENCE!,
})

const app = new Elysia()
  .use(requireAuth) // ต้อง .use() ที่ instance/route จริง — derive เป็น scoped ไม่ inherit อัตโนมัติ
  .post('/documents/:id/sign', ({ auth, params, body, set }) => {
    const companyId = Number((body as any).companyId)
    // canUse = hasModule + can ในตัวเดียว — ใช้ตัวนี้เสมอฝั่ง product (ดู §6)
    if (!canUse(auth.claims, companyId, 'esign', 'esign.document.sign')) {
      set.status = 403
      return { error: 'forbidden' }
    }
    // token ไม่ valid/หมดอายุ → requireAuth throw 401 ให้เองแล้ว ไม่ต้องเช็คซ้ำที่นี่
    return { ok: true, signedBy: auth.sub }
  })
  .listen(3000)
```

**JavaScript** (เหมือนกันทุกจุด แค่ตัด type annotation)

```js
import { Elysia } from 'elysia'
import { createRequireAuth, canUse } from '@platform/auth'

const requireAuth = createRequireAuth({
  jwksUrl: process.env.ZITADEL_JWKS_URL,
  issuer: process.env.ZITADEL_ISSUER,
  audience: process.env.ZITADEL_AUDIENCE,
})

const app = new Elysia()
  .use(requireAuth)
  .post('/documents/:id/sign', ({ auth, body, set }) => {
    const companyId = Number(body.companyId)
    if (!canUse(auth.claims, companyId, 'esign', 'esign.document.sign')) {
      set.status = 403
      return { error: 'forbidden' }
    }
    return { ok: true, signedBy: auth.sub }
  })
  .listen(3000)
```

## 4. ใช้กับ framework อื่น (Express / Fastify / Next.js route handler)

`createRequireAuth` คืนค่าเป็น **Elysia plugin instance** — ใช้กับ framework อื่นตรง ๆ
ไม่ได้ ต้อง verify JWT เองด้วย `jose` (dependency ของ `@platform/auth` อยู่แล้ว ไม่ต้องลง
เพิ่ม) แล้วเอา `can`/`canUse`/`canManageTenant`/`isSuperadmin` มาต่อ — pattern เดียวกับที่
`createRequireAuth` ทำข้างในทุกอย่าง แค่ย้ายมาเขียนเอง

### แกนกลาง (ใช้ร่วมกันได้ทุก framework)

**TypeScript** — `auth.ts`

```ts
import { createRemoteJWKSet, jwtVerify } from 'jose'

const JWKS = createRemoteJWKSet(new URL(process.env.ZITADEL_JWKS_URL!))

export type AuthContext = { sub: string; claims: Record<string, any> }

// คืน AuthContext ถ้า token valid, null ถ้าไม่ผ่าน (ไม่ว่าเหตุผลอะไร — ไม่มี token,
// signature ผิด, iss/aud ไม่ตรง, หมดอายุ — jose ไม่แยกให้เชื่อถือได้พอจะ branch โค้ด
// ต่าง กัน caller แค่ตอบ 401 เหมือนกันหมด เหมือนพฤติกรรมของ createRequireAuth เอง)
export async function verifyAuth(authorizationHeader?: string): Promise<AuthContext | null> {
  const token = authorizationHeader?.replace('Bearer ', '')
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: process.env.ZITADEL_ISSUER!,
      audience: process.env.ZITADEL_AUDIENCE!,
    })
    return { sub: payload.sub as string, claims: payload as Record<string, any> }
  } catch {
    return null
  }
}
```

**JavaScript** — `auth.js` (CommonJS; ใช้ `import`/`export` ได้เหมือนกันถ้าโปรเจกต์เป็น ESM)

```js
const { createRemoteJWKSet, jwtVerify } = require('jose')

const JWKS = createRemoteJWKSet(new URL(process.env.ZITADEL_JWKS_URL))

async function verifyAuth(authorizationHeader) {
  const token = authorizationHeader?.replace('Bearer ', '')
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: process.env.ZITADEL_ISSUER,
      audience: process.env.ZITADEL_AUDIENCE,
    })
    return { sub: payload.sub, claims: payload }
  } catch {
    return null
  }
}

module.exports = { verifyAuth }
```

### Express

**JavaScript**

```js
const express = require('express')
const { verifyAuth } = require('./auth')
const { canUse } = require('@platform/auth')

const app = express()
app.use(express.json())

async function requireAuth(req, res, next) {
  const ctx = await verifyAuth(req.headers.authorization)
  if (!ctx) return res.status(401).json({ error: 'unauthorized' })
  req.auth = ctx
  next()
}

app.post('/documents/:id/sign', requireAuth, (req, res) => {
  const companyId = Number(req.body.companyId)
  if (!canUse(req.auth.claims, companyId, 'esign', 'esign.document.sign')) {
    return res.status(403).json({ error: 'forbidden' })
  }
  res.json({ ok: true, signedBy: req.auth.sub })
})

app.listen(3000)
```

**TypeScript** (เพิ่ม type ให้ `req.auth`)

```ts
import express, { type Request, type Response, type NextFunction } from 'express'
import { verifyAuth, type AuthContext } from './auth'
import { canUse } from '@platform/auth'

declare global {
  namespace Express {
    interface Request { auth?: AuthContext }
  }
}

const app = express()
app.use(express.json())

async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const ctx = await verifyAuth(req.headers.authorization)
  if (!ctx) { res.status(401).json({ error: 'unauthorized' }); return }
  req.auth = ctx
  next()
}

app.post('/documents/:id/sign', requireAuth, (req: Request, res: Response) => {
  const companyId = Number(req.body.companyId)
  if (!canUse(req.auth!.claims, companyId, 'esign', 'esign.document.sign')) {
    res.status(403).json({ error: 'forbidden' }); return
  }
  res.json({ ok: true, signedBy: req.auth!.sub })
})

app.listen(3000)
```

### Fastify (onRequest hook เดียวกันหลักการ)

```ts
import Fastify from 'fastify'
import { verifyAuth, type AuthContext } from './auth'
import { canUse } from '@platform/auth'

declare module 'fastify' {
  interface FastifyRequest { auth?: AuthContext }
}

const app = Fastify()

app.addHook('onRequest', async (req, reply) => {
  const ctx = await verifyAuth(req.headers.authorization)
  if (!ctx) return reply.status(401).send({ error: 'unauthorized' })
  req.auth = ctx
})

app.post('/documents/:id/sign', async (req, reply) => {
  const { companyId } = req.body as { companyId: number }
  if (!canUse(req.auth!.claims, companyId, 'esign', 'esign.document.sign')) {
    return reply.status(403).send({ error: 'forbidden' })
  }
  return { ok: true, signedBy: req.auth!.sub }
})

app.listen({ port: 3000 })
```

### Next.js (App Router route handler)

```ts
// app/api/documents/[id]/sign/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { canUse } from '@platform/auth'

export async function POST(req: NextRequest) {
  const ctx = await verifyAuth(req.headers.get('authorization') ?? undefined)
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { companyId } = await req.json()
  if (!canUse(ctx.claims, companyId, 'esign', 'esign.document.sign')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  return NextResponse.json({ ok: true, signedBy: ctx.sub })
}
```

(JS ล้วนสำหรับ Fastify/Next.js เหมือนกัน — ตัด type annotation ออกตามรูปแบบ Express ด้านบน)

## 5. Claims shape ที่จะได้ในตัว JWT

Custom claims ทุกตัว prefix ด้วย `urn:platform:` (มาจาก Zitadel Action ที่แปลง
`entitlement/src/claims/resolver.ts` → token, ดู `zitadel/actions/token-claims.md`)
type จริงของฝั่งเรา (`packages/contracts/src/index.ts`):

```ts
type Grant = { roles: string[]; permissions: string[] }
type PlatformClaims =
  | { tenantId: number; companies: number[]; modules: string[]; grants: Record<string, Grant>; package?: string }
  | { role: 'superadmin' }
  | {} // unprovisioned
```

แปลงเป็น claim จริงในตัว JWT:

| Claim | ประเภท | มีเมื่อ | ความหมาย |
|---|---|---|---|
| `urn:platform:role` | `"superadmin"` | เฉพาะ platform admin | ดู §5.1 |
| `urn:platform:tenantId` | number | user ที่ provision แล้ว | tenant ที่ user สังกัด |
| `urn:platform:companies` | number[] | user ที่ provision แล้ว | company id ทั้งหมดที่ user เข้าถึง |
| `urn:platform:modules` | string[] | user ที่ provision แล้ว | module ที่ **tenant** เปิดใช้งาน (ไม่ใช่สิทธิ์รายคน) |
| `urn:platform:grants` | `{ [companyId: string]: { roles: string[]; permissions: string[] } }` | user ที่ provision แล้ว | สิทธิ์จริงต่อ company — `permissions: ["*"]` = ได้ทุก permission **ของ company นั้น** |
| `urn:platform:package` | string | เฉพาะ tenant ที่ผูก package | package slug ของ tenant (ยังไม่มี helper ใน `@platform/auth` ใช้ตรง ๆ — ถ้าต้องเช็ค business logic ตาม package อ่านค่านี้เอง) |

### 5.1 กติกาสำคัญ 3 ข้อ — ต้องรู้ก่อนเขียน permission check

1. **Superadmin ไม่มี grants** — claims ของ superadmin คือ `{ role: 'superadmin' }`
   เท่านั้น ไม่มี `tenantId`/`companies`/`modules`/`grants` เลย ผลคือ **`canUse()`/`can()`
   จะคืน `false` ให้ superadmin เสมอ** (เพราะไม่มี `urn:platform:modules`/`grants` ให้เช็ค)
   ถ้า product ต้องการให้ superadmin bypass permission check ของตัวเอง (เช่น support
   engineer เข้าไป debug เอกสารลูกค้า) **ต้องเช็ค `isSuperadmin(claims)` เพิ่มเอง**:
   ```ts
   if (!isSuperadmin(auth.claims) && !canUse(auth.claims, companyId, 'esign', 'esign.document.sign')) {
     set.status = 403; return { error: 'forbidden' }
   }
   ```
2. **ไม่มี `'*'` ต่ำกว่า superadmin แล้ว (V2)** — เดิม (V1) มี concept "grant all แบบ
   ข้าม tenant"; ตอนนี้ `'*'` ใน `permissions` ของ grant หมายถึง "ได้ทุก permission
   **เฉพาะ company ที่ grant นั้นผูกอยู่**" เท่านั้น ไม่ทะลุ company อื่น และไม่ทะลุ
   module ที่ tenant ไม่ได้เปิด (เงื่อนไขหลังนี้คือเหตุผลที่ต้องใช้ `canUse` ไม่ใช่ `can`
   — ดู §6)
3. **User ที่ยังไม่ provision → claims ว่างเปล่า** (`{}` ไม่มี key `urn:platform:*`
   เลยสักตัว) — เช่น login ผ่าน Zitadel สำเร็จแต่ยังไม่ได้ invite เข้า entitlement
   ทุก helper ของ `@platform/auth` treat กรณีนี้เป็น "ไม่มีสิทธิ์อะไรเลย" โดยอัตโนมัติ
   (ไม่ throw, ไม่ undefined error) — product แค่ต้องโชว์ข้อความที่เหมาะสม (ดู §7)

## 6. Helper ทุกตัวใน `@platform/auth`

| Function | Signature | ใช้เมื่อไหร่ | Gotcha |
|---|---|---|---|
| `createRequireAuth` | `(opts: { jwksUrl, issuer, audience }) => Elysia plugin` | setup middleware บน Elysia ครั้งเดียวตอน boot app | คืนเป็น Elysia instance — ใช้กับ framework อื่นไม่ได้ (ดู §4); ต้อง `.use()` ที่ instance/route จริง เพราะ `derive` เป็น `{ as: 'scoped' }` ไม่ inherit อัตโนมัติ ถ้าลืม route จะไม่มี `auth` เลย (undefined, ไม่ error ตอน compile) |
| `isSuperadmin` | `(claims) => boolean` | เช็คว่าเป็น platform superadmin (ข้าม tenant ทั้งหมด) | claims ของ superadmin ไม่มี `grants`/`tenantId` — อย่าเอาไปเรียก `getGrant`/`can` ต่อ (ได้ผลลัพธ์ "ไม่มีสิทธิ์" เสมอ ไม่ error แต่ความหมายผิด) |
| `canManageTenant` | `(claims, tenantId, perm?) => boolean` | guard endpoint ระดับจัดการ tenant (invite user, ตั้ง role) — เป็น platform-plane ไม่ใช่ resource ปกติของ product | ไม่ส่ง `perm` = เฉพาะคนถือ `'*'` ผ่าน (ใช้เฉพาะ escalation-sensitive อย่าง role management); ปกติ eSign ไม่ต้องใช้ตัวนี้ (ไม่ได้จัดการ tenant/user เอง) |
| `getGrant` | `(claims, companyId) => Grant` | ดึง `{ roles, permissions }` ดิบของ company หนึ่ง เผื่อ custom logic ที่ `canUse` ไม่ครอบ | ไม่มี grant ที่ company นั้น → คืน `{ roles: [], permissions: [] }` เฉย ๆ ไม่ throw |
| `can` | `(claims, companyId, perm) => boolean` | เช็ค permission ดิบของ company เดียว **ไม่ผ่าน module filter** | **ห้ามใช้เดี่ยว ๆ ฝั่ง product** — user ที่ถือ `'*'` (grant_all) จะทะลุ module ที่ tenant ไม่ได้เปิดด้วย เพราะ permission key ปัจจุบันไม่ได้ prefix ด้วย module เสมอไป (ดู `docs/KNOWN-LIMITATIONS-v1.md`) ใช้ `canUse` แทนเสมอ |
| `hasModule` | `(claims, moduleKey) => boolean` | เช็คว่า **tenant** เปิดใช้โมดูลนี้หรือยัง | เช็คระดับ tenant เท่านั้น ไม่บอกว่า user คนนี้มีสิทธิ์ทำอะไรในโมดูล — ต้องคู่กับ `can`/`canUse` เสมอ |
| `canUse` | `(claims, companyId, moduleKey, perm) => boolean` | **API หลักที่ product ควรใช้เช็คสิทธิ์ทุกครั้ง** — รวม `hasModule` + `can` ในตัวเดียว | คืน `false` ให้ superadmin เสมอ (ดู §5.1 ข้อ 1); ปิดช่องโหว่ `'*'` ทะลุ module (ดู `can` แถวบน และ `packages/auth/tests/helpers.test.ts`) |

## 7. เคสที่ต้อง handle

| เคส | HTTP status | ทำอย่างไร |
|---|---|---|
| ไม่มี header `Authorization`, token เสีย/ปลอม, signature ไม่ตรง, `iss`/`aud` ไม่ตรง, **token หมดอายุ** | **401** | ทุกเคสนี้แยกกันไม่ได้ (`jose` throw คนละ error class แต่ `createRequireAuth`/`verifyAuth` ข้างบนจับรวมเป็น "ไม่ valid" หมด) — ตอบ 401 เดียวกันหมด ฝั่ง client เห็น 401 แล้วพา user ไป login ใหม่ (refresh token หรือ redirect ไป authorize ใหม่) |
| Token valid แต่ user ไม่มีสิทธิ์ทำ action นั้น (`canUse` คืน `false`) — รวมถึง user ที่ยัง**ไม่ provision** (claims ว่าง) | **403** | ตอบ 403 พร้อมข้อความชัดเจนใน UI ของ product เอง (เช่น "คุณไม่มีสิทธิ์เซ็นเอกสารนี้") **ห้าม crash / 500** และ **ห้ามลิงก์ไปหน้า Zitadel Console หรือ entitlement admin** — หลักการของระบบคือ end user ไม่ควรเห็น/รู้จักเครื่องมือฝั่ง platform เลย (ดู `docs/PRETEST-PHASE1-STATUS-AND-ESIGN-PLAN.md`); ถ้า user ควรมีสิทธิ์แต่ไม่มี ให้ทีมนั้นติดต่อ tenant admin ของบริษัทตัวเอง ไม่ใช่ทีม Auth |

## 8. จาก 0 ถึงยิง API แรกได้ (copy-paste ได้จริง — ตัวอย่าง Express + plain JS)

```bash
mkdir esign-api && cd esign-api
npm init -y
npm install express jose
mkdir vendor
curl -u esign:'<password>' -o vendor/platform-auth-1.2.0.tgz \
  https://authservice.edmcompany.co.th/packages/platform-auth-1.2.0.tgz
npm install ./vendor/platform-auth-1.2.0.tgz
```

`.env`:

```env
ZITADEL_ISSUER=https://authservice.edmcompany.co.th
ZITADEL_JWKS_URL=https://authservice.edmcompany.co.th/oauth/v2/keys
ZITADEL_AUDIENCE=<client id ของแอป eSign — ขอทีม Auth>
PORT=3000
```

`index.js`:

```js
require('dotenv').config()
const express = require('express')
const { createRemoteJWKSet, jwtVerify } = require('jose')
const { canUse, isSuperadmin } = require('@platform/auth')

const JWKS = createRemoteJWKSet(new URL(process.env.ZITADEL_JWKS_URL))

async function verifyAuth(authorizationHeader) {
  const token = authorizationHeader?.replace('Bearer ', '')
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: process.env.ZITADEL_ISSUER,
      audience: process.env.ZITADEL_AUDIENCE,
    })
    return { sub: payload.sub, claims: payload }
  } catch {
    return null
  }
}

const app = express()
app.use(express.json())

app.post('/documents/:id/sign', async (req, res) => {
  const ctx = await verifyAuth(req.headers.authorization)
  if (!ctx) return res.status(401).json({ error: 'unauthorized' })

  const companyId = Number(req.body.companyId)
  const allowed = isSuperadmin(ctx.claims) || canUse(ctx.claims, companyId, 'esign', 'esign.document.sign')
  if (!allowed) return res.status(403).json({ error: 'forbidden' })

  res.json({ ok: true, documentId: req.params.id, signedBy: ctx.sub })
})

app.listen(process.env.PORT, () => console.log(`esign-api listening on :${process.env.PORT}`))
```

ทดสอบ (ต้องมี access token จริงจาก login flow — ดู `docs/API-INTEGRATION.md` §2 วิธีได้ token):

```bash
node index.js &
curl -X POST http://localhost:3000/documents/42/sign \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"companyId": 5}'
```

ผลที่ควรเจอ: ไม่ใส่ header → `401`; ใส่ token ของ user ที่ไม่มีสิทธิ์/ไม่ได้ provision →
`403`; ใส่ token ของ user ที่มี `esign.document.sign` ที่ company 5 → `200`
