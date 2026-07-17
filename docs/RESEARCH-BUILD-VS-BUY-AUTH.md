# Research — Auth: build เอง vs buy vs self-host + ทางเลือก library ล้วน

> อัปเดต: 2026-07-17
> ที่มา: deep-research (fan-out หลายแหล่ง + adversarial verify) 2 รอบ
> โจทย์: (1) industry จริงเขาทำ auth แบบไหนตามขนาดบริษัท (2) ถ้าอยากทำ SSO กลางเอง มี OSS "backend library ล้วน" ตัวไหนหยิบใช้แทน Zitadel ได้บ้าง เพื่อคุมโค้ดเต็มที่

---

## 0. TL;DR สำหรับเคสเรา

1. **อุตสาหกรรมไม่เขียน auth จากศูนย์** ยกเว้นเคสแคบมาก — consensus เกือบเอกฉันท์คือ *"don't roll your own auth"* เพราะระบบ auth ที่ปลอดภัยยากกว่าที่คิดเยอะ และ provider เจ้าใหญ่ลงทุนด้าน security/compliance เกินกว่าทีมเล็กจะตามทัน
2. **auth ไม่ใช่ backend library อย่างเดียว** — มันเป็น "ตลาดหลายชั้น": managed SaaS (Auth0/Okta/Clerk/Cognito) → self-host platform (Zitadel/Keycloak/Authentik) → composable services (Ory) → protocol library (node-oidc-provider/fosite/OpenIddict) → token primitive (jose/PyJWT). เราจะเลือกอยู่ชั้นไหนคือคนละคำถามกับ build-vs-buy
3. **เส้นทาง Zitadel self-host ของเราถูกต้องตามหลัก** — มันอยู่ควอดแรนต์ "ทีมมี ops + มีเหตุผลต้องคุม identity เอง" (data sovereignty, คุม token/claims เอง). ต้นทุนจริงคือ **operational ไม่ใช่ค่า license**: patch CVE + HA + upgrade ~0.5–1 FTE
4. **แนวคิด "หยิบ library ล้วนมาประกอบเองเพื่อคุมทุกอย่าง + patch ตาม lib" → ต้องคิดใหม่** — มันไม่ได้ทำให้ maintain *น้อยลง* มันแค่ย้ายภาระ identity ทั้งก้อนจาก vendor มาเป็นของเรา OAuth engine ที่ library ให้ = แค่ ~10–20% ของระบบ identity จริง ที่เหลือ (login UI, session, MFA, password reset, admin, audit, SCIM) เราต้อง build + patch เองตลอดไป
5. **Zitadel = "platform ที่เบาที่สุด" อยู่แล้ว** (Go single-binary + DB) ถ้ากังวลว่า "tool ใหญ่ไป" คำตอบคือเลือก platform ที่เบา (= Zitadel) ไม่ใช่ไปประกอบเองจาก library ซึ่งจะ *เพิ่ม* พื้นที่ maintain ไม่ใช่ลด

> **สรุปคำแนะนำ:** อยู่กับ Zitadel self-host ต่อ ส่วนที่ควร "build เอง" คือ **entitlement/authorization layer** (ซึ่งเรากำลังทำ) — นั่นคือที่ที่ custom มีเหตุผล ไม่ใช่ตัว auth primitive

---

## 1. auth เป็นตลาดหลายชั้น (ไม่ใช่แค่ backend lib)

| ชั้น | ตัวอย่าง | เราได้อะไร | เราต้องทำเองอะไร |
|------|----------|-----------|------------------|
| **Managed SaaS** | Auth0, Okta, Clerk, Cognito, WorkOS | เกือบทุกอย่าง | glue เชื่อมต่อ |
| **Self-host platform** | **Zitadel**, Keycloak, Authentik, FusionAuth | login UI, MFA, admin, audit, multi-tenant | run + patch + upgrade |
| **Composable services** | Ory (Hydra/Kratos/Keto/Oathkeeper) | protocol engine แบบ headless (API) | **UI ทุกจอ** + wire หลาย service |
| **Protocol library** | node-oidc-provider, ory/fosite, OpenIddict, Spring Authorization Server, Authlib | endpoint OAuth2/OIDC | user store, login UI, MFA, admin, audit — **ทั้งหมด** |
| **Token primitive** | jose, jsonwebtoken, PyJWT, golang-jwt | เซ็น/verify token เฉยๆ | **ทุกอย่างที่เหลือ** (ไม่ใช่ auth ด้วยซ้ำ) |

ยิ่งลงล่าง = คุมได้มากขึ้น แต่โค้ดที่ต้องเขียน+ดูแลเองยิ่งเยอะขึ้นแบบทวีคูณ

---

## 2. Industry ทำแบบไหน — แยกตามขนาดบริษัท

