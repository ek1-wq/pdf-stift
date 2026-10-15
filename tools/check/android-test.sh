#!/usr/bin/env bash
# Android app in the emulator: install, start, set up offline, create a notebook page, detect crashes
set -u
FAIL=0
pip3 install -q pillow 2>/dev/null || true
OUT="$1"; APK="$2"; mkdir -p "$OUT"
log() { echo "$*" | tee -a "$OUT/test.txt"; }
shot() { adb exec-out screencap -p > "$OUT/$1.png"; }
texts() { adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adb shell cat /sdcard/ui.xml > "$OUT/ui.xml" 2>/dev/null; grep -o 'text="[^"]*"' "$OUT/ui.xml" | sed 's/text="//;s/"$//' | grep -v '^$' | head -40 | tr '\n' '|'; }
# auf ein Element mit diesem Text tippen (Mitte der Fläche)
tap() {
  adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adb shell cat /sdcard/ui.xml > "$OUT/ui.xml"
  local b; b="$(python3 - "$OUT/ui.xml" "$1" <<'P'
import sys,re
x=open(sys.argv[1],encoding='utf-8',errors='ignore').read()
for m in re.finditer(r'<node [^>]*>',x):
    n=m.group(0)
    t=re.search(r' text="([^"]*)"',n); d=re.search(r'content-desc="([^"]*)"',n)
    q=sys.argv[2].lower()
    if (t and q in t.group(1).lower()) or (d and q in d.group(1).lower()):
        a,b,c,e=map(int,re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"',n).groups()); print((a+c)//2,(b+e)//2); break
P
)"
  if [ -z "$b" ]; then log "nicht gefunden: $1 – sichtbar: $(texts)"; return 1; fi
  adb shell input tap $b; sleep 2; log "getippt: $1"
}
adb logcat -c
T0=$(date +%s); adb install -r "$APK" >/dev/null && log "installiert in $(( $(date +%s) - T0 )) s"
PKG="$(adb shell pm list packages | grep -i pdfstift | head -1 | sed 's/package://' | tr -d '\r')"
log "Paket: $PKG"
adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1; sleep 8
shot 1-start; log "Start: $(texts)"
tap "Andere Adresse oder offline" || true
tap "Offline" && sleep 4
shot 2-offline; log "Offline: $(texts)"
tap "Notizbuch" && sleep 2
tap "Neues Notizbuch" && sleep 2
adb shell input text "Test"; sleep 1; shot 3-dialog; log "Dialog: $(texts)"
tap "Anlegen" || tap "OK" || true
sleep 3; shot 4-notizbuch; log "Notizbuch: $(texts)"
tap "Test" || true; sleep 3; log "Im Notizbuch: $(texts)"
tap "Neuer Abschnitt" || tap "Abschnitt" || true; sleep 2; adb shell input text "Kapitel"; tap "Anlegen" || true; sleep 3; log "Abschnitt: $(texts)"
tap "+ Seite" || true; sleep 3
log "nach + Seite: $(texts)"; tap "Anlegen" || true
sleep 5; shot 5-seite; log "Seite offen: $(texts)"
adb shell dumpsys activity activities | grep -m1 -o "mResumedActivity.*" | tee -a "$OUT/test.txt"
# „Finger schreibt“ einschalten (eingespielte Berührungen gelten als Finger; der Stift schreibt ohnehin)
adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adb shell cat /sdcard/ui.xml > "$OUT/ui-seite.xml"
python3 - "$OUT/ui-seite.xml" <<'P' | tee -a "$OUT/test.txt"
import re,sys
x=open(sys.argv[1],encoding='utf-8',errors='ignore').read()
for m in re.finditer(r'<node [^>]*>',x):
    n=m.group(0); b=re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"',n)
    if not b: continue
    a,bb,c,d=map(int,b.groups())
    if a<=900<=c and bb<=800<=d: print('Element bei 900,800:', re.search(r'class="([^"]*)"',n).group(1), b.group(0), 'clickable=' + re.search(r'clickable="(\w+)"',n).group(1))
P
# Schreiben lässt sich im Emulator nicht verlässlich prüfen (eingespielte Berührungen sind weder Finger noch Stift,
# die schnelle Stiftanzeige braucht eine echte Grafikkarte) – geprüft werden Start, Notizbuch, Seite und Rückweg
adb shell input keyevent KEYCODE_BACK; sleep 3; shot 6-zurueck; log "Liste: $(texts)"
texts | grep -q "Neue Seite" || { log "FEHLER: angelegte Seite fehlt in der Liste"; FAIL=1; }
tap "Neue Seite" && sleep 4 && shot 7-wieder-offen && adb shell dumpsys activity activities | grep -m1 -o "mResumedActivity.*" | grep -q BoardActivity || { log "FEHLER: Seite lässt sich nicht wieder öffnen"; FAIL=1; }
adb shell input keyevent KEYCODE_BACK; sleep 2
adb logcat -d > "$OUT/logcat.txt"; grep -i "pdfstift\|BoardView" "$OUT/logcat.txt" | tail -40 > "$OUT/logcat-app.txt"
if grep -q "FATAL EXCEPTION" "$OUT/logcat.txt"; then log "ABSTURZ:"; grep -A12 "FATAL EXCEPTION" "$OUT/logcat.txt" | head -30 | tee -a "$OUT/test.txt"; exit 1; fi
if grep -q "ANR in $PKG" "$OUT/logcat.txt"; then log "App reagiert nicht (ANR)"; exit 1; fi
log "kein Absturz"
[ "${FAIL:-0}" = 1 ] && exit 1
log "alle Prüfungen bestanden"
