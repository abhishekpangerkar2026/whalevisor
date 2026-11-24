#!/usr/bin/env bash
# Builds out/whalevisor-<version>-x86_64.iso.
#
# Needs an x86_64 Linux machine with Docker, grub-mkrescue (grub-pc-bin and
# grub-efi-amd64-bin), xorriso and mtools. Run with sudo. GitHub Actions
# runs this on every push; see .github/workflows/iso.yml.
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(dirname "$HERE")
VERSION=${VERSION:-0.1.0}
ALPINE=${ALPINE:-3.22}
WORK=${WORK:-$REPO/work}
OUT=${OUT:-$REPO/out}
ISO="$OUT/whalevisor-$VERSION-x86_64.iso"

rm -rf "$WORK"
mkdir -p "$WORK" "$OUT"

docker run --rm \
    -e VERSION="$VERSION" \
    -v "$HERE:/iso:ro" \
    -v "$REPO/control-plane:/cp:ro" \
    -v "$WORK:/work" \
    "alpine:$ALPINE" sh /iso/make-rootfs.sh

ISODIR="$WORK/isodir"
mkdir -p "$ISODIR/boot/grub"
cp "$WORK/vmlinuz" "$WORK/initramfs.gz" "$ISODIR/boot/"
sed "s/@VERSION@/$VERSION/g" "$HERE/grub.cfg" > "$ISODIR/boot/grub/grub.cfg"

# Boots from BIOS and UEFI, from a CD or written to a USB stick.
grub-mkrescue -o "$ISO" "$ISODIR" -- -volid WHALEVISOR

cp "$WORK/manifest.txt" "$OUT/manifest.txt"
echo "ISO size: $(du -h "$ISO" | cut -f1)" | tee -a "$OUT/manifest.txt"
echo "Built $ISO"
