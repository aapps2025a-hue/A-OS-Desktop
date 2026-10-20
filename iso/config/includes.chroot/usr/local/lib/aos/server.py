#!/usr/bin/env python3

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock, Thread, Timer
from urllib.request import Request, urlopen
import hashlib
import json
import math
import os
import re
import shutil
import socket
import subprocess
import tarfile
import tempfile
import time


PACKAGED_ROOT = Path(os.environ.get("AOS_PUBLIC_ROOT", "/opt/a-os/public")).resolve()
STATE_ROOT = Path(os.environ.get("AOS_STATE_ROOT", "/var/lib/aos")).resolve()
RELEASES_ROOT = STATE_ROOT / "releases"
ACTIVE_RELEASE = STATE_ROOT / "active-public"
READY_FILE = Path(os.environ.get("AOS_READY_FILE", "/tmp/aos-browser-ready"))
PORT = int(os.environ.get("AOS_PORT", "5000"))
REMOTE_VERSION_URL = "https://a-os-desktop.web.app/version.json"
SOURCE_ARCHIVE_URL = "https://github.com/aapps2025a-hue/A-OS-Desktop/archive/{revision}.tar.gz"
MAX_BODY = 16 * 1024
COMMAND_TIMEOUT = 12
VERSION_CACHE_SECONDS = 30
VERSION_CACHE = {"at": 0.0, "value": None}
VERSION_LOCK = Lock()
NETWORK_HEALTH_CACHE = {"at": 0.0, "value": None}
NETWORK_HEALTH_LOCK = Lock()
UPDATE_LOCK = Lock()
INSTALL_LOCK = Lock()
UPDATE_STATE = {"running": False, "stage": "idle", "progress": 0, "message": "", "error": ""}
INSTALL_STATE = {"running": False, "stage": "idle", "progress": 0, "message": "", "error": ""}
MIB = 1024 * 1024
GIB = 1024 * MIB
MIN_ALONGSIDE_BYTES = 32 * GIB
EFI_SYSTEM_GUID = "c12a7328-f81f-11d2-ba4b-00a0c93ec93b"
os.chdir(PACKAGED_ROOT)


def active_public_root():
    try:
        active = ACTIVE_RELEASE.resolve(strict=True)
        releases = RELEASES_ROOT.resolve(strict=False)
        if releases in active.parents and (active / "index.html").is_file():
            return active
    except (OSError, RuntimeError):
        pass
    return PACKAGED_ROOT


def run(command, timeout=COMMAND_TIMEOUT):
    try:
        result = subprocess.run(
            command, check=False, capture_output=True, text=True, timeout=timeout,
            env={**os.environ, "LC_ALL": "C.UTF-8"},
        )
        return result.returncode, result.stdout.strip(), result.stderr.strip()
    except (FileNotFoundError, subprocess.TimeoutExpired) as error:
        return 127, "", str(error)


def require_command(command, timeout=COMMAND_TIMEOUT):
    code, output, error = run(command, timeout=timeout)
    if code != 0:
        raise RuntimeError(error or output or "Command failed: " + " ".join(command))
    return output


def read_json_file(path):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def set_job_state(state, lock, **changes):
    with lock:
        state.update(changes)


def job_snapshot(state, lock):
    with lock:
        return dict(state)


def remote_version(force=False):
    now = time.monotonic()
    with VERSION_LOCK:
        if not force and now - VERSION_CACHE["at"] < VERSION_CACHE_SECONDS:
            return VERSION_CACHE["value"]
        value = None
        try:
            request = Request(REMOTE_VERSION_URL, headers={"User-Agent": "A-OS-Desktop/1.2.1"})
            with urlopen(request, timeout=8) as response:
                value = json.loads(response.read(64 * 1024).decode("utf-8"))
        except Exception:
            value = None
        VERSION_CACHE.update({"at": now, "value": value})
        return value


def persistent_storage_active():
    code, output, _ = run(["findmnt", "-rn", "-o", "TARGET,SOURCE,FSTYPE"], timeout=2)
    if code == 0:
        for line in output.splitlines():
            lowered = line.lower()
            if "/run/live/persistence" in lowered or "persistence" in lowered and "overlay" not in lowered:
                return True
    try:
        command_line = Path("/proc/cmdline").read_text(encoding="utf-8", errors="ignore")
        return "persistence" in command_line.split()
    except OSError:
        return False


def battery_state():
    for battery in sorted(Path("/sys/class/power_supply").glob("BAT*")):
        try:
            level = max(0, min(100, int((battery / "capacity").read_text().strip())))
            status = (battery / "status").read_text().strip().lower()
            return {"available": True, "percentage": level, "charging": status in {"charging", "full"}, "status": status}
        except (OSError, ValueError):
            continue
    return {"available": False, "percentage": 0, "charging": False, "status": "unknown"}


def split_nmcli(line):
    fields, current, escaped = [], [], False
    for character in line:
        if escaped:
            current.append(character)
            escaped = False
        elif character == "\\":
            escaped = True
        elif character == ":":
            fields.append("".join(current))
            current = []
        else:
            current.append(character)
    fields.append("".join(current))
    return fields


def networking_enabled():
    code, output, _ = run(["nmcli", "networking"])
    return code == 0 and output.strip().lower() == "enabled"


def invalidate_network_health():
    with NETWORK_HEALTH_LOCK:
        NETWORK_HEALTH_CACHE["at"] = 0.0
        NETWORK_HEALTH_CACHE["value"] = None


