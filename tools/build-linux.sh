#!/usr/bin/env bash
# Builds the Linux packages of PDF-Stift (AppImage and .deb) on Ubuntu with Node.js 20, plus the server package (ZIP).
#   tools/build-linux.sh <version> [publish]
# 1. checks the English translation is up to date
# 2. bundles a self-contained PHP (static build from static-php.dev, extensions built in)
# 3. smoke-tests the local server (library listing, search)
# 4. builds desktop/dist/PDF-Stift-<version>.AppImage and pdf-stift_<version>_amd64.deb (with "publish": uploads them to GitHub Releases)
# 5. builds desktop/dist/pdf-stift-server-<version>.zip – PDF-Stift for your own web server (upload via FTP)
set -euo pipefail
V="${1:?version}"; PUB="${2:-never}"; [ "$PUB" = publish ] && PUB=always
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"

echo "== translation"
(cd tools/i18n && npm install --no-audit --no-fund >/dev/null && node i18n.js check)

echo "== PHP"
rm -rf desktop/php && mkdir -p desktop/php
BASE="https://dl.static-php.dev/static-php-cli/common"
F="$(curl -sSfL "$BASE/" | grep -oE 'php-8\.3\.[0-9]+-cli-linux-x86_64\.tar\.gz' | sort -t. -k3,3n -u | tail -1)"
[ -n "$F" ] || { echo "no static PHP build found"; exit 1; }
echo "$F"
curl -sSfL "$BASE/$F" | tar xz -C desktop/php
chmod +x desktop/php/php
# extensions are built in – keep only the settings from desktop/php.ini
grep -v '^extension=' desktop/php.ini > desktop/php/php.ini
desktop/php/php -c desktop/php/php.ini -m | tr '\n' ' '; echo
for e in mbstring fileinfo openssl curl zip pdo_sqlite sqlite3; do desktop/php/php -m | grep -qix "$e" || { echo "missing PHP extension $e"; exit 1; }; done
du -sh desktop/php

echo "== smoke test"
T="$(mktemp -d)"; mkdir -p "$T/lib/Test" "$T/data"
printf '%%PDF-1.4\n%%%%EOF\n' > "$T/lib/Test/sample.pdf"
PDFSTIFT_LOCAL_KEY=ci PDFSTIFT_DATA="$T/data" PDFSTIFT_LIBRARY="$T/lib" desktop/php/php -c desktop/php/php.ini -S 127.0.0.1:38999 -t app > "$T/php.log" 2>&1 &
PHPPID=$!
sleep 3
ME="$(curl -sS -H 'X-PDFStift-Local: ci' http://127.0.0.1:38999/api.php?a=me)"; echo "$ME"
LIST="$(curl -sS -H 'X-PDFStift-Local: ci' 'http://127.0.0.1:38999/api.php?a=list')"; echo "${LIST:0:300}"
curl -sS -H 'X-PDFStift-Local: ci' 'http://127.0.0.1:38999/api.php?a=search&q=test' | head -c 200; echo
CODE="$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:38999/)"; echo "index: $CODE"
kill $PHPPID 2>/dev/null || true
tail -5 "$T/php.log" || true
[[ "$ME" == *'"loggedIn":true'* ]] && [[ "$LIST" == *sample.pdf* ]] && [ "$CODE" = 200 ] || { echo "SMOKE TEST FAILED"; exit 1; }

echo "== packages"
rm -rf desktop/web && cp -r app desktop/web
cp LICENSE desktop/LICENSE.txt && cp THIRD-PARTY-NOTICES.md desktop/THIRD-PARTY-NOTICES.md
cd desktop
npm install --no-audit --no-fund 2>&1 | tail -3
npx electron-builder --linux AppImage deb --x64 --publish "$PUB" -c.extraMetadata.version="$V" 2>&1 | tail -25

echo "== server package"
S="$(mktemp -d)/pdf-stift"; mkdir -p "$S"
cp -r "$ROOT/app/." "$S/"
cp "$ROOT/docs/SERVER.md" "$S/INSTALL.md"; cp "$ROOT/LICENSE" "$S/LICENSE.txt"
rm -f "$S/config.php"; rm -rf "$S/storage"
(cd "$(dirname "$S")" && zip -qr "$ROOT/desktop/dist/pdf-stift-server-$V.zip" pdf-stift)
ls -la dist
if [ "$PUB" = always ]; then gh release upload "v$V" "dist/pdf-stift-server-$V.zip" --clobber; fi
