(function () {
  "use strict";

  if (window.AOS_SECURITY_API) return;

  var nativeSetItem = Storage.prototype.setItem;
  var nativeRemoveItem = Storage.prototype.removeItem;
  var scanTimer = 0;
  var periodicTimer = 0;
  var internalWrite = false;
  var deletingThreat = false;
  var currentThreat = null;
  var pendingOpen = null;
  var warningSoundFor = "";
  var lastQuotaWarning = 0;
  var FILE_KEYS = ["aos-files", "aos-tv-files"];
  var APP_KEYS = ["aos-url-apps", "aos-dev-apps", "aos-tv-url-apps", "aos-tv-installed-apps", "aos-installed-apps"];
  var QUARANTINE_KEY = "aos-security-quarantine";
  var LOCK_KEY = "aos-security-lockdown";
  var LAST_SCAN_KEY = "aos-antivirus-last-scan";
  var SCAN_COUNT_KEY = "aos-antivirus-scan-count";
  var HISTORY_KEY = "aos-antivirus-history";
  var AUTO_CHECK_KEY = "aos-antivirus-auto-checks";
  var NAMED_MALWARE = /\b(?:mirai|xor[._ -]?ddos|xorddos|wanna?cry|wanacry|tsunami|pnscan|ddos[._:-]?kaiten[._:-]?a|jupyter[._:-]?infostealer|magecart|fword|mydoom|conficker|emotet|trickbot|ryuk|lockbit|petya|notpetya|zeus|dridex|qakbot|agent[._ -]?tesla|redline|blackenergy|stuxnet|slammer|nimda|iloveyou|wannamine|cryptolocker|darkcomet|njrat|ramnit|sality|virut)\b/i;

  function automaticChecksEnabled() {
    return localStorage.getItem(AUTO_CHECK_KEY) !== "false";
  }

  function parse(value, fallback) {
    try { return JSON.parse(value); } catch (_) { return fallback; }
  }

  function isQuotaError(error) {
    return !!error && (
      error.name === "QuotaExceededError" ||
      error.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
      error.code === 22 ||
      error.code === 1014
    );
  }

  function releaseActiveWorkspaceDuplicate() {
    try {
      var profile = localStorage.getItem("aos-profile") || "Person";
      var key = "aos-profile-workspace-" + encodeURIComponent(profile);
      if (localStorage.getItem(key) !== null) nativeRemoveItem.call(localStorage, key);
    } catch (_) {}
  }

  function reportStorageFull(key) {
    var now = Date.now();
    if (now - lastQuotaWarning < 10000) return;
    lastQuotaWarning = now;
    console.warn("A-OS storage is full; the last change was not saved:", key);
    setTimeout(function () {
      window.dispatchEvent(new CustomEvent("aos-notification", {
        detail: {message: "A-OS storage is full. Remove a large file before saving more changes."}
      }));
    }, 0);
  }

  // The active profile already lives in the normal A-OS storage keys. Older builds
  // duplicated it into a profile snapshot, which could exhaust Chrome's quota.
  releaseActiveWorkspaceDuplicate();

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (character) {
      return {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[character];
    });
  }

  function readableContent(value) {
    var source = String(value == null ? "" : value);
    if (!/^data:/i.test(source)) return source;
    var comma = source.indexOf(",");
    if (comma === -1) return source;
    var header = source.slice(0, comma);
    var payload = source.slice(comma + 1);
    try {
      if (/;base64/i.test(header)) {
        var binary = atob(payload.slice(0, 1600000));
        var bytes = new Uint8Array(binary.length);
        for (var index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
        return new TextDecoder().decode(bytes);
      }
      return decodeURIComponent(payload);
    } catch (_) {
      return source.slice(0, 1200000);
    }
  }

  function dispatchChange() {
    window.dispatchEvent(new CustomEvent("aos-security-change", {detail: getStatus()}));
    refreshSecurityApps();
  }

  function protectedItemCount() {
    return FILE_KEYS.concat(APP_KEYS).reduce(function (total, key) {
      var value = parse(localStorage.getItem(key) || "[]", []);
      return total + (Array.isArray(value) ? value.length : 0);
    }, 0);
  }

  function getStatus() {
    return {
      threat: currentThreat,
      lockdown: localStorage.getItem(LOCK_KEY) === "true",
      lastScan: localStorage.getItem(LAST_SCAN_KEY),
      scanCount: Number(localStorage.getItem(SCAN_COUNT_KEY) || 0),
      protectedItems: protectedItemCount(),
      intervalMs: 30000,
      automaticChecks: automaticChecksEnabled(),
      history: parse(localStorage.getItem(HISTORY_KEY) || "[]", [])
    };
  }

  function recordScan(threat, at, source) {
    var count = Number(localStorage.getItem(SCAN_COUNT_KEY) || 0) + 1;
    var history = parse(localStorage.getItem(HISTORY_KEY) || "[]", []);
    if (!Array.isArray(history)) history = [];
    history.unshift({at: at, threat: threat ? threat.name : "", source: source || "automatic"});
    internalWrite = true;
    nativeSetItem.call(localStorage, SCAN_COUNT_KEY, String(count));
    nativeSetItem.call(localStorage, HISTORY_KEY, JSON.stringify(history.slice(0, 12)));
    internalWrite = false;
  }

  function trashKeyFor(sourceKey) {
    return sourceKey.indexOf("tv") !== -1 ? "aos-tv-trash" : "aos-trash";
  }

  function rememberRemovedFiles(storage, key, nextRaw) {
    if (internalWrite || deletingThreat || FILE_KEYS.indexOf(key) === -1) return;
    var previous = parse(storage.getItem(key) || "[]", []);
    var next = parse(String(nextRaw), []);
    if (!Array.isArray(previous) || !Array.isArray(next)) return;
    var remaining = new Set(next.map(function (item) { return item && item.id; }));
    var removed = previous.filter(function (item) { return item && item.id && !remaining.has(item.id); });
    if (!removed.length) return;
    var trashKey = trashKeyFor(key);
    var trash = parse(storage.getItem(trashKey) || "[]", []);
    if (!Array.isArray(trash)) trash = [];
    var now = new Date().toISOString();
    removed.forEach(function (item) {
      trash.push(Object.assign({}, item, {
        __trashId: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()),
        __sourceKey: key,
        __originalParent: item.parent || "root",
        __deletedAt: now
      }));
    });
    internalWrite = true;
    try {
      nativeSetItem.call(storage, trashKey, JSON.stringify(trash));
    } catch (error) {
      if (!isQuotaError(error)) throw error;
      reportStorageFull(trashKey);
      return;
    } finally {
      internalWrite = false;
    }
    window.dispatchEvent(new CustomEvent("aos-trash-change"));
  }

  Storage.prototype.setItem = function (key, value) {
    var normalizedKey = String(key);
    if (this === window.localStorage) rememberRemovedFiles(this, normalizedKey, value);
    try {
      nativeSetItem.call(this, key, value);
    } catch (error) {
      if (this !== window.localStorage || !isQuotaError(error)) throw error;
      reportStorageFull(normalizedKey);
      return;
    }
    if (this === window.localStorage && !internalWrite && !/^aos-security-|^aos-antivirus-/.test(normalizedKey) && automaticChecksEnabled()) scheduleScan(80);
  };

  Storage.prototype.removeItem = function (key) {
    nativeRemoveItem.call(this, key);
    if (this === window.localStorage && !internalWrite && !/^aos-security-|^aos-antivirus-/.test(String(key)) && automaticChecksEnabled()) scheduleScan(80);
  };

  function dangerReason(item, kind) {
    var name = String(item && (item.name || item.title || item.label) || "");
    var url = String(item && (item.url || item.domain) || "");
    var rawBody = item && (item.securityScanText || item.content || item.devCode || item.code || item.script) || "";
    var body = readableContent(rawBody);
    var all = (name + "\n" + url + "\n" + body).slice(0, 1200000);

    if (NAMED_MALWARE.test(all)) return "Known malware family or signature";
    if (/\.(virus|malware|trojan|ransom|aosvirus|crashos)$/i.test(name)) return "Dangerous file type";
    if (/\b(virus|malware|trojan|ransomware|crash[ _-]*a[ _-]*os)\b/i.test(name)) return "Dangerous app or file name";
    if (/^(javascript:|data:text\/html)/i.test(url)) return "Unsafe executable app address";
    if (/aos[-_: ]?(virus|malware|crash[-_ ]?on[-_ ]?boot|corrupt)|ransomware/i.test(all)) return "Known A-OS crash signature";
    if (/localStorage\s*\.\s*clear\s*\(|indexedDB\s*\.\s*deleteDatabase\s*\(|document\s*\.\s*documentElement\s*\.\s*innerHTML\s*=|while\s*\(\s*true\s*\)/i.test(body)) return "Code attempts to erase, replace, or freeze A-OS";
    if (/aos-(security|antivirus)-(quarantine|lockdown|history|auto-checks)[\s\S]{0,100}(removeItem|setItem)|AOS_SECURITY_API\s*=|Storage\s*\.\s*prototype\s*\.\s*(setItem|removeItem)\s*=/i.test(body)) return "Code attempts to disable A-OS protection";
    if (/(localStorage|sessionStorage|document\s*\.\s*cookie)[\s\S]{0,180}(sendBeacon|fetch\s*\(|XMLHttpRequest)/i.test(body)) return "Code may send private A-OS data outside the device";
    if (/setInterval\s*\([^)]*(location\s*\.\s*(reload|replace)|window\s*\.\s*open)|requestAnimationFrame\s*\([^)]*requestAnimationFrame/i.test(body)) return "Code contains a repeated window or restart loop";
    if (/(?:setInterval|for\s*\([^;]*;[^;]*;[^)]*\)|while\s*\()[\s\S]{0,300}(?:fetch\s*\(|XMLHttpRequest|WebSocket\s*\(|new\s+Image\s*\(\)[\s\S]{0,80}\.src\s*=)/i.test(body)) return "Code may flood a network or service";
    if (/(?:eval|Function)\s*\(\s*(?:atob|unescape|decodeURIComponent)\s*\(/i.test(body)) return "Obfuscated executable code";
    if (/(?:indexedDB\.deleteDatabase|localStorage\.clear|sessionStorage\.clear|caches\.delete|FileSystemHandle[\s\S]{0,80}removeEntry)[\s\S]{0,240}(?:location\.reload|document\.write|innerHTML)/i.test(body)) return "Code can erase data and prevent A-OS from recovering";
    if (/(?:crypto\.subtle|WebAssembly)[\s\S]{0,500}(?:hardwareConcurrency|setInterval|Worker\s*\()/i.test(body)) return "Suspicious hidden compute activity";
    if ((body.match(/<iframe\b/gi) || []).length > 12 || (body.match(/window\s*\.\s*open\s*\(/gi) || []).length > 8) return "Code tries to create too many embedded windows";
    if (kind === "app" && /location\s*\.\s*(reload|replace)\s*\([^)]*\)[\s\S]{0,160}location\s*\.\s*(reload|replace)/i.test(body)) return "Restart loop signature";
    return "";
  }

  function threatFromArray(key, list, kind) {
    for (var index = 0; index < list.length; index += 1) {
      var item = list[index];
      var normalized = typeof item === "string" ? {name: item} : item;
      if (!normalized || typeof normalized !== "object") continue;
      var reason = dangerReason(normalized, kind);
      if (!reason) continue;
      return {
        id: normalized.id || "",
        index: index,
        name: normalized.name || normalized.title || String(item),
        kind: kind,
        reason: reason,
        storageKey: key,
        detectedAt: new Date().toISOString(),
        fingerprint: key + ":" + (normalized.id || normalized.name || index)
      };
    }
    return null;
  }

  function findThreat() {
    var index;
    for (index = 0; index < FILE_KEYS.length; index += 1) {
      var fileKey = FILE_KEYS[index];
      var files = parse(localStorage.getItem(fileKey) || "[]", []);
      if (Array.isArray(files)) {
        var fileThreat = threatFromArray(fileKey, files, "file");
        if (fileThreat) return fileThreat;
      }
    }

    for (index = 0; index < APP_KEYS.length; index += 1) {
      var appKey = APP_KEYS[index];
      var apps = parse(localStorage.getItem(appKey) || "[]", []);
      if (Array.isArray(apps)) {
        var appThreat = threatFromArray(appKey, apps, "app");
        if (appThreat) return appThreat;
      }
    }

    for (index = 0; index < localStorage.length; index += 1) {
      var key = localStorage.key(index) || "";
      if (!/^aos-(tv-)?dev-/.test(key)) continue;
      var app = parse(localStorage.getItem(key) || "null", null);
      if (!app) continue;
      var reason = dangerReason(app, "app");
      if (reason) return {
        id: app.id || "",
        index: 0,
        name: app.name || key,
        kind: "app",
        reason: reason,
        storageKey: key,
        directKey: true,
        detectedAt: new Date().toISOString(),
        fingerprint: key
      };
    }
    return null;
  }

  function playWarningTwice(fingerprint) {
    if (warningSoundFor === fingerprint) return;
    warningSoundFor = fingerprint;
    try {
      var AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      var context = new AudioContextClass();
      [0, 0.22, 0.8, 1.02].forEach(function (offset, index) {
        var oscillator = context.createOscillator();
        var gain = context.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = index % 2 ? 560 : 820;
        gain.gain.setValueAtTime(0.0001, context.currentTime + offset);
        gain.gain.exponentialRampToValueAtTime(0.18, context.currentTime + offset + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + offset + 0.18);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start(context.currentTime + offset);
        oscillator.stop(context.currentTime + offset + 0.2);
      });
      window.setTimeout(function () { context.close(); }, 1500);
    } catch (_) {}
  }

  function ensureStyles() {
    if (document.getElementById("aos-security-styles")) return;
    var style = document.createElement("style");
    style.id = "aos-security-styles";
    style.textContent = "#aos-security-recovery,#aos-trash-manager{position:fixed;inset:0;z-index:2147483647;background:rgba(2,8,14,.96);color:#eef9ff;font-family:Arial,sans-serif;display:grid;place-items:center;padding:24px}#aos-security-recovery *{box-sizing:border-box}.aos-sec-card,.aos-trash-card{width:min(720px,94vw);max-height:90vh;overflow:auto;background:#111c25;border:1px solid #ffffff24;border-radius:8px;box-shadow:0 28px 90px #000;padding:30px}.aos-sec-mark{width:74px;height:74px;border-radius:50%;display:grid;place-items:center;background:#d43c3c;color:white;font-size:38px;font-weight:900}.aos-sec-card h1,.aos-trash-card h1{font-size:34px;margin:18px 0 8px}.aos-sec-card p,.aos-trash-card p{color:#b9cbd5;line-height:1.5}.aos-sec-threat{background:#251719;border:1px solid #ff6c6c66;border-radius:7px;padding:16px;margin:20px 0;display:grid;gap:4px}.aos-sec-threat small{color:#ffaaa4}.aos-sec-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:22px}.aos-sec-actions button,.aos-trash-card button{border:0;border-radius:6px;padding:13px 17px;font-weight:800;cursor:pointer}.aos-sec-delete{background:#f05b55;color:#160605}.aos-sec-secondary{background:#dbe9ef;color:#10202a}.aos-sec-file{background:#fff;color:#19252e;border-radius:7px;padding:14px;display:flex;align-items:center;gap:12px}.aos-sec-file span{display:grid;flex:1}.aos-sec-file button{background:#cf3e3e;color:white}.aos-sec-note{background:#0b2530;border-left:4px solid #50cddd;padding:13px;margin-top:18px}.aos-trash-row{background:#fff;color:#15232c;border-radius:6px;padding:12px;margin-top:9px;display:flex;align-items:center;gap:12px}.aos-trash-row span{display:grid;flex:1}.aos-trash-close{float:right}.aos-trash-empty{text-align:center;padding:35px 10px}.aos-trash-danger{background:#c93737;color:#fff}";
    style.textContent += ".security.aos-security-dashboard{color:#edf7fb;background:#07111a!important;display:block!important;height:calc(100% - 43px);padding:0!important;overflow:auto}.aos-security-app-head{background:#0d1b27;border-bottom:1px solid #ffffff1c;grid-template-columns:60px 1fr auto;align-items:center;gap:16px;min-height:104px;padding:20px 24px;display:grid}.aos-security-app-head>img{object-fit:contain;width:56px;height:56px}.aos-security-app-head span{display:grid}.aos-security-app-head small,.aos-security-app-main small{color:#65dce9;letter-spacing:1.1px;font-size:9px;font-weight:900}.aos-security-app-head h1,.aos-security-app-head p,.aos-security-app-main h2,.aos-security-app-main p{margin:0}.aos-security-app-head h1{font-size:27px}.aos-security-app-head p{color:#9eb0be;margin-top:3px}.aos-security-live{color:#9ff2d0;background:#16352e;border:1px solid #42c69655;border-radius:100px;padding:8px 11px;font-size:10px}.aos-security-app-main{grid-template-columns:repeat(3,1fr);gap:12px;padding:20px 24px 28px;display:grid}.aos-security-summary{background:#0d1a25;border:1px solid #ffffff1d;border-radius:8px;grid-column:1/-1;grid-template-columns:64px 1fr auto;align-items:center;gap:17px;min-height:132px;padding:20px;display:grid}.aos-security-summary.danger{background:#251719;border-color:#ff6c6c55}.aos-security-summary>img{object-fit:contain;width:60px;height:60px}.aos-security-summary>div{display:grid;gap:4px}.aos-security-summary h2{font-size:20px}.aos-security-summary p{color:#98aab8}.aos-security-summary button{color:#061018;background:#55d6e4;border:0;border-radius:7px;min-width:122px;padding:11px 15px;font-weight:900}.aos-security-summary button.danger{color:#fff;background:#d94c4c}.aos-security-metric{background:#0d1a25;border:1px solid #ffffff1d;border-radius:8px;gap:2px;padding:16px;display:grid}.aos-security-metric b{color:#65dce9;font-size:22px}.aos-security-metric span{font-weight:800}.aos-security-metric small{color:#8fa3b2;letter-spacing:0}.aos-security-areas,.aos-security-history{background:#0d1a25;border:1px solid #ffffff1d;border-radius:8px;grid-column:span 2;padding:18px}.aos-security-history{grid-column:span 1}.aos-security-areas header,.aos-security-history header{margin-bottom:9px}.aos-security-row{border-top:1px solid #ffffff14;align-items:center;gap:11px;min-height:54px;padding:8px 0;display:flex}.aos-security-row img{object-fit:contain;width:34px;height:34px}.aos-security-row span{flex:1;display:grid}.aos-security-row small{color:#8fa3b2;letter-spacing:0}.aos-security-row i{background:#45d49b;border-radius:50%;width:9px;height:9px}.aos-security-empty{color:#8fa3b2!important;padding:18px 0}@media(max-width:720px){.aos-security-app-head{grid-template-columns:52px 1fr}.aos-security-live{grid-column:1/-1;justify-self:start}.aos-security-app-main{grid-template-columns:1fr}.aos-security-summary{grid-template-columns:50px 1fr}.aos-security-summary>img{width:48px;height:48px}.aos-security-summary button{grid-column:1/-1}.aos-security-areas,.aos-security-history{grid-column:1}}";
    style.textContent += ".aos-security-auto{background:#0d1a25;border:1px solid #ffffff1d;border-radius:8px;grid-column:1/-1;display:flex;align-items:center;gap:14px;padding:15px 18px}.aos-security-auto span{display:grid;flex:1}.aos-security-auto small{color:#8fa3b2;letter-spacing:0}.aos-security-auto input{appearance:none;width:44px;height:25px;border-radius:20px;background:#536774;position:relative;cursor:pointer}.aos-security-auto input:after{content:'';position:absolute;left:3px;top:3px;width:19px;height:19px;border-radius:50%;background:#fff;transition:transform .2s}.aos-security-auto input:checked{background:#3cc891}.aos-security-auto input:checked:after{transform:translateX(19px)}";
    document.head.appendChild(style);
  }

  function removeRecovery() {
    var existing = document.getElementById("aos-security-recovery");
    if (existing) existing.remove();
  }

  function deleteThreat() {
    if (!currentThreat) return;
    var openResolver = pendingOpen && pendingOpen.resolve;
    pendingOpen = null;
    deletingThreat = true;
    try {
      var key = currentThreat.storageKey;
      if (!key || currentThreat.transient) {
        // A package chosen from the PC has not been installed yet; cancelling discards it.
      } else if (currentThreat.directKey) {
        nativeRemoveItem.call(localStorage, key);
      } else {
        var value = parse(localStorage.getItem(key) || "[]", []);
        if (Array.isArray(value)) {
          var next = value.filter(function (item, index) {
            if (currentThreat.id && item && item.id === currentThreat.id) return false;
            if (index === currentThreat.index && String(item && (item.name || item.title) || item) === currentThreat.name) return false;
            return true;
          });
          nativeSetItem.call(localStorage, key, JSON.stringify(next));
        }
      }
      ["aos-installed-apps", "aos-tv-installed-apps"].forEach(function (installedKey) {
        var installed = parse(localStorage.getItem(installedKey) || "[]", []);
        if (Array.isArray(installed)) nativeSetItem.call(localStorage, installedKey, JSON.stringify(installed.filter(function (name) { return name !== currentThreat.name; })));
      });
      nativeRemoveItem.call(localStorage, QUARANTINE_KEY);
      nativeRemoveItem.call(localStorage, LOCK_KEY);
      currentThreat = null;
      warningSoundFor = "";
      removeRecovery();
      window.dispatchEvent(new CustomEvent("aos-files-change"));
      dispatchChange();
    } finally {
      deletingThreat = false;
    }
    if (openResolver) openResolver(false);
    window.setTimeout(scan, 100);
  }

  function runThreatOnce() {
    if (!pendingOpen) return;
    var resolver = pendingOpen.resolve;
    pendingOpen = null;
    currentThreat = null;
    internalWrite = true;
    nativeRemoveItem.call(localStorage, QUARANTINE_KEY);
    nativeRemoveItem.call(localStorage, LOCK_KEY);
    internalWrite = false;
    warningSoundFor = "";
    removeRecovery();
    dispatchChange();
    resolver(true);
  }

  function renderRecovery(view) {
    if (!currentThreat) return;
    ensureStyles();
    removeRecovery();
    var root = document.createElement("div");
    root.id = "aos-security-recovery";
    root.setAttribute("role", "alertdialog");
    root.setAttribute("aria-modal", "true");
    var threat = '<div class="aos-sec-threat"><b>' + esc(currentThreat.name) + '</b><small>' + esc(currentThreat.kind.toUpperCase()) + ' · ' + esc(currentThreat.reason) + '</small></div>';

    if (view === "file-open") {
      root.innerHTML = '<section class="aos-sec-card"><div class="aos-sec-mark">!</div><h1>A-OS blocked an infected file</h1><p>This file includes malware or code that could damage A-OS. A-OS does not want to run it.</p>' + threat + '<div class="aos-sec-actions"><button class="aos-sec-delete">Delete file</button><button class="aos-sec-secondary" data-run-anyway>Run anyway</button></div><div class="aos-sec-note">Run anyway allows this opening only. Automatic protection remains active.</div></section>';
    } else if (view === "files") {
      root.innerHTML = '<section class="aos-sec-card"><div class="aos-sec-mark">!</div><h1>Quarantine Files</h1><p>Only the detected virus is visible while A-OS is restricted.</p><div class="aos-sec-file"><span><b>' + esc(currentThreat.name) + '</b><small>' + esc(currentThreat.reason) + '</small></span><button class="aos-sec-delete">Delete virus</button></div><div class="aos-sec-actions"><button class="aos-sec-secondary" data-view="lock">Back</button></div></section>';
    } else if (view === "settings") {
      root.innerHTML = '<section class="aos-sec-card"><div class="aos-sec-mark">!</div><h1>Security settings</h1><p>Real-time protection is on. A-OS scans files and installed apps every 30 seconds and immediately after storage changes.</p>' + threat + '<div class="aos-sec-note">Protection remains active during Do Not Disturb, restart, lock, and BIOS screens.</div><div class="aos-sec-actions"><button class="aos-sec-delete">Delete virus</button><button class="aos-sec-secondary" data-view="lock">Back</button></div></section>';
    } else if (view === "lock") {
      root.innerHTML = '<section class="aos-sec-card"><div class="aos-sec-mark">!</div><h1>A-OS access is restricted</h1><p>The infection warning was ignored. Apps and normal files are locked until the detected item is deleted.</p>' + threat + '<div class="aos-sec-actions"><button class="aos-sec-secondary" data-view="settings">Settings</button><button class="aos-sec-secondary" data-view="files">Files</button><button class="aos-sec-delete">Delete virus</button></div></section>';
    } else {
      root.innerHTML = '<section class="aos-sec-card"><div class="aos-sec-mark">!</div><h1>This device is infected</h1><p>A-OS found an item that could crash or damage the system. A-OS is asking to delete the virus now.</p>' + threat + '<div class="aos-sec-actions"><button class="aos-sec-delete">Delete virus</button><button class="aos-sec-secondary" data-ignore>Ignore warning</button></div><div class="aos-sec-note">Ignoring this warning restricts apps and files until the virus is removed.</div></section>';
    }
    document.body.appendChild(root);
    var deleteButton = root.querySelector(".aos-sec-delete");
    if (deleteButton) deleteButton.addEventListener("click", deleteThreat);
    root.querySelectorAll("[data-view]").forEach(function (button) { button.addEventListener("click", function () { renderRecovery(button.getAttribute("data-view")); }); });
    var ignoreButton = root.querySelector("[data-ignore]");
    if (ignoreButton) ignoreButton.addEventListener("click", function () {
      nativeSetItem.call(localStorage, LOCK_KEY, "true");
      renderRecovery("lock");
    });
    var runButton = root.querySelector("[data-run-anyway]");
    if (runButton) runButton.addEventListener("click", runThreatOnce);
    window.setTimeout(function () { (deleteButton || root.querySelector("button"))?.focus(); }, 20);
  }

  function quarantine(threat) {
    var previous = currentThreat;
    currentThreat = threat;
    internalWrite = true;
    nativeSetItem.call(localStorage, QUARANTINE_KEY, JSON.stringify(threat));
    internalWrite = false;
    if (!previous || previous.fingerprint !== threat.fingerprint) playWarningTwice(threat.fingerprint);
    renderRecovery(localStorage.getItem(LOCK_KEY) === "true" ? "lock" : "warning");
    dispatchChange();
  }

  function scan(source) {
    window.clearTimeout(scanTimer);
    if (pendingOpen) return currentThreat;
    var now = new Date().toISOString();
    internalWrite = true;
    nativeSetItem.call(localStorage, LAST_SCAN_KEY, now);
    internalWrite = false;
    var threat = findThreat();
    recordScan(threat, now, source);
    if (threat) quarantine(threat);
    else if (currentThreat) {
      currentThreat = null;
      nativeRemoveItem.call(localStorage, QUARANTINE_KEY);
      nativeRemoveItem.call(localStorage, LOCK_KEY);
      removeRecovery();
      dispatchChange();
    } else dispatchChange();
    return threat;
  }

  function locateStoredThreat(item, reason) {
    var keys = FILE_KEYS.concat(APP_KEYS);
    for (var keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
      var list = parse(localStorage.getItem(keys[keyIndex]) || "[]", []);
      if (!Array.isArray(list)) continue;
      for (var itemIndex = 0; itemIndex < list.length; itemIndex += 1) {
        var candidate = list[itemIndex];
        if (!candidate) continue;
        if ((item.id && candidate.id === item.id) || (!item.id && candidate.name === item.name)) {
          return {
            id: candidate.id || "",
            index: itemIndex,
            name: candidate.name || item.name || "Suspicious file",
            kind: "file",
            reason: reason,
            storageKey: keys[keyIndex],
            detectedAt: new Date().toISOString(),
            fingerprint: keys[keyIndex] + ":" + (candidate.id || candidate.name || itemIndex)
          };
        }
      }
    }
    return {
      id: item.id || "",
      index: -1,
      name: item.name || "Suspicious file",
      kind: "file",
      reason: reason,
      storageKey: "",
      transient: Boolean(item.transient),
      detectedAt: new Date().toISOString(),
      fingerprint: "open:" + (item.id || item.name || Date.now())
    };
  }

  function openSecurityApp() {
    var visibleSecurity = document.querySelector(".security");
    if (visibleSecurity) {
      var existingWindow = visibleSecurity.closest(".system-window");
      if (existingWindow) existingWindow.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true}));
      return;
    }
    var buttons = Array.from(document.querySelectorAll("button"));
    var securityButton = buttons.find(function (button) { return button.textContent.trim() === "Security"; });
    if (securityButton) {
      securityButton.click();
      return;
    }
    var launcher = buttons.find(function (button) { return String(button.getAttribute("aria-label") || button.textContent).trim() === "Launcher"; });
    if (!launcher) return;
    launcher.click();
    window.setTimeout(function () {
      var appButton = Array.from(document.querySelectorAll("button")).find(function (button) { return button.textContent.trim() === "Security"; });
      if (appButton) appButton.click();
    }, 80);
  }

  function checkBeforeOpen(item, showSecurity) {
    if (!item || item.type === "folder") return Promise.resolve(true);
    var reason = dangerReason(item, "file");
    if (!reason) return Promise.resolve(true);
    var threat = locateStoredThreat(item, reason);
    currentThreat = threat;
    internalWrite = true;
    nativeSetItem.call(localStorage, QUARANTINE_KEY, JSON.stringify(threat));
    internalWrite = false;
    recordScan(threat, threat.detectedAt, "file-open");
    playWarningTwice(threat.fingerprint);
    if (typeof showSecurity === "function") showSecurity();
    else openSecurityApp();
    dispatchChange();
    return new Promise(function (resolve) {
      pendingOpen = {resolve: resolve, threat: threat};
      window.setTimeout(function () { renderRecovery("file-open"); }, 120);
    });
  }

  function scheduleScan(delay) {
    window.clearTimeout(scanTimer);
    if (!automaticChecksEnabled()) return;
    scanTimer = window.setTimeout(scan, typeof delay === "number" ? delay : 0);
  }

  function schedulePeriodicScans() {
    window.clearInterval(periodicTimer);
    periodicTimer = 0;
    if (!automaticChecksEnabled()) return;
    periodicTimer = window.setInterval(scan, 30000);
  }

  function setAutomaticChecks(enabled) {
    internalWrite = true;
    nativeSetItem.call(localStorage, AUTO_CHECK_KEY, enabled ? "true" : "false");
    internalWrite = false;
    window.clearTimeout(scanTimer);
    schedulePeriodicScans();
    if (enabled) scheduleScan(50);
    dispatchChange();
  }

  function openTrashManager() {
    ensureStyles();
    var old = document.getElementById("aos-trash-manager");
    if (old) old.remove();
    var key = document.documentElement.dataset.aosSurface === "tv" ? "aos-tv-trash" : "aos-trash";
    var items = parse(localStorage.getItem(key) || "[]", []);
    if (!Array.isArray(items)) items = [];
    var root = document.createElement("div");
    root.id = "aos-trash-manager";
    var rows = items.map(function (item) {
      return '<div class="aos-trash-row" data-trash-id="' + esc(item.__trashId) + '"><span><b>' + esc(item.name || "Deleted item") + '</b><small>' + esc(item.__deletedAt ? new Date(item.__deletedAt).toLocaleString() : "Deleted recently") + '</small></span><button data-restore>Restore</button><button class="aos-trash-danger" data-permanent>Delete forever</button></div>';
    }).join("");
    root.innerHTML = '<section class="aos-trash-card"><button class="aos-trash-close" data-close>Close</button><h1>Trash</h1><p>Restore an A-OS file or delete it permanently.</p>' + (rows || '<div class="aos-trash-empty"><b>Trash is empty</b><p>Deleted A-OS files will appear here.</p></div>') + '</section>';
    document.body.appendChild(root);
    root.querySelector("[data-close]").addEventListener("click", function () { root.remove(); });
    root.querySelectorAll("[data-trash-id]").forEach(function (row) {
      var item = items.find(function (entry) { return String(entry.__trashId) === row.getAttribute("data-trash-id"); });
      row.querySelector("[data-restore]").addEventListener("click", function () {
        var sourceKey = item.__sourceKey || (key === "aos-tv-trash" ? "aos-tv-files" : "aos-files");
        var files = parse(localStorage.getItem(sourceKey) || "[]", []);
        var restored = Object.assign({}, item, {parent: item.__originalParent || "root"});
        ["__trashId", "__sourceKey", "__originalParent", "__deletedAt"].forEach(function (field) { delete restored[field]; });
        nativeSetItem.call(localStorage, sourceKey, JSON.stringify((Array.isArray(files) ? files : []).concat([restored])));
        nativeSetItem.call(localStorage, key, JSON.stringify(items.filter(function (entry) { return entry.__trashId !== item.__trashId; })));
        window.dispatchEvent(new CustomEvent("aos-files-change"));
        openTrashManager();
      });
      row.querySelector("[data-permanent]").addEventListener("click", function () {
        nativeSetItem.call(localStorage, key, JSON.stringify(items.filter(function (entry) { return entry.__trashId !== item.__trashId; })));
        openTrashManager();
      });
    });
  }

  function securityTime(value) {
    if (!value) return "Protection is starting";
    try { return new Date(value).toLocaleTimeString(); } catch (_) { return "Recently"; }
  }

  function refreshSecurityApp(root) {
    if (!root || root.dataset.aosSecurityEnhanced !== "true") return;
    var status = getStatus();
    var elapsed = status.lastScan ? Date.now() - new Date(status.lastScan).getTime() : 30000;
    var nextScan = Math.max(0, 30 - Math.floor(elapsed / 1000));
    var summary = root.querySelector("[data-security-summary]");
    var title = root.querySelector("[data-security-title]");
    var detail = root.querySelector("[data-security-detail]");
    var action = root.querySelector("[data-security-action]");
    var items = root.querySelector("[data-security-items]");
    var next = root.querySelector("[data-security-next]");
    var count = root.querySelector("[data-security-count]");
    var history = root.querySelector("[data-security-history]");
    var statusIcon = root.querySelector("[data-security-icon]");
    var automatic = root.querySelector("[data-security-auto]");
    var live = root.querySelector(".aos-security-live");
    var headCopy = root.querySelector(".aos-security-app-head p");
    var nextCopy = root.querySelector("[data-security-next-copy]");
    if (summary) summary.classList.toggle("danger", Boolean(status.threat));
    if (title) title.textContent = status.threat ? status.threat.name + " is quarantined" : "Your A-OS device is protected";
    if (detail) detail.textContent = status.threat ? status.threat.reason : status.automaticChecks ? "Files, apps, embeds, startup data, and A-Store additions are checked automatically." : "Automatic checks are off. Use Check for malware whenever you want to check this device.";
    if (statusIcon) statusIcon.src = "/assets/icons/" + (status.threat ? "UnSafe.png" : "Tick.png");
    if (action) {
      action.textContent = status.threat ? "Delete threat" : "Check for malware";
      action.classList.toggle("danger", Boolean(status.threat));
      action.dataset.mode = status.threat ? "delete" : "scan";
    }
    if (items) items.textContent = String(status.protectedItems);
    if (next) next.textContent = status.automaticChecks ? (status.lastScan ? nextScan + "s" : "Starting") : "Off";
    if (automatic) automatic.checked = status.automaticChecks;
    if (live) live.textContent = status.automaticChecks ? "Every 30 seconds" : "Manual checks";
    if (headCopy) headCopy.textContent = status.automaticChecks ? "Real-time protection is active" : "Manual scanning is available";
    if (nextCopy) nextCopy.textContent = status.automaticChecks ? "Runs every 30 seconds" : "Manual scans only";
    if (count) count.textContent = String(status.scanCount);
    if (history) {
      var recent = Array.isArray(status.history) ? status.history.slice(0, 4) : [];
      history.innerHTML = recent.length ? recent.map(function (item) {
        return '<div class="aos-security-row"><img src="/assets/icons/' + (item.threat ? 'UnSafe.png' : 'Tick.png') + '" alt=""><span><b>' + (item.threat ? esc(item.threat) + ' quarantined' : (item.source === 'manual' ? 'Manual scan completed' : 'Automatic scan completed')) + '</b><small>' + esc(securityTime(item.at)) + '</small></span></div>';
      }).join("") : '<p class="aos-security-empty">Scan activity will appear here after protection starts.</p>';
    }
  }

  function enhanceSecurityApps() {
    document.querySelectorAll(".security").forEach(function (root) {
      if (root.dataset.aosSecurityEnhanced === "true") return;
      root.dataset.aosSecurityEnhanced = "true";
      root.classList.add("aos-security-dashboard");
      root.innerHTML = '<header class="aos-security-app-head"><img src="/assets/icons/Security Shield Assistant.png" alt=""><span><small>A-OS PROTECTION</small><h1>Security</h1><p>Real-time protection is active</p></span><b class="aos-security-live">Always on</b></header><main class="aos-security-app-main"><section class="aos-security-summary" data-security-summary><img data-security-icon src="/assets/icons/Tick.png" alt=""><div><small>CURRENT STATUS</small><h2 data-security-title>Your A-OS device is protected</h2><p data-security-detail>Checking protection status.</p></div><button data-security-action data-mode="scan">Check for malware</button></section><section class="aos-security-auto"><span><b>Automatic 30-second virus checks</b><small>Check files, apps, embeds, and startup data every 30 seconds</small></span><input type="checkbox" data-security-auto aria-label="Automatic 30-second virus checks"></section><article class="aos-security-metric"><b data-security-items>0</b><span>Protected items</span><small>A-OS Files and apps</small></article><article class="aos-security-metric"><b data-security-next>Starting</b><span>Next automatic scan</span><small data-security-next-copy>Runs every 30 seconds</small></article><article class="aos-security-metric"><b data-security-count>0</b><span>Scans completed</span><small>On this device</small></article><section class="aos-security-areas"><header><small>PROTECTION AREAS</small><h2>What A-OS is watching</h2></header><div class="aos-security-row"><img src="/assets/icons/Files.png" alt=""><span><b>A-OS Files</b><small>Saved files and Downloads</small></span><i></i></div><div class="aos-security-row"><img src="/assets/icons/Downloads.png" alt=""><span><b>Apps and A-Store</b><small>Installed, web, and developer apps</small></span><i></i></div><div class="aos-security-row"><img src="/assets/icons/Internet.png" alt=""><span><b>Web and embeds</b><small>Saved web apps and embedded launch data</small></span><i></i></div><div class="aos-security-row"><img src="/assets/icons/Reboot.png" alt=""><span><b>Startup and system</b><small>Restart, lock, and BIOS protection</small></span><i></i></div></section><section class="aos-security-history"><header><small>RECENT ACTIVITY</small><h2>Scan history</h2></header><div data-security-history></div></section></main>';
      root.querySelector("[data-security-action]").addEventListener("click", function (event) {
        var button = event.currentTarget;
        if (button.dataset.mode === "delete") deleteThreat();
        else {
          button.disabled = true;
          button.textContent = "Scanning...";
          window.setTimeout(function () {
            scan("manual");
            button.disabled = false;
            refreshSecurityApp(root);
          }, 450);
        }
      });
      root.querySelector("[data-security-auto]").addEventListener("change", function (event) {
        setAutomaticChecks(event.currentTarget.checked);
      });
      refreshSecurityApp(root);
    });
  }

  function refreshSecurityApps() {
    document.querySelectorAll(".security.aos-security-dashboard").forEach(refreshSecurityApp);
  }

  function suppressExternalFilePickers() {
    document.querySelectorAll('input[type="file"]').forEach(function (input) {
      if (input.dataset.aosAllowedPicker === "true" || /(?:^|,)\s*\.aos(?:\s*,|$)/i.test(input.accept || "")) return;
      input.disabled = true;
      input.hidden = true;
      input.setAttribute("aria-hidden", "true");
    });
    document.querySelectorAll("button,label").forEach(function (control) {
      var text = control.textContent.replace(/\s+/g, " ").trim().toLowerCase();
      var ownedInput = control.matches("label") && control.querySelector('input[type="file"]');
      var ownsFileInput = ownedInput && ownedInput.dataset.aosAllowedPicker !== "true" && !/(?:^|,)\s*\.aos(?:\s*,|$)/i.test(ownedInput.accept || "");
      if (ownsFileInput || /^(upload|upload file|upload files|upload background|upload icon pack|download pc)$/.test(text) || text.indexOf("google drive") !== -1) {
        control.hidden = true;
        control.setAttribute("aria-hidden", "true");
      }
    });
  }

  async function saveAnchorDownload(anchor) {
    var href = anchor.href;
    var name = anchor.download || "download";
    var content = href;
    var mime = "text/uri-list";
    try {
      var response = await fetch(href);
      var blob = await response.blob();
      mime = blob.type || "application/octet-stream";
      content = await new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onload = function () { resolve(String(reader.result)); };
        reader.onerror = function () { reject(reader.error); };
        reader.readAsDataURL(blob);
      });
    } catch (_) {}
    var key = document.documentElement.dataset.aosSurface === "tv" ? "aos-tv-files" : "aos-files";
    var files = parse(localStorage.getItem(key) || "[]", []);
    if (!Array.isArray(files)) files = [];
    files.push({
      id: crypto.randomUUID ? crypto.randomUUID() : "download-" + Date.now(),
      name: name,
      type: "file",
      parent: "downloads",
      content: content,
      mime: mime,
      icon: "Downloads.png"
    });
    localStorage.setItem(key, JSON.stringify(files));
    window.dispatchEvent(new CustomEvent("aos-files-change"));
  }

  document.addEventListener("click", function (event) {
    var download = event.target.closest && event.target.closest("a[download]");
    if (download) {
      event.preventDefault();
      event.stopImmediatePropagation();
      saveAnchorDownload(download);
      return;
    }
    if (document.documentElement.dataset.aosSurface === "tv" || currentThreat) return;
    var button = event.target.closest && event.target.closest("button");
    if (!button || button.closest("#aos-trash-manager")) return;
    if (button.textContent.trim().toLowerCase() === "trash" || String(button.getAttribute("aria-label") || "").toLowerCase() === "trash") {
      event.preventDefault();
      event.stopImmediatePropagation();
      openTrashManager();
    }
  }, true);

  window.addEventListener("DOMContentLoaded", function () {
    ensureStyles();
    suppressExternalFilePickers();
    enhanceSecurityApps();
    new MutationObserver(function () {
      suppressExternalFilePickers();
      enhanceSecurityApps();
    }).observe(document.body, {childList: true, subtree: true});
    window.setInterval(refreshSecurityApps, 1000);
  }, {once: true});

  currentThreat = parse(localStorage.getItem(QUARANTINE_KEY) || "null", null);
  window.AOS_SECURITY_API = {scan: function () { return scan("manual"); }, checkBeforeOpen: checkBeforeOpen, dangerReason: dangerReason, deleteThreat: deleteThreat, openSecurityApp: openSecurityApp, openTrash: openTrashManager, getStatus: getStatus, setAutomaticChecks: setAutomaticChecks};
  if (currentThreat) window.addEventListener("DOMContentLoaded", function () { quarantine(currentThreat); }, {once: true});
  window.addEventListener("DOMContentLoaded", function () {
    schedulePeriodicScans();
    if (automaticChecksEnabled()) scheduleScan(50);
  }, {once: true});
})();
