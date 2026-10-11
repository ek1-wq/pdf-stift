#!/usr/bin/env python3
"""Google Play: native libraries must be aligned for 16 KB memory pages. Checks every arm64/x86_64 .so in an APK or AAB."""
import struct, sys, zipfile
bad = 0
for f in sys.argv[1:]:
    with zipfile.ZipFile(f) as z:
        for n in z.namelist():
            if not n.endswith('.so') or not ('arm64-v8a' in n or 'x86_64' in n):
                continue
            b = z.read(n)
            if b[:4] != b'\x7fELF' or b[4] != 2:
                continue
            phoff, = struct.unpack_from('<Q', b, 0x20); phsz, phn = struct.unpack_from('<HH', b, 0x36)
            al = [struct.unpack_from('<Q', b, phoff + i * phsz + 0x30)[0] for i in range(phn) if struct.unpack_from('<I', b, phoff + i * phsz)[0] == 1]
            ok = all(a >= 16384 for a in al)
            print(('ok   ' if ok else 'FAIL ') + n + ' ' + str(min(al) if al else '-'))
            bad += not ok
sys.exit(1 if bad else 0)