| ขนาด / สถานการณ์ | แนวทางที่ industry เลือก | เหตุผล |
|-------------------|--------------------------|--------|
| **Startup เล็ก (2–5 dev, auth เป็นงานรอง)** | **Buy managed** (Auth0/Clerk/Cognito) | auth ใช้งานได้ใน ~1 สัปดาห์, ops overhead ต่ำสุด |
| **Enterprise ทั่วไป อยากได้เร็ว ops น้อย** | **Managed SaaS IAM** (Okta/Auth0) | time-to-market เร็ว, SLA 99.99%, ทีมไม่ต้องดูแล infra |
| **Enterprise + ทีม platform แข็ง + มีเหตุผลต้องคุม identity เอง** | **Self-host OSS** (Keycloak/Zitadel/Authentik) | regulated (gov/health/finance), data sovereignty, on-prem, มี LDAP/AD เดิม, คุมงบ |
| **identity เป็น core product / scale สุดขั้ว + มีทีม security เฉพาะ** | **Build custom** | เคสแคบมาก มีเหตุผลจริงเท่านั้น |

**หลักที่ยืนยันเกือบเอกฉันท์ (ผ่าน adversarial verify):**
- *"Don't roll your own auth"* — auth ปลอดภัยยากกว่าที่คิด, provider เจ้าใหญ่ลงทุน security/compliance เกินทีมเล็ก (Auth0/Okta ถือ SOC2 Type II, ISO 27001, GDPR, HIPAA)
- **Startup เล็กควร buy** — auth ทำงานได้ใน ~1 สัปดาห์ vs custom อย่างน้อย 2–3 สัปดาห์
- **Managed (Okta/Auth0)** = เลือกเมื่ออยากได้เร็ว ops น้อย (Auth0 ฟรีถึง 25,000 MAU, SLA 99.99% tier enterprise)
- **Self-host OSS** = "best reserved for" ทีมที่มี ops + เหตุผลจริง (ไม่ใช่ "ห้ามใครอื่นใช้" — เป็น heuristic)

---

## 3. ต้นทุนจริงของ self-host OSS = operational ไม่ใช่ license

> "The license is free; the operations are not."

- **Patch cadence**: patch/minor ออกทุก ~2–4 สัปดาห์ (Keycloak) → ต้อง track CVE + upgrade สม่ำเสมอ
- **HA**: run หลาย node, failover, DB replication
- **Upgrade/migration**: DB schema / theme / provider ต้องปรับทุกรอบ major
- **คนดูแล**: ~**0.5–1 FTE** DevOps + hosting **$500–5,000/เดือน** (รวมค่าดูแล) + ~2–4 สัปดาห์ตั้ง production ครั้งแรก

เทียบกับ managed = ใช้งานได้ในหลักชั่วโมง, SLA 99.99%, ไม่ต้องดูแล infra

> ⚠️ ตัวเลขเงิน/FTE เป็น "directional" จากบล็อก vendor — เชื่อทิศทางได้ แต่ไม่ใช่ตัวเลขเป๊ะ (ดู §7 caveats) — ตัวเลข build cost แบบ $150K–400K ถูก **refute** ในการ verify ห้ามอ้างเป็น fact

---

## 4. ทางเลือก "library ล้วน" ถ้าจะประกอบ SSO เอง

### 4.1 OAuth2/OIDC provider library (ฝังในแอปเรา)

| Project | ภาษา | ให้อะไร | ต้องทำเองอะไร | License | สุขภาพ |
|---------|------|---------|--------------|---------|--------|
| **node-oidc-provider** (panva) | Node | OAuth2+OIDC AS, **OpenID Certified**, spec-complete สุดฝั่ง JS | account model, login/consent view, MFA, admin | MIT | active แต่ **maintainer คนเดียว** (bus-factor 1) |
| **ory/fosite** | Go | OAuth2+OIDC SDK เน้น security (เอนจินเบื้องหลัง Ory Hydra) | storage, login/consent, MFA, admin | Apache 2.0 | healthy (Ory หนุน) — *แต่ Ory เองแนะนำให้ใช้ Hydra แทนการต่อ fosite เอง* |
| **OpenIddict** | .NET | OAuth2/OIDC framework, ฟีเจอร์ใกล้ Duende, **ฟรีรวม production** | users, UI, MFA, **ไม่มี admin UI** | Apache 2.0 | active — คำตอบฟรีมาตรฐานฝั่ง .NET |
| **Duende IdentityServer** | .NET | OAuth2/OIDC certified, ฟีเจอร์เยอะ | users, UI, MFA, admin แยกขาย | **Commercial** (ฟรีเฉพาะ dev/test; prod ต้องซื้อ ~$1,500+/ปี) | vendor-backed |
| **Spring Authorization Server** | Java/Spring | OAuth2.1+OIDC IdP บน Spring Security | user store, login/consent UI, MFA, admin | Apache 2.0 | official Spring, healthy |
| **Authlib** | Python | OAuth1/2 + OIDC (client+provider) + JOSE | users, UI, MFA, admin, framework glue | BSD-3 | maintain อยู่ (ค่อนไป single-maintainer) |
| **django-oauth-toolkit** | Python/Django | OAuth2 provider endpoint + OIDC (บน oauthlib) | login UI, MFA, SAML, admin | BSD | **ขอคนช่วย maintain** — bandwidth บาง |

**ประเด็นสำคัญ:** ทุกตัวคือ *protocol library* ไม่ใช่ SSO — มันให้ token endpoint ที่ถูก spec แต่ **user, login page, credential, MFA, consent, session, admin, audit เป็นของเราหมด**

