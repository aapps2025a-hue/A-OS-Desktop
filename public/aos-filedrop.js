(function () {
  "use strict";

  if (window.AOS_FILEDROP) return;

  var SERVICE = "http://127.0.0.1:45872";
  var BROWSER_STATE_KEY = "aos-filedrop-browser-state";
  var ICON = "./assets/icons/FileDrop.svg";
  var state = null;
  var windowElement = null;
  var mainElement = null;
  var statusElement = null;
  var enabledInput = null;
  var nameInput = null;
  var taskbarButton = null;
  var selectedPeer = "";
  var selectedFiles = new Set();
  var pollTimer = 0;
  var notifiedOffers = new Set();
  var notifiedComplete = new Set();

  function readBrowserSettings() {
    var fallbackName = "A-OS Computer";
    try {
      var raw = localStorage.getItem(BROWSER_STATE_KEY);
      var saved = JSON.parse(raw || "{}");
      return {
        enabled: raw === null ? true : saved.enabled !== false,
        name: String(saved.name || fallbackName).slice(0, 80)
      };
    } catch (_) {
      return {enabled: false, name: fallbackName};
    }
  }

  function saveBrowserSettings(changes) {
    var saved = Object.assign(readBrowserSettings(), changes || {});
    saved.enabled = Boolean(saved.enabled);
    saved.name = String(saved.name || "A-OS Computer").trim().slice(0, 80) || "A-OS Computer";
    try { localStorage.setItem(BROWSER_STATE_KEY, JSON.stringify(saved)); } catch (_) {}
    return saved;
  }

  function browserState() {
    var saved = readBrowserSettings();
    return {
      enabled: saved.enabled,
      device: {name: saved.name, platform: "A-OS Browser"},
      downloads: "A-OS Files > Downloads",
      peers: [],
      transfers: [],
      browserMode: true
    };
  }

  function parseFiles() {
    try {
      var value = JSON.parse(localStorage.getItem("aos-files") || "[]");
      return Array.isArray(value) ? value.filter(function (file) {
        return file && file.type !== "folder" && !file.__deletedAt && !/^os-/i.test(String(file.id || ""));
      }) : [];
    } catch (_) {
      return [];
    }
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (character) {
      return {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[character];
    });
  }

  function fileSize(file) {
    if (Number.isFinite(Number(file.size))) return Number(file.size);
    var content = String(file.content == null ? "" : file.content);
    if (/^data:/i.test(content)) {
      var comma = content.indexOf(",");
      if (comma >= 0) return Math.max(0, Math.floor((content.length - comma - 1) * .75));
    }
    return new Blob([content]).size;
  }

  function humanSize(bytes) {
    var value = Math.max(0, Number(bytes) || 0);
    var units = ["B", "KB", "MB", "GB"];
    var index = 0;
    while (value >= 1024 && index < units.length - 1) { value /= 1024; index += 1; }
    return (index ? value.toFixed(1) : Math.round(value)) + " " + units[index];
  }

  function uniqueAosName(name) {
    var files = parseFiles();
    var used = new Set(files.map(function (file) { return String(file.name || "").toLowerCase(); }));
    if (!used.has(String(name).toLowerCase())) return name;
    var dot = name.lastIndexOf(".");
    var base = dot > 0 ? name.slice(0, dot) : name;
    var extension = dot > 0 ? name.slice(dot) : "";
    var index = 2;
    while (used.has((base + " (" + index + ")" + extension).toLowerCase())) index += 1;
    return base + " (" + index + ")" + extension;
  }

  function blobDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || "")); };
      reader.onerror = function () { reject(reader.error || new Error("Could not read the received file.")); };
      reader.readAsDataURL(blob);
    });
  }

  async function importLocalFiles(fileList) {
    var incoming = Array.from(fileList || []).slice(0, 12);
    if (!incoming.length) return;
    var files = parseFiles();
    var added = [];
    for (var index = 0; index < incoming.length; index += 1) {
      var file = incoming[index];
      if (file.size > 15 * 1024 * 1024) {
        setStatus(file.name + " is larger than the 15 MB browser-transfer limit", true);
        continue;
      }
      var name = uniqueAosName(file.name || "Uploaded file");
      var stored = {
        id: crypto.randomUUID ? crypto.randomUUID() : "filedrop-upload-" + Date.now() + "-" + index,
        name: name,
        type: "file",
        parent: "downloads",
        content: await blobDataUrl(file),
        mime: file.type || "application/octet-stream",
        size: file.size,
        icon: /image\//i.test(file.type) ? "Images.png" : /video\//i.test(file.type) ? "Video.png" : /audio\//i.test(file.type) ? "Music.png" : "Downloads.png",
        fileDropSource: "This device"
      };
      files.push(stored);
      added.push(stored);
    }
    if (!added.length) return;
    try { localStorage.setItem("aos-files", JSON.stringify(files)); }
    catch (_) {
      setStatus("A-OS browser storage is full. Remove a large file and try again.", true);
      return;
    }
    added.forEach(function (file) { selectedFiles.add(String(file.id)); });
    window.dispatchEvent(new CustomEvent("aos-files-change"));
    setStatus(added.length === 1 ? added[0].name + " is ready to send" : added.length + " files are ready to send", false);
    notify(added.length === 1 ? added[0].name + " added to FileDrop" : added.length + " files added to FileDrop");
    render();
  }

  async function addReceivedToAos(transferId) {
    var transfer = state && (state.transfers || []).find(function (item) { return item.id === transferId; });
    if (!transfer) throw new Error("That received file is no longer available.");
    var response;
    try {
      response = await fetch(SERVICE + "/api/transfers/" + encodeURIComponent(transferId) + "/content", {cache: "no-store"});
    } catch (_) {
      throw new Error("FileDrop lost its connection to the desktop service. Reopen FileDrop on this device.");
    }
    if (!response.ok) throw new Error("The verified file could not be read from disk.");
    var blob = await response.blob();
    var dataUrl = await blobDataUrl(blob);
    var files;
    try { files = JSON.parse(localStorage.getItem("aos-files") || "[]"); } catch (_) { files = []; }
    if (!Array.isArray(files)) files = [];
    var name = uniqueAosName(transfer.name || "Received file");
    files.push({
      id: crypto.randomUUID ? crypto.randomUUID() : "filedrop-" + Date.now(),
      name: name,
      type: "file",
      parent: "downloads",
      content: dataUrl,
      mime: blob.type || "application/octet-stream",
      icon: "Downloads.png",
      fileDropSource: transfer.peerName || "FileDrop"
    });
    try { localStorage.setItem("aos-files", JSON.stringify(files)); }
    catch (_) { throw new Error("A-OS Files does not have enough browser storage. The file is still safe in FileDrop Downloads on disk."); }
    window.dispatchEvent(new CustomEvent("aos-files-change"));
    notify(name + " was added to A-OS Files > Downloads");
    setStatus(name + " added to A-OS Files", false);
  }

  function fileBlob(file) {
    var content = String(file.content == null ? "" : file.content);
    if (/^data:/i.test(content)) return fetch(content).then(function (response) { return response.blob(); });
    return Promise.resolve(new Blob([content], {type: file.mime || "application/octet-stream"}));
  }

  async function request(path, options) {
    var response;
    var controller = new AbortController();
    var timeout = window.setTimeout(function () { controller.abort(); }, 1400);
    try {
      response = await fetch(SERVICE + path, Object.assign({cache: "no-store", mode: "cors", signal: controller.signal}, options || {}));
    } catch (_) {
      var unavailable = new Error("The native FileDrop service is not running on this device.");
      unavailable.code = "FILEDROP_SERVICE_UNAVAILABLE";
      throw unavailable;
    } finally {
      clearTimeout(timeout);
    }
    var body = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(body.error || "FileDrop could not complete that action.");
    return body;
  }

  function setStatus(message, error) {
    if (!statusElement) return;
    statusElement.textContent = message || "";
    statusElement.dataset.error = error ? "true" : "false";
  }

  function notify(message) {
    window.dispatchEvent(new CustomEvent("aos-notification", {detail: {message: message}}));
  }

  function platformIcon(peer) {
    return /a-os/i.test(peer.platform) ? "./assets/icons/OS Logo.png" : "./assets/icons/PC.png";
  }

  function fileIcon(file) {
    if (/\.(?:png|jpe?g|gif|webp|svg)$/i.test(file.name || "")) return "./assets/icons/Images.png";
    if (/\.(?:mp4|mov|webm|mkv)$/i.test(file.name || "")) return "./assets/icons/Video.png";
    if (/\.(?:mp3|wav|ogg|m4a)$/i.test(file.name || "")) return "./assets/icons/Music.png";
    return "./assets/icons/Files.png";
  }

  function transferStatus(transfer) {
    var value = String(transfer.state || "").replace(/_/g, " ");
    value = value.charAt(0).toUpperCase() + value.slice(1);
    if (transfer.state === "sending" || transfer.state === "receiving") value += " " + Number(transfer.progress || 0) + "%";
    return value;
  }

  function render() {
    if (!state || !mainElement) return;
    if (enabledInput) { enabledInput.disabled = false; enabledInput.checked = Boolean(state.enabled); }
    if (nameInput && document.activeElement !== nameInput) nameInput.value = state.device.name || "A-OS Computer";
    var pathLabel = windowElement && windowElement.querySelector("[data-fd-path]");
    if (pathLabel) pathLabel.textContent = "Received files: " + (state.downloads || "FileDrop Downloads");
    var peers = state.peers || [];
    if (!peers.some(function (peer) { return peer.id === selectedPeer; })) selectedPeer = "";
    var files = parseFiles();
    selectedFiles.forEach(function (id) {
      if (!files.some(function (file) { return String(file.id) === id; })) selectedFiles.delete(id);
    });
    var pending = (state.transfers || []).filter(function (item) { return item.direction === "incoming" && item.state === "pending"; });
    var transfers = (state.transfers || []).filter(function (item) { return item.state !== "pending"; }).slice(0, 8);

    var html = "";
    if (pending.length) {
      html += '<section class="aos-filedrop-section"><header><h3>Waiting for you</h3><small>Accept only files you expect</small></header><div class="aos-filedrop-incoming">';
      pending.forEach(function (item) {
        html += '<article class="aos-filedrop-offer"><span><b>' + escapeHtml(item.name) + '</b><small>' + escapeHtml(item.peerName) + ' · ' + escapeHtml(item.sizeText) + '</small></span><div class="aos-filedrop-actions"><button class="aos-filedrop-action" data-accept="' + escapeHtml(item.id) + '">Accept</button><button class="aos-filedrop-action" data-reject="' + escapeHtml(item.id) + '">Decline</button></div></article>';
      });
      html += "</div></section>";
    }
    if (state.browserMode) {
      html += '<section class="aos-filedrop-section aos-filedrop-browser-direct"><header><h3>Receive files</h3><small>Ready in this browser</small></header><div class="aos-filedrop-receive-ready"><img src="' + ICON + '" alt=""><span><b>' + (state.enabled ? "Waiting for files" : "FileDrop is paused") + '</b><small>' + (state.enabled ? "Keep this browser open. A-OS will ask before another account or device can access anything." : "Turn on FileDrop to receive files in this browser.") + '</small></span></div></section>';
    } else {
      html += '<section class="aos-filedrop-section"><header><h3>Nearby devices</h3><small>' + (state.enabled ? "Same local network" : "FileDrop is off") + '</small></header><div class="aos-filedrop-grid">';
      if (!peers.length) html += '<div class="aos-filedrop-empty">' + (state.enabled ? "Looking for A-OS, Windows, and Mac devices…" : "Enable FileDrop to find devices.") + '</div>';
      peers.forEach(function (peer) {
        html += '<button class="aos-filedrop-peer" aria-pressed="' + (peer.id === selectedPeer) + '" data-peer="' + escapeHtml(peer.id) + '"><img src="' + platformIcon(peer) + '" alt=""><span><b>' + escapeHtml(peer.name) + '</b><small>' + escapeHtml(peer.platform) + '</small></span></button>';
      });
      html += '</div></section>';
    }
    html += '<section class="aos-filedrop-section"><header><h3>A-OS Files</h3><span class="aos-filedrop-file-actions"><small>Select a file</small><button type="button" class="aos-filedrop-quiet" data-fd-upload>Upload</button></span></header><div class="aos-filedrop-grid">';
    if (!files.length) html += '<div class="aos-filedrop-empty">There are no files to send yet. Add a file in A-OS Files first.</div>';
    files.slice(0, 80).forEach(function (file) {
      var id = String(file.id || file.name);
      html += '<button class="aos-filedrop-file" aria-pressed="' + selectedFiles.has(id) + '" data-file="' + escapeHtml(id) + '"><img src="' + fileIcon(file) + '" alt=""><span><b>' + escapeHtml(file.name || "A-OS file") + '</b><small>' + humanSize(fileSize(file)) + '</small></span></button>';
    });
    html += "</div></section>";
    if (transfers.length) {
      html += '<section class="aos-filedrop-section"><header><h3>Recent transfers</h3><small>Verified before saving</small></header><div class="aos-filedrop-incoming">';
      transfers.forEach(function (item) {
        var direction = item.direction === "incoming" ? "Received from " : "Sent to ";
        var progress = Math.max(0, Math.min(100, Number(item.progress || 0)));
        var importButton = item.direction === "incoming" && item.state === "complete" ? '<button class="aos-filedrop-quiet" data-import="' + escapeHtml(item.id) + '">Add to A-OS Files</button>' : '<small>' + escapeHtml(item.sizeText || "") + '</small>';
        html += '<article class="aos-filedrop-transfer"><span><b>' + escapeHtml(item.name) + '</b><small>' + direction + escapeHtml(item.peerName || "device") + ' · ' + escapeHtml(transferStatus(item)) + (item.error ? " · " + escapeHtml(item.error) : "") + '</small></span>' + importButton + '<div class="aos-filedrop-progress" style="--progress:' + progress + '%"><i></i></div></article>';
      });
      html += "</div></section>";
    }
    var sendDisabled = !selectedFiles.size || !state.enabled || (!state.browserMode && !selectedPeer);
    html += '<footer class="aos-filedrop-sendbar"><span>' + (selectedFiles.size ? selectedFiles.size + " selected" : state.browserMode ? "Upload or choose a file" : "Choose files and a nearby device") + '</span><button class="aos-filedrop-primary" data-send ' + (sendDisabled ? "disabled" : "") + '>' + (state.browserMode ? "Choose device and send" : "Send files") + '</button></footer>';
    mainElement.innerHTML = html;
  }

  async function refresh() {
    if (!windowElement || windowElement.hidden) return;
    state = browserState();
    render();
    setStatus(state.enabled ? "Ready to send and receive in your browser" : "FileDrop is off", false);
  }

  function startPolling() {
    clearInterval(pollTimer);
    refresh();
    pollTimer = window.setInterval(refresh, 3000);
  }

  async function sendSelected() {
    if (!selectedFiles.size) return;
    var files = parseFiles().filter(function (file) { return selectedFiles.has(String(file.id || file.name)); });
    if (state && state.browserMode) {
      var file = files[0];
      if (!file) return;
      if (!window.AOS_NEARBY_SHARE || typeof window.AOS_NEARBY_SHARE.open !== "function") {
        setStatus("Browser sharing is still starting. Try again in a moment.", true);
        return;
      }
      window.AOS_NEARBY_SHARE.open(file);
      if (files.length > 1) setStatus("Choose a device for " + file.name + ". Send additional files one at a time.", false);
      else setStatus("Choose the receiving browser", false);
      return;
    }
    if (!selectedPeer) return;
    setStatus("Preparing " + files.length + (files.length === 1 ? " file…" : " files…"), false);
    try {
      for (var index = 0; index < files.length; index += 1) {
        var file = files[index];
        setStatus("Sending request for " + file.name + "…", false);
        var blob = await fileBlob(file);
        await request("/api/send/" + encodeURIComponent(selectedPeer), {
          method: "POST",
          headers: {"Content-Type": "application/octet-stream", "X-File-Name": encodeURIComponent(file.name || "A-OS file")},
          body: blob
        });
      }
      selectedFiles.clear();
      setStatus("Waiting for the other device to accept", false);
      notify(files.length === 1 ? files[0].name + " is waiting for approval" : files.length + " files are waiting for approval");
      await refresh();
    } catch (error) {
      setStatus(error.message || "The files could not be sent.", true);
    }
  }

  function bindMainActions() {
    mainElement.addEventListener("click", async function (event) {
      var peer = event.target.closest("[data-peer]");
      if (peer) { selectedPeer = peer.getAttribute("data-peer"); render(); return; }
      var file = event.target.closest("[data-file]");
      if (file) {
        var id = file.getAttribute("data-file");
        if (selectedFiles.has(id)) selectedFiles.delete(id); else selectedFiles.add(id);
        render();
        return;
      }
      if (event.target.closest("[data-fd-upload]")) {
        var picker = windowElement.querySelector("[data-fd-upload-input]");
        if (picker) picker.click();
        return;
      }
      var accept = event.target.closest("[data-accept]");
      var reject = event.target.closest("[data-reject]");
      try {
        if (accept) await request("/api/accept/" + encodeURIComponent(accept.getAttribute("data-accept")), {method: "POST"});
        if (reject) await request("/api/reject/" + encodeURIComponent(reject.getAttribute("data-reject")), {method: "POST"});
        if (accept || reject) await refresh();
      } catch (error) { setStatus(error.message, true); }
      var importButton = event.target.closest("[data-import]");
      if (importButton) {
        importButton.disabled = true;
        try { await addReceivedToAos(importButton.getAttribute("data-import")); }
        catch (error) { setStatus(error.message, true); }
        finally { importButton.disabled = false; }
      }
      if (event.target.closest("[data-send]")) sendSelected();
    });
  }

  function makeDraggable() {
    var titlebar = windowElement.querySelector(".aos-filedrop-titlebar");
    var drag = null;
    titlebar.addEventListener("pointerdown", function (event) {
      if (event.target.closest("button") || windowElement.classList.contains("aos-filedrop-maximized")) return;
      var bounds = windowElement.getBoundingClientRect();
      drag = {x: event.clientX, y: event.clientY, left: bounds.left, top: bounds.top};
      titlebar.setPointerCapture(event.pointerId);
      windowElement.classList.add("aos-filedrop-positioned");
      windowElement.style.transform = "none";
      windowElement.style.left = bounds.left + "px";
      windowElement.style.top = bounds.top + "px";
    });
    titlebar.addEventListener("pointermove", function (event) {
      if (!drag) return;
      var left = Math.max(0, Math.min(window.innerWidth - 180, drag.left + event.clientX - drag.x));
      var top = Math.max(0, Math.min(window.innerHeight - 90, drag.top + event.clientY - drag.y));
      windowElement.style.left = left + "px";
      windowElement.style.top = top + "px";
    });
    titlebar.addEventListener("pointerup", function () { drag = null; });
  }

  function makeResizable() {
    var handle = windowElement.querySelector(".aos-filedrop-resize");
    var resize = null;
    handle.addEventListener("pointerdown", function (event) {
      if (windowElement.classList.contains("aos-filedrop-maximized")) return;
      var bounds = windowElement.getBoundingClientRect();
      resize = {x: event.clientX, y: event.clientY, width: bounds.width, height: bounds.height};
      handle.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    handle.addEventListener("pointermove", function (event) {
      if (!resize) return;
      windowElement.style.width = Math.max(600, Math.min(window.innerWidth - 12, resize.width + event.clientX - resize.x)) + "px";
      windowElement.style.height = Math.max(460, Math.min(window.innerHeight - 76, resize.height + event.clientY - resize.y)) + "px";
    });
    handle.addEventListener("pointerup", function () { resize = null; });
  }

  function ensureTaskbar() {
    if (taskbarButton && taskbarButton.isConnected) return;
    var shelf = document.querySelector(".shelf");
    if (!shelf) return;
    taskbarButton = document.createElement("button");
    taskbarButton.type = "button";
    taskbarButton.className = "shelf-icon aos-filedrop-taskbar";
    taskbarButton.setAttribute("aria-label", "FileDrop");
    taskbarButton.setAttribute("data-symbol", "FD");
    taskbarButton.innerHTML = '<img src="' + ICON + '" alt="">';
    taskbarButton.addEventListener("click", open);
    shelf.appendChild(taskbarButton);
  }

  function close() {
    if (!windowElement) return;
    windowElement.hidden = true;
    windowElement.classList.remove("aos-filedrop-minimized");
    clearInterval(pollTimer);
    if (taskbarButton) taskbarButton.remove();
    taskbarButton = null;
  }

  function open() {
    ensureWindow();
    windowElement.hidden = false;
    windowElement.classList.remove("aos-filedrop-minimized");
    windowElement.style.zIndex = String(Date.now() % 1000000 + 6000);
    ensureTaskbar();
    startPolling();
  }

  function ensureWindow() {
    if (windowElement) return;
    windowElement = document.createElement("section");
    windowElement.className = "system-window aos-filedrop-window";
    windowElement.hidden = true;
    windowElement.setAttribute("data-app", "FileDrop");
    windowElement.innerHTML = '<header class="aos-filedrop-titlebar"><img src="' + ICON + '" alt=""><span><strong>FileDrop</strong><small>Browser-to-browser files for A-OS, Windows, and Mac</small></span><div class="aos-filedrop-controls"><button type="button" data-fd-minimize aria-label="Minimize">−</button><button type="button" data-fd-maximize aria-label="Maximize">□</button><button type="button" data-fd-close aria-label="Close">×</button></div></header><div class="aos-filedrop-body"><aside class="aos-filedrop-sidebar"><div class="aos-filedrop-device-mark"><img src="' + ICON + '" alt=""></div><h2>FileDrop</h2><p>Share through the browser. Nothing to install.</p><div class="aos-filedrop-toggle"><span><b>Enable FileDrop</b><small>Send and receive in this browser</small></span><label class="aos-filedrop-switch"><input type="checkbox" data-fd-enabled><i></i></label></div><div class="aos-filedrop-name"><label for="aos-filedrop-device-name">Device name</label><div><input id="aos-filedrop-device-name" maxlength="80"><button type="button" data-fd-save-name aria-label="Save device name">✓</button></div></div><p class="aos-filedrop-path" data-fd-path></p><div class="aos-filedrop-status" data-fd-status role="status"></div></aside><main class="aos-filedrop-main"></main></div><input type="file" hidden multiple data-fd-upload-input data-aos-allowed-picker="true"><div class="aos-filedrop-resize" aria-hidden="true"></div>';
    document.body.appendChild(windowElement);
    mainElement = windowElement.querySelector(".aos-filedrop-main");
    statusElement = windowElement.querySelector("[data-fd-status]");
    enabledInput = windowElement.querySelector("[data-fd-enabled]");
    nameInput = windowElement.querySelector("#aos-filedrop-device-name");
    bindMainActions();
    makeDraggable();
    makeResizable();
    windowElement.addEventListener("pointerdown", function () { windowElement.style.zIndex = String(Date.now() % 1000000 + 6000); });
    windowElement.querySelector("[data-fd-close]").addEventListener("click", close);
    windowElement.querySelector("[data-fd-minimize]").addEventListener("click", function () { windowElement.classList.add("aos-filedrop-minimized"); });
    windowElement.querySelector("[data-fd-maximize]").addEventListener("click", function () { windowElement.classList.toggle("aos-filedrop-maximized"); });
    windowElement.querySelector("[data-fd-upload-input]").addEventListener("change", async function (event) {
      await importLocalFiles(event.target.files);
      event.target.value = "";
    });
    enabledInput.addEventListener("change", async function () {
      var enabled = enabledInput.checked;
      saveBrowserSettings({enabled: enabled});
      state = browserState();
      render();
      setStatus(enabled ? "Ready to send and receive in your browser" : "FileDrop is off", false);
    });
    windowElement.querySelector("[data-fd-save-name]").addEventListener("click", async function () {
      saveBrowserSettings({name: nameInput.value});
      state = browserState();
      render();
      setStatus("Device name saved for browser FileDrop", false);
    });
  }

  function installLauncher() {
    var files = document.querySelector(".desktop-files");
    if (!files || files.querySelector(".aos-filedrop-shortcut")) return false;
    var button = document.createElement("button");
    button.type = "button";
    button.className = "aos-filedrop-shortcut";
    button.setAttribute("aria-label", "FileDrop");
    button.innerHTML = '<span><img src="' + ICON + '" alt=""></span><b>FileDrop</b>';
    button.addEventListener("click", open);
    files.appendChild(button);
    return true;
  }

  function start() {
    saveBrowserSettings(readBrowserSettings());
    ensureWindow();
    installLauncher();
    var observer = new MutationObserver(installLauncher);
    observer.observe(document.body, {childList: true, subtree: true});
    window.addEventListener("aos-files-change", function () { if (windowElement && !windowElement.hidden) render(); });
    window.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && windowElement && !windowElement.hidden) close();
    });
    if (String(new URLSearchParams(location.search).get("app") || "").toLowerCase() === "filedrop") {
      window.setTimeout(open, 450);
    }
  }

  window.AOS_FILEDROP = {open: open, close: close, refresh: refresh, importFiles: importLocalFiles};
  document.documentElement.dataset.aosFileDrop = "ready";
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, {once: true});
  else start();
})();
