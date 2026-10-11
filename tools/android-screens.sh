#!/bin/bash
# Runs inside the Android emulator (CI): installs the app, sets it up offline and takes screenshots.
set -x
OUT="$1"; APK="$2"; mkdir -p "$OUT"
adb install -r "$APK"
adb shell am start -n io.github.pdfstift/.MainActivity; sleep 8
shot() { adb exec-out screencap -p > "$OUT/$1.png"; }
tap() { adb shell uiautomator dump /sdcard/ui.xml >/dev/null; adb pull /sdcard/ui.xml /tmp/ui.xml >/dev/null
  B=$(python3 - "$1" <<'PY'
import re,sys
x=open('/tmp/ui.xml',encoding='utf-8').read()
for m in re.finditer(r'text="([^"]*)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"',x):
    if sys.argv[1] in m.group(1):
        a,b,c,d=map(int,m.groups()[1:]); print((a+c)//2,(b+d)//2); break
PY
); [ -n "$B" ] && adb shell input tap $B; }
shot 1-start
tap "Offline"; sleep 6; shot 2-main
adb shell settings put system accelerometer_rotation 0; adb shell settings put system user_rotation 1; sleep 5; shot 3-landscape
adb shell settings put system user_rotation 0; sleep 3
adb logcat -d -s AndroidRuntime:E > "$OUT/crash.txt"
exit 0