### 4.2 JWT/token library = แค่ primitive ไม่ใช่ SSO

`jose` (panva), `jsonwebtoken`, `PyJWT`, `golang-jwt/jwt` — ทำแค่เซ็น/verify token ไม่มี concept ของ user/login/session/consent/revoke. ใช้ฝั่ง **resource server เพื่อ verify JWT** ที่ IdP ออกให้ (เราใช้ตรงนี้อยู่แล้วผ่าน JWKS)

### 4.3 Ory — ทางสายกลาง "unbundled"

Ory = ชุด service headless (API-first) ที่เอามาต่อกันเอง:
- **Hydra** — OAuth2/OIDC server (บน fosite) แต่ **ไม่จัดการ user/password** → เราต้องทำ login+consent app เอง
- **Kratos** — identity/user management (register/login/recovery/MFA) แต่ **ไม่มี UI เลย** → เราสร้างทุกจอ
- **Keto** — permission แบบ Google Zanzibar (RBAC/ReBAC)
- **Oathkeeper** — identity-aware proxy

ต่างจาก Zitadel: Ory = composable คุม UX ได้เต็มโดยไม่ต้องเขียน protocol เอง — แต่ "เบา" แค่ในแง่ scope ต่อ service **operational กลับมี moving parts มากกว่า** (run หลาย service + สร้าง UI ทุกจอ)

### 4.4 Keycloak vs Zitadel (ทั้งคู่เป็น platform)

| มิติ | Keycloak | **Zitadel** |
|------|----------|-------------|
| Runtime | Java/Quarkus (JVM) + Infinispan tuning | **Go single binary** + DB (event-sourced) |
| Footprint | หนักกว่า (~470MB RAM dev) | **เบากว่า**, stateless, ไม่มี JVM |
| Protocol | กว้างสุด: OIDC/OAuth2/**SAML**/LDAP-AD | OIDC/OAuth2, SAML, multi-tenant native |
| Extensibility | SPI provider (เขียน Java) — ลึก | Config/Actions + API |
| Ecosystem | ใหญ่สุด, community เยอะ | ใหม่กว่า, DX ดี |
| Patch CVE | bump image + migrate; ต้องดู transitive Java deps | bump image; dep surface เล็กกว่า (Go) |

> **"เบากว่า" = Zitadel** — ตรงกับความกังวลของเราเรื่อง "tool ใหญ่ไป": Zitadel เป็น platform ที่เบาที่สุดอยู่แล้ว

---

## 5. Reality check — "patch CVE ตาม lib" ง่ายกว่าจริงไหม?

**คำตอบตรงๆ: ส่วนใหญ่ ไม่ง่ายกว่า**

1. **bump library ได้เฉพาะช่องโหว่ที่อยู่ *ใน library*** — แต่ attack surface ส่วนใหญ่ตอนนี้คือ **โค้ดเราเอง** (login flow, session, password reset, MFA) → *ไม่มีใครออก CVE หรือ patch ให้บั๊กของเรา* เราต้องหา+แก้เอง ซึ่งยากกว่า `docker pull`
2. **bump platform = patch ทั้ง stack ทีเดียว** — Zitadel/Keycloak ออก security release ครั้งเดียว fix ทั้ง AS + MFA + login UI + SCIM + audit. เส้น library ระบบพวกนี้คือโค้ดเราเขียน ไม่มี upstream fix
3. **ต้อง build+maintain ตลอดไป ถ้าไปเส้น library:** login/register/consent UI, session mgmt (rotate/logout-everywhere/timeout), password hashing+reset, email/phone verify, **MFA/TOTP/WebAuthn/passkey** (API เบราว์เซอร์เปลี่ยนทุกปี ~3–5 eng-week/ปีแค่ให้ WebAuthn ไม่พัง), brute-force/lockout, **SCIM** (~3 เดือน/IdP แรก + ต่อลูกค้า enterprise), admin UI, audit log, key rotation, multi-tenant
4. **bus-factor:** library ที่ดีหลายตัว (node-oidc-provider, Authlib, django-oauth-toolkit) เป็น **single-maintainer** → "เราคุมเอง" อาจแปลว่า "เรากำลัง maintain dependency ที่ใกล้ถูกทิ้ง"
5. **ที่ lib-bump ง่ายกว่าจริง:** dependency *surface* เล็กและภาษาเดียว (Go binary + fosite vs JVM ลาก Java deps เยอะ) — แต่ถ้ากังวลตรงนี้ คำตอบคือ **Zitadel (Go binary) อยู่ปลายที่เบาของ platform อยู่แล้ว**

> **Reframe:** "คุมโค้ดเอง + patch ตาม lib" ฟังดู maintain น้อยลง แต่จริงๆ *มากขึ้น* — เราแลก "patch platform ของ vendor" เป็น "กลายเป็น vendor เอง" คุมโค้ด = คุมช่องโหว่ + วิ่งตาม browser API + ทำ compliance evidence + แบก bus-factor เอง

---

