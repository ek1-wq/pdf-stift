#!/usr/bin/env bash
# Builds the Windows installer of PDF-Stift (runs on a Windows machine with Git Bash and Node.js 20).
#   tools/build-windows.sh <version> [publish]
# 1. checks the English translation is up to date
# 2. bundles the official PHP build for Windows (NTS x64) with the needed extensions
# 3. bundles LibreOffice (official Windows build, unmodified) and tests a conversion
# 4. smoke-tests the local server (library listing, search)
# 5. builds desktop/dist/PDF-Stift-Setup-<version>.exe  (with "publish": uploads it to GitHub Releases, needs GH_TOKEN)
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

echo "== LibreOffice"
# official Windows build, unpacked unmodified (administrative install of the MSI) into desktop/libreoffice
rm -rf desktop/libreoffice lo lo.msi
LOV="$(curl -sSfL --retry 3 --max-time 120 https://download.documentfoundation.org/libreoffice/stable/ | grep -oE 'href="[0-9]+\.[0-9]+\.[0-9]+/"' | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | sort -V | tail -1)"
echo "LibreOffice $LOV"
curl -sSfL --retry 3 --connect-timeout 30 --max-time 1200 -o lo.msi "https://download.documentfoundation.org/libreoffice/stable/$LOV/win/x86_64/LibreOffice_${LOV}_Win_x86-64.msi"
mkdir -p lo
# msiexec returns at once when started from bash – wait for it with PowerShell
powershell -NoProfile -Command "\$p = Start-Process msiexec.exe -ArgumentList '/a $(cygpath -w "$ROOT/lo.msi") /qn TARGETDIR=$(cygpath -w "$ROOT/lo")' -PassThru; if (-not \$p.WaitForExit(1200000)) { \$p.Kill(); exit 1 }; exit \$p.ExitCode"
SO="$(find lo -iname soffice.com -path '*program*' | head -1)"
[ -n "$SO" ] || { echo "LibreOffice: soffice.com not found"; find lo -maxdepth 3 | head -30; exit 1; }
mv "$(dirname "$(dirname "$SO")")" desktop/libreoffice
rm -rf lo lo.msi
# not needed for converting files in the background: help, dictionaries, gallery, templates, other UI languages
( cd desktop/libreoffice
  rm -rf help readmes share/gallery share/template share/wizards share/extensions/dict-* share/extensions/wiki-publisher share/extensions/nlpsolver
  for d in program/resource/*/; do case "$(basename "$d")" in de|en_GB|en_US) ;; *) rm -rf "$d" ;; esac; done
  # icon themes (only one is needed), other UI languages and Python scripting (Java/database parts stay: removing them stalls the start)
  for f in share/config/images_*.zip; do case "$(basename "$f")" in images_colibre.zip) ;; *) rm -f "$f" ;; esac; done
  for f in share/registry/Langpack-*.xcd share/registry/res/registry_*.xcd share/registry/res/fcfg_langpack_*.xcd; do case "$(basename "$f")" in Langpack-de.xcd|Langpack-en-US.xcd|Langpack-en-GB.xcd|registry_de.xcd|registry_en-GB.xcd|fcfg_langpack_de.xcd|fcfg_langpack_en-US.xcd|fcfg_langpack_en-GB.xcd) ;; *) rm -f "$f" ;; esac; done
  rm -rf program/python-core-* program/python*.dll program/python.exe program/pythonloader* program/pyuno* program/uno.py program/unohelper.py share/registry/pyuno.xcd

  du -sh program share 2>/dev/null; du -sh share/* 2>/dev/null | sort -h | tail -6 )
du -sh desktop/libreoffice
# short test: plain text → PDF
T0="$(mktemp -d)"; printf 'PDF-Stift LibreOffice test\n' > "$T0/t.txt"
MSYS_NO_PATHCONV=1 timeout 300 desktop/libreoffice/program/soffice.com --headless --norestore --nologo "-env:UserInstallation=file:///$(cygpath -m "$T0")/profil" --convert-to pdf --outdir "$(cygpath -w "$T0")" "$(cygpath -w "$T0/t.txt")" || true
[ -s "$T0/t.pdf" ] && echo "LibreOffice test: ok" || { echo "LibreOffice test FAILED"; exit 1; }

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
