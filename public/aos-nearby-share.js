(function () {
  "use strict";

  if (window.AOS_NEARBY_SHARE) return;

  var API_KEY = "AIzaSyDvqfC7dm1umT6pyftRJt2kF1d91uKF_DM";
  var FIRESTORE_PROJECT = "emojis-symbols-online";
  var FIRESTORE_ROOT = "https://firestore.googleapis.com/v1/projects/" + FIRESTORE_PROJECT + "/databases/(default)/documents";
  var SESSION_KEY = "aos-aapplications-session";
  var DEVICE_ID_KEY = "aos-nearby-device-id";
  var DEVICE_ID = safeStorageGet(DEVICE_ID_KEY) || makeId("device");
  var PAGE_ID = makeId("page");
  var CHANNEL_NAME = "aos-nearby-share-v1";
  var CHUNK_SIZE = 360000;
  var PRESENCE_TTL = 35000;
  var channel = "BroadcastChannel" in window ? new BroadcastChannel(CHANNEL_NAME) : null;
  var localPeers = new Map();
  var cloudPeers = new Map();
  var receivedTransfers = new Set();
  var selectedFile = null;
  var modal = null;
  var deviceList = null;
  var statusLine = null;
  var refreshTimer = 0;
  var heartbeatTimer = 0;
  var inboxTimer = 0;

  safeStorageSet(DEVICE_ID_KEY, DEVICE_ID);

  function safeStorageGet(key) {
    try { return localStorage.getItem(key); } catch (_) { return null; }
  }

  function safeStorageSet(key, value) {
    try { localStorage.setItem(key, value); return true; } catch (_) { return false; }
  }

  function makeId(prefix) {
    var value = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
    return prefix + "-" + value;
  }

  function readSession() {
    try {
      var session = JSON.parse(safeStorageGet(SESSION_KEY) || "null");
      return session && session.idToken && session.refreshToken && session.uid ? session : null;
    } catch (_) {
      return null;
    }
  }

  async function currentSession() {
    var session = readSession();
    if (!session) return null;
    if (Number(session.expiresAt || 0) > Date.now() + 60000) return session;
    try {
      var response = await fetch("https://securetoken.googleapis.com/v1/token?key=" + API_KEY, {
        method: "POST",
        headers: {"content-type": "application/x-www-form-urlencoded"},
        body: new URLSearchParams({grant_type: "refresh_token", refresh_token: session.refreshToken})
      });
      var result = await response.json();
      if (!response.ok || !result.id_token) return null;
      session = {
        idToken: result.id_token,
        refreshToken: result.refresh_token || session.refreshToken,
        uid: result.user_id || session.uid,
        email: session.email,
        expiresAt: Date.now() + Number(result.expires_in || 3600) * 1000
      };
      safeStorageSet(SESSION_KEY, JSON.stringify(session));
      return session;
    } catch (_) {
      return null;
    }
  }

  function deviceName() {
    return safeStorageGet("aos-device") || "A-OS Computer";
  }

  function profileName() {
    return safeStorageGet("aos-profile") || "Person";
  }

  function notification(message) {
    window.dispatchEvent(new CustomEvent("aos-notification", {detail: {message: message}}));
  }

  function firestoreValue(value) {
    if (typeof value === "number") return {integerValue: String(Math.round(value))};
    return {stringValue: String(value)};
  }

  function documentBody(payload, uid) {
    return {
      fields: {
        ownerUid: firestoreValue(uid),
        payload: firestoreValue(JSON.stringify(payload)),
        updatedAt: firestoreValue(Date.now())
      }
    };
  }

  function decodeDocument(document) {
    try {
      var fields = document.fields || {};
      var payload = JSON.parse(fields.payload && fields.payload.stringValue || "{}");
      payload.__documentName = document.name;
      payload.__updatedAt = Number(fields.updatedAt && (fields.updatedAt.integerValue || fields.updatedAt.doubleValue) || 0);
      return payload;
    } catch (_) {
      return null;
    }
  }

  async function firebaseRequest(path, options) {
    var session = await currentSession();
    if (!session) throw new Error("Sign in with A-Applications to find another A-OS device.");
    var response = await fetch(FIRESTORE_ROOT + path, Object.assign({}, options, {
      headers: Object.assign({}, options && options.headers, {authorization: "Bearer " + session.idToken})
    }));
    if (!response.ok) {
      var detail = await response.json().catch(function () { return null; });
      throw new Error(detail && detail.error && detail.error.message || "Nearby Share could not reach Firebase.");
    }
    return response;
  }

  function devicePath(uid, deviceId) {
    return "/aosNearbyUsers/" + encodeURIComponent(uid) + "/devices/" + encodeURIComponent(deviceId);
  }

  function inboxPath(uid, deviceId, transferId) {
    return devicePath(uid, deviceId) + "/inbox/" + encodeURIComponent(transferId);
  }

  async function writeDocument(path, payload, uid) {
    await firebaseRequest(path, {
      method: "PATCH",
      headers: {"content-type": "application/json"},
      body: JSON.stringify(documentBody(payload, uid))
    });
  }

  async function deleteDocument(path) {
    await firebaseRequest(path, {method: "DELETE"});
  }

  async function listDocuments(path) {
    var response = await firebaseRequest(path + (path.indexOf("?") === -1 ? "?" : "&") + "pageSize=100", {method: "GET"});
    var result = await response.json();
    return (result.documents || []).map(decodeDocument).filter(Boolean);
  }

  async function announceCloud() {
    var session = await currentSession();
    if (!session) return;
    await writeDocument(devicePath(session.uid, DEVICE_ID), {
      deviceId: DEVICE_ID,
      name: deviceName(),
      profile: profileName(),
      updatedAt: Date.now(),
      online: true
    }, session.uid);
  }

  function announceLocal() {
    if (!channel) return;
    channel.postMessage({
      type: "AOS_NEARBY_HELLO",
      pageId: PAGE_ID,
      deviceId: DEVICE_ID,
      name: deviceName(),
      profile: profileName(),
      updatedAt: Date.now()
    });
  }

  async function discoverCloud() {
    var session = await currentSession();
    cloudPeers.clear();
    if (!session) return [];
    var devices = await listDocuments("/aosNearbyUsers/" + encodeURIComponent(session.uid) + "/devices");
    var now = Date.now();
    devices.forEach(function (device) {
      if (device.deviceId && device.deviceId !== DEVICE_ID && now - Number(device.updatedAt || device.__updatedAt) < PRESENCE_TTL) {
        cloudPeers.set(device.deviceId, device);
      }
    });
    return Array.from(cloudPeers.values());
  }

  function activeLocalPeers() {
    var now = Date.now();
    return Array.from(localPeers.values()).filter(function (peer) {
      return peer.deviceId !== DEVICE_ID && now - peer.updatedAt < PRESENCE_TTL;
    });
  }

  function prepareFile(file, transferId) {
    var clean = Object.assign({}, file, {
      id: makeId("nearby-file"),
      parent: "downloads",
      __nearbyTransferId: transferId
    });
    delete clean.__trashId;
    delete clean.__sourceKey;
    delete clean.__deletedAt;
    delete clean.__originalParent;
    return clean;
  }

  function uniqueFileName(file) {
    var files;
    try { files = JSON.parse(safeStorageGet("aos-files") || "[]"); } catch (_) { files = []; }
    if (!Array.isArray(files)) files = [];
    var used = new Set(files.filter(function (entry) { return entry.parent === "downloads"; }).map(function (entry) { return String(entry.name || "").toLowerCase(); }));
    if (!used.has(String(file.name || "").toLowerCase())) return file.name;
    var name = String(file.name || "Received file");
    var dot = name.lastIndexOf(".");
    var base = dot > 0 ? name.slice(0, dot) : name;
    var extension = dot > 0 ? name.slice(dot) : "";
    var number = 2;
    while (used.has((base + " (" + number + ")" + extension).toLowerCase())) number += 1;
    return base + " (" + number + ")" + extension;
  }

  function receiveFile(file, sender, transferId) {
    if (!file || receivedTransfers.has(transferId)) return;
    receivedTransfers.add(transferId);
    var received = prepareFile(file, transferId);
    received.name = uniqueFileName(received);
    window.dispatchEvent(new CustomEvent("aos-nearby-file-received", {detail: {file: received}}));
    notification(received.name + " received from " + (sender || "A-OS") + " and saved in Downloads");
  }

  async function sendLocal(peer, file) {
    var transferId = makeId("transfer");
    channel.postMessage({
      type: "AOS_NEARBY_FILE",
      targetPageId: peer.pageId,
      transferId: transferId,
      sender: deviceName(),
      file: file
    });
    return transferId;
  }

  async function sendCloud(peer, file) {
    var session = await currentSession();
    if (!session) throw new Error("Sign in with A-Applications before sending a file.");
    var transferId = makeId("transfer");
    var serialized = JSON.stringify(file);
    var chunks = [];
    for (var offset = 0; offset < serialized.length; offset += CHUNK_SIZE) chunks.push(serialized.slice(offset, offset + CHUNK_SIZE));
    for (var index = 0; index < chunks.length; index += 1) {
      await writeDocument(inboxPath(session.uid, peer.deviceId, transferId) + "/chunks/" + String(index).padStart(5, "0"), {
        index: index,
        data: chunks[index]
      }, session.uid);
    }
    await writeDocument(inboxPath(session.uid, peer.deviceId, transferId), {
      transferId: transferId,
      senderDeviceId: DEVICE_ID,
      sender: deviceName(),
      fileName: file.name || "Received file",
      chunkCount: chunks.length,
      createdAt: Date.now(),
      status: "pending"
    }, session.uid);
    return transferId;
  }

  async function pollInbox() {
    var session = await currentSession();
    if (!session) return;
    try {
      var entries = await listDocuments(devicePath(session.uid, DEVICE_ID) + "/inbox");
      for (var index = 0; index < entries.length; index += 1) {
        var entry = entries[index];
        if (!entry.transferId || entry.status !== "pending" || receivedTransfers.has(entry.transferId)) continue;
        var chunks = await listDocuments(inboxPath(session.uid, DEVICE_ID, entry.transferId) + "/chunks");
        chunks.sort(function (left, right) { return Number(left.index) - Number(right.index); });
        if (chunks.length !== Number(entry.chunkCount)) continue;
        var file = JSON.parse(chunks.map(function (chunk) { return chunk.data || ""; }).join(""));
        receiveFile(file, entry.sender, entry.transferId);
        entry.status = "received";
        entry.receivedAt = Date.now();
        await writeDocument(inboxPath(session.uid, DEVICE_ID, entry.transferId), entry, session.uid);
        break;
      }
    } catch (_) {}
  }

  function renderDevices() {
    if (!deviceList) return;
    var local = activeLocalPeers().map(function (peer) { return Object.assign({transport: "local"}, peer); });
    var cloud = Array.from(cloudPeers.values()).map(function (peer) { return Object.assign({transport: "cloud"}, peer); });
    var merged = [];
    var ids = new Set();
    local.concat(cloud).forEach(function (peer) {
      var key = peer.deviceId || peer.pageId;
      if (!ids.has(key)) { ids.add(key); merged.push(peer); }
    });
    deviceList.innerHTML = "";
    if (!merged.length) {
      var empty = document.createElement("p");
      empty.className = "aos-nearby-empty";
      empty.textContent = readSession() ? "Looking for active A-OS devices..." : "Sign in with A-Applications on both devices.";
      deviceList.appendChild(empty);
      return;
    }
    merged.forEach(function (peer) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "aos-nearby-device";
      button.innerHTML = '<img src="/assets/icons/PC.png" alt=""><span><b></b><small></small></span><i>Send</i>';
      button.querySelector("b").textContent = peer.name || "A-OS device";
      button.querySelector("small").textContent = peer.profile || "A-OS";
      button.addEventListener("click", function () { sendToPeer(peer); });
      deviceList.appendChild(button);
    });
  }

  async function refreshDevices() {
    announceLocal();
    try {
      await announceCloud();
      await discoverCloud();
      if (statusLine) statusLine.textContent = "Devices signed in to the same A-Applications account";
    } catch (error) {
      if (statusLine) statusLine.textContent = error.message;
    }
    renderDevices();
  }

  async function sendToPeer(peer) {
    if (!selectedFile) return;
    var buttons = deviceList.querySelectorAll("button");
    buttons.forEach(function (button) { button.disabled = true; });
    if (statusLine) statusLine.textContent = "Sending " + selectedFile.name + "...";
    try {
      if (peer.transport === "local") await sendLocal(peer, selectedFile);
      else await sendCloud(peer, selectedFile);
      notification(selectedFile.name + " sent to " + (peer.name || "A-OS device"));
      closeModal();
    } catch (error) {
      if (statusLine) statusLine.textContent = error.message || "The file could not be sent.";
      buttons.forEach(function (button) { button.disabled = false; });
    }
  }

  function ensureModal() {
    if (modal) return;
    var style = document.createElement("style");
    style.textContent = "#aos-nearby-modal{position:fixed;inset:0;z-index:10000000;display:grid;place-items:center;padding:20px;background:#02061799;backdrop-filter:blur(12px);font-family:Inter,system-ui,sans-serif}#aos-nearby-modal[hidden]{display:none}.aos-nearby-panel{width:min(440px,100%);max-height:min(620px,90vh);overflow:hidden;border:1px solid #ffffff29;border-radius:8px;background:#0f172af7;color:#f8fafc;box-shadow:0 28px 90px #0009}.aos-nearby-head{display:flex;align-items:center;gap:12px;padding:16px;border-bottom:1px solid #ffffff17}.aos-nearby-head>img{width:40px;height:40px;object-fit:contain}.aos-nearby-head span{min-width:0;flex:1}.aos-nearby-head h2{margin:0;font-size:17px;letter-spacing:0}.aos-nearby-head p{margin:2px 0 0;color:#94a3b8;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.aos-nearby-close{width:34px;height:34px;border:0;border-radius:6px;background:#ffffff0f;color:#cbd5e1;font-size:22px;cursor:pointer}.aos-nearby-close:hover{background:#ef4444;color:white}.aos-nearby-list{display:grid;gap:8px;min-height:130px;max-height:380px;overflow:auto;padding:14px}.aos-nearby-device{display:flex;align-items:center;gap:12px;width:100%;min-height:62px;padding:10px;border:1px solid #334155;border-radius:7px;background:#172033;color:white;text-align:left;cursor:pointer}.aos-nearby-device:hover{border-color:#38bdf8;background:#172a42}.aos-nearby-device:disabled{opacity:.55;cursor:wait}.aos-nearby-device img{width:38px;height:38px;object-fit:contain}.aos-nearby-device span{display:grid;min-width:0;flex:1}.aos-nearby-device b{font-size:13px}.aos-nearby-device small{color:#94a3b8}.aos-nearby-device i{font-style:normal;font-size:11px;font-weight:800;color:#7dd3fc}.aos-nearby-empty{margin:auto;color:#94a3b8;font-size:13px;text-align:center}.aos-nearby-status{margin:0;padding:11px 16px;border-top:1px solid #ffffff17;color:#94a3b8;background:#0206174d;font-size:11px}";
    document.head.appendChild(style);
    modal = document.createElement("div");
    modal.id = "aos-nearby-modal";
    modal.hidden = true;
    modal.innerHTML = '<section class="aos-nearby-panel" role="dialog" aria-modal="true" aria-labelledby="aos-nearby-title"><header class="aos-nearby-head"><img src="/assets/icons/Files.png" alt=""><span><h2 id="aos-nearby-title">Nearby Share</h2><p data-nearby-file></p></span><button type="button" class="aos-nearby-close" aria-label="Close">×</button></header><main class="aos-nearby-list"></main><p class="aos-nearby-status"></p></section>';
    document.body.appendChild(modal);
    deviceList = modal.querySelector(".aos-nearby-list");
    statusLine = modal.querySelector(".aos-nearby-status");
    modal.querySelector(".aos-nearby-close").addEventListener("click", closeModal);
    modal.addEventListener("click", function (event) { if (event.target === modal) closeModal(); });
  }

  function openModal(file) {
    if (!file || file.type !== "file") return;
    ensureModal();
    selectedFile = file;
    modal.querySelector("[data-nearby-file]").textContent = file.name || "A-OS file";
    modal.hidden = false;
    refreshDevices();
    clearInterval(refreshTimer);
    refreshTimer = setInterval(refreshDevices, 5000);
  }

  function closeModal() {
    if (modal) modal.hidden = true;
    selectedFile = null;
    clearInterval(refreshTimer);
    refreshTimer = 0;
  }

  function start() {
    announceLocal();
    announceCloud().catch(function () {});
    pollInbox();
    heartbeatTimer = setInterval(function () {
      announceLocal();
      announceCloud().catch(function () {});
    }, 10000);
    inboxTimer = setInterval(pollInbox, 5000);
  }

  if (channel) {
    channel.addEventListener("message", function (event) {
      var data = event.data;
      if (!data || data.pageId === PAGE_ID) return;
      if (data.type === "AOS_NEARBY_HELLO") {
        localPeers.set(data.pageId, data);
        renderDevices();
      }
      if (data.type === "AOS_NEARBY_FILE" && data.targetPageId === PAGE_ID) {
        receiveFile(data.file, data.sender, data.transferId);
      }
    });
  }

  window.addEventListener("aos-nearby-send", function (event) {
    openModal(event.detail && event.detail.file);
  });
  window.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && modal && !modal.hidden) closeModal();
  });
  window.addEventListener("beforeunload", function () {
    clearInterval(heartbeatTimer);
    clearInterval(inboxTimer);
    if (channel) channel.close();
    var session = readSession();
    if (session) {
      fetch(FIRESTORE_ROOT + devicePath(session.uid, DEVICE_ID), {
        method: "DELETE",
        headers: {authorization: "Bearer " + session.idToken},
        keepalive: true
      }).catch(function () {});
    }
  });

  window.AOS_NEARBY_SHARE = {
    open: openModal,
    refresh: refreshDevices,
    deviceId: DEVICE_ID
  };
  document.documentElement.dataset.aosNearbyShare = "ready";

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, {once: true});
  else start();
})();
