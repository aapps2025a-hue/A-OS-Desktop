# A-OS Desktop live ISO

This directory is the complete, open-source Debian Live configuration for the
A-OS Desktop ISO. The image boots a lightweight Linux session, starts a
localhost-only web and hardware bridge, opens Chromium in kiosk mode, and loads
the same `public/index.html` build used by Firebase and GitHub Pages. A quiet
A-OS Plymouth theme covers Linux startup; Chromium then plays the same
`assets/os/A-OS Boot.gif` animation as the website and enters the A-OS setup
automatically.

The native bridge provides a master Internet switch, real NetworkManager Wi-Fi
scanning and connection, BlueZ Bluetooth pairing, hardware battery status, and
device restart/shutdown. The installation wizard can copy the hybrid image to
a different physical drive and create a Debian Live persistence partition for
A-OS accounts, settings, application data, and files. It refuses the drive the
live system booted from and requires the exact target path to be typed before
the selected drive is erased.

The update indicator compares the packaged version with Firebase. An update is
never installed automatically: after the user approves it, the native updater
downloads the exact published Git commit, validates the archive paths, and
updates only `/opt/a-os/public` in the background. A persistent installation is
required for that update to survive a restart.

Virtual machines only show physical Wi-Fi or Bluetooth devices when the host
passes the corresponding hardware through to the guest. The live boot enables
Debian Live persistence when the USB has a writable persistence partition.

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
workflow builds it in a clean runner, boots it in QEMU until the real packaged
HTML reports ready, publishes a checksum, and uploads the ISO to the
`iso-v1.2.1-classic1` release.
