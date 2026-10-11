#!/usr/bin/env bash
# Builds the Windows installer of PDF-Stift (runs on a Windows machine with Git Bash and Node.js 20).
#   tools/build-windows.sh <version> [publish]
# 1. checks the English translation is up to date
# 2. bundles the official PHP build for Windows (NTS x64) with the needed extensions
# 3. smoke-tests the local server (library listing, search)
# 4. builds desktop/dist/PDF-Stift-Setup-<version>.exe  (with "publish": uploads it to GitHub Releases, needs GH_TOKEN)
set -euo pipefail
V="${1:?version}"; PUB="${2:-never}"; [ "$PUB" = publish ] && PUB=always
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"

echo "== translation"
(cd tools/i18n && npm install --no-audit --no-fund >/dev/null && node i18n.js check)

echo "== PHP"
rm -rf desktop/php php.zip
curl -sSfL -o php.zip "https://windows.php.net/downloads/releases/latest/php-8.3-nts-Win32-vs16-x64-latest.zip"
mkdir -p desktop/php && unzip -q php.zip -d desktop/php && rm php.zip
rm -rf desktop/php/dev desktop/php/extras desktop/php/php.ini-* desktop/php/phpdbg* desktop/php/php-cgi.exe
rm -f desktop/php/php-win.exe desktop/php/deplister.exe desktop/php/*.pdb desktop/php/ext/*.pdb
# only the extensions listed in desktop/php.ini
KEEP="$(grep -oE '^extension=[a-z_0-9]+' desktop/php.ini | sed 's/extension=/php_/; s/$/.dll/')"
for f in desktop/php/ext/*.dll; do grep -qx "$(basename "$f")" <<<"$KEEP" || rm -f "$f"; done
cp desktop/php.ini desktop/php/php.ini
EXT="$(cygpath -w "$ROOT/desktop/php/ext" 2>/dev/null || echo "$ROOT/desktop/php/ext")"
desktop/php/php.exe -c desktop/php/php.ini -d extension_dir="$EXT" -m | tr '\n' ' '; echo
du -sh desktop/php

echo "== smoke test"
T="$(mktemp -d)"; mkdir -p "$T/lib/Test" "$T/data"
printf '%%PDF-1.4\n%%%%EOF\n' > "$T/lib/Test/sample.pdf"
PDFSTIFT_LOCAL_KEY=ci PDFSTIFT_DATA="$(cygpath -w "$T/data" 2>/dev/null || echo "$T/data")" PDFSTIFT_LIBRARY="$(cygpath -w "$T/lib" 2>/dev/null || echo "$T/lib")" \
  desktop/php/php.exe -c desktop/php/php.ini -d extension_dir="$EXT" -S 127.0.0.1:38999 -t app > "$T/php.log" 2>&1 &
PHPPID=$!
sleep 3
ME="$(curl -sS -H 'X-PDFStift-Local: ci' http://127.0.0.1:38999/api.php?a=me)"; echo "$ME"
LIST="$(curl -sS -H 'X-PDFStift-Local: ci' 'http://127.0.0.1:38999/api.php?a=list')"; echo "${LIST:0:300}"
curl -sS -H 'X-PDFStift-Local: ci' 'http://127.0.0.1:38999/api.php?a=search&q=test' | head -c 200; echo
CODE="$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:38999/)"; echo "index: $CODE"
kill $PHPPID 2>/dev/null || true
tail -5 "$T/php.log" || true
[[ "$ME" == *'"loggedIn":true'* ]] && [[ "$LIST" == *sample.pdf* ]] && [ "$CODE" = 200 ] || { echo "SMOKE TEST FAILED"; exit 1; }

echo "== installer"
rm -rf desktop/web && cp -r app desktop/web
cp LICENSE desktop/LICENSE.txt && cp THIRD-PARTY-NOTICES.md desktop/THIRD-PARTY-NOTICES.md
cd desktop
npm install --no-audit --no-fund 2>&1 | tail -3
npx electron-builder --win nsis --x64 --publish "$PUB" -c.extraMetadata.version="$V" 2>&1 | tail -25
ls -la dist
