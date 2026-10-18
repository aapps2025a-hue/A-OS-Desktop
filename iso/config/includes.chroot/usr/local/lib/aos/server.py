#!/usr/bin/env python3

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock, Timer
from urllib.request import Request, urlopen
import json
import os
import re
import subprocess
import time


ROOT = Path(os.environ.get("AOS_PUBLIC_ROOT", "/opt/a-os/public")).resolve()
READY_FILE = Path(os.environ.get("AOS_READY_FILE", "/tmp/aos-browser-ready"))
PORT = int(os.environ.get("AOS_PORT", "5000"))
REMOTE_VERSION_URL = "https://a-os-desktop.web.app/version.json"
MAX_BODY = 16 * 1024
COMMAND_TIMEOUT = 12
VERSION_CACHE_SECONDS = 30
VERSION_CACHE = {"at": 0.0, "value": None}
VERSION_LOCK = Lock()
os.chdir(ROOT)


def run(command, timeout=COMMAND_TIMEOUT):
    try:
        result = subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=True,
            timeout=timeout,
            env={**os.environ, "LC_ALL": "C.UTF-8"},
        )
        return result.returncode, result.stdout.strip(), result.stderr.strip()
    except (FileNotFoundError, subprocess.TimeoutExpired) as error:
        return 127, "", str(error)


def read_json_file(path):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def remote_version():
    now = time.monotonic()
    with VERSION_LOCK:
        if now - VERSION_CACHE["at"] < VERSION_CACHE_SECONDS:
            return VERSION_CACHE["value"]
        value = None
        try:
            request = Request(REMOTE_VERSION_URL, headers={"User-Agent": "A-OS-Desktop-ISO/1.2.1"})
            with urlopen(request, timeout=4) as response:
                value = json.loads(response.read(64 * 1024).decode("utf-8"))
        except Exception:
            value = None
        VERSION_CACHE.update({"at": now, "value": value})
        return value


def battery_state():
    batteries = sorted(Path("/sys/class/power_supply").glob("BAT*"))
    for battery in batteries:
        try:
            level = max(0, min(100, int((battery / "capacity").read_text().strip())))
            status = (battery / "status").read_text().strip().lower()
            return {
                "available": True,
                "percentage": level,
                "charging": status in {"charging", "full"},
                "status": status,
            }
        except (OSError, ValueError):
            continue
    return {"available": False, "percentage": 0, "charging": False, "status": "unknown"}


def current_network():
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
    code, output, _ = run([
        "runuser", "-u", "aos", "--", "env", "XDG_RUNTIME_DIR=/run/user/" + uid,
        "pw-dump",
    ], timeout=3)
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
        "battery": battery_state(),
        "wifi": {"enabled": wifi_enabled(), "network": current_network()},
        "bluetooth": {"enabled": bluetooth_enabled()},
        "microphoneActive": microphone_active(),
    }


def storage_targets():
    code, output, _ = run([
        "lsblk", "--json", "--bytes", "--output",
        "NAME,PATH,SIZE,TYPE,MODEL,TRAN,RM,MOUNTPOINTS",
    ])
    if code != 0:
        return {"ok": True, "targets": []}
    try:
        devices = json.loads(output).get("blockdevices", [])
    except (TypeError, ValueError):
        return {"ok": True, "targets": []}
    targets = []
    for device in devices:
        if device.get("type") != "disk":
            continue
        path = str(device.get("path") or ("/dev/" + str(device.get("name") or "")))
        model = str(device.get("model") or "").strip()
        transport = str(device.get("tran") or "").strip().upper()
        removable = bool(device.get("rm")) or transport == "USB"
        description = "Detected " + ("removable" if removable else "internal") + " drive"
        if transport:
            description += " | " + transport
        targets.append({
            "id": path,
            "name": model or path,
            "description": description,
            "size": int(device.get("size") or 0),
            "removable": removable,
        })
    return {"ok": True, "targets": targets}