def network_health(force=False):
    now = time.monotonic()
    with NETWORK_HEALTH_LOCK:
        cached = NETWORK_HEALTH_CACHE.get("value")
        if not force and cached is not None and now - NETWORK_HEALTH_CACHE["at"] < 15:
            return dict(cached)

    result = {
        "online": False,
        "dns": False,
        "checked": True,
        "message": "Internet access is off",
    }
    if networking_enabled():
        result["message"] = "Connected to a network, checking Internet access"
        try:
            socket.getaddrinfo("a-os-desktop.web.app", 443, type=socket.SOCK_STREAM)
            result["dns"] = True
        except OSError:
            result["message"] = "Connected, but DNS is not responding"
        if result["dns"]:
            try:
                request = Request(REMOTE_VERSION_URL, method="HEAD", headers={"User-Agent": "A-OS/1.2.1"})
                with urlopen(request, timeout=5) as response:
                    result["online"] = 200 <= int(response.status) < 500
                result["message"] = "Internet connection is working" if result["online"] else "The Internet check was rejected"
            except Exception:
                result["message"] = "Connected, but the Internet is not responding"

    with NETWORK_HEALTH_LOCK:
        NETWORK_HEALTH_CACHE["at"] = time.monotonic()
        NETWORK_HEALTH_CACHE["value"] = dict(result)
    return result


def current_network():
    if not networking_enabled():
        return "Internet off"
    code, output, _ = run(["nmcli", "-t", "-f", "ACTIVE,SSID", "device", "wifi"])
    if code == 0:
        for line in output.splitlines():
            if line.startswith("yes:"):
                return line[4:].replace("\\:", ":") or "Connected"
    code, output, _ = run(["nmcli", "-t", "-f", "NAME,TYPE", "connection", "show", "--active"])
    if code == 0:
        for line in output.splitlines():
            fields = split_nmcli(line)
            if len(fields) >= 2 and fields[1] == "802-3-ethernet":
                return fields[0] or "Ethernet"
    return "Offline"


def wifi_enabled():
    code, output, _ = run(["nmcli", "radio", "wifi"])
    return code == 0 and output.strip().lower() == "enabled"


def bluetooth_enabled():
    code, output, _ = run(["bluetoothctl", "show"])
    return code == 0 and bool(re.search(r"^\s*Powered:\s+yes\s*$", output, re.MULTILINE))


def microphone_active():
    code, uid, _ = run(["id", "-u", "aos"], timeout=2)
    if code != 0 or not uid.isdigit():
        return False
    code, output, _ = run(["runuser", "-u", "aos", "--", "env", "XDG_RUNTIME_DIR=/run/user/" + uid, "pw-dump"], timeout=3)
    if code != 0:
        return False
    try:
        objects = json.loads(output)
    except (TypeError, ValueError):
        return False
    for item in objects:
        info = item.get("info") or {}
        properties = info.get("props") or {}
        if properties.get("media.class") == "Stream/Input/Audio" and info.get("state") == "running":
            return True
    return False


def system_state():
    return {
        "native": True,
        "persistent": persistent_storage_active(),
        "networking": {"enabled": networking_enabled()},
        "connectivity": network_health(),
        "battery": battery_state(),
        "wifi": {"enabled": wifi_enabled(), "network": current_network()},
        "bluetooth": {"enabled": bluetooth_enabled()},
        "microphoneActive": microphone_active(),
    }


def live_source_device():
    code, output, _ = run(["findmnt", "-n", "-o", "SOURCE", "/run/live/medium"], timeout=3)
    if code != 0 or not output.startswith("/dev/"):
        return ""
    source = os.path.realpath(output.splitlines()[0].strip())
    code, device_type, _ = run(["lsblk", "-dnro", "TYPE", source], timeout=3)
    if code == 0 and device_type.strip() in {"disk", "rom"}:
        return source
    code, parent, _ = run(["lsblk", "-dnro", "PKNAME", source], timeout=3)
    return "/dev/" + parent.strip() if code == 0 and parent.strip() else source


def block_devices():
    code, output, _ = run([
        "lsblk", "--json", "--bytes", "--output",
        "NAME,PATH,SIZE,TYPE,MODEL,TRAN,RM,MOUNTPOINTS,START,FSTYPE,PARTTYPE,PARTN,PTTYPE",
    ])
    if code != 0:
        return []
    try:
        return json.loads(output).get("blockdevices", [])
    except (TypeError, ValueError):
        return []


def parse_parted_free(output):
    """Return MiB-aligned free regions from machine-readable parted output."""
    regions = []
    pattern = re.compile(r"^\d*:(\d+)B:(\d+)B:(\d+)B:free(?::.*)?;$")
    for line in str(output or "").splitlines():
        match = pattern.match(line.strip())
        if not match:
            continue
        raw_start, raw_end, _ = (int(value) for value in match.groups())
        start_mib = int(math.ceil(raw_start / MIB))
        end_mib = int(math.floor((raw_end + 1) / MIB))
        if end_mib > start_mib:
            regions.append({
                "startMiB": start_mib,
                "endMiB": end_mib,
                "size": (end_mib - start_mib) * MIB,
            })
    return regions


def disk_free_regions(device):
    code, output, _ = run(["parted", "-m", "-s", device, "unit", "B", "print", "free"], timeout=10)
    return parse_parted_free(output) if code == 0 else []


def mounted_path(partition):
    code, output, _ = run(["findmnt", "-n", "-o", "TARGET", "--source", partition], timeout=3)
    return output.splitlines()[0].strip() if code == 0 and output.strip() else ""


def partition_has_windows_loader(partition):
    existing = mounted_path(partition)
    mount_dir = None
    try:
        if existing:
            root = Path(existing)
        else:
            mount_dir = Path(tempfile.mkdtemp(prefix="aos-esp-check-", dir="/mnt"))
            code, _, _ = run(["mount", "-o", "ro", partition, str(mount_dir)], timeout=15)
            if code != 0:
                return False
            root = mount_dir
        return (root / "EFI" / "Microsoft" / "Boot" / "bootmgfw.efi").is_file()
    finally:
        if mount_dir:
            run(["umount", str(mount_dir)], timeout=10)
            shutil.rmtree(mount_dir, ignore_errors=True)


