#!/usr/bin/env python3
"""Local-network file transfer service shared by A-OS, Windows, and macOS."""

from __future__ import annotations

import argparse
import hashlib
import http.client
import ipaddress
import json
import os
import platform
import secrets
import shutil
import socket
import threading
import time
import uuid
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, quote, unquote, urlparse
from urllib.request import Request, urlopen


PROTOCOL = "aos-filedrop/1"
DISCOVERY_PORT = 45871
SERVICE_PORT = 45872
ANNOUNCE_SECONDS = 2.0
PEER_TIMEOUT_SECONDS = 8.0
OFFER_TIMEOUT_SECONDS = 600.0
MAX_FILE_BYTES = 10 * 1024 * 1024 * 1024
CHUNK_BYTES = 1024 * 1024


def _default_state_dir() -> Path:
    if platform.system() == "Windows":
        root = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming"))
        return root / "A-OS" / "FileDrop"
    if platform.system() == "Darwin":
        return Path.home() / "Library" / "Application Support" / "A-OS FileDrop"
    return Path(os.environ.get("XDG_STATE_HOME", Path.home() / ".local" / "state")) / "aos-filedrop"


def _default_downloads_dir() -> Path:
    return Path.home() / "Downloads" / "FileDrop"


def safe_filename(value: str) -> str:
    """Return a portable basename that cannot escape the downloads directory."""
    value = Path(str(value).replace("\\", "/")).name.strip()
    blocked = '<>:"/\\|?*\x00'
    value = "".join("_" if char in blocked or ord(char) < 32 else char for char in value)
    value = value.rstrip(" .")
    if value in {"", ".", ".."}:
        value = "Received file"
    return value[:240]


def unique_path(directory: Path, filename: str) -> Path:
    filename = safe_filename(filename)
    candidate = directory / filename
    if not candidate.exists() and not candidate.with_suffix(candidate.suffix + ".part").exists():
        return candidate
    stem = candidate.stem
    suffix = candidate.suffix
    for index in range(2, 10000):
        candidate = directory / f"{stem} ({index}){suffix}"
        if not candidate.exists() and not candidate.with_suffix(candidate.suffix + ".part").exists():
            return candidate
    return directory / f"{stem}-{uuid.uuid4().hex[:8]}{suffix}"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(CHUNK_BYTES), b""):
            digest.update(chunk)
    return digest.hexdigest()


def human_size(size: int) -> str:
    value = float(max(0, size))
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if value < 1024 or unit == "TB":
            return f"{value:.0f} {unit}" if unit == "B" else f"{value:.1f} {unit}"
        value /= 1024
    return f"{size} B"


@dataclass
class Peer:
    id: str
    name: str
    platform: str
    host: str
    port: int
    token: str
    seen: float


