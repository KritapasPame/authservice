#!/usr/bin/env bash
# สร้าง Actions v2 target + execution (preaccesstoken) ให้ Zitadel ยิง custom claims มาที่ Entitlement Service
# อ้างอิง: zitadel/actions/token-claims.md §5.1-5.2 (pinned Zitadel v4.16.0)
#
# ใช้:
#   ZITADEL_PAT=<service user PAT> ./scripts/setup-zitadel-action.sh \
#     [ZITADEL_URL] [TARGET_ENDPOINT]
#
#   ZITADEL_URL      default: https://authservice.edmcompany.co.th
#   TARGET_ENDPOINT  default: http://entitlement:3000/internal/zitadel/token-claims (compose network)
#                    (host-only dev: http://host.docker.internal:3000/internal/zitadel/token-claims)
#
# สำคัญ: signingKey โชว์ครั้งเดียวตอนสร้าง target — เอาไปใส่ env ZITADEL_ACTIONS_SIGNING_KEY ของ entitlement ทันที
set -euo pipefail

ZITADEL_URL="${1:-https://authservice.edmcompany.co.th}"
TARGET_ENDPOINT="${2:-http://entitlement:3000/internal/zitadel/token-claims}"
: "${ZITADEL_PAT:?ต้องตั้ง env ZITADEL_PAT (service user PAT ที่มีสิทธิ์ instance actions)}"

auth=(-H "Authorization: Bearer $ZITADEL_PAT" -H "Content-Type: application/json")

echo "== 1/2 สร้าง target: entitlement-token-claims -> $TARGET_ENDPOINT"
create_res=$(curl -sf -X POST "$ZITADEL_URL/v2/actions/targets" "${auth[@]}" -d "{
  \"name\": \"entitlement-token-claims\",
  \"restCall\": { \"interruptOnError\": true },
  \"endpoint\": \"$TARGET_ENDPOINT\",
  \"timeout\": \"5s\"
}")
echo "$create_res"
target_id=$(echo "$create_res" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
signing_key=$(echo "$create_res" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("signingKey",""))')

echo "== 2/2 bind execution: function preaccesstoken -> target $target_id"
curl -sf -X PUT "$ZITADEL_URL/v2/actions/executions" "${auth[@]}" -d "{
  \"condition\": { \"function\": { \"name\": \"preaccesstoken\" } },
  \"targets\": [ \"$target_id\" ]
}"
echo

echo
echo "=========================================================="
echo "TARGET_ID: $target_id"
echo "SIGNING KEY (โชว์ครั้งเดียว — ใส่ env entitlement ทันที ห้าม commit):"
echo "  ZITADEL_ACTIONS_SIGNING_KEY=$signing_key"
echo "=========================================================="
echo "อย่าลืม (ดู token-claims.md + PHASE1-PRETEST-RUNBOOK.md):"
echo "  1. zitadel container ต้องมี ZITADEL_HTTPCLIENT_DENYLIST override (§4) ไม่งั้นยิง private net ไม่ได้"
echo "  2. OIDC app ต้องตั้ง Access Token Type = JWT (Console → project → app → Token Settings)"
echo "  3. restart entitlement หลังใส่ signing key แล้วทดสอบด้วย scripts/oidc-pkce-test.py"