## 6. สรุปคำแนะนำสำหรับดีไซน์ปัจจุบัน (Zitadel + entitlement)

**เลือก "library ล้วน" เมื่อ:** auth *คือ* product เรา / มี flow แปลกที่ platform ทำไม่ได้ / มีทีม identity ยืนพื้น 1–3 FTE ถาวร → ตัวที่เหมาะ: OpenIddict (.NET ฟรี), Spring Authorization Server, node-oidc-provider, fosite (แต่ถ้าถึง fosite → Ory แนะนำให้ใช้ Hydra แทน)

**เลือก platform (Zitadel/Keycloak) เมื่อ:** auth เป็น *infrastructure หนุน* product (เคสเรา = Auth + eSign) อยากได้ MFA/passwordless/social/SAML/admin/audit/multi-tenant **วันนี้** โดยมีคน patch ให้ผ่าน image bump

**เคสเราโดยเฉพาะ:**
- เป้าหมาย "คุมโค้ด + patch เอง" ทำได้จริงและถูกกว่า/เสี่ยงน้อยกว่าด้วยการ **self-host Zitadel** (Go binary ที่เราคุมเต็ม + patch ด้วย image bump เดียว) มากกว่าไปประกอบเองจาก library
- "tool ใหญ่ไป" เป็นข้อกังวลจริง — แต่คำตอบคือ **"เลือก platform ที่เบา" (= Zitadel) ไม่ใช่ "กลายเป็น identity vendor เอง"**
- ที่ควร build custom จริงๆ คือ **entitlement/authorization layer** (tenant/role/grants/claims) — ซึ่งเรากำลังทำ. consensus "อย่า build เอง" แรงสุดที่ *auth primitive* ไม่ได้ครอบ authorization layer ที่ทั่วไปมัก build/assemble เอง (เทียบเคียง Cerbos, OpenFGA, Oso, SpiceDB)
- ✅ **Zitadel relicense เป็น AGPL-3.0 (2025-03-31)** — เช็คแล้ว **ไม่กระทบเคสเรา** (self-host ไม่แก้ code + entitlement แยก + apps ผ่าน OIDC = mere aggregation) ดูรายละเอียด §10. ระวังเฉพาะถ้าไป fork/link core ของ Zitadel

---

## 7. Caveats (อ่านก่อนเชื่อ)

- **แหล่งส่วนใหญ่เป็น vendor/SEO blog** ที่มี conflict of interest (SuperTokens, Skycloak, Zitadel, getflip ฯลฯ) — finding รอดเพราะ cross-check กับแหล่งเป็นกลาง/primary (Auth0/Okta docs, Keycloak GitHub release, cert SOC2/ISO) ไม่ใช่เพราะ blog เชื่อถือได้เอง
- **ไม่มีงานวิจัย/survey เชิงวิชาการ** — guidance เรื่อง "ขนาดบริษัท" เป็น conventional wisdom ไม่ใช่ข้อมูลวัดจริง
- **ตัวเลขเงิน/เวลาอ่อนสุด** — "2–4 สัปดาห์", "$500–5,000/เดือน", "0.5–1 FTE" มาจาก marketing เชื่อทิศทางได้ ไม่เป๊ะ
- **ที่ถูก refute ในการ verify (ห้ามอ้างเป็น fact):** custom build $150K–400K / $200–500K, ตัวเลข FTE+compliance audit เจาะจง, Cognito free-tier 50k MAU, และคำ flat ว่า regulated "ต้อง" self-host
- **time-sensitive:** ราคา/free-tier (Auth0 25k MAU, Okta ~$2/seat), SLA tier, Keycloak release cadence เปลี่ยนได้ — ตัวเลข current ปี 2024–2026 ควร re-check หน้า pricing สด
- **entitlement layer อยู่นอก scope ที่ค้น** — "don't build" แรงสุดที่ auth ไม่ auto ครอบ authorization

---

## 8. Sources

**Build vs buy / rolling your own:**
- https://withblue.ink/2020/04/08/stop-writing-your-own-user-authentication-code.html
- https://dev.to/devlawrence/should-you-really-roll-your-own-auth-4dj
- https://supertokens.com/blog/build-vs-buy
- https://ssojet.com/ciam-qna/roll-your-own-authentication-vs-third-party
- https://www.okta.com/resources/whitepaper-build-vs-buy/

**ขนาดบริษัท / managed vs self-host:**
- https://ritza.co/articles/gen-articles/keycloak-vs-okta-vs-auth0-vs-authelia-vs-cognito-vs-authentik/
- https://skycloak.io/blog/is-self-hosting-keycloak-worth-it-2026/
- https://supertokens.com/blog/auth0-alternatives-auth0-vs-okta-vs-cognito-vs-supertokens
- https://www.getflip.com/blog/auth0-alternative/
- https://www.mgsoftware.nl/en/vergelijking/keycloak-vs-auth0

