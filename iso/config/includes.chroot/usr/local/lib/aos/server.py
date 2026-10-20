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
BACKLIGHT_ROOT = Path(os.environ.get("AOS_BACKLIGHT_ROOT", "/sys/class/backlight")).resolve()
RELEASES_ROOT = STATE_ROOT / "releases"
ACTIVE_RELEASE = STATE_ROOT / "active-public"
READY_FILE = Path(os.environ.get("AOS_READY_FILE", "/tmp/aos-browser-ready"))
PORT = int(os.environ.get("AOS_PORT", "5000"))
REMOTE_VERSION_URL = "https://a-os-desktop.web.app/version.json"
SOURCE_ARCHIVE_URL = "https://github.com/aapps2025a-hue/A-OS-Desktop/archive/{revision}.tar.gz"
MAX_BODY = 256 * 1024
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
AUTO_SPACE_BYTES = MIN_ALONGSIDE_BYTES + 4 * MIB
MIN_WINDOWS_REMAIN_BYTES = 32 * GIB
NTFS_RESIZE_MARGIN_BYTES = 8 * MIB
EFI_SYSTEM_GUID = "c12a7328-f81f-11d2-ba4b-00a0c93ec93b"
WINDOWS_LOADER = ("EFI", "Microsoft", "Boot", "bootmgfw.efi")
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


def run(command, timeout=COMMAND_TIMEOUT, input_text=None):
    try:
        result = subprocess.run(
            command, check=False, capture_output=True, text=True, timeout=timeout,
            env={**os.environ, "LC_ALL": "C.UTF-8"},
            input=input_text,
        )
        return result.returncode, result.stdout.strip(), result.stderr.strip()
    except (FileNotFoundError, subprocess.TimeoutExpired) as error:
        return 127, "", str(error)


def require_command(command, timeout=COMMAND_TIMEOUT, input_text=None):
    code, output, error = run(command, timeout=timeout, input_text=input_text)
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
            request = Request(REMOTE_VERSION_URL, headers={"User-Agent": "A-OS-Desktop/3.0"})
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


def run_as_aos(command, timeout=COMMAND_TIMEOUT):
    code, uid, error = run(["id", "-u", "aos"], timeout=2)
    if code != 0 or not uid.isdigit():
        return code or 1, "", error or "The A-OS audio session is not available"
    return run([
        "runuser", "-u", "aos", "--", "env", "XDG_RUNTIME_DIR=/run/user/" + uid,
        *command,
    ], timeout=timeout)


def volume_state():
    code, output, error = run_as_aos(["wpctl", "get-volume", "@DEFAULT_AUDIO_SINK@"], timeout=4)
    match = re.search(r"Volume:\s*([0-9]+(?:\.[0-9]+)?)", output)
    if code != 0 or not match:
        return {"available": False, "percentage": 0, "muted": False, "error": error}
    percentage = max(0, min(100, round(float(match.group(1)) * 100)))
    return {"available": True, "percentage": percentage, "muted": "[MUTED]" in output.upper()}


def set_volume(value):
    try:
        percentage = max(0, min(100, round(float(value))))
    except (TypeError, ValueError):
        raise RuntimeError("Choose a volume between 0 and 100")
    code, output, error = run_as_aos([
        "wpctl", "set-volume", "@DEFAULT_AUDIO_SINK@", str(percentage) + "%",
    ], timeout=5)
    if code != 0:
        raise RuntimeError(error or output or "A-OS could not change the sound volume")
    code, output, error = run_as_aos([
        "wpctl", "set-mute", "@DEFAULT_AUDIO_SINK@", "1" if percentage == 0 else "0",
    ], timeout=5)
    if code != 0:
        raise RuntimeError(error or output or "A-OS could not change the sound mute state")
    return volume_state()


def backlight_device():
    try:
        devices = sorted(path for path in BACKLIGHT_ROOT.iterdir() if path.is_dir())
    except OSError:
        return None
    for device in devices:
        try:
            maximum = int((device / "max_brightness").read_text().strip())
            current = int((device / "brightness").read_text().strip())
            if maximum > 0:
                return device, maximum, current
        except (OSError, ValueError):
            continue
    return None


