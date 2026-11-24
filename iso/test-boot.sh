#!/usr/bin/env bash
# Boots the ISO in QEMU and checks that WhaleVisor comes up.
#   test-boot.sh <iso> <bios|uefi> <output-dir>
# Writes serial-<mode>.log, screen-<mode>.png and result-<mode>.txt.
set -uo pipefail

ISO=$1
MODE=$2
OUT=$3
mkdir -p "$OUT"
LOG="$OUT/serial-$MODE.log"
RESULT="$OUT/result-$MODE.txt"
SOCK=$(mktemp -u)
PORT=18080
: > "$LOG"
: > "$RESULT"

ARGS=(-m 2048 -smp 2 -cdrom "$ISO" -boot d -display none -vga std -no-reboot
      -serial "file:$LOG" -monitor "unix:$SOCK,server,nowait"
      -netdev "user,id=n0,hostfwd=tcp:127.0.0.1:$PORT-:8080" -device e1000,netdev=n0)
if [ -w /dev/kvm ]; then
    ARGS+=(-enable-kvm -cpu host)
    LIMIT=300
    echo "host acceleration: kvm" >> "$RESULT"
else
    ARGS+=(-cpu max)
    LIMIT=1200
    echo "host acceleration: none (slow emulation)" >> "$RESULT"
fi
if [ "$MODE" = uefi ]; then
    FW=""
    for f in /usr/share/ovmf/OVMF.fd /usr/share/OVMF/OVMF.fd /usr/share/qemu/OVMF.fd; do
        [ -f "$f" ] && FW=$f && break
    done
    if [ -z "$FW" ]; then
        echo "UEFI firmware not found" >> "$RESULT"
        echo "RESULT: FAIL" >> "$RESULT"
        cat "$RESULT"
        exit 1
    fi
    ARGS+=(-bios "$FW")
fi

qemu-system-x86_64 "${ARGS[@]}" &
QEMU=$!
trap 'kill $QEMU 2>/dev/null' EXIT

ok=1
booted=no
for ((i = 0; i < LIMIT; i += 2)); do
    if grep -q WHALEVISOR_READY "$LOG"; then booted=yes; break; fi
    kill -0 $QEMU 2>/dev/null || break
    sleep 2
done
echo "control plane ready: $booted (after about ${i}s)" >> "$RESULT"
[ $booted = yes ] || ok=0

# Give the status screen on tty1 a moment to draw, then photograph it.
sleep 10
echo "screendump $OUT/screen-$MODE.png -f png" | socat - "UNIX-CONNECT:$SOCK" >/dev/null 2>&1
[ -s "$OUT/screen-$MODE.png" ] && echo "screenshot: saved" >> "$RESULT" || echo "screenshot: FAILED" >> "$RESULT"

# From outside the VM: the API must answer, and must refuse a missing token.
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://127.0.0.1:$PORT/api/v1/health")
echo "API without token: HTTP $code (expected 401)" >> "$RESULT"
[ "$code" = 401 ] || ok=0

[ $ok = 1 ] && echo "RESULT: PASS" >> "$RESULT" || echo "RESULT: FAIL" >> "$RESULT"
cat "$RESULT"
[ $ok = 1 ]