def windows_esp_for_disk(device):
    for child in device.get("children") or []:
        parttype = str(child.get("parttype") or "").lower()
        fstype = str(child.get("fstype") or "").lower()
        path = str(child.get("path") or "")
        if parttype == EFI_SYSTEM_GUID and fstype in {"vfat", "fat", "fat32"} and path:
            if partition_has_windows_loader(path):
                return path
    return ""


def secure_boot_enabled():
    for variable in Path("/sys/firmware/efi/efivars").glob("SecureBoot-*"):
        try:
            data = variable.read_bytes()
            return len(data) >= 5 and data[4] == 1
        except OSError:
            continue
    return False


def alongside_targets(devices, source):
    if not Path("/sys/firmware/efi").is_dir():
        return []
    targets = []
    for device in devices:
        if device.get("type") != "disk" or bool(device.get("rm")):
            continue
        path = os.path.realpath(str(device.get("path") or ""))
        if not path or path == source or str(device.get("pttype") or "").lower() != "gpt":
            continue
        esp = windows_esp_for_disk(device)
        if not esp:
            continue
        for region in disk_free_regions(path):
            if region["size"] < MIN_ALONGSIDE_BYTES:
                continue
            blocked_reason = "Disable Secure Boot in UEFI settings before installing" if secure_boot_enabled() else ""
            target_id = "alongside:{}:{}:{}".format(path, region["startMiB"], region["endMiB"])
            targets.append({
                "id": target_id,
                "mode": "alongside",
                "name": "Windows local disk (C:) - install A-OS beside Windows",
                "description": "Uses only unallocated space on {} | Windows local disk detected{}".format(
                    path, " | " + blocked_reason if blocked_reason else "",
                ),
                "size": region["size"],
                "removable": False,
                "installable": not blocked_reason,
                "blockedReason": blocked_reason,
                "disk": path,
                "esp": esp,
                "startMiB": region["startMiB"],
                "endMiB": region["endMiB"],
            })
    return targets


def storage_targets():
    live_source = live_source_device()
    source = os.path.realpath(live_source) if live_source else ""
    devices = block_devices()
    targets = alongside_targets(devices, source)
    for device in devices:
        if device.get("type") != "disk":
            continue
        path = os.path.realpath(str(device.get("path") or ("/dev/" + str(device.get("name") or ""))))
        model = str(device.get("model") or "").strip()
        transport = str(device.get("tran") or "").strip().upper()
        removable = bool(device.get("rm")) or transport == "USB"
        mounted = any(device.get("mountpoints") or []) or any(any(child.get("mountpoints") or []) for child in device.get("children") or [])
        blocked_reason = ""
        if path == source:
            blocked_reason = "A-OS is currently booted from this drive"
        elif mounted:
            blocked_reason = "This drive has mounted partitions"
        elif int(device.get("size") or 0) < 5 * 1024 * 1024 * 1024:
            blocked_reason = "This drive is too small"
        description = "Detected " + ("removable" if removable else "internal") + " drive"
        if transport:
            description += " | " + transport
        if blocked_reason:
            description += " | " + blocked_reason
        targets.append({
            "id": path, "mode": "erase", "name": model or path, "description": description,
            "size": int(device.get("size") or 0), "removable": removable,
            "installable": not blocked_reason, "blockedReason": blocked_reason,
        })
    return {"ok": True, "targets": targets, "source": source}


def wifi_scan():
    if not networking_enabled():
        return {"ok": True, "networks": [], "internetDisabled": True}
    code, output, error = run(
        ["nmcli", "--terse", "--escape", "yes", "-f", "SSID,SIGNAL,SECURITY,IN-USE", "device", "wifi", "list", "--rescan", "yes"],
        timeout=20,
    )
    if code != 0:
        return {"ok": False, "error": error or "Wi-Fi scan failed", "networks": []}
    networks = {}
    for line in output.splitlines():
        fields = split_nmcli(line)
        if len(fields) < 4 or not fields[0]:
            continue
        ssid, signal, security, active = fields[:4]
        item = {"ssid": ssid, "strength": max(0, min(100, int(signal or 0))), "secure": bool(security and security != "--"), "security": security if security != "--" else "Open", "connected": active == "*"}
        if ssid not in networks or item["strength"] > networks[ssid]["strength"]:
            networks[ssid] = item
    return {"ok": True, "networks": sorted(networks.values(), key=lambda item: (not item["connected"], -item["strength"], item["ssid"].lower()))}


def bluetooth_scan():
    run(["rfkill", "unblock", "bluetooth"])
    run(["bluetoothctl", "power", "on"])
    run(["bluetoothctl", "--timeout", "5", "scan", "on"], timeout=8)
    code, output, error = run(["bluetoothctl", "devices"])
    if code != 0:
        return {"ok": False, "error": error or "Bluetooth scan failed", "devices": []}
    paired_code, paired_output, _ = run(["bluetoothctl", "paired-devices"])
    paired = set(re.findall(r"Device\s+([0-9A-F:]{17})", paired_output, re.IGNORECASE)) if paired_code == 0 else set()
    devices = []
    for line in output.splitlines():
        match = re.match(r"Device\s+([0-9A-F:]{17})\s+(.+)", line, re.IGNORECASE)
        if not match:
            continue
        address, name = match.groups()
        info_code, info, _ = run(["bluetoothctl", "info", address])
        devices.append({"address": address.upper(), "name": name.strip(), "paired": address.upper() in {item.upper() for item in paired}, "connected": info_code == 0 and "Connected: yes" in info})
    devices.sort(key=lambda item: (not item["connected"], not item["paired"], item["name"].lower()))
    return {"ok": True, "devices": devices}