**Library ล้วน / composable:**
- node-oidc-provider: https://github.com/panva/node-oidc-provider · https://oidc-provider.dev/
- ory/fosite: https://github.com/ory/fosite · Ory Hydra: https://github.com/ory/hydra · Kratos: https://www.ory.com/kratos
- OpenIddict vs Duende vs Keycloak (.NET): https://codingdroplets.com/duende-identityserver-vs-keycloak-vs-openiddict-in-net-which-to-use-in-2026
- Duende licensing: https://docs.duendesoftware.com/general/licensing/
- Spring Authorization Server: https://spring.io/projects/spring-authorization-server/
- Authlib: https://github.com/authlib/authlib · django-oauth-toolkit: https://github.com/django-oauth/django-oauth-toolkit
- jose (panva): https://github.com/panva/jose · JWT libs: https://www.jwt.io/libraries

**Keycloak vs Zitadel / OSS comparison:**
- https://skycloak.io/blog/keycloak-vs-zitadel-comparison/ · https://zitadel.com/blog/zitadel-vs-keycloak
- https://www.cerbos.dev/blog/keycloak-vs-zitadel
- Keycloak security/CVE: https://www.keycloak.org/security
- Ory vs Keycloak: https://skycloak.io/blog/keycloak-vs-ory-comparison/
- 11 OSS SSO เทียบ: https://lacontrevoie.fr/en/blog/2024/comparatif-de-onze-solutions-de-sso-libres/

---

## 9. Zitadel มีคนใช้เยอะไหม? (adoption / traction)

**คำตอบสั้น: มีจริง แต่ niche — เป็นบริษัท VC หนุน ไม่ใช่ hobby project**

- **CAOS AG** (St. Gallen, สวิตเซอร์แลนด์) ก่อตั้ง ~2019–2020, remote team
- ระดมทุน ~**$11.5M**: Seed $2.5M (มิ.ย. 2022) + Series A $9M (พ.ย. 2024) นำโดย Nexus Venture Partners (+Floodgate)
- **160+ customers**, commit ทุกวัน, ออก v3 (2025-03-31)
- เว็บ Zitadel เคลม ">1.2M downloads" + "250+ contributors" (self-report ไม่ audited)

**GitHub stars (live ก.ค. 2026) — เทียบ mindshare:**

| Project | Stars | อายุ (repo) | Backing | License |
|---------|-------|-------------|---------|---------|
| **Keycloak** | ~35,700 | 2013 | Red Hat/IBM | Apache-2.0 |
| **Authentik** | ~22,400 | 2019 | goauthentik | MIT (+enterprise) |
| Ory Hydra | ~17,400 | 2015 | Ory | Apache-2.0 |
| SuperTokens | ~15,200 | 2020 | SuperTokens | Apache-2.0 |
| **Zitadel** | ~14,440 | 2020 | CAOS AG (VC) | **AGPL-3.0** |
| Ory Kratos | ~13,770 | 2018 | Ory | Apache-2.0 |

อันดับ mindshare ใน OSS IAM: **Keycloak (นำขาด ~2.5x) > Authentik > Zitadel ≈ SuperTokens ≈ Ory**

**ใครใช้ (จาก case study ของ Zitadel เอง — logo หน้า vendor, ไม่ใช่ audited):**
Kaspar& (fintech สวิส), Open Systems (cybersecurity), CrossClassify, 23 Technologies (K8s-as-a-service), Orbica, JOSHMARTIN/Hygeia (contact-tracing สาธารณสุข), Chapati Systems (self-host) — **เอียงไป SMB/startup ยุโรป (โดยเฉพาะสวิส) ไม่มี Fortune-500 เป็นตัวชูโรง**

**ทำไมเราไม่เคยได้ยินชื่อ:**
1. ใหม่ — Keycloak/Auth0 นำหน้า ~7 ปี
2. ยุโรป/สวิส สาย dev — งบ marketing เทียบ Okta/Auth0 ไม่ได้
3. category self-host IAM เอง niche — dev ส่วนใหญ่ทำ login เองง่ายๆ หรือหยิบ Auth0/Firebase/Clerk
4. แม้ใน OSS IAM เอง Keycloak ครองตลาด

**Health verdict:** เดิมพันได้สำหรับบริษัทเล็ก (maintain จริง เงินจริง ยึด standard protocol → exit ได้) แต่พึ่ง single vendor (Keycloak มี Red Hat + Apache-2.0 = conservative กว่า). Zitadel = ตัว modern/DX ดี

---

## 10. AGPL-3.0 license — กระทบเราไหม? ⭐ (ตัวชี้ขาด)

> ⚠️ ไม่ใช่คำแนะนำทางกฎหมาย — สังเคราะห์จากตัวบท AGPL + FSF FAQ + คำแถลง Zitadel. ก่อน launch เชิงพาณิชย์ควรให้ทนาย OSS/IP เซ็นรับรอง

### Verdict: **ไม่ใช่ dealbreaker — สถาปัตยกรรมเรารอด ไม่ต้องเปิด source แอปเราเอง**

**การ relicense:** Zitadel เปลี่ยน Apache-2.0 → **AGPL-3.0-only** ตั้งแต่ **v3.0 (2025-03-31)** ไม่ย้อนหลัง. ในซอร์สปัจจุบัน (LICENSING.md): core = AGPL, แต่ `proto/` = Apache-2.0, `apps/login/` + `packages/zitadel-client` + SDK = MIT (**ตั้งใจให้ generated client / การ build against ไม่ติด AGPL**)

