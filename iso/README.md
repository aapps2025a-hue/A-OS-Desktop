# A-OS Desktop live ISO

This directory is the complete, open-source Debian Live configuration for the
A-OS Desktop ISO. The image boots a lightweight Linux session, starts a local
web server, opens Chromium in kiosk mode, and loads the same `public` build used
by Firebase and GitHub Pages. The first visible application screen therefore
uses the same `assets/os/A-OS Boot.gif` animation as the website.

## Build on Debian or Ubuntu

```bash
sudo apt-get update
sudo apt-get install -y live-build debootstrap squashfs-tools xorriso isolinux syslinux-common
rm -rf config/includes.chroot/opt/a-os/public
mkdir -p config/includes.chroot/opt/a-os/public
cp -a ../public/. config/includes.chroot/opt/a-os/public/
sudo lb clean --purge || true
sudo lb config
sudo lb build
```

The result is `live-image-amd64.hybrid.iso`. It is an ISO-hybrid image suitable
for a virtual machine, DVD, or writing directly to a USB drive. The GitHub
workflow builds it in a clean runner, publishes a checksum, and uploads the ISO
to the `iso-v1.2.1-managed11` release.