def list_partitions(device):
    code, output, _ = run(["lsblk", "--json", "--bytes", "--output", "PATH,TYPE,START,SIZE,PARTN,FSTYPE", device])
    if code != 0:
        return []
    try:
        root = json.loads(output).get("blockdevices", [])[0]
    except (TypeError, ValueError, IndexError):
        return []
    return [item for item in root.get("children") or [] if item.get("type") == "part"]


def iso_size(source):
    output = require_command(["isosize", source], timeout=8)
    match = re.search(r"\d+", output)
    if not match:
        raise RuntimeError("A-OS could not determine the installation image size")
    return int(match.group(0))


def validate_install_target(target):
    target = os.path.realpath(str(target or ""))
    listed = {item["id"]: item for item in storage_targets()["targets"]}
    item = listed.get(target)
    if not item:
        raise RuntimeError("The selected drive is no longer available")
    if not item["installable"]:
        raise RuntimeError(item["blockedReason"] or "A-OS cannot install to this drive")
    if not re.fullmatch(r"/dev/(?:sd[a-z]+|vd[a-z]+|xvd[a-z]+|nvme\d+n\d+|mmcblk\d+)", target):
        raise RuntimeError("A-OS rejected an unsafe drive path")
    return target, item


def validate_alongside_target(target):
    pattern = r"alongside:(/dev/(?:sd[a-z]+|vd[a-z]+|xvd[a-z]+|nvme\d+n\d+|mmcblk\d+)):(\d+):(\d+)"
    if not re.fullmatch(pattern, str(target or "")):
        raise RuntimeError("A-OS rejected an unsafe alongside-install target")
    listed = {item["id"]: item for item in storage_targets()["targets"] if item.get("mode") == "alongside"}
    item = listed.get(target)
    if not item:
        raise RuntimeError("That Windows unallocated region is no longer available")
    if not item.get("installable"):
        raise RuntimeError(item.get("blockedReason") or "A-OS cannot use that Windows unallocated region")
    if not Path("/sys/firmware/efi").is_dir():
        raise RuntimeError("Install alongside Windows requires UEFI boot mode")
    return item


def partition_number(partition):
    output = require_command(["lsblk", "-dnro", "PARTN", partition], timeout=5)
    if not output.strip().isdigit():
        raise RuntimeError("A-OS could not identify a new partition")
    return int(output.strip())


def create_partition(device, name, start_mib, end_mib):
    before = {str(item.get("path") or "") for item in list_partitions(device)}
    require_command([
        "parted", "-s", device, "unit", "MiB", "mkpart", name, "ext4",
        str(start_mib), str(end_mib),
    ], timeout=30)
    require_command(["partprobe", device], timeout=20)
    run(["udevadm", "settle"], timeout=20)
    time.sleep(1)
    candidates = [item for item in list_partitions(device) if str(item.get("path") or "") not in before]
    if not candidates:
        raise RuntimeError("A-OS could not find the partition it created")
    expected = start_mib * MIB
    selected = min(candidates, key=lambda item: abs(int(item.get("start") or 0) - expected))
    path = str(selected.get("path") or "")
    return path, partition_number(path)


def sha256_prefix(path, byte_count):
    digest = hashlib.sha256()
    remaining = int(byte_count)
    with open(path, "rb", buffering=0) as handle:
        while remaining:
            block = handle.read(min(4 * MIB, remaining))
            if not block:
                raise RuntimeError("A-OS could not read the complete installation image")
            digest.update(block)
            remaining -= len(block)
    return digest.hexdigest()


def directory_size(path):
    output = require_command(["du", "--bytes", "--summarize", str(path)], timeout=30)
    value = output.split(None, 1)[0]
    if not value.isdigit():
        raise RuntimeError("A-OS could not measure the live installation files")
    return int(value)


def filesystem_uuid(partition):
    value = require_command(["blkid", "-s", "UUID", "-o", "value", partition], timeout=8).strip()
    if not re.fullmatch(r"[A-Za-z0-9-]+", value):
        raise RuntimeError("A-OS could not read a filesystem identifier")
    return value


def aos_boot_entries():
    code, output, _ = run(["efibootmgr"], timeout=8)
    if code != 0:
        return set()
    return set(re.findall(r"^Boot([0-9A-Fa-f]{4})\*?\s+A-OS(?:\s|$)", output, re.MULTILINE))


def efi_boot_order():
    code, output, _ = run(["efibootmgr"], timeout=8)
    if code != 0:
        return []
    match = re.search(r"^BootOrder:\s*([^\r\n]+)", output, re.MULTILINE)
    if not match:
        return []
    return [
        value.strip().upper() for value in match.group(1).split(",")
        if re.fullmatch(r"[0-9A-Fa-f]{4}", value.strip())
    ]


def prioritize_aos_boot(entry):
    entry = str(entry or "").upper()
    if not re.fullmatch(r"[0-9A-F]{4}", entry):
        raise RuntimeError("A-OS could not identify its new UEFI boot entry")
    current_order = efi_boot_order()
    if not current_order:
        raise RuntimeError("A-OS could not read the current UEFI boot order")
    order = [value for value in current_order if value != entry]
    require_command(["efibootmgr", "--bootorder", ",".join([entry] + order)], timeout=10)
    require_command(["efibootmgr", "--bootnext", entry], timeout=10)


def grub_configuration(system_uuid, esp_uuid):
    return """set timeout=8
set default=0
search --no-floppy --fs-uuid --set=winboot %s
if loadfont unicode; then
    insmod gfxterm
    insmod png
    insmod efi_gop
    terminal_output gfxterm
    if background_image ($winboot)/EFI/AOSDesktop/splash.png; then
        set color_normal=white/black
        set color_highlight=black/light-gray
    fi
fi

menuentry 'A-OS Desktop' {
    search --no-floppy --fs-uuid --set=aosroot %s
    linux ($aosroot)/live/vmlinuz boot=live components persistence live-media=/dev/disk/by-uuid/%s live-media-path=/live quiet splash reboot=efi loglevel=3 systemd.show_status=false rd.systemd.show_status=false udev.log_priority=3 rd.udev.log_level=3 logo.nologo plymouth.ignore-serial-consoles vt.global_cursor_default=0 nox11autologin username=aos hostname=a-os locales=en_GB.UTF-8 keyboard-layouts=gb timezone=Europe/London console=ttyS0,115200n8 noeject
    initrd ($aosroot)/live/initrd.img
}

menuentry 'Windows Boot Manager' {
    chainloader ($winboot)/EFI/Microsoft/Boot/bootmgfw.efi
}
""" % (esp_uuid, system_uuid, system_uuid)