class FileDropService:
    """Discovery, approval, transfer, and local control for FileDrop."""

    def __init__(
        self,
        state_dir: Path | str | None = None,
        downloads_dir: Path | str | None = None,
        name: str | None = None,
        service_port: int = SERVICE_PORT,
        discovery_port: int = DISCOVERY_PORT,
        bind_host: str = "0.0.0.0",
        enable_discovery: bool = True,
    ) -> None:
        self.state_dir = Path(state_dir or _default_state_dir())
        self.downloads_dir = Path(downloads_dir or _default_downloads_dir())
        self.state_dir.mkdir(parents=True, exist_ok=True)
        self.downloads_dir.mkdir(parents=True, exist_ok=True)
        self.spool_dir = self.state_dir / "spool"
        self.spool_dir.mkdir(parents=True, exist_ok=True)
        self.config_path = self.state_dir / "config.json"
        config = self._load_config()
        self.device_id = str(config.get("deviceId") or uuid.uuid4())
        default_name = os.environ.get("AOS_FILEDROP_DEFAULT_NAME") or socket.gethostname() or "FileDrop device"
        self.name = str(name or config.get("name") or default_name)[:80]
        self.enabled = bool(config.get("enabled", True))
        self.platform = self._platform_name()
        self.session_token = secrets.token_urlsafe(32)
        self.bind_host = bind_host
        self.service_port = int(service_port)
        self.discovery_port = int(discovery_port)
        self.enable_discovery = bool(enable_discovery)
        self.peers: dict[str, Peer] = {}
        self.transfers: dict[str, dict[str, Any]] = {}
        self._lock = threading.RLock()
        self._stop = threading.Event()
        self._httpd: ThreadingHTTPServer | None = None
        self._threads: list[threading.Thread] = []
        self._listeners: list[Callable[[dict[str, Any]], None]] = []
        self._save_config()
        self._clear_old_spool()

    @staticmethod
    def _platform_name() -> str:
        system = platform.system()
        if system == "Darwin":
            return "macOS"
        if system == "Windows":
            return "Windows"
        if os.environ.get("AOS_FILEDROP_NATIVE") == "1":
            return "A-OS"
        return system or "Computer"

    def _load_config(self) -> dict[str, Any]:
        try:
            data = json.loads(self.config_path.read_text(encoding="utf-8"))
            return data if isinstance(data, dict) else {}
        except (OSError, ValueError):
            return {}

    def _save_config(self) -> None:
        payload = {"deviceId": self.device_id, "name": self.name, "enabled": self.enabled}
        temporary = self.config_path.with_suffix(".tmp")
        temporary.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        temporary.replace(self.config_path)

    def _clear_old_spool(self) -> None:
        cutoff = time.time() - 24 * 60 * 60
        for path in self.spool_dir.glob("*"):
            try:
                if path.is_file() and path.stat().st_mtime < cutoff:
                    path.unlink()
            except OSError:
                pass

    def add_listener(self, callback: Callable[[dict[str, Any]], None]) -> None:
        self._listeners.append(callback)

    def _notify(self) -> None:
        snapshot = self.snapshot()
        for listener in list(self._listeners):
            try:
                listener(snapshot)
            except Exception:
                pass

    def start(self) -> "FileDropService":
        if self._httpd is not None:
            return self
        handler = self._make_handler()
        self._httpd = ThreadingHTTPServer((self.bind_host, self.service_port), handler)
        self._httpd.daemon_threads = True
        self.service_port = int(self._httpd.server_address[1])
        self._start_thread(self._httpd.serve_forever, "filedrop-http")
        if self.enable_discovery:
            self._start_thread(self._discovery_listener, "filedrop-discovery")
            self._start_thread(self._announcement_loop, "filedrop-announcer")
        self._start_thread(self._cleanup_loop, "filedrop-cleanup")
        return self

    def stop(self) -> None:
        self._stop.set()
        if self._httpd is not None:
            self._httpd.shutdown()
            self._httpd.server_close()
            self._httpd = None
        for thread in list(self._threads):
            thread.join(timeout=2)

    def _start_thread(self, target: Callable[[], None], name: str) -> None:
        thread = threading.Thread(target=target, name=name, daemon=True)
        self._threads.append(thread)
        thread.start()

    def set_enabled(self, enabled: bool) -> None:
        self.enabled = bool(enabled)
        if not self.enabled:
            with self._lock:
                self.peers.clear()
        self._save_config()
        self._notify()

    def set_name(self, name: str) -> None:
        cleaned = " ".join(str(name).split())[:80]
        if cleaned:
            self.name = cleaned
            self._save_config()
            self._notify()

    def snapshot(self) -> dict[str, Any]:
        now = time.time()
        with self._lock:
            peers = [
                {"id": peer.id, "name": peer.name, "platform": peer.platform, "seen": peer.seen}
                for peer in self.peers.values()
                if now - peer.seen <= PEER_TIMEOUT_SECONDS
            ]
            transfers = [self._public_transfer(item) for item in self.transfers.values()]
        peers.sort(key=lambda item: item["name"].lower())
        transfers.sort(key=lambda item: item.get("updated", 0), reverse=True)
        return {
            "protocol": PROTOCOL,
            "enabled": self.enabled,
            "device": {"id": self.device_id, "name": self.name, "platform": self.platform},
            "peers": peers,
            "transfers": transfers[:100],
            "downloads": str(self.downloads_dir),
            "servicePort": self.service_port,
        }

    @staticmethod
    def _public_transfer(item: dict[str, Any]) -> dict[str, Any]:
        allowed = {
            "id", "direction", "name", "size", "sizeText", "sha256", "state", "progress",
            "peerId", "peerName", "peerPlatform", "error", "created", "updated",
        }
        return {key: value for key, value in item.items() if key in allowed}

    def _announcement(self) -> bytes:
        return json.dumps(
            {
                "protocol": PROTOCOL,
                "kind": "announce",
                "id": self.device_id,
                "name": self.name,
                "platform": self.platform,
                "port": self.service_port,
                "token": self.session_token,
            },
            separators=(",", ":"),
        ).encode("utf-8")

    def _announcement_loop(self) -> None:
        while not self._stop.is_set():
            if self.enabled:
                payload = self._announcement()
                try:
                    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
                        sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
                        sock.sendto(payload, ("255.255.255.255", self.discovery_port))
                except OSError:
                    pass
            self._stop.wait(ANNOUNCE_SECONDS)

    def _discovery_listener(self) -> None:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        if hasattr(socket, "SO_REUSEPORT"):
            try:
                sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, 1)
            except OSError:
                pass
        try:
            sock.bind(("", self.discovery_port))
            sock.settimeout(1.0)
            while not self._stop.is_set():
                try:
                    payload, address = sock.recvfrom(8192)
                except socket.timeout:
                    continue
                except OSError:
                    break
                self._register_announcement(payload, address[0])
        finally:
            sock.close()

    def _register_announcement(self, payload: bytes, host: str) -> None:
        if not self.enabled:
            return
        try:
            data = json.loads(payload.decode("utf-8"))
            if data.get("protocol") != PROTOCOL or data.get("kind") != "announce":
                return
            peer_id = str(data["id"])
            if peer_id == self.device_id:
                return
            peer = Peer(
                id=peer_id,
                name=" ".join(str(data.get("name") or "FileDrop device").split())[:80],
                platform=" ".join(str(data.get("platform") or "Computer").split())[:40],
                host=host,
                port=int(data["port"]),
                token=str(data["token"]),
                seen=time.time(),
            )
            if not 1 <= peer.port <= 65535 or len(peer.token) < 20:
                return
            with self._lock:
                self.peers[peer.id] = peer
            self._notify()
        except (KeyError, TypeError, ValueError, UnicodeError):
            return

    def _cleanup_loop(self) -> None:
        while not self._stop.wait(2.0):
            now = time.time()
            changed = False
            with self._lock:
                stale = [key for key, peer in self.peers.items() if now - peer.seen > PEER_TIMEOUT_SECONDS]
                for key in stale:
                    self.peers.pop(key, None)
                    changed = True
                for transfer in self.transfers.values():
                    if transfer["state"] == "pending" and now - transfer["created"] > OFFER_TIMEOUT_SECONDS:
                        transfer["state"] = "expired"
                        transfer["updated"] = now
                        changed = True
            if changed:
                self._notify()

    def accept(self, transfer_id: str) -> bool:
        with self._lock:
            transfer = self.transfers.get(transfer_id)
            if not transfer or transfer.get("direction") != "incoming" or transfer.get("state") != "pending":
                return False
            transfer["state"] = "accepted"
            transfer["updated"] = time.time()
        self._notify()
        return True

    def reject(self, transfer_id: str) -> bool:
        with self._lock:
            transfer = self.transfers.get(transfer_id)
            if not transfer or transfer.get("direction") != "incoming" or transfer.get("state") != "pending":
                return False
            transfer["state"] = "rejected"
            transfer["updated"] = time.time()
        self._notify()
        return True

    def queue_file(self, peer_id: str, path: Path | str, delete_after: bool = False) -> str:
        path = Path(path)
        if not path.is_file():
            raise FileNotFoundError(path)
        size = path.stat().st_size
        if size > MAX_FILE_BYTES:
            raise ValueError("File is larger than the 10 GB FileDrop limit")
        with self._lock:
            peer = self.peers.get(peer_id)
            if peer is None or time.time() - peer.seen > PEER_TIMEOUT_SECONDS:
                raise ValueError("That device is no longer available")
            transfer_id = uuid.uuid4().hex
            self.transfers[transfer_id] = {
                "id": transfer_id,
                "direction": "outgoing",
                "name": safe_filename(path.name),
                "size": size,
                "sizeText": human_size(size),
                "sha256": "",
                "state": "preparing",
                "progress": 0,
                "peerId": peer.id,
                "peerName": peer.name,
                "peerPlatform": peer.platform,
                "path": str(path),
                "error": "",
                "created": time.time(),
                "updated": time.time(),
                "deleteAfter": bool(delete_after),
            }
        self._start_thread(lambda: self._send_file(transfer_id, path, peer), f"filedrop-send-{transfer_id[:8]}")
        self._notify()
        return transfer_id

    def spool_bytes(self, peer_id: str, filename: str, stream: Any, size: int) -> str:
        if size < 0 or size > MAX_FILE_BYTES:
            raise ValueError("Invalid file size")
        path = self.spool_dir / f"{uuid.uuid4().hex}-{safe_filename(filename)}"
        remaining = size
        with path.open("wb") as output:
            while remaining:
                chunk = stream.read(min(CHUNK_BYTES, remaining))
                if not chunk:
                    raise ValueError("The uploaded file ended early")
                output.write(chunk)
                remaining -= len(chunk)
        return self.queue_file(peer_id, path, delete_after=True)

    def _set_transfer(self, transfer_id: str, **updates: Any) -> None:
        with self._lock:
            transfer = self.transfers.get(transfer_id)
            if transfer is None:
                return
            transfer.update(updates)
            transfer["updated"] = time.time()
        self._notify()

    def _send_file(self, transfer_id: str, path: Path, peer: Peer) -> None:
        try:
            digest = sha256_file(path)
            self._set_transfer(transfer_id, state="waiting", sha256=digest, progress=0)
            metadata = {
                "name": safe_filename(path.name),
                "size": path.stat().st_size,
                "sha256": digest,
                "sender": {"id": self.device_id, "name": self.name, "platform": self.platform},
            }
            response = self._json_request(peer, "POST", "/v1/offers", metadata)
            remote_id = str(response["id"])
            upload_token = str(response["uploadToken"])
            deadline = time.time() + OFFER_TIMEOUT_SECONDS
            while time.time() < deadline and not self._stop.is_set():
                status = self._json_request(peer, "GET", f"/v1/transfers/{quote(remote_id)}?uploadToken={quote(upload_token)}")
                state = status.get("state")
                if state == "accepted":
                    break
                if state in {"rejected", "expired", "cancelled", "failed"}:
                    self._set_transfer(transfer_id, state=str(state), error=str(status.get("error") or ""))
                    return
                time.sleep(0.45)
            else:
                self._set_transfer(transfer_id, state="expired", error="The receiver did not answer in time")
                return
            self._set_transfer(transfer_id, state="sending")
            self._upload(peer, remote_id, upload_token, transfer_id, path, digest)
            self._set_transfer(transfer_id, state="complete", progress=100)
        except (OSError, ValueError, KeyError, HTTPError, URLError, TimeoutError) as error:
            self._set_transfer(transfer_id, state="failed", error=str(error))
        finally:
            with self._lock:
                transfer = self.transfers.get(transfer_id, {})
                delete_after = bool(transfer.get("deleteAfter"))
            if delete_after:
                try:
                    path.unlink()
                except OSError:
                    pass

    def _json_request(self, peer: Peer, method: str, path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        data = None if payload is None else json.dumps(payload).encode("utf-8")
        request = Request(
            f"http://{peer.host}:{peer.port}{path}",
            data=data,
            method=method,
            headers={"Authorization": f"Bearer {peer.token}", "Content-Type": "application/json"},
        )
        with urlopen(request, timeout=6) as response:
            body = response.read(1024 * 1024)
        result = json.loads(body.decode("utf-8"))
        if not isinstance(result, dict):
            raise ValueError("Invalid response from FileDrop device")
        return result

    def _upload(self, peer: Peer, remote_id: str, upload_token: str, local_id: str, path: Path, digest: str) -> None:
        size = path.stat().st_size
        connection = http.client.HTTPConnection(peer.host, peer.port, timeout=30)
        route = f"/v1/transfers/{quote(remote_id)}/content"
        connection.putrequest("PUT", route)
        connection.putheader("Authorization", f"Bearer {upload_token}")
        connection.putheader("Content-Type", "application/octet-stream")
        connection.putheader("Content-Length", str(size))
        connection.putheader("X-File-Name", quote(safe_filename(path.name)))
        connection.putheader("X-File-Sha256", digest)
        connection.endheaders()
        sent = 0
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(CHUNK_BYTES), b""):
                connection.send(chunk)
                sent += len(chunk)
                progress = 100 if size == 0 else min(99, int(sent * 100 / size))
                self._set_transfer(local_id, progress=progress)
        response = connection.getresponse()
        body = response.read(1024 * 1024)
        connection.close()
        if response.status != 200:
            try:
                message = json.loads(body.decode("utf-8")).get("error")
            except (ValueError, UnicodeError):
                message = None
            raise OSError(message or f"Receiver returned HTTP {response.status}")

    def _make_handler(self) -> type[BaseHTTPRequestHandler]:
        service = self

        class Handler(BaseHTTPRequestHandler):
            server_version = "A-OS FileDrop/1"

            def log_message(self, _format: str, *args: Any) -> None:
                return

            def _origin_allowed(self) -> bool:
                origin = self.headers.get("Origin", "")
                if not origin:
                    return True
                try:
                    parsed = urlparse(origin)
                except ValueError:
                    return False
                return parsed.hostname in {
                    "127.0.0.1",
                    "localhost",
                    "a-os-desktop.web.app",
                    "aapps2025a-hue.github.io",
                }

            def _cors(self) -> None:
                origin = self.headers.get("Origin", "")
                if origin and self._origin_allowed():
                    self.send_header("Access-Control-Allow-Origin", origin)
                    self.send_header("Vary", "Origin")
                self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-File-Name, X-File-Sha256")
                self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
                self.send_header("Access-Control-Allow-Private-Network", "true")

            def _json(self, status: int, payload: dict[str, Any]) -> None:
                data = json.dumps(payload, separators=(",", ":")).encode("utf-8")
                self.send_response(status)
                self._cors()
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(data)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(data)

            def _read_json(self, maximum: int = 1024 * 1024) -> dict[str, Any]:
                length = int(self.headers.get("Content-Length", "0"))
                if length < 0 or length > maximum:
                    raise ValueError("Request is too large")
                data = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
                if not isinstance(data, dict):
                    raise ValueError("JSON object required")
                return data

            def _bearer(self) -> str:
                value = self.headers.get("Authorization", "")
                return value[7:] if value.startswith("Bearer ") else ""

            def _is_local(self) -> bool:
                try:
                    return ipaddress.ip_address(self.client_address[0]).is_loopback
                except ValueError:
                    return self.client_address[0] in {"127.0.0.1", "::1"}

            def _require_public(self) -> bool:
                if not service.enabled:
                    self._json(503, {"error": "FileDrop is disabled"})
                    return False
                if not secrets.compare_digest(self._bearer(), service.session_token):
                    self._json(401, {"error": "Invalid FileDrop token"})
                    return False
                return True

            def _require_local(self) -> bool:
                if not self._is_local() or not self._origin_allowed():
                    self._json(403, {"error": "Local A-OS access only"})
                    return False
                return True

            def do_OPTIONS(self) -> None:
                if not self._origin_allowed():
                    self.send_error(403)
                    return
                self.send_response(204)
                self._cors()
                self.send_header("Content-Length", "0")
                self.end_headers()

            def do_GET(self) -> None:
                parsed = urlparse(self.path)
                parts = [unquote(part) for part in parsed.path.split("/") if part]
                if parsed.path == "/api/state":
                    if self._require_local():
                        self._json(200, service.snapshot())
                    return
                if len(parts) == 4 and parts[:2] == ["api", "transfers"] and parts[3] == "content":
                    if not self._require_local():
                        return
                    with service._lock:
                        transfer = service.transfers.get(parts[2])
                        path = Path(str(transfer.get("path", ""))) if transfer else None
                        valid = bool(
                            transfer
                            and transfer.get("direction") == "incoming"
                            and transfer.get("state") == "complete"
                            and path
                            and path.is_file()
                        )
                    if not valid or transfer is None or path is None:
                        self._json(404, {"error": "Received file not found"})
                        return
                    self.send_response(200)
                    self._cors()
                    self.send_header("Content-Type", "application/octet-stream")
                    self.send_header("Content-Length", str(path.stat().st_size))
                    self.send_header("Content-Disposition", "attachment; filename*=UTF-8''" + quote(path.name))
                    self.send_header("Cache-Control", "no-store")
                    self.end_headers()
                    with path.open("rb") as stream:
                        shutil.copyfileobj(stream, self.wfile, length=CHUNK_BYTES)
                    return
                if parsed.path == "/v1/ping":
                    if self._require_public():
                        self._json(200, {"protocol": PROTOCOL, "id": service.device_id, "name": service.name})
                    return
                if len(parts) == 3 and parts[:2] == ["v1", "transfers"]:
                    if not self._require_public():
                        return
                    transfer_id = parts[2]
                    supplied = parse_qs(parsed.query).get("uploadToken", [""])[0]
                    with service._lock:
                        transfer = service.transfers.get(transfer_id)
                        if not transfer or not secrets.compare_digest(str(transfer.get("uploadToken", "")), supplied):
                            self._json(404, {"error": "Transfer not found"})
                            return
                        self._json(200, service._public_transfer(transfer))
                    return
                self._json(404, {"error": "Not found"})

            def do_POST(self) -> None:
                parsed = urlparse(self.path)
                parts = [unquote(part) for part in parsed.path.split("/") if part]
                try:
                    if parsed.path == "/v1/offers":
                        if not self._require_public():
                            return
                        data = self._read_json()
                        size = int(data.get("size", -1))
                        digest = str(data.get("sha256", "")).lower()
                        sender = data.get("sender") if isinstance(data.get("sender"), dict) else {}
                        if size < 0 or size > MAX_FILE_BYTES or len(digest) != 64:
                            raise ValueError("Invalid file metadata")
                        transfer_id = uuid.uuid4().hex
                        upload_token = secrets.token_urlsafe(32)
                        now = time.time()
                        transfer = {
                            "id": transfer_id,
                            "direction": "incoming",
                            "name": safe_filename(str(data.get("name") or "Received file")),
                            "size": size,
                            "sizeText": human_size(size),
                            "sha256": digest,
                            "state": "pending",
                            "progress": 0,
                            "peerId": str(sender.get("id") or ""),
                            "peerName": " ".join(str(sender.get("name") or "Another device").split())[:80],
                            "peerPlatform": " ".join(str(sender.get("platform") or "Computer").split())[:40],
                            "path": "",
                            "error": "",
                            "created": now,
                            "updated": now,
                            "uploadToken": upload_token,
                        }
                        with service._lock:
                            service.transfers[transfer_id] = transfer
                        service._notify()
                        self._json(201, {"id": transfer_id, "uploadToken": upload_token, "state": "pending"})
                        return
                    if parsed.path == "/api/enable":
                        if not self._require_local():
                            return
                        service.set_enabled(bool(self._read_json().get("enabled")))
                        self._json(200, service.snapshot())
                        return
                    if parsed.path == "/api/name":
                        if not self._require_local():
                            return
                        service.set_name(str(self._read_json().get("name") or ""))
                        self._json(200, service.snapshot())
                        return
                    if len(parts) == 3 and parts[:2] == ["api", "accept"]:
                        if self._require_local():
                            ok = service.accept(parts[2])
                            self._json(200 if ok else 409, {"ok": ok})
                        return
                    if len(parts) == 3 and parts[:2] == ["api", "reject"]:
                        if self._require_local():
                            ok = service.reject(parts[2])
                            self._json(200 if ok else 409, {"ok": ok})
                        return
                    if len(parts) == 3 and parts[:2] == ["api", "send"]:
                        if not self._require_local():
                            return
                        size = int(self.headers.get("Content-Length", "-1"))
                        filename = self.headers.get("X-File-Name", "Received file")
                        transfer_id = service.spool_bytes(parts[2], unquote(filename), self.rfile, size)
                        self._json(202, {"id": transfer_id})
                        return
                except (ValueError, UnicodeError, json.JSONDecodeError) as error:
                    self._json(400, {"error": str(error)})
                    return
                except OSError as error:
                    self._json(500, {"error": str(error)})
                    return
                self._json(404, {"error": "Not found"})

            def do_PUT(self) -> None:
                parsed = urlparse(self.path)
                parts = [unquote(part) for part in parsed.path.split("/") if part]
                if len(parts) != 4 or parts[:2] != ["v1", "transfers"] or parts[3] != "content":
                    self._json(404, {"error": "Not found"})
                    return
                transfer_id = parts[2]
                partial: Path | None = None
                with service._lock:
                    transfer = service.transfers.get(transfer_id)
                    valid = bool(
                        transfer
                        and transfer.get("state") == "accepted"
                        and secrets.compare_digest(self._bearer(), str(transfer.get("uploadToken", "")))
                    )
                if not valid or transfer is None:
                    self._json(409, {"error": "Transfer is not accepted"})
                    return
                try:
                    size = int(self.headers.get("Content-Length", "-1"))
                    if size != int(transfer["size"]):
                        raise ValueError("File size does not match the offer")
                    digest_header = self.headers.get("X-File-Sha256", "").lower()
                    if digest_header != transfer["sha256"]:
                        raise ValueError("File checksum does not match the offer")
                    destination = unique_path(service.downloads_dir, transfer["name"])
                    partial = destination.with_suffix(destination.suffix + ".part")
                    digest = hashlib.sha256()
                    remaining = size
                    service._set_transfer(transfer_id, state="receiving", progress=0)
                    with partial.open("wb") as output:
                        while remaining:
                            chunk = self.rfile.read(min(CHUNK_BYTES, remaining))
                            if not chunk:
                                raise ValueError("File transfer ended early")
                            output.write(chunk)
                            digest.update(chunk)
                            remaining -= len(chunk)
                            progress = 100 if size == 0 else min(99, int((size - remaining) * 100 / size))
                            service._set_transfer(transfer_id, progress=progress)
                    if digest.hexdigest() != transfer["sha256"]:
                        partial.unlink(missing_ok=True)
                        raise ValueError("File verification failed")
                    partial.replace(destination)
                    service._set_transfer(transfer_id, state="complete", progress=100, path=str(destination))
                    self._json(200, {"ok": True, "name": destination.name})
                except (OSError, ValueError) as error:
                    if partial is not None:
                        try:
                            partial.unlink(missing_ok=True)
                        except OSError:
                            pass
                    service._set_transfer(transfer_id, state="failed", error=str(error))
                    self._json(400, {"error": str(error)})

        return Handler


def run_service(args: argparse.Namespace) -> int:
    service = FileDropService(
        state_dir=args.state_dir,
        downloads_dir=args.downloads,
        name=args.name,
        service_port=args.port,
        discovery_port=args.discovery_port,
    ).start()
    print(f"A-OS FileDrop is ready on port {service.service_port}", flush=True)
    try:
        while True:
            time.sleep(60)
    except KeyboardInterrupt:
        service.stop()
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="A-OS FileDrop local-network service")
    parser.add_argument("--state-dir", type=Path, default=_default_state_dir())
    parser.add_argument("--downloads", type=Path, default=_default_downloads_dir())
    parser.add_argument("--name")
    parser.add_argument("--port", type=int, default=SERVICE_PORT)
    parser.add_argument("--discovery-port", type=int, default=DISCOVERY_PORT)
    return parser


if __name__ == "__main__":
    raise SystemExit(run_service(build_parser().parse_args()))