**ทำไมเคสเรารอด (self-host ไม่แก้ code + entitlement แยก + apps ผ่าน OIDC):**

1. **รัน Zitadel unmodified** (official image + config/env เท่านั้น) → §13 บังคับแค่ให้ user ที่คุยผ่าน network เข้าถึง source ของ Zitadel ที่ *public อยู่แล้ว* → แค่ลิงก์ไป repo upstream ที่ version/tag ที่เรารัน. **ไม่ต้องเปิดอะไรของเราเลย**
2. **entitlement service (HTTP webhook)** + **eSign apps (OIDC/JWKS)** = คุยกับ Zitadel ผ่าน network protocol แบบ "โปรแกรมแยกกัน" → เข้าข่าย **mere aggregation / separate & independent works** ไม่ใช่ derivative → AGPL เอื้อมไม่ถึง (FSF FAQ: "pipes, sockets... normally used between two separate programs")
3. **Zitadel แถลงเอง:** *"If you are only using Zitadel as an identity platform, the license change doesn't affect you"* + *"API usage without modifying the code doesn't trigger reciprocal requirements"*
4. เราอยู่ **นอก** เป้าหมายที่ AGPL ตั้งใจปิด (SaaS loophole = เอา Zitadel ที่แก้แล้วไปขายเป็น managed service โดยไม่แชร์) — เราไม่ได้ขาย Zitadel-as-a-service และไม่แก้ code

### แก้ design login UI ทั้งหมด — ติดไหม? ❌ ไม่ติด

login UI คือส่วนเดียวที่ Zitadel **จงใจกันเป็น MIT** (ไม่ใช่ AGPL) — เพราะคาดหวังให้คน fork/customize. เช็คสดจาก LICENSING.md:

| Path | License |
|------|---------|
| **`apps/login/`** (login UI Next.js app) | **MIT** ✅ |
| `packages/zitadel-client` (SDK ที่ login app ใช้คุย core) | MIT |
| `packages/zitadel-proto`, `proto/` | Apache-2.0 |
| core ที่เหลือ (Go engine: token/session/user) | AGPL-3.0 |

**2 ทางทำ login UI เอง ทั้งคู่ปลอดภัย:**
- **A — fork/แก้ `apps/login/`**: อยู่ใต้ MIT → แก้ design ทั้งหมด, rebrand, **เก็บ private ได้ ไม่ต้องแชร์**. app คุย core ผ่าน Session API ด้วย `zitadel-client` (MIT) + network API → ไม่เกิด combined work. แค่คง copyright notice ของ MIT ในไฟล์ที่ fork
- **B — เขียน login UI เองจากศูนย์** (แบบ "หน้ากาก" ใน pretest): ใช้ OIDC + Session API ทำ UI เองทั้งจอ = โค้ดเราล้วน แยกขาด → AGPL เอื้อมไม่ถึง

> **สำคัญ: แก้ login UI ≠ fork AGPL core** — login ไม่ได้อยู่ใน AGPL core ตั้งแต่แรก (เป็น MIT). เส้นอันตรายคือไปแก้ *Go engine ที่เป็น AGPL* (token/session/user logic) ซึ่งการทำ UI ไม่แตะ

### เขียน UI เอง (Session API) vs fork login app — อันไหน worry-free กว่า?

**จุดพลิก: fork login app = ได้เป็นของตัวเองอยู่แล้ว (MIT) โดยไม่ต้องสร้าง flow เอง** — ไม่ต้องเลือกระหว่าง "ได้ของตัวเอง" กับ "ไม่ re-implement"

Zitadel มี 3 ทาง auth: (1) hosted login, (2) **custom UI บน Session API**, (3) OIDC/SAML ตรง — ที่เกี่ยวกับเราคือ 2 ทาง:

| มิติ | (A) เขียน UI เองเรียก Session API | (B) fork Login V2 (`apps/login/`) |
|------|----------------------------------|-----------------------------------|
| เป็นโค้ดของเรา? | ใช่ (เราเขียนเอง) | **ใช่ (MIT — fork แล้วเป็นของเรา เก็บ private ได้)** |
| flow (password/passkey/MFA/IdP/session) | **เราสร้าง+maintain เองทุกอัน ตลอดไป** | **ได้มาพร้อม maintain โดย Zitadel** แค่ restyle |
| branding | ทำเองหมด | config เป็นหลัก (logo/สี/domain), WCAG auto |
| security correctness | เสี่ยงสูง (เรารื้อ session/MFA เอง) | ต่ำ (โค้ดตัวเดียวกับ Zitadel Cloud รัน) |
| control/design | สูงสุด (framework อะไรก็ได้, ฝัง native app ได้) | สูง (Next.js เต็มตัว) แต่ตามโครง app |
| upgrade risk | ไม่มี merge conflict; พึ่ง API (Session API **GA นิ่ง**) | merge upstream (เลี่ยงด้วยแยก branding layer) |
| time-to-market | ช้าสุด | เร็ว (fork → env → brand → deploy) |

