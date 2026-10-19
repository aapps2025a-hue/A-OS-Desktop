# A-OS Desktop live ISO

This directory is the complete, open-source Debian Live configuration for the
A-OS Desktop ISO. The image boots a lightweight Linux session, starts a
localhost-only web and hardware bridge, opens Chromium in kiosk mode, and loads
the same `public/index.html` build used by Firebase and GitHub Pages. A quiet
A-OS Plymouth theme covers Linux startup. The UEFI loader and Plymouth use the
exact first frame of `assets/os/A-OS Boot.gif`; Chromium then plays the complete
GIF once and fades into A-OS. Firmware bootloaders cannot animate GIF files, so
this keeps the artwork continuous without exposing Debian or Chromium. Rufus
only writes the hybrid image and does not display or animate an operating-system
splash itself.

The native bridge provides a master Internet switch, real NetworkManager Wi-Fi
scanning and connection, BlueZ Bluetooth pairing, hardware battery status, and
device restart/shutdown. The installation wizard supports both a dedicated
drive and a conservative UEFI dual-boot installation beside Windows. The
dual-boot path only uses space that Windows has already left unallocated; it
does not resize NTFS, format the Windows EFI partition, or alter Windows and
recovery partition boundaries. It creates separate A-OS system and persistence
partitions, installs a self-contained A-OS UEFI loader, and keeps Windows Boot
Manager available in the A-OS boot menu. The dedicated-drive path still erases
the selected drive and requires the exact target path to be typed.

Before a dual-boot installation, use Windows Disk Management to shrink the
Windows volume and leave at least 32 GB unallocated. Save the BitLocker recovery
key, disable Windows Fast Startup, and disable Secure Boot in UEFI settings. If the wizard cannot verify UEFI boot,
GPT, Windows Boot Manager, and a sufficiently large unallocated extent, it does
not offer the alongside option.

The update indicator compares the packaged version with Firebase. An update is
never installed automatically: after the user approves it, the native updater
downloads the exact published Git commit, validates the archive paths, and
installs it as a versioned release under `/var/lib/aos/releases`. A validated
release is activated with one atomic link switch, so a failed download cannot
replace the working system. A persistent installation is required for updates.
The Chromium profile is also kept under `/var/lib/aos`, preserving Files,
settings, installed apps, browser data, accounts, and hibernation state on the
installed disk.

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
workflow runs the installer unit tests, builds it in a clean runner, boots it
in QEMU from both the ISO and a generated installed UEFI disk until the real
packaged HTML reports ready, and launches the core A-OS apps in headless Chrome.
Only then does it publish a checksum and upload the ISO to the
`iso-v1.2.1-classic1` release.