def install_alongside_worker(target):
    mount_root = None
    mounted = []
    original_partition_numbers = set()
    new_boot_entry = ""
    efi_directory = None
    try:
        item = validate_alongside_target(target)
        device = item["disk"]
        original_partition_numbers = {
            int(partition.get("partn")) for partition in list_partitions(device)
            if str(partition.get("partn") or "").isdigit()
        }
        live_medium = Path("/run/live/medium")
        if not live_medium.is_dir() or not (live_medium / "live" / "filesystem.squashfs").is_file():
            raise RuntimeError("The A-OS installation media could not be found")
        system_mib = max(4096, int(math.ceil(directory_size(live_medium) / MIB)) + 1024)
        available_mib = int(item["endMiB"]) - int(item["startMiB"])
        if available_mib < system_mib + 8192:
            raise RuntimeError("A-OS needs at least 8 GB of data space after its system image")

        set_job_state(
            INSTALL_STATE, INSTALL_LOCK, stage="partitioning", progress=6,
            message="Creating A-OS partitions only inside Windows unallocated space",
        )
        system_end = int(item["startMiB"]) + system_mib
        system_partition, system_number = create_partition(
            device, "AOS_SYSTEM", int(item["startMiB"]), system_end,
        )
        persistence_partition, persistence_number = create_partition(
            device, "AOS_DATA", system_end, int(item["endMiB"]),
        )

        set_job_state(INSTALL_STATE, INSTALL_LOCK, stage="formatting", progress=15, message="Formatting new A-OS partitions")
        require_command(["mkfs.ext4", "-F", "-L", "AOS_SYSTEM", system_partition], timeout=180)
        require_command(["mkfs.ext4", "-F", "-L", "persistence", persistence_partition], timeout=180)

        mount_root = Path(tempfile.mkdtemp(prefix="aos-dual-install-", dir="/mnt"))
        system_mount = mount_root / "system"
        persistence_mount = mount_root / "data"
        esp_mount = mount_root / "efi"
        system_mount.mkdir()
        persistence_mount.mkdir()
        esp_mount.mkdir()

        require_command(["mount", system_partition, str(system_mount)], timeout=20)
        mounted.append(system_mount)
        set_job_state(INSTALL_STATE, INSTALL_LOCK, stage="copying", progress=24, message="Copying A-OS system files into the new partition")
        require_command([
            "rsync", "-aH", "--delete", "--exclude=lost+found",
            str(live_medium) + "/", str(system_mount) + "/",
        ], timeout=3600)

        set_job_state(INSTALL_STATE, INSTALL_LOCK, stage="verifying", progress=61, message="Verifying the installed A-OS system")
        for relative in ("live/filesystem.squashfs", "live/vmlinuz", "live/initrd.img"):
            source_file = live_medium / relative
            installed_file = system_mount / relative
            if not installed_file.is_file():
                raise RuntimeError("The installed A-OS system is incomplete")
            source_hash = sha256_prefix(source_file, source_file.stat().st_size)
            installed_hash = sha256_prefix(installed_file, installed_file.stat().st_size)
            if source_hash != installed_hash:
                raise RuntimeError("The installed A-OS system did not match the USB files")

        require_command(["mount", persistence_partition, str(persistence_mount)], timeout=20)
        mounted.append(persistence_mount)
        (persistence_mount / "persistence.conf").write_text("/ union\n", encoding="utf-8")

        set_job_state(INSTALL_STATE, INSTALL_LOCK, stage="bootloader", progress=78, message="Adding A-OS beside Windows Boot Manager")
        require_command(["mount", "-o", "rw", item["esp"], str(esp_mount)], timeout=20)
        mounted.append(esp_mount)
        windows_loader = esp_mount / "EFI" / "Microsoft" / "Boot" / "bootmgfw.efi"
        if not windows_loader.is_file():
            raise RuntimeError("Windows Boot Manager disappeared before installation")
        efi_directory = esp_mount / "EFI" / "AOSDesktop"
        if efi_directory.exists():
            raise RuntimeError("An existing A-OS UEFI loader was found; remove the old A-OS installation first")
        efi_directory.mkdir(parents=True)
        shutil.copyfile(
            "/usr/share/plymouth/themes/aos/aos-boot.png",
            efi_directory / "splash.png",
        )
        grub_file = mount_root / "grub.cfg"
        grub_file.write_text(
            grub_configuration(filesystem_uuid(system_partition), filesystem_uuid(item["esp"])),
            encoding="utf-8",
        )
        require_command([
            "grub-mkstandalone", "--format=x86_64-efi",
            "--output=" + str(efi_directory / "grubx64.efi"),
            "--locales=", "--fonts=unicode",
            "--modules=part_gpt fat ext2 iso9660 loopback linux normal search search_fs_uuid chain gfxterm png efi_gop",
            "boot/grub/grub.cfg=" + str(grub_file),
        ], timeout=180)

        previous_entries = aos_boot_entries()
        code, output, error = run([
            "efibootmgr", "--create", "--disk", device, "--part", str(partition_number(item["esp"])),
            "--label", "A-OS", "--loader", "\\EFI\\AOSDesktop\\grubx64.efi",
        ], timeout=30)
        if code != 0:
            raise RuntimeError(error or output or "A-OS could not create its UEFI boot entry")
        added_entries = aos_boot_entries() - previous_entries
        new_boot_entry = sorted(added_entries)[-1] if added_entries else ""
        prioritize_aos_boot(new_boot_entry)
        require_command(["sync"], timeout=60)
        for path in reversed(mounted):
            require_command(["umount", str(path)], timeout=30)
        mounted.clear()
        shutil.rmtree(mount_root, ignore_errors=True)
        mount_root = None
        set_job_state(
            INSTALL_STATE, INSTALL_LOCK, running=False, stage="complete", progress=100,
            message="A-OS is installed beside Windows and set as the next boot. Remove the USB and restart; Windows remains in the A-OS boot menu.",
        )
    except Exception as error:
        if efi_directory and efi_directory.exists():
            shutil.rmtree(efi_directory, ignore_errors=True)
        for path in reversed(mounted):
            run(["umount", str(path)], timeout=15)
        if new_boot_entry:
            run(["efibootmgr", "-b", new_boot_entry, "-B"], timeout=10)
        if mount_root:
            shutil.rmtree(mount_root, ignore_errors=True)
        if "item" in locals():
            current_numbers = {
                int(partition.get("partn")) for partition in list_partitions(item["disk"])
                if str(partition.get("partn") or "").isdigit()
            }
            for number in sorted(current_numbers - original_partition_numbers, reverse=True):
                run(["parted", "-s", item["disk"], "rm", str(number)], timeout=30)
            run(["partprobe", item["disk"]], timeout=20)
        set_job_state(INSTALL_STATE, INSTALL_LOCK, running=False, stage="error", error=str(error), message="Installation stopped and new A-OS partitions were removed")


