#!/usr/bin/env bash
# pack @platform/auth เป็น tarball สำหรับวางบนเครื่อง test ให้ eSign download
# ใช้: ./scripts/pack-auth.sh  → ได้ dist-packages/platform-auth-<version>.tgz
# ขั้นตอนเต็ม (bump version, วางบน nginx, ฝั่ง eSign install) ดู docs/PACKAGE-DISTRIBUTION.md
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$root/dist-packages"
# build ก่อน pack เสมอ — ตั้งแต่ v1.2.0 tarball มีทั้ง src (bun consumer เดิม)
# และ dist (ESM JS + .d.ts สำหรับ plain Node/JS consumer) ดู docs/PACKAGE-DISTRIBUTION.md
(cd "$root/packages/auth" && bun run build)
out=$(cd "$root/packages/auth" && npm pack --pack-destination "$root/dist-packages" 2>/dev/null | tail -1)

echo "✅ $root/dist-packages/$out"
echo
echo "ต่อไป:"
echo "  1. scp dist-packages/$out <server>:/var/www/packages/"
echo "  2. ฝั่ง eSign: bun add https://authservice.edmcompany.co.th/packages/$out"
echo "  (อัปเดตครั้งหน้า: bump version ใน packages/auth/package.json ก่อน pack ใหม่)"