def brightness_state():
    device = backlight_device()
    if not device:
        return {"available": False, "percentage": 100}
    _, maximum, current = device
    return {
        "available": True,
        "percentage": max(1, min(100, round(current * 100 / maximum))),
    }


def set_brightness(value):
    try:
        percentage = max(5, min(100, round(float(value))))
    except (TypeError, ValueError):
        raise RuntimeError("Choose a brightness between 5 and 100")
    device = backlight_device()
    if not device:
        raise RuntimeError("This display does not expose a hardware brightness control")
    path, maximum, _ = device
    raw_value = max(1, min(maximum, round(maximum * percentage / 100)))
    try:
        (path / "brightness").write_text(str(raw_value), encoding="ascii")
    except OSError as error:
        raise RuntimeError("A-OS could not change this display's brightness") from error
    return brightness_state()


def device_info():
    hostname = socket.gethostname() or "A-OS Device"
    processor = "Unknown processor"
    try:
        for line in Path("/proc/cpuinfo").read_text(encoding="utf-8", errors="ignore").splitlines():
            if line.lower().startswith("model name") and ":" in line:
                processor = line.split(":", 1)[1].strip()
                break
    except OSError:
        pass
    address = "Unavailable"
    code, output, _ = run(["ip", "route", "get", "1.1.1.1"], timeout=3)
    if code == 0:
        match = re.search(r"\bsrc\s+(\d{1,3}(?:\.\d{1,3}){3})", output)
        if match:
            address = match.group(1)
    release = read_json_file(active_public_root() / "version.json") or {}
    return {
        "ok": True,
        "ip": address,
        "device": hostname,
        "processor": processor,
        "os": "A-OS Desktop " + str(release.get("version") or "3.0"),
    }


def run_python(code):
    source = str(code or "")
    if not source.strip():
        raise RuntimeError("The Python file is empty")
    if len(source.encode("utf-8")) > MAX_BODY - 1024:
        raise RuntimeError("The Python file is too large")
    descriptor, path = tempfile.mkstemp(prefix="aos-python-", suffix=".py")
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(source)
        os.chmod(path, 0o644)
        code_value, output, error = run(["runuser", "-u", "aos", "--", "python3", "-I", path], timeout=20)
        return {
            "ok": code_value == 0,
            "exitCode": code_value,
            "output": output[-65536:],
            "error": error[-65536:],
        }
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


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
                request = Request(REMOTE_VERSION_URL, method="HEAD", headers={"User-Agent": "A-OS/3.0"})
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
        "installationMedia": {
            "source": live_source_device(),
            "removable": live_source_is_removable(),
        },
        "networking": {"enabled": networking_enabled()},
        "connectivity": network_health(),
        "battery": battery_state(),
        "volume": volume_state(),
        "brightness": brightness_state(),
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


def live_source_is_removable():
    source = live_source_device()
    if not source:
        return False
    code, output, _ = run(["lsblk", "-dnro", "RM,TRAN", source], timeout=3)
    if code != 0:
        return False
    fields = output.lower().split()
    return "1" in fields or "usb" in fields


def read_block_devices(columns, device=None):
    # Bookworm's lsblk has no PARTN column. Read partition numbers from sysfs.
    command = ["lsblk", "--json", "--bytes", "--tree", "--output", columns]
    if device:
        command.append(device)
    code, output, error = run(command)
    if code != 0:
        raise RuntimeError("Disk detection failed: " + (error.strip() or output.strip() or "lsblk failed"))
    try:
        devices = json.loads(output)["blockdevices"]
        if not isinstance(devices, list):
            raise ValueError("Invalid block-device list")
    except (TypeError, ValueError):
        raise RuntimeError("Disk detection returned invalid data")
    except KeyError:
        raise RuntimeError("Disk detection returned no device list")

    def add_partition_numbers(items):
        for item in items:
            if item.get("type") == "part":
                item["partn"] = partition_number(item.get("path"))
            add_partition_numbers(item.get("children") or [])

    add_partition_numbers(devices)
    return devices


def block_devices():
    return read_block_devices(
        "NAME,PATH,SIZE,TYPE,MODEL,TRAN,RM,MOUNTPOINTS,START,FSTYPE,PARTTYPE,PARTUUID,PTTYPE"
    )


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


