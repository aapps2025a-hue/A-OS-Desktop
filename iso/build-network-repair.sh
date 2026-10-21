#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/DEBIAN" "$stage/usr/local/lib/aos"
cp "$root/iso/repair/control" "$stage/DEBIAN/control"
cp "$root/iso/repair/postinst" "$stage/DEBIAN/postinst"
for file in server.py network-ready.sh; do
  cp "$root/iso/config/includes.chroot/usr/local/lib/aos/$file" "$stage/usr/local/lib/aos/$file"
done
chmod 0755 "$stage/DEBIAN/postinst" "$stage/usr/local/lib/aos/"*
dpkg-deb --root-owner-group --build "$stage" "$root/A-OS-Network-Repair-20261021.deb"
