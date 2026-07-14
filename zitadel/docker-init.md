# Zitadel manual console setup (v4.16.0)

One-time manual steps after `docker compose up -d db zitadel` comes up healthy.
This project pins Zitadel to `v4.16.0` and runs the bundled **legacy login UI
v1** (`ZITADEL_DEFAULTINSTANCE_FEATURES_LOGINV2_REQUIRED=false`), not the new
Login V2 Next.js app — so everything below happens under `:8080`, no extra
containers or reverse proxy.

1. `docker compose up -d db zitadel`, wait for `curl -sf localhost:8080/debug/healthz` to return `ok`.
2. Open the console: `http://localhost:8080/ui/console`.
   - First login uses the bootstrap admin user Zitadel creates on `start-from-init`
     (`zitadel-admin@zitadel.<ZITADEL_EXTERNALDOMAIN>` / a generated password —
     **verify in console**: the exact login/password Zitadel prints; on v4 it may
     also be logged to the container's stdout on first boot — check
     `docker compose logs zitadel` if the console doesn't show it).
3. **Create a service user + PAT** (→ `ZITADEL_MGMT_TOKEN`):
   - Console → *Users* → *Service Users* → *New* → give it a name (e.g.
     `entitlement-service`), type `Machine`.
   - Grant it a role that can call the Management API for claims lookups
     (e.g. org-level `ORG_OWNER` or a narrower manager role) — **verify in
     console**: exact role name/granularity to use for a minimal-privilege
     service account is a judgment call, pick the least-privileged role that
     lets `/management/v1/*` calls succeed.
   - Open the service user → *Personal Access Tokens* tab → *New* → copy the
     generated token immediately (shown once) → put it in `.env` as
     `ZITADEL_MGMT_TOKEN`.
4. **Create a project + OIDC app** (→ `ZITADEL_AUDIENCE`):
   - Console → *Projects* → *New* → name it (e.g. `entitlement`).
   - Inside the project → *New Application* → type **Web** → auth method
     **Authorization Code** → enable **PKCE** (Zitadel calls this
     "Proof Key for Code Exchange" in the app creation wizard, under
     "Authentication Method"/"Auth Flow" step — **verify in console**: the
     v4 app-creation wizard's exact wording for selecting Auth Code + PKCE
     vs. other flows may differ from v3 screenshots online).
   - Configure redirect URIs / post-logout URIs for whichever client
     (Next.js / eSign) will use this app.
   - After creation, the app detail page shows a **Client ID** — use that
     as `ZITADEL_AUDIENCE` (Zitadel access tokens carry the project/client
     id as `aud`; **verify in console**: confirm whether the value to copy
     is the *Client ID* field or the *Project resource ID*, since both are
     sometimes referred to loosely as "audience" — for this app type it
     should be the OIDC Client ID shown on the application page).
5. **Set access token TTL to 10 minutes**:
   - Console → the project's application → *Token Settings* (or the
     instance-level *Login Behavior and Security* settings, depending on
     whether you want this per-app or instance-wide) → set **Access Token
     Lifetime** to `10m` — **verify in console**: v4 may expose this under
     *Instance* → *Settings* → *Security* rather than per-application; check
     both locations if it's not on the app page.
6. Copy `ZITADEL_ISSUER=http://localhost:8080` and
   `ZITADEL_JWKS_URL=http://localhost:8080/oauth/v2/keys` into `.env`
   (these paths were confirmed live against v4.16.0 — see "registered route"
   log lines on boot: `/oauth/v2/keys`, `/oauth/v2/token`, etc.).

## Notes / things confirmed by actually running v4.16.0

- `/debug/healthz` — confirmed working (`curl -sf localhost:8080/debug/healthz` → `ok`).
- `/ui/console` — confirmed reachable (200 OK).
- `/ui/login/login` — confirmed reachable (routes exist; redirects to
  `/ui/console/` when hit without an active OIDC auth request, which is
  expected — you'll only see the real login form when a client redirects
  a user in via a proper `/oauth/v2/authorize` request).
- Steps 2-5 above (exact console labels/menus) were **not** click-verified
  in a browser this session — only the HTTP surface was checked via curl.
  Verify the console wording before relying on the exact wording above.