**ข้อเท็จจริงสำคัญของ Login V2 (`apps/login/`):**
- เป็น **แอปตัวเดียวกับที่ Zitadel Cloud ใช้** + **default ของ v4 GA**
- **MIT** → fork/customize/เก็บ private ได้ (แค่คง copyright notice)
- Zitadel official **แนะนำ fork + brand สำหรับคนส่วนใหญ่** — สงวน "เขียนเองจาก Session API" ไว้เคสพิเศษ (ฝัง login ใน native app, business flow แปลก)
- Session API เป็น **GA** (v2 surface ที่ Zitadel แนะนำสำหรับ integration ใหม่) แต่ยอมรับเองว่า "ไม่ใช่ industry-standard" → ทาง A ต้องต่อ OIDC/SAML proxy glue เอง

**fork ทำขาย = practice ปกติ:** มี Vercel deploy button, guide self-host, ตัวอย่างจริง (`quochuydev/zitadel-login-ui`, fork `wiadok`/ConnectCloud). ทั้งอุตสาหกรรมทำ: Keycloak theming, Ory BYO-UI, **Auth0 เรียก Universal Login ตัวเองว่า "white-label product"** — ครอบ IdP ด้วยหน้าตัวเองคือมาตรฐาน

**⚠️ Caveat ก่อน commit:** Login V2 ตอน v4 GA เป็น default แล้ว แต่บาง feature เคยตามยังไม่ครบ (**passkey setup, LDAP, custom login-text translation**) — เช็ค parity กับ method ที่ต้องมีจริงก่อน. self-host Login V2 ต้องมี HTTPS + service account (Login Client role + PAT) + ลงทะเบียน domain เป็น Trusted Domain

**Verdict สำหรับทีมเล็กทำ white-label:** **fork Login V2 (B)** — ได้ branding เต็ม + เป็นโค้ดเรา (MIT) + inherit flow ที่ maintain แล้ว + ship เร็ว. เขียนเองจากศูนย์ (A) เก็บไว้เฉพาะถ้าต้องฝัง login ใน non-web/native หรือ flow ที่ app ทำไม่ได้

> **โยงกับคำถาม license:** ทั้ง A และ B **ไม่แตะ AGPL core** — A = โค้ดเราล้วน, B = MIT. ทุก request วิ่งไป Zitadel self-host เหมือนกัน สิ่งที่ต่างคือ "ใครเขียน+maintain flow orchestration" เท่านั้น

### Flutter integration + login approach (mockup = popup ฝังในแอป)

**คำถาม: กด login ต้องเด้งมาหน้าเราทุกครั้งไหม? Flutter มีแอปอยู่แล้วทำยังไง?**

มี 2 โมเดลสำหรับ native app:

| | **A: Redirect OIDC+PKCE** (fork Login V2) | **B: Native form + Session API** |
|---|-------------------------------------------|----------------------------------|
| งาน | ต่ำ — มี **Flutter example ทางการ** | สูง — ทุกจอ + **ต้องมี backend ถือ PAT** |
| ตรง mockup (popup ในแอป)? | ❌ หน้าใน browser tab | ✅ email/password ในแอป |
| social (Google/Apple) | เด้ง provider | **ยังเด้ง** provider เหมือนกัน |
| security | secure default, ไม่มี secret ในแอป | hardening เอง + ห้าม leak PAT |
| maintain | Zitadel ดูแล | เราดูแล UI + backend |

