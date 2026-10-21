A-OS Network Repair - 2026-10-21

For an existing A-OS installation only. This is not a Windows installer.
Back up important files before changing system software.

Download A-OS-Network-Repair-20261021.deb and its .sha256 file from the
A-OS Desktop GitHub release. Transfer them using USB if needed.
In a real Linux administrator terminal, in the download directory:

  sha256sum -c A-OS-Network-Repair-20261021.deb.sha256
  sudo apt install ./A-OS-Network-Repair-20261021.deb

APT may need Internet access to download systemd-timesyncd and dependencies.
The in-app A-OS command window is not a Linux administrator terminal.
Do not erase or reinstall the disk to apply this package.

The package replaces the native A-OS hardware service, repairs incomplete
NetworkManager Wi-Fi profiles that are missing their WPA key-management mode,
and enables network clock synchronisation. It does not modify A-OS user
profiles, personal files or disk partitions.
After installing, use A-OS Updates for the matching website interface fixes.
An already incorrect clock may need manual correction before HTTPS downloads
work. Network time also needs access to an NTP server.

This fixes known software defects; it is not a guarantee that every router,
adapter or mobile network will work. Use Internet > Check connection to see
DNS, certificate or timeout errors rather than a misleading password error.