def partition_has_path(partition, components):
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
        return root.joinpath(*components).is_file()
    finally:
        if mount_dir:
            run(["umount", str(mount_dir)], timeout=10)
            # Never recursively remove a directory that could still be mounted.
            try:
                mount_dir.rmdir()
            except OSError:
                pass


def partition_has_windows_loader(partition):
    return partition_has_path(partition, WINDOWS_LOADER)


def partition_has_windows_installation(partition):
    return partition_has_path(partition, ("Windows", "System32", "config", "SYSTEM"))


def windows_firmware_partition_uuids():
    code, output, _ = run(["efibootmgr", "-v"], timeout=5)
    if code != 0:
        return set()
    pattern = re.compile(
        r"GPT,([0-9a-f-]{36}),.*?File\(\\EFI\\Microsoft\\Boot\\bootmgfw\.efi\)",
        re.IGNORECASE,
    )
    return {match.lower() for match in pattern.findall(output)}


def windows_esp_for_disk(device):
    firmware_partitions = windows_firmware_partition_uuids()
    for child in device.get("children") or []:
        parttype = str(child.get("parttype") or "").lower()
        fstype = str(child.get("fstype") or "").lower()
        partuuid = str(child.get("partuuid") or "").lower()
        path = str(child.get("path") or "")
        is_efi_candidate = parttype == EFI_SYSTEM_GUID or fstype in {"vfat", "fat", "fat32"}
        if is_efi_candidate and path:
            if partition_has_windows_loader(path) or partuuid in firmware_partitions:
                return path
    return ""


def windows_system_partition(device):
    candidates = []
    for child in device.get("children") or []:
        path = str(child.get("path") or "")
        fstype = str(child.get("fstype") or "").lower()
        size = int(child.get("size") or 0)
        partn = str(child.get("partn") or "")
        if path and partn.isdigit() and fstype == "ntfs" and size >= MIN_WINDOWS_REMAIN_BYTES + AUTO_SPACE_BYTES:
            candidates.append(child)
    for child in sorted(candidates, key=lambda item: int(item.get("size") or 0), reverse=True):
        if partition_has_windows_installation(str(child.get("path") or "")):
            return child
    return None


def secure_boot_enabled():
    for variable in Path("/sys/firmware/efi/efivars").glob("SecureBoot-*"):
        try:
            data = variable.read_bytes()
            return len(data) >= 5 and data[4] == 1
        except OSError:
            continue
    return False