**ข้อเท็จจริงสำคัญ:**
- **โมเดล A** = OAuth 2.0 for Native Apps (RFC 8252): เปิด login ใน **system browser tab** (`ASWebAuthenticationSession`/Custom Tabs) — **ห้าม webview** (Google บล็อก) → callback ผ่าน deep link. Zitadel example: [github.com/zitadel/example-auth-flutter](https://github.com/zitadel/example-auth-flutter) ใช้ lib `oidc` + `flutter_web_auth_2` + `flutter_secure_storage`. **PKCE บังคับ** (native = public client ไม่มี secret)
- **โมเดล B** เรียก Session API จากแอปตรงๆ **ไม่ได้** — ต้องใช้ `IAM_LOGIN_CLIENT` PAT (credential ระดับ instance) → **บังคับต้องมี backend** ถือ token + broker ทุก call. ถ้าฝังใน binary = ใครแกะได้ปลอม session ใครก็ได้
- **ปุ่ม Google/Apple เด้งเสมอทั้ง 2 โมเดล** — ฝัง login ของ Google ในกล่องเราไม่ได้ (Google ห้าม, RFC 8252). Zitadel ใช้ IDP intent (`StartIdentityProviderIntent` → authUrl → redirect). ทางเลือก native หน่อย = OS sheet (`google_sign_in`/`sign_in_with_apple`) แต่ก็ยังออกจาก popup
- **⚠️ Apple App Store Guideline 4.8:** ถ้ามี Google login บน iOS → **บังคับต้องมี Sign in with Apple** (หรือ privacy option เทียบเท่า) — mockup เรามีแล้ว ✅

**🎯 Middle ground (เลือกอันนี้): fork Login V2 → brand ตาม mockup → เปิดผ่าน PKCE แบบโมเดล A**
- ได้หน้าตาตาม mockup เกือบเป๊ะ + งานเศษเสี้ยวของ B + ไม่มี PAT ในแอป
- ข้อแลกเดียว: เป็น browser-tab ไม่ใช่ modal ฝังแอปจริง

**Flutter setup (โมเดล A):** ลงทะเบียน app เป็น **Native** ใน Zitadel (auth = PKCE เสมอ) + redirect URI custom scheme (`com.example.app://callback`) → iOS: URL Types ใน Info.plist / Android: intent-filter + `minSdkVersion 18` → token เก็บใน `flutter_secure_storage` + ขอ scope `offline_access` เพื่อได้ refresh token

**Zitadel docs:** [Flutter example](https://zitadel.com/docs/examples/login/flutter) · [Build your own Login UI](https://zitadel.com/docs/guides/integrate/login-ui) · [External Login (Google/Apple)](https://zitadel.com/docs/guides/integrate/login-ui/external-login) · [Connect Self-Hosted Login UI (login-client)](https://zitadel.com/docs/self-hosting/manage/login-client) · [Self-host TypeScript login](https://zitadel.com/blog/how-to-self-host-zitadel-typescript-login-ui) · RFC 8252: https://datatracker.ietf.org/doc/html/rfc8252

### เส้นที่จะทำให้ "ติด" AGPL (ต้องเฝ้าระวัง)

- **fork/patch source Zitadel** แล้วเปิดให้ user คุยผ่าน network → ต้องเปิด source *ส่วนที่แก้* (หรือซื้อ commercial license)
- **import Go package ของ Zitadel / link เข้า core** → combined work เสี่ยงลาม (build บน proto/SDK ที่เป็น Apache/MIT = ปลอดภัย)
- **เอา Zitadel ที่แก้แล้วไปเสนอเป็น hosted service (rebrand)** ให้บุคคลที่สาม → commercial license territory

**Escape hatch:** Zitadel dual-license — ถ้ารับ AGPL ไม่ได้ ซื้อ **commercial/Enterprise license** ที่ replace AGPL ได้ (จำเป็นเฉพาะเมื่อ fork+ไม่อยากแชร์ หรือ resell Zitadel-as-service)

### ถ้า AGPL เป็น dealbreaker จริง — ทางเลือก permissive (ไม่มี copyleft)

| Project | License core | Copyleft? | หมายเหตุ |
|---------|--------------|-----------|----------|
| **Keycloak** | Apache-2.0 | ไม่ | platform เต็ม, ตัว conservative |
| **Ory Hydra/Kratos** | Apache-2.0 | ไม่ | headless, สลับได้แบบคง arm's-length |
| **node-oidc-provider** | MIT | ไม่ | library ฝัง Node/Bun ตรงๆ (เข้ากับ entitlement เรา) |
| **OpenIddict** | Apache-2.0 | ไม่ | .NET |
| **SuperTokens** | Apache-2.0 | ไม่ | self-host auth |
| **Authentik** | MIT core (+enterprise proprietary) | ไม่ (open-core) | |
| **Zitadel (ปัจจุบัน)** | **AGPL-3.0** core | **ใช่** (core) | copyleft เฉพาะ *ส่วนที่แก้* |

> ถ้าจะสลับเพราะ AGPL: **node-oidc-provider (MIT)** = pure-library ฝังตรง Bun ได้, หรือ **Ory Hydra (Apache-2.0)** = server แยกที่คง arm's-length architecture เดิม — **แต่ไม่จำเป็นต้องสลับ ตราบใดที่ไม่ fork Zitadel**

### กฎที่ควรตั้งให้ทีม

> **"ห้าม fork หรือ link AGPL core ของ Zitadel — integrate ผ่าน OIDC/JWKS, proto/SDK ที่เป็น Apache/MIT, และ network webhook เท่านั้น"**
> ถ้าวันไหนต้อง break กฎนี้ → ตั้งงบ commercial license + ปรึกษาทนายก่อน

**Sources (adoption + license):**
- Zitadel adoption: https://zitadel.com/about · https://github.com/zitadel/zitadel · Series A: https://www.startupticker.ch/en/news/zitadel-raises-9-million-series-a · Seed: https://zitadel.com/blog/fundraising-nexus · case studies: https://zitadel.com/blog/tags/successstory · HN: https://news.ycombinator.com/item?id=31408059
- AGPL relicense: https://zitadel.com/blog/apache-to-agpl · https://zitadel.com/blog/zitadel-v3-announcement · LICENSING.md: https://github.com/zitadel/zitadel/blob/main/LICENSING.md
- Licensing FAQ: https://help.zitadel.com/zitadel-licensing-faqs · https://help.zitadel.com/what-should-people-who-cannot-use-agpl-3.0-license-do
- AGPL text §13: https://www.gnu.org/licenses/agpl-3.0.en.html · GNU GPL FAQ (aggregation/sockets): https://www.gnu.org/licenses/gpl-faq.html · FSF AGPLv3: https://www.fsf.org/bulletin/2021/fall/the-fundamentals-of-the-agplv3
