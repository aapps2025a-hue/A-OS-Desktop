#!/bin/sh

set -u

# Bring up real adapters before A-OS starts, including Ethernet in VMs and
# Wi-Fi adapters that firmware leaves soft-blocked after boot.
rfkill unblock wifi >/dev/null 2>&1 || true
nmcli networking on >/dev/null 2>&1 || true
nmcli radio wifi on >/dev/null 2>&1 || true
# Keep HTTPS working when the hardware clock is wrong. The service retries
# when a connection becomes available, including Wi-Fi joined after setup.
timedatectl set-ntp true >/dev/null 2>&1 || true

nmcli -t -f DEVICE,TYPE device status 2>/dev/null | while IFS=: read -r device kind; do
  case "$kind" in
    ethernet|wifi)
      nmcli device set "$device" managed yes >/dev/null 2>&1 || true
      ;;
  esac
done

nmcli connection reload >/dev/null 2>&1 || true
wired_device="$(nmcli -t -f DEVICE,TYPE,STATE device status 2>/dev/null | awk -F: '$2 == "ethernet" && $3 != "connected" {print $1; exit}')"
if [ -n "$wired_device" ]; then
  nmcli device connect "$wired_device" >/dev/null 2>&1 || true
fi

exit 0