def split_nmcli(line):
    fields = []
    current = []
    escaped = False
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


def wifi_scan():
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
        item = {
            "ssid": ssid,
            "strength": max(0, min(100, int(signal or 0))),
            "secure": bool(security and security != "--"),
            "security": security if security != "--" else "Open",
            "connected": active == "*",
        }
        if ssid not in networks or item["strength"] > networks[ssid]["strength"]:
            networks[ssid] = item
    ordered = sorted(networks.values(), key=lambda item: (not item["connected"], -item["strength"], item["ssid"].lower()))
    return {"ok": True, "networks": ordered}


def bluetooth_scan():
    run(["rfkill", "unblock", "bluetooth"])
    run(["bluetoothctl", "power", "on"])
    run(["bluetoothctl", "--timeout", "5", "scan", "on"], timeout=8)
    code, output, error = run(["bluetoothctl", "devices"])
    if code != 0:
        return {"ok": False, "error": error or "Bluetooth scan failed", "devices": []}
    paired_code, paired_output, _ = run(["bluetoothctl", "paired-devices"])
    paired = set(re.findall(r"Device\s+([0-9A-F:]{17})", paired_output, re.IGNORECASE)) if paired_code == 0 else set()
    paired_upper = {item.upper() for item in paired}
    devices = []
    for line in output.splitlines():
        match = re.match(r"Device\s+([0-9A-F:]{17})\s+(.+)", line, re.IGNORECASE)
        if not match:
            continue
        address, name = match.groups()
        info_code, info, _ = run(["bluetoothctl", "info", address])
        devices.append({
            "address": address.upper(),
            "name": name.strip(),
            "paired": address.upper() in paired_upper,
            "connected": info_code == 0 and "Connected: yes" in info,
        })
    devices.sort(key=lambda item: (not item["connected"], not item["paired"], item["name"].lower()))
    return {"ok": True, "devices": devices}


class AosHandler(SimpleHTTPRequestHandler):
    server_version = "A-OS Native Bridge/1.0"

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
            if route == "/__aos/system":
                self._json(200, system_state())
                return
            if route == "/__aos/update":
                self._json(200, {
                    "packagedVersion": read_json_file(ROOT / "version.json"),
                    "remoteVersion": remote_version(),
                })
                return
            if route == "/__aos/storage":
                self._json(200, storage_targets())
                return
            if route == "/__aos/wifi/scan":
                self._json(200, wifi_scan())
                return
            if route == "/__aos/bluetooth/scan":
                self._json(200, bluetooth_scan())
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

        if route == "/__aos/wifi/toggle":
            enabled = bool(body.get("enabled"))
            code, _, error = run(["nmcli", "radio", "wifi", "on" if enabled else "off"])
            self._json(200 if code == 0 else 500, {"ok": code == 0, "enabled": enabled, "error": error})
            return

        if route == "/__aos/wifi/connect":
            ssid = str(body.get("ssid") or "")[:128]
            password = str(body.get("password") or "")[:256]
            if not ssid:
                self._json(400, {"ok": False, "error": "Choose a Wi-Fi network"})
                return
            command = ["nmcli", "device", "wifi", "connect", ssid]
            if password:
                command.extend(["password", password])
            code, output, error = run(command, timeout=35)
            self._json(200 if code == 0 else 400, {"ok": code == 0, "message": output, "error": error})
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

        if route in {"/__aos/power/restart", "/__aos/power/shutdown", "/__aos/power/hibernate"}:
            action = "reboot" if route.endswith("restart") else "hibernate" if route.endswith("hibernate") else "poweroff"
            self._json(200, {"ok": True, "action": action})
            Timer(1.0, lambda: subprocess.run(["systemctl", action], check=False)).start()
            return

        self._json(404, {"ok": False, "error": "Unknown A-OS endpoint"})

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Cross-Origin-Opener-Policy", "same-origin-allow-popups")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()


ThreadingHTTPServer(("127.0.0.1", PORT), AosHandler).serve_forever()