def install_erase_worker(target):
    mount_dir = None
    try:
        target, item = validate_install_target(target)
        source = live_source_device()
        if not source:
            raise RuntimeError("The A-OS installation media could not be found")
        image_bytes = iso_size(source)
        if item["size"] < image_bytes + 2 * 1024 * 1024 * 1024:
            raise RuntimeError("The selected drive needs at least 2 GB free after the A-OS image")
        set_job_state(INSTALL_STATE, INSTALL_LOCK, stage="copying", progress=8, message="Copying A-OS to " + target)
        for partition in list_partitions(target):
            path = str(partition.get("path") or "")
            if path:
                run(["swapoff", path], timeout=5)
                run(["umount", path], timeout=10)
        require_command(["dd", "if=" + source, "of=" + target, "bs=4M", "iflag=count_bytes", "count=" + str(image_bytes), "conv=fsync", "status=none"], timeout=3600)
        set_job_state(INSTALL_STATE, INSTALL_LOCK, stage="storage", progress=68, message="Creating persistent A-OS storage")
        code, table_type, _ = run(["lsblk", "-dnro", "PTTYPE", target], timeout=5)
        if code == 0 and table_type.strip().lower() == "gpt":
            run(["sgdisk", "-e", target], timeout=20)
        run(["partprobe", target], timeout=20)
        time.sleep(2)
        partitions = list_partitions(target)
        furthest_byte = image_bytes
        for partition in partitions:
            furthest_byte = max(furthest_byte, int(partition.get("start") or 0) + int(partition.get("size") or 0))
        start_mib = int(math.ceil((furthest_byte + 16 * 1024 * 1024) / (1024 * 1024)))
        if start_mib * 1024 * 1024 >= item["size"] - 1024 * 1024 * 1024:
            raise RuntimeError("There is not enough room for persistent A-OS storage")
        before = {str(partition.get("path") or "") for partition in partitions}
        require_command(["parted", "-s", target, "unit", "MiB", "mkpart", "primary", "ext4", str(start_mib), "100%"], timeout=30)
        require_command(["partprobe", target], timeout=20)
        run(["udevadm", "settle"], timeout=20)
        time.sleep(2)
        after = list_partitions(target)
        candidates = [partition for partition in after if str(partition.get("path") or "") not in before]
        if not candidates:
            candidates = [partition for partition in after if int(partition.get("start") or 0) >= start_mib * 1024 * 1024]
        if not candidates:
            raise RuntimeError("A-OS could not create its persistent storage partition")
        persistence = str(max(candidates, key=lambda value: int(value.get("start") or 0)).get("path") or "")
        require_command(["mkfs.ext4", "-F", "-L", "persistence", persistence], timeout=180)
        mount_dir = Path(tempfile.mkdtemp(prefix="aos-install-", dir="/mnt"))
        require_command(["mount", persistence, str(mount_dir)], timeout=20)
        (mount_dir / "persistence.conf").write_text("/ union\n", encoding="utf-8")
        require_command(["sync"], timeout=60)
        require_command(["umount", str(mount_dir)], timeout=30)
        mount_dir.rmdir()
        mount_dir = None
        set_job_state(INSTALL_STATE, INSTALL_LOCK, running=False, stage="complete", progress=100, message="A-OS is installed. Remove the USB or DVD and restart.")
    except Exception as error:
        if mount_dir:
            run(["umount", str(mount_dir)], timeout=15)
            shutil.rmtree(mount_dir, ignore_errors=True)
        set_job_state(INSTALL_STATE, INSTALL_LOCK, running=False, stage="error", error=str(error), message="Installation stopped")