def alongside_targets(devices, source):
    uefi_booted = Path("/sys/firmware/efi").is_dir()
    secure_booted = secure_boot_enabled() if uefi_booted else False
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
        eligible_regions = [region for region in disk_free_regions(path) if region["size"] >= MIN_ALONGSIDE_BYTES]
        requirements = []
        if not uefi_booted:
            requirements.append("Restart and choose the UEFI entry for this A-OS USB")
        if secure_booted:
            requirements.append("Disable Secure Boot in UEFI settings")
        if not eligible_regions:
            windows_partition = windows_system_partition(device)
            if windows_partition:
                partn = int(windows_partition["partn"])
                blocked_reason = "; ".join(requirements)
                targets.append({
                    "id": "alongside-auto:{}:{}".format(path, partn),
                    "mode": "alongside",
                    "name": "Windows local disk (C:) - create A-OS partitions",
                    "description": "No empty partition was found. A-OS will safely check and shrink Windows by 32 GB, then create its partitions{}".format(
                        " | " + blocked_reason if blocked_reason else "",
                    ),
                    "size": MIN_ALONGSIDE_BYTES,
                    "removable": False,
                    "installable": not blocked_reason,
                    "blockedReason": blocked_reason,
                    "disk": path,
                    "esp": esp,
                    "autoCreateSpace": True,
                    "resizePartition": str(windows_partition["path"]),
                    "resizePartitionNumber": partn,
                })
            else:
                requirements.append("A-OS could not safely identify a resizable Windows NTFS system partition")
                requirements.append("Create at least 32 GB of unallocated space in Windows Disk Management")
                blocked_reason = "; ".join(requirements)
                targets.append({
                    "id": "alongside-unavailable:" + path,
                    "mode": "alongside",
                    "name": "Windows local disk (C:) - setup required",
                    "description": "Windows detected on {} | {}".format(path, blocked_reason),
                    "size": 0,
                    "removable": False,
                    "installable": False,
                    "blockedReason": blocked_reason,
                    "disk": path,
                    "esp": esp,
                })
            continue
        for region in eligible_regions:
            blocked_reason = "; ".join(requirements)
            target_id = "alongside:{}:{}:{}".format(path, region["startMiB"], region["endMiB"])
            targets.append({
                "id": target_id,
                "mode": "alongside",
                "name": "Windows local disk (C:) - install A-OS beside Windows",
                "description": "Uses only unallocated space on {} | Windows detected{}".format(
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
    run(["systemctl", "start", "bluetooth"], timeout=10)
    run(["bluetoothctl", "power", "on"])
    run(["bluetoothctl", "agent", "on"])
    run(["bluetoothctl", "default-agent"])
    run(["bluetoothctl", "pairable", "on"])
    run(["bluetoothctl", "--timeout", "8", "scan", "on"], timeout=12)
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
    devices = read_block_devices("PATH,TYPE,START,SIZE,FSTYPE", device)
    if not devices:
        raise RuntimeError("The selected disk was not returned by lsblk: " + device)
    root = devices[0]
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
    disk_pattern = r"/dev/(?:sd[a-z]+|vd[a-z]+|xvd[a-z]+|nvme\d+n\d+|mmcblk\d+)"
    region_pattern = r"alongside:{}:(\d+):(\d+)".format(disk_pattern)
    automatic_pattern = r"alongside-auto:{}:(\d+)".format(disk_pattern)
    if not re.fullmatch(region_pattern, str(target or "")) and not re.fullmatch(automatic_pattern, str(target or "")):
        raise RuntimeError("A-OS rejected an unsafe alongside-install target")
    listed = {item["id"]: item for item in storage_targets()["targets"] if item.get("mode") == "alongside"}
    item = listed.get(target)
    if not item:
        disk = str(target).split(":")[1]
        same_disk = [candidate for candidate in listed.values() if candidate.get("disk") == disk]
        blocked = next((candidate.get("blockedReason") for candidate in same_disk if candidate.get("blockedReason")), "")
        if blocked:
            raise RuntimeError("Windows was detected, but installation is blocked: " + blocked)
        raise RuntimeError(
            "The selected Windows installation area could not be revalidated. "
            "Go Back to disk selection and choose Rescan disks. No disk has been erased."
        )
    if not item.get("installable"):
        raise RuntimeError(item.get("blockedReason") or "A-OS cannot use that Windows unallocated region")
    if not Path("/sys/firmware/efi").is_dir():
        raise RuntimeError("Install alongside Windows requires UEFI boot mode")
    return item


def parse_parted_partitions(output):
    partitions = {}
    pattern = re.compile(r"^(\d+):(\d+)B:(\d+)B:(\d+)B:")
    for line in str(output or "").splitlines():
        match = pattern.match(line.strip())
        if not match:
            continue
        number, start, end, size = (int(value) for value in match.groups())
        partitions[number] = {"number": number, "start": start, "end": end, "size": size}
    return partitions


def partition_geometry(device, number):
    output = require_command(["parted", "-m", "-s", device, "unit", "B", "print"], timeout=15)
    geometry = parse_parted_partitions(output).get(int(number))
    if not geometry:
        raise RuntimeError("A-OS could not read the Windows partition geometry")
    return geometry


def create_alongside_space(item):
    device = str(item["disk"])
    partition = str(item.get("resizePartition") or "")
    number = int(item.get("resizePartitionNumber") or 0)
    current = {int(value.get("partn")): value for value in list_partitions(device) if str(value.get("partn") or "").isdigit()}
    listed = current.get(number)
    if not listed or str(listed.get("path") or "") != partition or str(listed.get("fstype") or "").lower() != "ntfs":
        raise RuntimeError("The Windows NTFS partition changed after it was selected")
    if mounted_path(partition):
        raise RuntimeError("The Windows partition is mounted. Restart from the A-OS USB before installing")
    geometry = partition_geometry(device, number)
    new_end_bytes = int(geometry["end"]) + 1 - AUTO_SPACE_BYTES
    new_end_mib = int(math.floor(new_end_bytes / MIB))
    new_partition_bytes = new_end_mib * MIB - int(geometry["start"])
    new_filesystem_bytes = new_partition_bytes - NTFS_RESIZE_MARGIN_BYTES
    if new_filesystem_bytes < MIN_WINDOWS_REMAIN_BYTES:
        raise RuntimeError("The Windows partition is too small to create a 32 GB A-OS partition area")
    sector_size = int(require_command(["blockdev", "--getss", device], timeout=10))
    if sector_size not in (512, 4096) or new_partition_bytes % sector_size:
        raise RuntimeError("Unsupported Windows partition sector alignment")
    # -N changes only this entry; omitted fields retain their original values.
    resize_input = "size={}\n".format(new_partition_bytes // sector_size)
    resize_command = ["sfdisk", "--lock=yes", "--wipe", "never", "--wipe-partitions", "never", "-N", str(number), device]
    require_command(resize_command + ["--no-act"], timeout=30, input_text=resize_input)

    check_command = ["ntfsresize", "--no-action", "--no-progress-bar", "--size", str(new_filesystem_bytes), partition]
    code, output, error = run(check_command, timeout=600)
    if code != 0:
        detail = (error or output or "NTFS validation failed").splitlines()[-1]
        raise RuntimeError(
            "A-OS did not resize Windows because the safety check failed. "
            "Turn off BitLocker, Fast Startup and hibernation, run the Windows disk error check, and keep at least 32 GB free. "
            "Details: " + detail
        )

    set_job_state(
        INSTALL_STATE, INSTALL_LOCK, stage="resizing", progress=4,
        message="Windows passed the safety check. Creating 32 GB of unallocated space",
    )
    require_command([
        "ntfsresize", "--force", "--no-progress-bar", "--size", str(new_filesystem_bytes), partition,
    ], timeout=3600)
    require_command(resize_command, timeout=120, input_text=resize_input)
    require_command(["partprobe", device], timeout=30)
    run(["udevadm", "settle"], timeout=30)
    time.sleep(1)
    resized = partition_geometry(device, number)
    if resized["start"] != geometry["start"] or resized["size"] != new_partition_bytes:
        raise RuntimeError("The resized Windows partition did not match the planned geometry")
    regions = []
    for region in disk_free_regions(device):
        end_mib = min(region["endMiB"], (geometry["end"] + 1) // MIB)
        size = (end_mib - new_end_mib) * MIB
        if region["startMiB"] == new_end_mib and size >= MIN_ALONGSIDE_BYTES:
            regions.append({"startMiB": new_end_mib, "endMiB": end_mib, "size": size})
    if not regions:
        raise RuntimeError("Windows was resized, but A-OS could not find the new unallocated partition area")
    region = min(regions, key=lambda value: abs(int(value["startMiB"]) - new_end_mib))
    prepared = dict(item)
    prepared.update({
        "startMiB": region["startMiB"],
        "endMiB": region["endMiB"],
        "size": region["size"],
        "autoCreateSpace": False,
    })
    return prepared


def partition_number(partition):
    name = os.path.basename(os.path.realpath(str(partition or "")))
    try:
        number = (Path("/sys/class/block") / name / "partition").read_text().strip()
    except OSError as error:
        raise RuntimeError("Cannot read partition number for " + name) from error
    if not number.isdigit() or int(number) < 1:
        raise RuntimeError("Invalid partition number for " + name)
    return int(number)


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


def standalone_grub_configuration(system_uuid):
    return """set timeout=2
set default=0
if loadfont unicode; then
    insmod gfxterm
    insmod png
    insmod efi_gop
    terminal_output gfxterm
fi

menuentry 'A-OS Desktop 3.0' {
    search --no-floppy --fs-uuid --set=aosroot %s
    linux ($aosroot)/live/vmlinuz boot=live components persistence live-media=/dev/disk/by-uuid/%s live-media-path=/live quiet splash reboot=efi loglevel=3 systemd.show_status=false rd.systemd.show_status=false udev.log_priority=3 rd.udev.log_level=3 logo.nologo plymouth.ignore-serial-consoles vt.global_cursor_default=0 nox11autologin username=aos hostname=a-os locales=en_GB.UTF-8 keyboard-layouts=gb timezone=Europe/London console=ttyS0,115200n8 noeject
    initrd ($aosroot)/live/initrd.img
}
""" % (system_uuid, system_uuid)


def install_alongside_worker(target):
    mount_root = None
    mounted = []
    created_partition_numbers = []
    new_boot_entry = ""
    efi_directory = None
    efi_created = False
    try:
        item = validate_alongside_target(target)
        device = item["disk"]
        live_medium = Path("/run/live/medium")
        if not live_medium.is_dir() or not (live_medium / "live" / "filesystem.squashfs").is_file():
            raise RuntimeError("The A-OS installation media could not be found")
        system_mib = max(4096, int(math.ceil(directory_size(live_medium) / MIB)) + 1024)
        if item.get("autoCreateSpace") and MIN_ALONGSIDE_BYTES // MIB < system_mib + 8192:
            raise RuntimeError("The A-OS image is too large for automatic partition creation")
        if item.get("autoCreateSpace"):
            set_job_state(
                INSTALL_STATE, INSTALL_LOCK, stage="checking", progress=2,
                message="Checking Windows before creating the A-OS partition area",
            )
            item = create_alongside_space(item)
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
        created_partition_numbers.append(system_number)
        persistence_partition, persistence_number = create_partition(
            device, "AOS_DATA", system_end, int(item["endMiB"]),
        )
        created_partition_numbers.append(persistence_number)

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
        efi_created = True
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
        if efi_created and efi_directory and efi_directory.exists():
            shutil.rmtree(efi_directory, ignore_errors=True)
        unmounted = True
        for path in reversed(mounted):
            code, _, _ = run(["umount", str(path)], timeout=15)
            unmounted = unmounted and code == 0
        if new_boot_entry:
            run(["efibootmgr", "-b", new_boot_entry, "-B"], timeout=10)
        if mount_root and unmounted:
            shutil.rmtree(mount_root, ignore_errors=True)
        if "item" in locals() and unmounted:
            for number in reversed(created_partition_numbers):
                run(["parted", "-s", item["disk"], "rm", str(number)], timeout=30)
            run(["partprobe", item["disk"]], timeout=20)
        set_job_state(INSTALL_STATE, INSTALL_LOCK, running=False, stage="error", error=str(error), message="Installation stopped. Review the error before retrying; any completed Windows resize remains in effect.")


def install_erase_worker(target):
    mount_root = None
    mounted = []
    new_boot_entry = ""
    try:
        target, item = validate_install_target(target)
        live_medium = Path("/run/live/medium")
        if not live_medium.is_dir() or not (live_medium / "live" / "filesystem.squashfs").is_file():
            raise RuntimeError("The A-OS installation media could not be found")
        system_mib = max(4096, int(math.ceil(directory_size(live_medium) / MIB)) + 1024)
        disk_mib = int(item["size"]) // MIB
        system_end = 513 + system_mib
        if disk_mib < system_end + 8192:
            raise RuntimeError("The selected drive needs at least 8 GB of data space after the A-OS system")

        set_job_state(INSTALL_STATE, INSTALL_LOCK, stage="partitioning", progress=5, message="Creating a bootable A-OS disk layout")
        for partition in list_partitions(target):
            path = str(partition.get("path") or "")
            if path:
                run(["swapoff", path], timeout=5)
                run(["umount", path], timeout=10)
        require_command(["wipefs", "--all", target], timeout=30)
        run(["sgdisk", "--zap-all", target], timeout=30)
        require_command(["parted", "-s", target, "mklabel", "gpt"], timeout=30)
        require_command(["parted", "-s", target, "unit", "MiB", "mkpart", "AOS_EFI", "fat32", "1", "513"], timeout=30)
        require_command(["parted", "-s", target, "set", "1", "esp", "on"], timeout=30)
        require_command(["parted", "-s", target, "unit", "MiB", "mkpart", "AOS_SYSTEM", "ext4", "513", str(system_end)], timeout=30)
        require_command(["parted", "-s", target, "unit", "MiB", "mkpart", "AOS_DATA", "ext4", str(system_end), "100%"], timeout=30)
        require_command(["partprobe", target], timeout=20)
        run(["udevadm", "settle"], timeout=20)
        time.sleep(1)
        partitions = {int(value.get("partn")): str(value.get("path") or "") for value in list_partitions(target) if str(value.get("partn") or "").isdigit()}
        if not all(partitions.get(number) for number in (1, 2, 3)):
            raise RuntimeError("A-OS could not find the partitions it created")
        efi_partition, system_partition, persistence_partition = partitions[1], partitions[2], partitions[3]

        set_job_state(INSTALL_STATE, INSTALL_LOCK, stage="formatting", progress=13, message="Formatting A-OS system and data partitions")
        require_command(["mkfs.vfat", "-F", "32", "-n", "AOS_EFI", efi_partition], timeout=180)
        require_command(["mkfs.ext4", "-F", "-L", "AOS_SYSTEM", system_partition], timeout=180)
        require_command(["mkfs.ext4", "-F", "-L", "persistence", persistence_partition], timeout=180)

        mount_root = Path(tempfile.mkdtemp(prefix="aos-install-", dir="/mnt"))
        system_mount = mount_root / "system"
        persistence_mount = mount_root / "data"
        esp_mount = mount_root / "efi"
        system_mount.mkdir()
        persistence_mount.mkdir()
        esp_mount.mkdir()
        require_command(["mount", system_partition, str(system_mount)], timeout=20)
        mounted.append(system_mount)
        require_command(["mount", persistence_partition, str(persistence_mount)], timeout=20)
        mounted.append(persistence_mount)
        require_command(["mount", efi_partition, str(esp_mount)], timeout=20)
        mounted.append(esp_mount)

        set_job_state(INSTALL_STATE, INSTALL_LOCK, stage="copying", progress=23, message="Copying A-OS system files to the selected disk")
        require_command(["rsync", "-aH", "--delete", "--exclude=lost+found", str(live_medium) + "/", str(system_mount) + "/"], timeout=3600)
        set_job_state(INSTALL_STATE, INSTALL_LOCK, stage="verifying", progress=62, message="Verifying the installed A-OS system")
        for relative in ("live/filesystem.squashfs", "live/vmlinuz", "live/initrd.img"):
            source_file = live_medium / relative
            installed_file = system_mount / relative
            if not installed_file.is_file() or sha256_prefix(source_file, source_file.stat().st_size) != sha256_prefix(installed_file, installed_file.stat().st_size):
                raise RuntimeError("The installed A-OS system did not match the USB files")
        (persistence_mount / "persistence.conf").write_text("/ union\n", encoding="utf-8")

        set_job_state(INSTALL_STATE, INSTALL_LOCK, stage="bootloader", progress=79, message="Installing the A-OS UEFI bootloader")
        efi_directory = esp_mount / "EFI" / "AOSDesktop"
        fallback_directory = esp_mount / "EFI" / "BOOT"
        efi_directory.mkdir(parents=True, exist_ok=True)
        fallback_directory.mkdir(parents=True, exist_ok=True)
        shutil.copyfile("/usr/share/plymouth/themes/aos/aos-boot.png", efi_directory / "splash.png")
        grub_file = mount_root / "grub.cfg"
        grub_file.write_text(standalone_grub_configuration(filesystem_uuid(system_partition)), encoding="utf-8")
        require_command([
            "grub-mkstandalone", "--format=x86_64-efi", "--output=" + str(efi_directory / "grubx64.efi"),
            "--locales=", "--fonts=unicode", "--modules=part_gpt fat ext2 iso9660 loopback linux normal search search_fs_uuid gfxterm png efi_gop",
            "boot/grub/grub.cfg=" + str(grub_file),
        ], timeout=180)
        shutil.copyfile(efi_directory / "grubx64.efi", fallback_directory / "BOOTX64.EFI")
        (esp_mount / "startup.nsh").write_text("fs0:\\EFI\\AOSDesktop\\grubx64.efi\r\n", encoding="ascii")

        if Path("/sys/firmware/efi").is_dir():
            previous_entries = aos_boot_entries()
            code, _, _ = run(["efibootmgr", "--create", "--disk", target, "--part", "1", "--label", "A-OS", "--loader", "\\EFI\\AOSDesktop\\grubx64.efi"], timeout=30)
            if code == 0:
                added_entries = aos_boot_entries() - previous_entries
                new_boot_entry = sorted(added_entries)[-1] if added_entries else ""
                if new_boot_entry:
                    try:
                        prioritize_aos_boot(new_boot_entry)
                    except RuntimeError:
                        pass

        require_command(["sync"], timeout=60)
        for path in reversed(mounted):
            require_command(["umount", str(path)], timeout=30)
        mounted.clear()
        shutil.rmtree(mount_root, ignore_errors=True)
        mount_root = None
        set_job_state(INSTALL_STATE, INSTALL_LOCK, running=False, stage="complete", progress=100, message="A-OS 3.0 is installed with a universal UEFI fallback loader. Remove the USB and restart.")
    except Exception as error:
        for path in reversed(mounted):
            run(["umount", str(path)], timeout=15)
        if new_boot_entry:
            run(["efibootmgr", "-b", new_boot_entry, "-B"], timeout=10)
        if mount_root:
            shutil.rmtree(mount_root, ignore_errors=True)
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
        request = Request(SOURCE_ARCHIVE_URL.format(revision=revision), headers={"User-Agent": "A-OS-Updater/3.0"})
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
                "/__aos/info": device_info,
                "/__aos/storage": storage_targets,
                "/__aos/network/check": lambda: network_health(force=True),
                "/__aos/wifi/scan": wifi_scan,
                "/__aos/bluetooth/scan": bluetooth_scan,
            }
            if route in routes:
                try:
                    self._json(200, routes[route]())
                except RuntimeError as error:
                    self._json(503, {"ok": False, "error": str(error)})
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
                run(["systemctl", "start", "bluetooth"], timeout=15)
                run(["rfkill", "unblock", "bluetooth"])
                run(["bluetoothctl", "agent", "on"])
                run(["bluetoothctl", "default-agent"])
            code, _, error = run(["bluetoothctl", "power", "on" if enabled else "off"])
            if enabled and code == 0:
                run(["bluetoothctl", "pairable", "on"])
            self._json(200 if code == 0 else 500, {"ok": code == 0, "enabled": enabled, "error": error})
            return
        if route == "/__aos/volume":
            try:
                self._json(200, {"ok": True, **set_volume(body.get("percentage"))})
            except RuntimeError as error:
                self._json(400, {"ok": False, "error": str(error)})
            return
        if route == "/__aos/brightness":
            try:
                self._json(200, {"ok": True, **set_brightness(body.get("percentage"))})
            except RuntimeError as error:
                self._json(400, {"ok": False, "error": str(error)})
            return
        if route == "/__aos/python/run":
            try:
                result = run_python(body.get("code"))
                self._json(200 if result["ok"] else 400, result)
            except RuntimeError as error:
                self._json(400, {"ok": False, "error": str(error)})
            return
        if route == "/__aos/bluetooth/connect":
            address = str(body.get("address") or "").upper()
            if not re.fullmatch(r"[0-9A-F]{2}(?::[0-9A-F]{2}){5}", address):
                self._json(400, {"ok": False, "error": "Invalid Bluetooth device"})
                return
            run(["systemctl", "start", "bluetooth"], timeout=15)
            run(["rfkill", "unblock", "bluetooth"])
            run(["bluetoothctl", "power", "on"])
            run(["bluetoothctl", "agent", "on"])
            run(["bluetoothctl", "default-agent"])
            info_code, info_output, _ = run(["bluetoothctl", "info", address], timeout=10)
            if info_code != 0 or "Paired: yes" not in info_output:
                pair_code, pair_output, pair_error = run(["bluetoothctl", "pair", address], timeout=40)
                if pair_code != 0:
                    self._json(400, {"ok": False, "message": pair_output, "error": pair_error or "Bluetooth pairing failed"})
                    return
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
                    install_target = validate_alongside_target(target)
                    worker = install_alongside_worker
                    message = "Checking Windows and creating partition space" if install_target.get("autoCreateSpace") else "Preparing unallocated space beside Windows"
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
