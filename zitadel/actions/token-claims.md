# Zitadel v4.16.0 → inject `urn:platform:*` claims into the access token

Config guide for making Zitadel access tokens carry the platform claims resolved by
the Entitlement Service (`POST /internal/claims`, see
`docs/superpowers/specs/2026-07-14-auth-service-design.md` §5).

Everything below is pinned to **Zitadel v4.16.0** (`ghcr.io/zitadel/zitadel:v4.16.0`,
self-host compose, legacy Login V1 — see `zitadel/docker-init.md`). Each behavioral
claim carries a source: either a docs URL, a v4.16.0 source file on GitHub, or a
live response observed against the running container (marked **[verified live]**).

---

## 1. Mechanism determination: Actions **v2** (execution targets), function `preaccesstoken`

Zitadel has two Action systems:

| | Actions v1 | Actions v2 |
|---|---|---|
| How | JS (goja) scripts run inside Zitadel (`complementToken` flow, `preAccessTokenCreation` trigger) | Zitadel POSTs a JSON payload to an external HTTP **target**; an **execution** binds the target to a condition |
| Status in v4.16.0 | Still executed (v1 script flows run in the same code path as v2 targets — [`internal/api/oidc/userinfo.go`](https://github.com/zitadel/zitadel/blob/v4.16.0/internal/api/oidc/userinfo.go) runs `actions.Run(...)` then `execution.CallTargets(...)`) | Fully supported; API endpoints exist **[verified live]** (see §7) |
| Future | **Deprecated in Zitadel v5; removal targeted for v6** ([zitadel/zitadel#10833 "Remove Actions V1"](https://github.com/zitadel/zitadel/issues/10833)) — no new features. The [migration guide](https://zitadel.com/docs/guides/integrate/actions/migrate-from-v1)'s "sunsetted in V5" wording refers to the v5 deprecation, not removal | The supported path |

**Decision: use Actions v2.** The v1 `preAccessTokenCreation` flow maps to the v2
**function condition `preaccesstoken`**
([migration guide](https://zitadel.com/docs/guides/integrate/actions/migrate-from-v1)).

The exact function name strings in v4.16.0 are `preuserinfo`, `preaccesstoken`,
`presamlresponse` — source:
[`internal/domain/action.go` L64-89](https://github.com/zitadel/zitadel/blob/v4.16.0/internal/domain/action.go)
(`ActionFunctionPreAccessToken.LocalizationKey() == "preaccesstoken"`).

### Where the trigger fires (and the JWT requirement)

Source: [`internal/api/oidc/token.go` L30-60, L119-123](https://github.com/zitadel/zitadel/blob/v4.16.0/internal/api/oidc/token.go)

- `preaccesstoken` fires in `createJWT(...)` at the **OIDC token endpoint**, and
  **only when the client's Access Token Type is JWT**
  (`client.AccessTokenType() == op.AccessTokenTypeJWT`). With the default
  ("Bearer"/opaque) token type Zitadel issues an opaque token and the trigger
  never runs → **the OIDC app MUST be set to Access Token Type = JWT**
  (Console → project → application → Token Settings).
- The ID token is built via the `preuserinfo` trigger (`createIDToken` →
  `TriggerTypePreUserinfoCreation`, same file L79). So with only `preaccesstoken`
  registered, claims appear in the **access token only**, not the ID token /
  userinfo. That is exactly what the spec needs for V1; register the same target
  additionally under `preuserinfo` if ID-token/userinfo claims are ever wanted.
- Because the trigger runs at token issuance in the OIDC layer, it is
  **independent of the login UI version** — it works with our legacy Login V1
  setup. (Known Login-V1 Actions-v2 bug
  [zitadel/zitadel#11095](https://github.com/zitadel/zitadel/issues/11095) is
  scoped to *identity-provider-intent* conditions, not function conditions.)

---

## 2. Request/response contract of the target webhook

### What Zitadel sends

Zitadel POSTs JSON (`Content-Type: application/json`) shaped as `ContextInfo` —
source: [`internal/api/oidc/userinfo.go` L474-486](https://github.com/zitadel/zitadel/blob/v4.16.0/internal/api/oidc/userinfo.go):

```json
{
  "function": "function/preaccesstoken",
  "userinfo":     { "sub": "<zitadel user id>", "...": "standard OIDC userinfo" },
  "user":         { "id": "<zitadel user id>", "...": "full user object" },
  "user_metadata": [ { "key": "...", "value": "<base64>" } ],
  "org":          { "id": "...", "name": "...", "primary_domain": "..." },
  "user_grants":  [ ],
  "application":  { "client_id": "<oidc client id>" }
}
```

**Extract the user ID from `user.id` (equal to `userinfo.sub`)** — both carry the
Zitadel user ID, which is what `users.zitadel_user_id` stores.
(Payload example with real values: [docs "Test Actions Function"](https://zitadel.com/docs/guides/integrate/actions/testing-function).)

### What the target must return

Source: `ContextInfoResponse`, same file L488-497 — **snake_case keys**, `value` is
any JSON type (objects/arrays allowed):

```json
{
  "append_claims": [
    { "key": "urn:platform:tenantId",  "value": 1 },
    { "key": "urn:platform:companies", "value": [10, 11] },
    { "key": "urn:platform:modules",   "value": ["hr", "esign"] },
    { "key": "urn:platform:grants",    "value": {
        "10": { "roles": ["company_admin"], "permissions": ["*"] },
        "11": { "roles": ["hr_staff"], "permissions": ["employee.read", "employee.write"] }
    } }
  ]
}
```

Rules enforced by Zitadel (same file, L456-468):

- Claims whose key starts with `urn:zitadel:iam` are silently dropped
  (`ClaimPrefix` check) — our `urn:platform:*` namespace is unaffected.
- A claim whose key already exists in the token is **not overwritten** (a note is
  appended to `urn:zitadel:iam:action:function/preaccesstoken:log` instead).
- `set_user_metadata` / `append_log_claims` are also supported; we don't use them.

### Mapping `PlatformClaims` → `append_claims`

| `/internal/claims` result | webhook response |
|---|---|
| `{ tenantId, companies, modules, grants }` | 4 `append_claims` entries as above |
| `{ role: "superadmin" }` | `{ "append_claims": [ { "key": "urn:platform:role", "value": "superadmin" } ] }` |
| `{}` (unknown / disabled user) | `{}` — no `append_claims` → token carries **no** `urn:platform:*` claims |

---

## 3. The header problem: Zitadel cannot send `x-claims-secret`

A v2 target is only `name + endpoint + timeout + restWebhook|restCall|restAsync (+ payloadType)`.
**There is no field for custom request headers** — source:
[CreateTarget API reference](https://zitadel.com/docs/reference/api/action/zitadel.action.v2.ActionService.CreateTarget)
and the `AddTarget` command struct in
[`internal/command/action_v2_target.go`](https://github.com/zitadel/zitadel/blob/v4.16.0/internal/command/action_v2_target.go).

So the existing `POST /internal/claims` + `x-claims-secret` endpoint **cannot be
called by Zitadel directly** — neither its auth header nor its request/response
shapes match. The design consequence:

> **Implemented** (Task 12b): a thin adapter route in the Entitlement Service,
> `entitlement/src/claims/zitadel-route.ts` (`zitadelClaimsRouter`), serving
> `POST /internal/zitadel/token-claims`. It authenticates the call via Zitadel's
> built-in HMAC signature instead of `x-claims-secret`, extracts `user.id`, reuses
> `resolveClaims()`, and answers in `ContextInfoResponse` shape. It **is mounted**
> in `entitlement/src/http/app.ts` (`createApp()`), but is not yet wired to a
> live Zitadel instance — see §6/§7.

### Authentication options, ranked

1. **`ZITADEL-Signature` HMAC (recommended).** Every target call carries the header
   `ZITADEL-Signature: t=<unix>,v1=<hex>` where
   `v1 = HMAC-SHA256(signingKey, "<unix>.<raw body>")`, default freshness
   tolerance 300 s — source:
   [`pkg/actions/signing.go`](https://github.com/zitadel/zitadel/blob/v4.16.0/pkg/actions/signing.go)
   (`SigningHeader = "ZITADEL-Signature"`, `ComputeSignatureHeader`,
   `ValidatePayload`). The per-target `signingKey` is returned **once** by
   CreateTarget — store it as `ZITADEL_ACTIONS_SIGNING_KEY` in the entitlement
   env (optional/empty by default — the adapter fails closed with 401 when
   unset). This is strictly stronger than a static header (keyed to the
   body + timestamped).
2. *Fallback:* secret as query param — the endpoint is a free-form URL, so
   `http://entitlement:3000/internal/zitadel/token-claims?secret=...` works.
   Tradeoff: the secret sits in plaintext in Zitadel's target config/DB and can
   leak into access logs. Only acceptable as a stopgap.
3. *Defense in depth (always):* keep the route reachable only on the compose
   network; never publish it.

Adapter sketch (this is what shipped, kept close to the original sketch —
see `entitlement/src/claims/zitadel-route.ts` for the real, tested file):

```ts
// entitlement/src/claims/zitadel-route.ts
import { Elysia } from 'elysia'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { env } from '../config/env'
import { resolveClaims } from './resolver'

function validSignature(header: string | null, raw: string, key: string) {
  if (!key) return false // fail-closed: signing key not configured
  const t = header?.match(/t=(\d+)/)?.[1], v1 = header?.match(/v1=([0-9a-f]+)/)?.[1]
  if (!t || !v1 || Math.abs(Date.now() / 1000 - Number(t)) > 300) return false
  const mac = createHmac('sha256', key).update(`${t}.${raw}`).digest()
  const got = Buffer.from(v1, 'hex')
  return got.length === mac.length && timingSafeEqual(mac, got)
}

export const zitadelClaimsRouter = new Elysia({ prefix: '/internal/zitadel' }).post('/token-claims', async ({ request, set }) => {
  const raw = await request.text()
  if (!validSignature(request.headers.get('ZITADEL-Signature'), raw, env.ZITADEL_ACTIONS_SIGNING_KEY)) { set.status = 401; return 'no' }
  const payload = JSON.parse(raw) as { user?: { id?: string } }
  const claims = payload.user?.id ? await resolveClaims(payload.user.id) : {}
  if ('role' in claims) return { append_claims: [{ key: 'urn:platform:role', value: claims.role }] }
  if (!('tenantId' in claims)) return {}
  return { append_claims: Object.entries(claims).map(([k, v]) => ({ key: `urn:platform:${k}`, value: v })) }
})
```

---

## 4. GOTCHA: the default deny-list blocks compose-internal endpoints

v4.16.0 ships `HTTPClient.DenyList` defaults that block `localhost` and **all
private CIDR ranges** — `10.0.0.0/8`, `172.16.0.0/12` (Docker compose networks!),
`192.168.0.0/16` (Docker Desktop's `host.docker.internal`), etc. It is enforced
both when *creating* the target (URL validation in `AddTarget.isValid` →
`denylist.IsURLBlocked`) and at *call time* by the dialer — sources:
[`cmd/defaults.yaml` L1086-1100](https://github.com/zitadel/zitadel/blob/v4.16.0/cmd/defaults.yaml),
[`internal/command/action_v2_target.go`](https://github.com/zitadel/zitadel/blob/v4.16.0/internal/command/action_v2_target.go).

So `http://entitlement:3000/...` (or `http://host.docker.internal:3000/...` in
host-run dev) will be **rejected unless the deny-list is overridden**. For the dev
compose, add to the `zitadel` service environment:

```yaml
# comma-separated (ZITADEL_HTTPCLIENT_DENYLIST); this REPLACES the default list.
# Dev-only: keep at least the cloud-metadata + CGNAT ranges blocked.
ZITADEL_HTTPCLIENT_DENYLIST: "169.254.0.0/16,100.64.0.0/10,0.0.0.0/8"
```

Production note: overriding weakens Zitadel's SSRF protection — keep the list as
tight as your network layout allows (block everything except the entitlement
subnet). **MANUAL VERIFY**: create the target with the default list first and
confirm you actually get the `Errors.Target.DeniedURL` rejection, then apply the
override and re-create.

---

## 5. Registering the target + execution

Prereqs:

- A PAT for a service user with **instance-level** action permissions
  (`action.target.write`, `action.execution.write` — permissions per the
  [CreateTarget](https://zitadel.com/docs/reference/api/action/zitadel.action.v2.ActionService.CreateTarget) /
  [SetExecution](https://zitadel.com/docs/reference/api/action/zitadel.action.v2.ActionService.SetExecution)
  API docs). The org-scoped service user from `zitadel/docker-init.md` step 3 is
  NOT sufficient — give it an IAM (instance) membership, e.g. `IAM_OWNER`, or use
  a dedicated admin PAT for this one-time setup. **MANUAL VERIFY** (console).
- Feature flag: docs mention an "Actions" instance feature flag "to manage the
  related resources" ([Actions v2 concept](https://zitadel.com/docs/concepts/features/actions_v2)),
  but the v4.16.0 create-target command path shows no feature gate (checked
  `internal/command/action_v2_target.go` / `internal/api/grpc/action/v2/target.go`
  — no feature check present). If the API refuses or the Console hides the
  Actions page: Console → Instance → Features → enable **Actions**. **MANUAL VERIFY**.

### 5.1 Create the target — must be `restCall`

Only `restCall` targets have their **response parsed**; `restWebhook` checks the
status code only and `restAsync` ignores the response entirely — source:
[`internal/execution/execution.go` L79-110](https://github.com/zitadel/zitadel/blob/v4.16.0/internal/execution/execution.go).

**Endpoint — current vs future state.** `docker-compose.yml` has **no
`entitlement` service today** (only `db`, `redis`, `zitadel`); the entitlement app
runs on the host. So:

- **TODAY (the only working option):** `http://host.docker.internal:<PORT>/internal/zitadel/token-claims`
  — Docker Desktop's host alias, reachable from the zitadel container. Resolves
  into `192.168.65.0/24`, so the §4 deny-list override is **required**.
- **FUTURE (once the entitlement service joins the compose file, per the design
  spec §8):** `http://entitlement:3000/internal/zitadel/token-claims` — compose
  networks are `172.16.0.0/12`, so the §4 override is required there too.

Route path is the §3 adapter, not `/internal/claims`.

```bash
curl -sf -X POST "http://localhost:8080/v2/actions/targets" \
  -H "Authorization: Bearer $ZITADEL_PAT" -H "Content-Type: application/json" \
  -d '{
    "name": "entitlement-token-claims",
    "restCall": { "interruptOnError": true },
    "endpoint": "http://host.docker.internal:3000/internal/zitadel/token-claims",
    "timeout": "5s"
  }'
# → { "id": "<TARGET_ID>", "creationDate": "...", "signingKey": "<SAVE ME ONCE>" }
```

(Swap the endpoint for the compose-internal URL when the entitlement service is
containerized — update the target via UpdateTarget or re-create it.)

- `interruptOnError: true` → if the entitlement service is down, **token issuance
  fails** (fail-closed; no tokens without claims). `false` would issue tokens
  *without* `urn:platform:*` claims (fail-open). Fail-closed is recommended: an
  unprovisioned user legitimately gets `{}` (that is not an error), so the only
  thing `true` blocks is real outages. This only affects apps with JWT access
  tokens; the Console app uses the default opaque type and keeps working.
- Save `signingKey` → entitlement env `ZITADEL_ACTIONS_SIGNING_KEY`. It is shown
  only in this response.

### 5.2 Bind it to the `preaccesstoken` function

```bash
curl -sf -X PUT "http://localhost:8080/v2/actions/executions" \
  -H "Authorization: Bearer $ZITADEL_PAT" -H "Content-Type: application/json" \
  -d '{
    "condition": { "function": { "name": "preaccesstoken" } },
    "targets": [ "<TARGET_ID>" ]
  }'
```

Sources for exact shapes: [SetExecution API reference](https://zitadel.com/docs/reference/api/action/zitadel.action.v2.ActionService.SetExecution),
[docs "Test Actions Function"](https://zitadel.com/docs/guides/integrate/actions/testing-function)
(same two curl calls, function `preuserinfo`). Available function names can be
listed via `GET /v2/actions/executions/functions` (route confirmed live, §7).
Setting `"targets": []` later removes the execution (noop).

**Console alternative**: Console → (instance) **Actions** → create Target → create
Execution with condition type *Function* = `preaccesstoken`
(cf. [zitadel/actions custom-claims example](https://github.com/zitadel/actions/blob/main/actions-v2-cloudflare-workers/CUSTOM-CLAIMS.md)).
**MANUAL VERIFY** exact v4.16 console wording.

### 5.3 Set the OIDC app to JWT access tokens

Console → project → your application → Token Settings → **Access Token Type = JWT**
(required, see §1). **MANUAL VERIFY** the exact console label.

---

## 6. End-to-end verification procedure

1. `docker compose up -d db zitadel` (+ entitlement running with the §3 adapter
   route mounted and `ZITADEL_ACTIONS_SIGNING_KEY` set).
2. Console one-time setup per `zitadel/docker-init.md` (admin login, service user
   + PAT with instance action permissions, project + Web app with PKCE, **Access
   Token Type = JWT**), then §5.1 + §5.2 above.
3. Provision a test user (T13 flow / seed): Zitadel human user + `users` row with
   matching `zitadel_user_id`, company membership + role.
4. Login via the real OIDC flow (Authorization Code + PKCE against
   `http://localhost:8080/oauth/v2/authorize` → `/oauth/v2/token`; paths
   confirmed in `zitadel/docker-init.md`). Grab `access_token` from the token
   response.
5. Decode the payload (access token is a JWT only if step 2 set JWT type):

   ```bash
   T="<access_token>"
   cut -d. -f2 <<<"$T" | tr '_-' '/+' | { P=$(cat); pad=$(( (4 - ${#P} % 4) % 4 )); printf '%s%s' "$P" "$(printf '=%.0s' $(seq 1 $pad))"; } | base64 -d | jq .
   # or paste into jwt.io
   ```

6. Expected:
   - **Provisioned tenant user** → payload contains `urn:platform:tenantId`,
     `urn:platform:companies`, `urn:platform:modules`, `urn:platform:grants`
     (per-company `roles[]`/`permissions[]`, `grant_all` → `["*"]`).
   - **Superadmin** (`platform_admins` row) → only `urn:platform:role: "superadmin"`,
     no tenantId/grants.
   - **Unprovisioned or disabled user** → resolver returns `{}` → adapter returns
     `{}` → **no `urn:platform:*` claims at all** (login still succeeds; the
     entitlement API middleware rejects such tokens downstream).
   - If anything failed inside Zitadel's claim merge, look for a
     `urn:zitadel:iam:action:function/preaccesstoken:log` claim in the token
     (Zitadel writes merge problems there, see §2).

Whole flow of steps 2-6: **MANUAL VERIFY** (needs console clicks + a real browser
login; deliberately not faked here).

---

## 7. What was actually verified against the running v4.16.0 instance

Executed this session against `ghcr.io/zitadel/zitadel:v4.16.0` started via
`docker compose up -d db zitadel` (no PAT available, so unauthenticated surface
checks only):

| Check | Result |
|---|---|
| `curl localhost:8080/debug/healthz` | `ok` |
| `POST /v2/actions/targets` (no auth) | HTTP **401** → route exists, auth-gated (not 404) |
| `PUT /v2/actions/executions` (no auth) | HTTP **401** → route exists |
| `GET /v2/actions/executions/functions` (no auth) | HTTP **401**, body `{"code":16, "message":"auth header missing"}` → route exists |
| Entitlement `POST /internal/claims`, wrong `x-claims-secret` | **401** `no` (real `claimsRouter` served locally against the live DB) |
| Entitlement `POST /internal/claims`, correct secret, unknown user | **200** `{}` |

Not verified live (requires PAT/console/browser — listed as MANUAL VERIFY above):
authenticated target/execution creation, deny-list rejection + override, console
wording, JWT token-type setting, real login + decoded token. The §3 adapter route
is now implemented (`entitlement/src/claims/zitadel-route.ts`,
`tests/zitadel-claims.test.ts` — signature verification, superadmin, tenant-claims
round-trip, and unprovisioned-user cases all exercised against the real DB with a
synthetically computed `ZITADEL-Signature`) and **is mounted** in
`entitlement/src/http/app.ts`, but has not yet been called by a live Zitadel
instance end-to-end (still MANUAL VERIFY).

## Sources

- v4.16.0 source (pinned tag): [`internal/api/oidc/token.go`](https://github.com/zitadel/zitadel/blob/v4.16.0/internal/api/oidc/token.go) · [`internal/api/oidc/userinfo.go`](https://github.com/zitadel/zitadel/blob/v4.16.0/internal/api/oidc/userinfo.go) · [`internal/domain/action.go`](https://github.com/zitadel/zitadel/blob/v4.16.0/internal/domain/action.go) · [`internal/execution/execution.go`](https://github.com/zitadel/zitadel/blob/v4.16.0/internal/execution/execution.go) · [`pkg/actions/signing.go`](https://github.com/zitadel/zitadel/blob/v4.16.0/pkg/actions/signing.go) · [`internal/command/action_v2_target.go`](https://github.com/zitadel/zitadel/blob/v4.16.0/internal/command/action_v2_target.go) · [`cmd/defaults.yaml`](https://github.com/zitadel/zitadel/blob/v4.16.0/cmd/defaults.yaml)
- Docs: [Actions v2 concept](https://zitadel.com/docs/concepts/features/actions_v2) · [Using Actions](https://zitadel.com/docs/guides/integrate/actions/usage) · [Migrate from Actions V1](https://zitadel.com/docs/guides/integrate/actions/migrate-from-v1) · [Test Actions Function](https://zitadel.com/docs/guides/integrate/actions/testing-function) · [Test Function Manipulation](https://zitadel.com/docs/guides/integrate/actions/testing-function-manipulation) · [CreateTarget](https://zitadel.com/docs/reference/api/action/zitadel.action.v2.ActionService.CreateTarget) · [SetExecution](https://zitadel.com/docs/reference/api/action/zitadel.action.v2.ActionService.SetExecution)
- GitHub: [#10833 Remove Actions V1](https://github.com/zitadel/zitadel/issues/10833) · [#11095 Actions V2 + Login V1 (IDP-intent scope)](https://github.com/zitadel/zitadel/issues/11095) · [zitadel/actions custom-claims example](https://github.com/zitadel/actions/blob/main/actions-v2-cloudflare-workers/CUSTOM-CLAIMS.md)
