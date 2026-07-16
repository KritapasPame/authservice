#!/usr/bin/env python3
"""Run a local OIDC Authorization Code + PKCE flow and print token audience."""

import argparse
import base64
import hashlib
import json
import secrets
import subprocess
import sys
import urllib.parse
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer


REDIRECT_URI = "http://127.0.0.1:8787/callback"


def base64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("client_id", help="ZITADEL OIDC application Client ID")
    parser.add_argument(
        "--issuer",
        default="https://authservice.edmcompany.co.th",
        help="OIDC issuer URL",
    )
    args = parser.parse_args()

    issuer = args.issuer.rstrip("/")
    verifier = secrets.token_urlsafe(64)
    challenge = base64url(hashlib.sha256(verifier.encode()).digest())
    state = secrets.token_urlsafe(24)
    result: dict[str, str] = {}

    class CallbackHandler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            result["code"] = query.get("code", [""])[0]
            result["state"] = query.get("state", [""])[0]
            result["error"] = query.get("error_description", query.get("error", [""]))[0]
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.end_headers()
            self.wfile.write(b"Login callback received. You can close this tab.")

        def log_message(self, _format: str, *_args: object) -> None:
            pass

    authorize_url = issuer + "/oauth/v2/authorize?" + urllib.parse.urlencode(
        {
            "client_id": args.client_id,
            "redirect_uri": REDIRECT_URI,
            "response_type": "code",
            "scope": "openid profile email",
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "state": state,
        }
    )

    server = HTTPServer(("127.0.0.1", 8787), CallbackHandler)
    server.timeout = 300
    print(f"Waiting for callback at {REDIRECT_URI}")
    print("Opening the login page in your browser...")
    if not webbrowser.open(authorize_url):
        print(f"Open this URL manually:\n{authorize_url}")
    server.handle_request()
    server.server_close()

    if result.get("error"):
        raise SystemExit(f"Authorization failed: {result['error']}")
    if not result.get("code"):
        raise SystemExit("No callback received within 5 minutes.")
    if result.get("state") != state:
        raise SystemExit("Callback state mismatch.")

    token_body = urllib.parse.urlencode(
        {
            "grant_type": "authorization_code",
            "client_id": args.client_id,
            "redirect_uri": REDIRECT_URI,
            "code": result["code"],
            "code_verifier": verifier,
        }
    ).encode()
    token_request = subprocess.run(
        [
            "curl",
            "--silent",
            "--show-error",
            "--request",
            "POST",
            issuer + "/oauth/v2/token",
            "--header",
            "Content-Type: application/x-www-form-urlencoded",
            "--data-binary",
            "@-",
        ],
        input=token_body,
        capture_output=True,
        check=False,
    )

    try:
        token_response = json.loads(token_request.stdout)
    except json.JSONDecodeError:
        message = token_request.stderr.decode(errors="replace") or token_request.stdout.decode(
            errors="replace"
        )
        raise SystemExit(f"Token exchange failed: {message}") from None

    if token_response.get("error"):
        message = token_response.get("error_description") or token_response["error"]
        raise SystemExit(f"Token exchange failed: {message}")

    access_token = token_response.get("access_token", "")
    parts = access_token.split(".")
    if len(parts) != 3:
        raise SystemExit(
            "Access token is opaque. Set the ZITADEL application's Access Token Type to JWT."
        )

    try:
        payload = json.loads(base64.urlsafe_b64decode(parts[1] + "=" * (-len(parts[1]) % 4)))
    except (ValueError, json.JSONDecodeError) as error:
        raise SystemExit(f"Could not decode access token payload: {error}") from None

    print("\nLogin succeeded.")
    print("aud =", json.dumps(payload.get("aud")))
    print("iss =", payload.get("iss"))
    print("sub =", payload.get("sub"))

    platform_claims = {k: v for k, v in payload.items() if k.startswith("urn:platform:")}
    print("\nurn:platform:* claims (custom claims via Actions v2):")
    if platform_claims:
        print(json.dumps(platform_claims, indent=2, ensure_ascii=False))
        print("\nDo not share the access, ID, or refresh tokens.")
    else:
        print("  (none)")
        print(
            "\nNo platform claims in the access token. Either the user is unprovisioned"
            " (no `users` row -> {} is correct), or the Actions v2 wiring is incomplete:"
            "\n  1. target+execution created? (scripts/setup-zitadel-action.sh)"
            "\n  2. ZITADEL_HTTPCLIENT_DENYLIST override set on the zitadel container?"
            "\n  3. entitlement running with ZITADEL_ACTIONS_SIGNING_KEY set?"
            "\n  4. user provisioned in entitlement DB (users + user_companies + user_roles)?"
        )
        raise SystemExit(2)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit("\nCancelled.")