def safe_extract_public(archive_path, destination):
    destination = Path(destination).resolve()
    with tarfile.open(archive_path, "r:gz") as archive:
        members = archive.getmembers()
        roots = {member.name.split("/", 1)[0] for member in members if "/" in member.name}
        if len(roots) != 1:
            raise RuntimeError("The update archive has an unexpected layout")
        prefix = roots.pop() + "/public/"
        selected = [member for member in members if member.name.startswith(prefix) and member.name != prefix]
        if not selected:
            raise RuntimeError("The update archive does not contain A-OS files")
        if sum(max(0, member.size) for member in selected) > 2 * 1024 * 1024 * 1024:
            raise RuntimeError("The unpacked update is unexpectedly large")
        for member in selected:
            if member.issym() or member.islnk():
                raise RuntimeError("The update archive contains unsupported links")
            relative = Path(member.name[len(prefix):])
            output = (destination / relative).resolve()
            if destination != output and destination not in output.parents:
                raise RuntimeError("The update archive contains an unsafe path")
            if member.isdir():
                output.mkdir(parents=True, exist_ok=True)
                continue
            if not member.isfile():
                continue
            output.parent.mkdir(parents=True, exist_ok=True)
            source = archive.extractfile(member)
            if source is None:
                raise RuntimeError("The update archive is incomplete")
            with source, output.open("wb") as handle:
                shutil.copyfileobj(source, handle)


def update_worker(version):
    work = None
    partial_release = None
    try:
        revision = str((version or {}).get("revision") or "").lower()
        if not re.fullmatch(r"[0-9a-f]{40}", revision):
            raise RuntimeError("The published update is not linked to a verified source revision")
        set_job_state(UPDATE_STATE, UPDATE_LOCK, stage="downloading", progress=8, message="Downloading the verified A-OS source revision")
        STATE_ROOT.mkdir(parents=True, exist_ok=True)
        RELEASES_ROOT.mkdir(parents=True, exist_ok=True)
        work = Path(tempfile.mkdtemp(prefix="update-", dir=str(STATE_ROOT)))
        archive_path = work / "update.tar.gz"
        request = Request(SOURCE_ARCHIVE_URL.format(revision=revision), headers={"User-Agent": "A-OS-Updater/1.2.1"})
        with urlopen(request, timeout=30) as response, archive_path.open("wb") as handle:
            total, received = int(response.headers.get("Content-Length") or 0), 0
            while True:
                block = response.read(1024 * 1024)
                if not block:
                    break
                received += len(block)
                if received > 512 * 1024 * 1024:
                    raise RuntimeError("The update download is unexpectedly large")
                handle.write(block)
                if total:
                    set_job_state(UPDATE_STATE, UPDATE_LOCK, progress=min(54, 8 + int(received / total * 46)))
        set_job_state(UPDATE_STATE, UPDATE_LOCK, stage="verifying", progress=58, message="Verifying and preparing A-OS files")
        partial_release = RELEASES_ROOT / (revision + ".partial")
        shutil.rmtree(partial_release, ignore_errors=True)
        partial_release.mkdir()
        safe_extract_public(archive_path, partial_release)
        if not (partial_release / "index.html").is_file():
            raise RuntimeError("The update is missing the A-OS start page")
        set_job_state(UPDATE_STATE, UPDATE_LOCK, stage="installing", progress=76, message="Installing the update in the background")
        (partial_release / "version.json").write_text(json.dumps(version, indent=2) + "\n", encoding="utf-8")
        release = RELEASES_ROOT / revision
        if release.exists():
            shutil.rmtree(partial_release)
            (release / "version.json").write_text(json.dumps(version, indent=2) + "\n", encoding="utf-8")
        else:
            partial_release.rename(release)
        partial_release = None
        next_link = STATE_ROOT / (".active-public-" + revision)
        try:
            next_link.unlink()
        except FileNotFoundError:
            pass
        next_link.symlink_to(release, target_is_directory=True)
        os.replace(next_link, ACTIVE_RELEASE)
        require_command(["sync"], timeout=60)
        set_job_state(UPDATE_STATE, UPDATE_LOCK, running=False, stage="complete", progress=100, message="A-OS is updated. Restart to use the new version.")
    except Exception as error:
        set_job_state(UPDATE_STATE, UPDATE_LOCK, running=False, stage="error", error=str(error), message="The update was not installed")
    finally:
        if partial_release:
            shutil.rmtree(partial_release, ignore_errors=True)
        if work:
            shutil.rmtree(work, ignore_errors=True)


def finish_power_action(action):
    subprocess.run(["sync"], check=False)
    subprocess.run(["systemctl", "reboot" if action == "restart" else "poweroff"], check=False)


