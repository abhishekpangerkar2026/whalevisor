# WhaleVisor ISO

This folder builds a bootable WhaleVisor image: `whalevisor-<version>-x86_64.iso`.

The image is a **live system**. It runs from memory and writes nothing to the server's disks. A disk installer comes later.

## What boots

1. A boot menu: "Try WhaleVisor without installing".
2. A small Alpine Linux system with the KVM kernel modules and Cloud Hypervisor.
3. The WhaleVisor control plane, listening on port 8080 with a random access token.
4. A status screen on the server's display. It shows the API address, the token, and whether hardware virtualization is available.

Press Alt+F2 on the server for a root shell.

## Get the ISO

Every push to `main` builds and boot-tests the ISO on GitHub Actions. The newest one that passed is on the repo's Releases page, under **latest-build**.

The test boots the ISO in a virtual machine twice, once with BIOS and once with UEFI. Logs and a screenshot of each boot go to the `ci-results` branch.

## Try it

In a virtual machine with at least 2 GB of memory:

```sh
qemu-system-x86_64 -enable-kvm -cpu host -m 2048 -cdrom whalevisor-*.iso \
  -nic user,hostfwd=tcp:127.0.0.1:8080-:8080
```

Then, using the token from the status screen:

```sh
curl -H "Authorization: Bearer <token>" http://127.0.0.1:8080/api/v1/health
```

On a real server, write the ISO to a USB stick with `dd` or balenaEtcher and boot from it.

## Build it yourself

You need an x86_64 Linux machine with Docker, `grub-mkrescue` (packages `grub-common`, `grub-pc-bin`, `grub-efi-amd64-bin`), `xorriso` and `mtools`.

```sh
sudo bash iso/build.sh                                  # writes out/whalevisor-*.iso
bash iso/test-boot.sh out/whalevisor-*.iso bios results # needs qemu-system-x86 and socat
```

## Files

| File | Does |
| --- | --- |
| `build.sh` | Runs the build and makes the ISO |
| `make-rootfs.sh` | Runs in an Alpine container; installs packages and packs the system into one initramfs |
| `grub.cfg` | Boot menu |
| `overlay/` | Files copied into the system: service script, status screen, network and init settings |
| `test-boot.sh` | Boots the ISO in QEMU and checks the control plane answers |

## Limits today

- **VMs are not real yet.** The control plane still uses the mock driver. Cloud Hypervisor is on the image but nothing calls it.
- **The API is plain HTTP.** The token travels unencrypted, so use it on a trusted network only.
- **No firmware packages.** Network cards that need firmware won't work on real servers until those packages are added.
- **No installer, no web Console, x86_64 only.**
