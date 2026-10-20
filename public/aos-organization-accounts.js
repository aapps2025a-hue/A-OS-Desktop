(function () {
  "use strict";

  if (window.AOS_ORGANIZATION_API) return;

  var API_KEY = "AIzaSyDvqfC7dm1umT6pyftRJt2kF1d91uKF_DM";
  var MODE_KEY = "aos-device-ownership-mode";
  var ACTIVE_KEY = "aos-organization-active";
  var ACCOUNTS_KEY = "aos-organization-accounts";
  var SESSION_KEY = "aos-aapplications-session";
  var DATABASE_NAME = "aos-organization-vaults";
  var STORE_NAME = "workspaces";
  var LOCAL_WORKSPACE_ID = "local-device";
  var saveTimer = 0;

  function parse(value, fallback) {
    try { return JSON.parse(value); } catch (_) { return fallback; }
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (character) {
      return {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[character];
    });
  }

  function modeLabel(mode) {
    return {business: "Business", education: "Education", company: "Company"}[mode] || "Personal";
  }

  function getMode() {
    var mode = localStorage.getItem(MODE_KEY) || "personal";
    return ["personal", "business", "education", "company"].indexOf(mode) === -1 ? "personal" : mode;
  }

  function getActiveAccount() {
    return parse(localStorage.getItem(ACTIVE_KEY) || "null", null);
  }

  function getKnownAccounts() {
    var accounts = parse(localStorage.getItem(ACCOUNTS_KEY) || "[]", []);
    return Array.isArray(accounts) ? accounts : [];
  }

  function isWorkspaceKey(key) {
    if (!/^aos-/.test(key) || /^aos-tv-/.test(key)) return false;
    if (key === MODE_KEY || key === ACTIVE_KEY || key === ACCOUNTS_KEY || key === SESSION_KEY) return false;
    if (key === "aos-device-power-state") return false;
    if (/^aos-(organization|security|antivirus)-/.test(key)) return false;
    return true;
  }

  function collectWorkspace() {
    var workspace = {};
    for (var index = 0; index < localStorage.length; index += 1) {
      var key = localStorage.key(index);
      if (key && isWorkspaceKey(key)) workspace[key] = localStorage.getItem(key);
    }
    return workspace;
  }

  function clearWorkspace() {
    var keys = [];
    for (var index = 0; index < localStorage.length; index += 1) {
      var key = localStorage.key(index);
      if (key && isWorkspaceKey(key)) keys.push(key);
    }
    keys.forEach(function (key) { localStorage.removeItem(key); });
  }

  function applyWorkspace(workspace) {
    clearWorkspace();
    Object.entries(workspace || {}).forEach(function (entry) {
      if (isWorkspaceKey(entry[0]) && entry[1] != null) localStorage.setItem(entry[0], String(entry[1]));
    });
  }

  function openDatabase() {
    return new Promise(function (resolve, reject) {
      var request = indexedDB.open(DATABASE_NAME, 1);
      request.onupgradeneeded = function () {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, {keyPath: "id"});
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }

  async function saveVault(id, workspace, metadata) {
    var database = await openDatabase();
    return new Promise(function (resolve, reject) {
      var transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put({id: id, workspace: workspace, metadata: metadata || {}, updatedAt: Date.now()});
      transaction.oncomplete = function () { database.close(); resolve(); };
      transaction.onerror = function () { database.close(); reject(transaction.error); };
    });
  }

  async function loadVault(id) {
    var database = await openDatabase();
    return new Promise(function (resolve, reject) {
      var transaction = database.transaction(STORE_NAME, "readonly");
      var request = transaction.objectStore(STORE_NAME).get(id);
      request.onsuccess = function () { database.close(); resolve(request.result || null); };
      request.onerror = function () { database.close(); reject(request.error); };
    });
  }

  async function saveCurrentWorkspace() {
    var active = getActiveAccount();
    var id = active && active.uid ? active.uid : LOCAL_WORKSPACE_ID;
    await saveVault(id, collectWorkspace(), active || {type: "local"});
  }

  function rememberAccount(session) {
    var accounts = getKnownAccounts();
    var email = String(session.email || "").toLowerCase();
    var username = email.split("@")[0];
    var next = accounts.filter(function (account) { return account.uid !== session.uid; });
    next.push({uid: session.uid, email: email, username: username, lastLogin: Date.now()});
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(next.slice(-50)));
  }

  function resolveAccountIdentifier(value) {
    var identifier = String(value || "").trim().toLowerCase();
    if (identifier.indexOf("@") !== -1) return identifier;
    var known = getKnownAccounts().find(function (account) {
      return String(account.username || "").toLowerCase() === identifier;
    });
    if (known) return known.email;
    throw new Error("Use the full A-Applications email the first time this account signs in.");
  }

  function authMessage(code) {
    return {
      INVALID_LOGIN_CREDENTIALS: "The username or password is incorrect.",
      INVALID_EMAIL: "Enter a valid A-Applications username or email.",
      MISSING_PASSWORD: "Enter the A-Applications password.",
      TOO_MANY_ATTEMPTS_TRY_LATER: "Too many attempts. Wait a moment and try again.",
      USER_DISABLED: "This A-Applications account is disabled."
    }[code] || "A-Applications could not sign in. Check the connection and try again.";
  }

  async function authenticate(identifier, password) {
    var email = resolveAccountIdentifier(identifier);
    var response = await fetch("https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=" + API_KEY, {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({email: email, password: password, returnSecureToken: true})
    });
    var result = await response.json();
    if (!response.ok || !result.idToken) {
      var code = String(result && result.error && result.error.message || "").split(" ")[0];
      throw new Error(authMessage(code));
    }
    return {
      idToken: result.idToken,
      refreshToken: result.refreshToken,
      uid: result.localId,
      email: String(result.email || email).toLowerCase(),
      expiresAt: Date.now() + Number(result.expiresIn || 3600) * 1000
    };
  }

  async function refreshSession(session) {
    if (!session || !session.refreshToken) throw new Error("Sign in with A-Applications again.");
    if (session.expiresAt > Date.now() + 60000) return session;
    var response = await fetch("https://securetoken.googleapis.com/v1/token?key=" + API_KEY, {
      method: "POST",
      headers: {"content-type": "application/x-www-form-urlencoded"},
      body: new URLSearchParams({grant_type: "refresh_token", refresh_token: session.refreshToken})
    });
    var result = await response.json();
    if (!response.ok || !result.id_token) throw new Error("The A-Applications session expired. Sign in again.");
    var refreshed = {
      idToken: result.id_token,
      refreshToken: result.refresh_token || session.refreshToken,
      uid: result.user_id || session.uid,
      email: session.email,
      expiresAt: Date.now() + Number(result.expires_in || 3600) * 1000
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(refreshed));
    return refreshed;
  }

  async function requestCloudSnapshot(session) {
    session = await refreshSession(session);
    var response = await fetch("/api/a-applications-sync", {
      headers: {authorization: "Bearer " + session.idToken},
      cache: "no-store"
    });
    if (!response.ok) return null;
    var payload = await response.json();
    if (payload && payload.snapshot === null) return null;
    return payload && payload.snapshot && typeof payload.snapshot === "object" ? payload.snapshot : payload;
  }

  function snapshotToWorkspace(snapshot) {
    if (!snapshot || typeof snapshot !== "object") return {};
    var workspace = {};
    if (snapshot.settings && typeof snapshot.settings === "object") {
      Object.entries(snapshot.settings).forEach(function (entry) {
        if (isWorkspaceKey(entry[0])) workspace[entry[0]] = String(entry[1]);
      });
    }
    if (Array.isArray(snapshot.files)) workspace["aos-files"] = JSON.stringify(snapshot.files);
    return workspace;
  }

  function workspaceToSnapshot(workspace) {
    var settings = {};
    Object.entries(workspace || {}).forEach(function (entry) {
      if (entry[0] !== "aos-files" && isWorkspaceKey(entry[0])) settings[entry[0]] = String(entry[1]);
    });
    return {
      version: 1,
      updatedAt: Date.now(),
      device: localStorage.getItem("aos-device") || "A-OS Computer",
      profile: localStorage.getItem("aos-profile") || "Person",
      files: parse(workspace && workspace["aos-files"] || "[]", []),
      settings: settings
    };
  }

  async function saveCloudSnapshot(session, workspace) {
    try {
      session = await refreshSession(session);
      await fetch("/api/a-applications-sync", {
        method: "PUT",
        headers: {authorization: "Bearer " + session.idToken, "content-type": "application/json"},
        body: JSON.stringify(workspaceToSnapshot(workspace)),
        cache: "no-store"
      });
    } catch (_) {}
  }

  function dispatchChange() {
    window.dispatchEvent(new CustomEvent("aos-organization-change", {detail: {mode: getMode(), active: getActiveAccount()}}));
  }

  async function signIn(identifier, password, status, options) {
    if (getMode() === "personal" && !(options && options.allowPersonal)) {
      throw new Error("Choose Business, Education, or Company mode in Settings first.");
    }
    if (status) status.textContent = "Signing in securely...";
    await saveCurrentWorkspace();
    var session = await authenticate(identifier, password);
    if (status) status.textContent = "Loading this account's A-OS data...";
    var localVault = await loadVault(session.uid).catch(function () { return null; });
    var cloudSnapshot = await requestCloudSnapshot(session).catch(function () { return null; });
    var workspace = Object.assign({}, localVault && localVault.workspace || {}, snapshotToWorkspace(cloudSnapshot));
    var profileName = session.email.split("@")[0] || "A-Applications User";

    applyWorkspace(workspace);
    localStorage.setItem("aos-configured", "true");
    localStorage.setItem("aos-profile", profileName);
    localStorage.setItem("aos-email", session.email);
    localStorage.setItem("aos-profiles", JSON.stringify([{name: profileName, email: session.email, role: "standard", aApplicationsEmail: session.email}]));
    localStorage.setItem("aos-aapplications-sync-options", JSON.stringify({files: true, settings: true}));
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    localStorage.setItem(ACTIVE_KEY, JSON.stringify({uid: session.uid, email: session.email, username: profileName, signedInAt: Date.now()}));
    rememberAccount(session);
    await saveVault(session.uid, collectWorkspace(), {email: session.email, username: profileName});
    dispatchChange();
    window.location.reload();
  }

  async function signOut(status) {
    var active = getActiveAccount();
    if (!active) return;
    if (status) status.textContent = "Saving and signing out...";
    var workspace = collectWorkspace();
    await saveVault(active.uid, workspace, active);
    var session = parse(localStorage.getItem(SESSION_KEY) || "null", null);
    if (session) await saveCloudSnapshot(session, workspace);
    var localVault = await loadVault(LOCAL_WORKSPACE_ID).catch(function () { return null; });

    applyWorkspace(localVault && localVault.workspace || {"aos-configured": "true", "aos-profile": "Person", "aos-files": "[]"});
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(ACTIVE_KEY);
    dispatchChange();
    window.location.reload();
  }

  async function saveNow(status) {
    var active = getActiveAccount();
    if (!active) throw new Error("No organization account is signed in.");
    if (status) status.textContent = "Saving account data...";
    var workspace = collectWorkspace();
    await saveVault(active.uid, workspace, active);
    var session = parse(localStorage.getItem(SESSION_KEY) || "null", null);
    if (session) await saveCloudSnapshot(session, workspace);
    if (status) status.textContent = "Account data saved locally and to A-Applications.";
  }

  function ensureStyles() {
    if (document.getElementById("aos-organization-styles")) return;
    var style = document.createElement("style");
    style.id = "aos-organization-styles";
    style.textContent = [
      ".aos-organization-login{position:absolute;z-index:30;left:22px;bottom:20px;color:#eef8fc;font-family:Inter,system-ui,sans-serif}",
      ".aos-organization-login>button{color:#fff;background:#071827df;border:1px solid #ffffff48;border-radius:8px;padding:10px 13px;font-weight:850;cursor:pointer;box-shadow:0 8px 28px #0005}",
      ".aos-organization-login-card{width:min(390px,calc(100vw - 28px));margin-top:8px;background:#0a1721f2;border:1px solid #ffffff38;border-radius:8px;padding:17px;box-shadow:0 20px 60px #0009;display:grid;gap:10px}",
      ".aos-organization-login-card[hidden]{display:none}.aos-organization-login-card h2,.aos-organization-login-card p{margin:0}.aos-organization-login-card h2{font-size:18px}.aos-organization-login-card p,.aos-organization-login-card small{color:#adc0cc;line-height:1.4}",
      ".aos-organization-login-card label{display:grid;gap:5px;font-size:11px;font-weight:850}.aos-organization-login-card input{color:#10202a;background:#fff;border:0;border-radius:6px;padding:11px;font:inherit}",
      ".aos-organization-login-actions{display:flex;gap:8px}.aos-organization-login-actions button{border:0;border-radius:6px;padding:10px 13px;font-weight:850;cursor:pointer}.aos-organization-login-actions button:first-child{color:#06141d;background:#65dbe8}.aos-organization-login-actions .secondary{color:#eaf5fa;background:#243947}",
      ".aos-organization-status{min-height:17px;color:#8fe5bd!important;font-size:10px}",
      ".aos-organization-settings-button{position:relative}.aos-organization-settings{position:absolute;z-index:40;inset:43px 0 0;background:#eef5f8;color:#10232e;font-family:Inter,system-ui,sans-serif;overflow:auto;padding:28px}",
      ".aos-organization-settings-head{display:flex;align-items:flex-start;gap:14px;max-width:900px;margin:auto auto 18px}.aos-organization-settings-head img{width:48px;height:48px;object-fit:contain}.aos-organization-settings-head div{flex:1}.aos-organization-settings h1,.aos-organization-settings h2,.aos-organization-settings p{margin:0}.aos-organization-settings-head p{color:#607783;margin-top:4px}.aos-organization-settings-close{border:0;background:#dce8ed;border-radius:6px;padding:9px 12px;font-weight:850;cursor:pointer}",
      ".aos-organization-settings-main{max-width:900px;margin:auto;display:grid;gap:14px}.aos-organization-card{background:#fff;border:1px solid #cbdce4;border-radius:8px;padding:18px}.aos-organization-card>p{color:#657b86;margin:5px 0 14px}",
      ".aos-organization-modes{display:grid;grid-template-columns:repeat(4,1fr);gap:9px}.aos-organization-modes button{color:#233944;background:#edf4f7;border:1px solid #cadbe2;border-radius:7px;min-height:74px;padding:11px;font-weight:850;cursor:pointer}.aos-organization-modes button.active{color:#fff;background:#0877ad;border-color:#0877ad}.aos-organization-modes small{display:block;margin-top:4px;font-weight:600;opacity:.8}",
      ".aos-organization-account-row{display:flex;align-items:center;gap:11px;border-top:1px solid #dbe7ec;padding:11px 0}.aos-organization-account-row:first-of-type{border-top:0}.aos-organization-account-row span{flex:1;display:grid}.aos-organization-account-row small{color:#758b95}.aos-organization-pill{color:#07608a;background:#d9f1fb;border-radius:100px;padding:5px 8px;font-size:9px;font-weight:900}",
      ".aos-organization-settings-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}.aos-organization-settings-actions button{border:0;border-radius:6px;padding:10px 13px;font-weight:850;cursor:pointer}.aos-organization-save{color:#fff;background:#0877ad}.aos-organization-signout{color:#fff;background:#b73d43}",
      "@media(max-width:700px){.aos-organization-login{left:12px;bottom:62px}.aos-organization-modes{grid-template-columns:1fr 1fr}.aos-organization-settings{padding:18px}.aos-organization-settings-head{align-items:center}}"
    ].join("");
    document.head.appendChild(style);
  }

  function addLockLogin() {
    var mode = getMode();
    document.querySelectorAll(".login-modern").forEach(function (login) {
      var existing = login.querySelector(".aos-organization-login");
      if (mode === "personal") {
        if (existing) existing.remove();
        return;
      }
      if (existing) return;
      var active = getActiveAccount();
      var root = document.createElement("section");
      root.className = "aos-organization-login";
      root.innerHTML = '<button type="button" data-organization-open>' + modeLabel(mode) + ' A-Applications account</button>' +
        '<form class="aos-organization-login-card" hidden><h2>Sign in to this ' + modeLabel(mode).toLowerCase() + ' computer</h2><p>Any A-Applications account can sign in. Its A-OS files and settings replace the previous user until sign out.</p>' +
        '<label>Username or email<input name="identifier" autocomplete="username" required placeholder="name@example.com"></label>' +
        '<label>A-Applications password<input name="password" type="password" autocomplete="current-password" required></label>' +
        '<small>Passwords are sent directly to A-Applications and are never saved on this computer.</small><p class="aos-organization-status" aria-live="polite"></p>' +
        '<div class="aos-organization-login-actions"><button type="submit">Sign in</button><button type="button" class="secondary" data-organization-cancel>Cancel</button>' +
        (active ? '<button type="button" class="secondary" data-organization-signout>Sign out ' + escapeHtml(active.username || active.email) + '</button>' : '') + '</div></form>';
      var card = root.querySelector("form");
      var status = root.querySelector(".aos-organization-status");
      root.querySelector("[data-organization-open]").addEventListener("click", function () { card.hidden = !card.hidden; });
      root.querySelector("[data-organization-cancel]").addEventListener("click", function () { card.hidden = true; status.textContent = ""; });
      root.addEventListener("submit", async function (event) {
        event.preventDefault();
        event.stopPropagation();
        var submit = card.querySelector('button[type="submit"]');
        submit.disabled = true;
        try {
          await signIn(card.elements.identifier.value, card.elements.password.value, status);
        } catch (error) {
          status.textContent = error.message || "Sign in failed.";
          submit.disabled = false;
        }
      });
      var signOutButton = root.querySelector("[data-organization-signout]");
      if (signOutButton) signOutButton.addEventListener("click", function () { signOut(status).catch(function (error) { status.textContent = error.message; }); });
      login.appendChild(root);
    });
  }

  function settingsHtml() {
    var mode = getMode();
    var active = getActiveAccount();
    var accounts = getKnownAccounts();
    var rows = accounts.map(function (account) {
      return '<div class="aos-organization-account-row"><img src="/assets/icons/Profile.png" alt="" width="34" height="34"><span><b>' + escapeHtml(account.username || account.email) + '</b><small>' + escapeHtml(account.email) + ' · Last used ' + new Date(account.lastLogin || 0).toLocaleString() + '</small></span>' + (active && active.uid === account.uid ? '<i class="aos-organization-pill">SIGNED IN</i>' : '') + '</div>';
    }).join("") || '<p>No A-Applications accounts have used this computer yet.</p>';
    return '<section class="aos-organization-settings"><header class="aos-organization-settings-head"><img src="/assets/icons/This PC.png" alt=""><div><h1>Organization computer</h1><p>Configure a shared A-OS Desktop for work, education, or company accounts.</p></div><button class="aos-organization-settings-close" type="button">Close</button></header>' +
      '<main class="aos-organization-settings-main"><article class="aos-organization-card"><h2>Device type</h2><p>Organization modes add A-Applications sign-in to the lock screen and isolate every account workspace.</p><div class="aos-organization-modes">' +
      [["personal", "Personal", "Local profiles only"], ["business", "Business", "Work accounts"], ["education", "Education", "School accounts"], ["company", "Company", "Shared company device"]].map(function (item) {
        return '<button type="button" data-organization-mode="' + item[0] + '" class="' + (mode === item[0] ? "active" : "") + '">' + item[1] + '<small>' + item[2] + '</small></button>';
      }).join("") + '</div></article><article class="aos-organization-card"><h2>Accounts that used this computer</h2><p>Only account names are listed here. Passwords are never stored, and user files are hidden after sign out.</p>' + rows +
      '<div class="aos-organization-settings-actions">' + (active ? '<button type="button" class="aos-organization-save">Save ' + escapeHtml(active.username || active.email) + ' now</button><button type="button" class="aos-organization-signout">Save and sign out</button>' : '') + '</div><p class="aos-organization-status" aria-live="polite"></p></article></main></section>';
  }

  function openSettingsPanel(windowElement) {
    var previous = windowElement.querySelector(".aos-organization-settings");
    if (previous) previous.remove();
    windowElement.insertAdjacentHTML("beforeend", settingsHtml());
    var panel = windowElement.querySelector(".aos-organization-settings");
    var status = panel.querySelector(".aos-organization-status");
    panel.querySelector(".aos-organization-settings-close").addEventListener("click", function () { panel.remove(); });
    panel.querySelectorAll("[data-organization-mode]").forEach(function (button) {
      button.addEventListener("click", function () {
        localStorage.setItem(MODE_KEY, button.dataset.organizationMode);
        dispatchChange();
        openSettingsPanel(windowElement);
        addLockLogin();
      });
    });
    var saveButton = panel.querySelector(".aos-organization-save");
    if (saveButton) saveButton.addEventListener("click", function () { saveNow(status).catch(function (error) { status.textContent = error.message; }); });
    var signOutButton = panel.querySelector(".aos-organization-signout");
    if (signOutButton) signOutButton.addEventListener("click", function () { signOut(status).catch(function (error) { status.textContent = error.message; }); });
  }

  function addSettingsEntry() {
    document.querySelectorAll(".system-window").forEach(function (windowElement) {
      var header = windowElement.querySelector("header");
      if (!header || header.textContent.indexOf("Settings") === -1) return;
      if (windowElement.querySelector(".aos-organization-settings-button")) return;
      var usersButton = Array.from(windowElement.querySelectorAll("button")).find(function (button) { return button.textContent.trim() === "Users"; });
      if (!usersButton || !usersButton.parentElement) return;
      var button = document.createElement("button");
      button.type = "button";
      button.className = usersButton.className + " aos-organization-settings-button";
      button.textContent = "Organization";
      button.addEventListener("click", function () { openSettingsPanel(windowElement); });
      usersButton.insertAdjacentElement("afterend", button);
    });
  }

  function enhance() {
    ensureStyles();
    addLockLogin();
    addSettingsEntry();
  }

  function scheduleEnhance() {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(enhance, 40);
  }

  window.AOS_ORGANIZATION_API = {
    getMode: getMode,
    setMode: function (mode) { localStorage.setItem(MODE_KEY, mode); dispatchChange(); enhance(); },
    getAccounts: getKnownAccounts,
    getActiveAccount: getActiveAccount,
    signIn: signIn,
    signOut: signOut,
    saveNow: saveNow
  };

  window.addEventListener("DOMContentLoaded", function () {
    enhance();
    if (!getActiveAccount()) saveCurrentWorkspace().catch(function () {});
    new MutationObserver(scheduleEnhance).observe(document.body, {childList: true, subtree: true});
    window.setInterval(function () { saveCurrentWorkspace().catch(function () {}); }, 8000);
  }, {once: true});
})();
