#!/bin/sh
# Builds the live system's root filesystem, kernel and initramfs.
# Runs as root inside an Alpine container (see build.sh):
#   /iso   this folder (read-only)
#   /cp    the control-plane folder (read-only)
#   /work  output: rootfs/, vmlinuz, initramfs.gz, manifest.txt
set -eu

R=/work/rootfs
VERSION=${VERSION:-dev}

say() { printf '\n==> %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

apk add --no-cache cpio gzip curl >/dev/null

say "Installing packages into $R"
mkdir -p "$R/etc/apk"
cp -r /etc/apk/keys "$R/etc/apk/"
cp /etc/apk/repositories "$R/etc/apk/"

# linux-firmware-none keeps hundreds of MB of firmware out. Servers whose
# network cards need firmware will need specific packages added later.
PKGS="alpine-base openrc busybox-openrc busybox-mdev-openrc ifupdown-ng kmod
      linux-lts linux-firmware-none nodejs"
# Package scripts can report errors when run outside a booted system (the
# kernel's initramfs trigger, for example). The checks below catch real failures.
# shellcheck disable=SC2086
apk add --root "$R" --initdb --update-cache --no-cache $PKGS || echo "apk reported errors; checking the result"

[ -x "$R/bin/busybox" ] || die "busybox missing"
[ -x "$R/usr/bin/node" ] || die "node missing"
[ -f "$R/boot/vmlinuz-lts" ] || die "kernel missing"

say "Adding Cloud Hypervisor"
if apk add --root "$R" --no-cache cloud-hypervisor; then
    echo "from the Alpine package"
else
    echo "no Alpine package; downloading the latest static release"
    curl -fsSL -o "$R/usr/bin/cloud-hypervisor" \
        https://github.com/cloud-hypervisor/cloud-hypervisor/releases/latest/download/cloud-hypervisor-static
    curl -fsSL -o "$R/usr/bin/ch-remote" \
        https://github.com/cloud-hypervisor/cloud-hypervisor/releases/latest/download/ch-remote-static
    chmod 0755 "$R/usr/bin/cloud-hypervisor" "$R/usr/bin/ch-remote"
fi

say "Adding WhaleVisor files"
cp -a /iso/overlay/. "$R/"
chmod 0755 "$R/init" "$R/etc/init.d/whalevisor" "$R/usr/local/bin/whalevisor-status"
mkdir -p "$R/opt/whalevisor/control-plane"
cp -a /cp/src /cp/package.json "$R/opt/whalevisor/control-plane/"
echo "$VERSION" > "$R/etc/whalevisor-release"
echo "whalevisor" > "$R/etc/hostname"
# The kernel opens /dev/console before /init runs.
[ -e "$R/dev/console" ] || mknod -m 600 "$R/dev/console" c 5 1
[ -e "$R/dev/null" ] || mknod -m 666 "$R/dev/null" c 1 3
# Package triggers may not have run, so build the module index here.
chroot "$R" /sbin/depmod -a "$(ls "$R/lib/modules")"

say "Enabling services"
enable() {
    level=$1; shift
    mkdir -p "$R/etc/runlevels/$level"
    for svc in "$@"; do
        if [ -e "$R/etc/init.d/$svc" ]; then
            ln -sf "/etc/init.d/$svc" "$R/etc/runlevels/$level/$svc"
            echo "  $level: $svc"
        else
            echo "  $level: $svc (not installed, skipped)"
        fi
    done
}
enable sysinit devfs procfs sysfs dmesg mdev hwdrivers
enable boot modules sysctl hostname bootmisc syslog networking
enable default whalevisor
enable shutdown mount-ro killprocs savecache
for svc in devfs mdev networking whalevisor; do
    find "$R/etc/runlevels" -name "$svc" | grep -q . || die "required service $svc is not enabled"
done

say "Packing the initramfs"
rm -rf "$R/var/cache/apk"/*
cp "$R/boot/vmlinuz-lts" /work/vmlinuz
(cd "$R" && find . -path ./boot -prune -o -print | cpio -o -H newc --quiet | gzip -6) > /work/initramfs.gz

{
    echo "WhaleVisor $VERSION"
    echo "Alpine $(cat "$R/etc/alpine-release")"
    echo "Kernel $(ls "$R/lib/modules")"
    echo "Node $(chroot "$R" /usr/bin/node --version)"
    echo "Cloud Hypervisor: $(chroot "$R" /usr/bin/cloud-hypervisor --version 2>&1 | head -n 1)"
    echo "initramfs $(du -h /work/initramfs.gz | cut -f1)"
} | tee /work/manifest.txt
