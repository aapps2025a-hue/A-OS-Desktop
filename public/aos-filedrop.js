(function () {
  "use strict";

  if (window.AOS_FILEDROP) return;

  var SERVICE = "http://127.0.0.1:45872";
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
    try {
      response = await fetch(SERVICE + path, Object.assign({cache: "no-store", mode: "cors"}, options || {}));
    } catch (_) {
      throw new Error("FileDrop is not running on this device. Open the A-OS FileDrop desktop app, then try again.");
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

  function renderOffline() {
    if (!mainElement) return;
    mainElement.innerHTML = '<section class="aos-filedrop-offline"><div><img src="' + ICON + '" alt=""><h2>Start FileDrop on this device</h2><p>The native FileDrop service is not running. On an installed A-OS computer it starts automatically. On Windows or macOS, open the A-OS FileDrop desktop app.</p></div></section>';
    if (enabledInput) enabledInput.disabled = true;
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
    html += '<section class="aos-filedrop-section"><header><h3>Nearby devices</h3><small>' + (state.enabled ? "Same local network" : "FileDrop is off") + '</small></header><div class="aos-filedrop-grid">';
    if (!peers.length) html += '<div class="aos-filedrop-empty">' + (state.enabled ? "Looking for A-OS, Windows, and Mac devices…" : "Enable FileDrop to find devices.") + '</div>';
    peers.forEach(function (peer) {
      html += '<button class="aos-filedrop-peer" aria-pressed="' + (peer.id === selectedPeer) + '" data-peer="' + escapeHtml(peer.id) + '"><img src="' + platformIcon(peer) + '" alt=""><span><b>' + escapeHtml(peer.name) + '</b><small>' + escapeHtml(peer.platform) + '</small></span></button>';
    });
    html += '</div></section><section class="aos-filedrop-section"><header><h3>A-OS Files</h3><small>Select one or more files</small></header><div class="aos-filedrop-grid">';
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
    html += '<footer class="aos-filedrop-sendbar"><span>' + (selectedFiles.size ? selectedFiles.size + " selected" : "Choose files and a nearby device") + '</span><button class="aos-filedrop-primary" data-send ' + (!selectedPeer || !selectedFiles.size || !state.enabled ? "disabled" : "") + '>Send files</button></footer>';
    mainElement.innerHTML = html;
  }

  async function refresh() {
    if (!windowElement || windowElement.hidden) return;
    try {
      state = await request("/api/state");
      (state.transfers || []).forEach(function (item) {
        if (item.direction === "incoming" && item.state === "pending" && !notifiedOffers.has(item.id)) {
          notifiedOffers.add(item.id);
          notify((item.peerName || "Another device") + " wants to send " + item.name);
        }
        if (item.direction === "incoming" && item.state === "complete" && !notifiedComplete.has(item.id)) {
          notifiedComplete.add(item.id);
          notify(item.name + " was received and verified");
        }
      });
      render();
      setStatus(state.enabled ? "Ready on your local network" : "FileDrop is off", false);
    } catch (error) {
      state = null;
      renderOffline();
      setStatus(error.message || "FileDrop is unavailable", true);
    }
  }

  function startPolling() {
    clearInterval(pollTimer);
    refresh();
    pollTimer = window.setInterval(refresh, 900);
  }

  async function sendSelected() {
    if (!selectedPeer || !selectedFiles.size) return;
    var files = parseFiles().filter(function (file) { return selectedFiles.has(String(file.id || file.name)); });
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
    windowElement.innerHTML = '<header class="aos-filedrop-titlebar"><img src="' + ICON + '" alt=""><span><strong>FileDrop</strong><small>Files between A-OS, Windows, and Mac</small></span><div class="aos-filedrop-controls"><button type="button" data-fd-minimize aria-label="Minimize">−</button><button type="button" data-fd-maximize aria-label="Maximize">□</button><button type="button" data-fd-close aria-label="Close">×</button></div></header><div class="aos-filedrop-body"><aside class="aos-filedrop-sidebar"><div class="aos-filedrop-device-mark"><img src="' + ICON + '" alt=""></div><h2>FileDrop</h2><p>Nearby file sharing that keeps you in control.</p><div class="aos-filedrop-toggle"><span><b>Enable FileDrop</b><small>Let nearby devices find this A-OS</small></span><label class="aos-filedrop-switch"><input type="checkbox" data-fd-enabled><i></i></label></div><div class="aos-filedrop-name"><label for="aos-filedrop-device-name">Device name</label><div><input id="aos-filedrop-device-name" maxlength="80"><button type="button" data-fd-save-name aria-label="Save device name">✓</button></div></div><p class="aos-filedrop-path" data-fd-path></p><div class="aos-filedrop-status" data-fd-status role="status"></div></aside><main class="aos-filedrop-main"></main></div><div class="aos-filedrop-resize" aria-hidden="true"></div>';
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
    enabledInput.addEventListener("change", async function () {
      try { state = await request("/api/enable", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({enabled: enabledInput.checked})}); render(); }
      catch (error) { enabledInput.checked = !enabledInput.checked; setStatus(error.message, true); }
    });
    windowElement.querySelector("[data-fd-save-name]").addEventListener("click", async function () {
      try { state = await request("/api/name", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({name: nameInput.value})}); render(); setStatus("Device name saved", false); }
      catch (error) { setStatus(error.message, true); }
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
    ensureWindow();
    installLauncher();
    var observer = new MutationObserver(installLauncher);
    observer.observe(document.body, {childList: true, subtree: true});
    window.addEventListener("aos-files-change", function () { if (windowElement && !windowElement.hidden) render(); });
    window.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && windowElement && !windowElement.hidden) close();
    });
  }

  window.AOS_FILEDROP = {open: open, close: close, refresh: refresh};
  document.documentElement.dataset.aosFileDrop = "ready";
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, {once: true});
  else start();
})();