class AosHandler(SimpleHTTPRequestHandler):
    server_version = "A-OS Native Bridge/1.1"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(active_public_root()), **kwargs)

    def _same_machine_request(self):
        host = (self.headers.get("Host") or "").split(":", 1)[0].strip("[]").lower()
        fetch_site = (self.headers.get("Sec-Fetch-Site") or "same-origin").lower()
        return host in {"127.0.0.1", "localhost", "::1"} and fetch_site in {"same-origin", "same-site", "none"}

    def _json(self, status, value):
        body = json.dumps(value, ensure_ascii=True).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        length = min(int(self.headers.get("Content-Length", "0") or 0), MAX_BODY)
        if not length:
            return {}
        try:
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            return None

    def do_GET(self):
        route = self.path.split("?", 1)[0]
        if route.startswith("/__aos/"):
            if not self._same_machine_request():
                self._json(403, {"ok": False, "error": "Local A-OS request required"})
                return
            routes = {
                "/__aos/system": system_state,
                "/__aos/storage": storage_targets,
                "/__aos/network/check": lambda: network_health(force=True),
                "/__aos/wifi/scan": wifi_scan,
                "/__aos/bluetooth/scan": bluetooth_scan,
            }
            if route in routes:
                self._json(200, routes[route]())
                return
            if route == "/__aos/update":
                self._json(200, {"packagedVersion": read_json_file(active_public_root() / "version.json"), "remoteVersion": remote_version(), "persistent": persistent_storage_active()})
                return
            if route == "/__aos/update/status":
                self._json(200, {"ok": True, **job_snapshot(UPDATE_STATE, UPDATE_LOCK)})
                return
            if route == "/__aos/install/status":
                self._json(200, {"ok": True, **job_snapshot(INSTALL_STATE, INSTALL_LOCK)})
                return
            self._json(404, {"ok": False, "error": "Unknown A-OS endpoint"})
            return
        super().do_GET()

    def do_POST(self):
        route = self.path.split("?", 1)[0]
        if route == "/__aos_browser_ready":
            length = min(int(self.headers.get("Content-Length", "0") or 0), 4096)
            message = self.rfile.read(length).decode("utf-8", errors="replace")
            READY_FILE.write_text(message or "A-OS HTML mounted", encoding="utf-8")
            body = b"ready"
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if not route.startswith("/__aos/") or not self._same_machine_request():
            self._json(403, {"ok": False, "error": "Local A-OS request required"})
            return
        body = self._body()
        if body is None:
            self._json(400, {"ok": False, "error": "Invalid JSON"})
            return
        if route == "/__aos/networking/toggle":
            enabled = bool(body.get("enabled"))
            code, _, error = run(["nmcli", "networking", "on" if enabled else "off"])
            invalidate_network_health()
            self._json(200 if code == 0 else 500, {"ok": code == 0, "enabled": enabled, "error": error})
            return
        if route == "/__aos/wifi/toggle":
            enabled = bool(body.get("enabled"))
            if enabled and not networking_enabled():
                run(["nmcli", "networking", "on"])
            code, _, error = run(["nmcli", "radio", "wifi", "on" if enabled else "off"])
            invalidate_network_health()
            self._json(200 if code == 0 else 500, {"ok": code == 0, "enabled": enabled, "error": error})
            return
        if route == "/__aos/wifi/connect":
            ssid, password = str(body.get("ssid") or "")[:128], str(body.get("password") or "")[:256]
            if not ssid:
                self._json(400, {"ok": False, "error": "Choose a Wi-Fi network"})
                return
            if not networking_enabled():
                run(["nmcli", "networking", "on"])
            command = ["nmcli", "device", "wifi", "connect", ssid]
            if password:
                command.extend(["password", password])
            code, output, error = run(command, timeout=35)
            invalidate_network_health()
            health = network_health(force=True) if code == 0 else None
            self._json(200 if code == 0 else 400, {"ok": code == 0, "message": output, "error": error, "connectivity": health})
            return
        if route == "/__aos/bluetooth/toggle":
            enabled = bool(body.get("enabled"))
            if enabled:
                run(["rfkill", "unblock", "bluetooth"])
            code, _, error = run(["bluetoothctl", "power", "on" if enabled else "off"])
            self._json(200 if code == 0 else 500, {"ok": code == 0, "enabled": enabled, "error": error})
            return
        if route == "/__aos/bluetooth/connect":
            address = str(body.get("address") or "").upper()
            if not re.fullmatch(r"[0-9A-F]{2}(?::[0-9A-F]{2}){5}", address):
                self._json(400, {"ok": False, "error": "Invalid Bluetooth device"})
                return
            run(["bluetoothctl", "agent", "on"])
            run(["bluetoothctl", "default-agent"])
            run(["bluetoothctl", "pair", address], timeout=25)
            run(["bluetoothctl", "trust", address])
            code, output, error = run(["bluetoothctl", "connect", address], timeout=25)
            self._json(200 if code == 0 else 400, {"ok": code == 0, "message": output, "error": error})
            return
        if route == "/__aos/install":
            target = str(body.get("target") or "")
            mode = str(body.get("mode") or "erase")
            confirmation = str(body.get("confirmation") or "")
            try:
                if mode == "alongside":
                    if confirmation != "INSTALL ALONGSIDE WINDOWS":
                        raise RuntimeError("Type INSTALL ALONGSIDE WINDOWS to confirm")
                    validate_alongside_target(target)
                    worker = install_alongside_worker
                    message = "Preparing unallocated space beside Windows"
                elif mode == "erase":
                    if confirmation != "ERASE " + target:
                        raise RuntimeError("Type ERASE followed by the exact drive path")
                    validate_install_target(target)
                    worker = install_erase_worker
                    message = "Preparing the selected drive"
                else:
                    raise RuntimeError("Unknown installation mode")
            except RuntimeError as error:
                self._json(400, {"ok": False, "error": str(error)})
                return
            with INSTALL_LOCK:
                if INSTALL_STATE["running"]:
                    self._json(409, {"ok": False, "error": "An installation is already running"})
                    return
                INSTALL_STATE.update({"running": True, "stage": "starting", "progress": 2, "message": message, "error": ""})
            Thread(target=worker, args=(target,), daemon=True).start()
            self._json(202, {"ok": True, "started": True})
            return
        if route == "/__aos/update/apply":
            if not persistent_storage_active():
                self._json(409, {"ok": False, "error": "Install A-OS to a disk with persistent storage before applying updates"})
                return
            version = remote_version(force=True)
            if not version:
                self._json(503, {"ok": False, "error": "A-OS could not reach the update service"})
                return
            with UPDATE_LOCK:
                if UPDATE_STATE["running"]:
                    self._json(409, {"ok": False, "error": "An update is already running"})
                    return
                UPDATE_STATE.update({"running": True, "stage": "starting", "progress": 2, "message": "Preparing the A-OS update", "error": ""})
            Thread(target=update_worker, args=(version,), daemon=True).start()
            self._json(202, {"ok": True, "started": True})
            return
        if route in {"/__aos/power/restart", "/__aos/power/shutdown", "/__aos/power/hibernate"}:
            action = "restart" if route.endswith("restart") else "hibernate" if route.endswith("hibernate") else "shutdown"
            self._json(200, {"ok": True, "action": action})
            Timer(0.8, finish_power_action, args=(action,)).start()
            return
        self._json(404, {"ok": False, "error": "Unknown A-OS endpoint"})

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Cross-Origin-Opener-Policy", "same-origin-allow-popups")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", PORT), AosHandler).serve_forever()
