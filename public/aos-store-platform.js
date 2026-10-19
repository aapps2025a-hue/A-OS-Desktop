(function () {
  "use strict";

  if (window.AOS_STORE_PLATFORM) return;

  var API_KEY = "AIzaSyDvqfC7dm1umT6pyftRJt2kF1d91uKF_DM";
  var FIRESTORE_PROJECT = "emojis-symbols-online";
  var FIRESTORE_ROOT = "https://firestore.googleapis.com/v1/projects/" + FIRESTORE_PROJECT + "/databases/(default)/documents";
  var SESSION_KEY = "aos-aapplications-session";
  var LOCAL_APPS_KEY = "aos-store-local-apps";
  var INSTALLED_KEY = "aos-store-installed-versions";
  var ANDROID_APK_URL = "https://github.com/aapps2025a-hue/A-OS-Desktop/releases/download/astore-android-v1.0.0/A-Store-Android.apk";
  var APP_APK_RELEASE_URL = "https://github.com/aapps2025a-hue/A-OS-Desktop/releases/download/astore-apps/";
  var APP_APK_RELEASE_API = "https://api.github.com/repos/aapps2025a-hue/A-OS-Desktop/releases/tags/astore-apps";
  var MAX_PACKAGE_BYTES = 720000;
  var MAX_MEDIA_BYTES = 260000;
  var CATEGORIES = ["Business", "Creativity", "Education", "Entertainment", "Games", "Lifestyle", "Music", "News", "Productivity", "Social", "Tools", "Travel", "Web"];
  var TEXT_FILE = /\.(?:html?|css|js|mjs|cjs|json|txt|md|xml|svg|csv|tsv|yml|yaml|toml|ini|conf)$/i;
  var state = {apps: [], loading: false, error: "", refreshedAt: 0, installPrompt: null, apkIndex: {}, apkRefreshedAt: 0};
  var subscribers = new Set();

  var BUILT_INS = [
    {slug: "a-store-dev", name: "A-Store Dev", description: "Build, review, publish, and update A-Store apps from a folder or A-OS Files.", category: "Tools", version: "1.0.0", logo: asset("Code.png"), preview: asset("Code.png"), builtin: true, trusted: true, downloads: 1000},
    {slug: "a-ai", name: "A-AI", description: "The A-OS assistant for ideas, questions, and everyday work.", category: "Productivity", version: "1.0.0", logo: asset("AI Services (Hidden App).png"), preview: asset("AI Services (Hidden App).png"), url: "https://a-ai.web.app/", builtin: true, trusted: true, downloads: 1800},
    {slug: "youtube", name: "YouTube", description: "Watch videos and channels in the YouTube web app.", category: "Entertainment", version: "1.0.0", logo: asset("Video.png"), preview: asset("Video.png"), url: "https://www.youtube.com/", builtin: true, trusted: true, downloads: 4200},
    {slug: "wikipedia", name: "Wikipedia", description: "Read and search the free encyclopedia.", category: "Education", version: "1.0.0", logo: asset("Internet.png"), preview: asset("Internet.png"), url: "https://www.wikipedia.org/", builtin: true, trusted: true, downloads: 2100},
    {slug: "weba", name: "WebA", description: "Open the WebA application collection.", category: "Web", version: "1.0.0", logo: asset("Internet.png"), preview: asset("Internet.png"), url: "https://weba-online.web.app/", builtin: true, trusted: true, downloads: 1450}
  ];

  function asset(name) {
    var base = document.documentElement.dataset.aosStoreStandalone === "true" ? "./assets/icons/" : "/assets/icons/";
    return base + name;
  }

  function safeGet(key, fallback) {
    try {
      var value = localStorage.getItem(key);
      return value === null ? fallback : value;
    } catch (_) {
      return fallback;
    }
  }

  function safeJson(key, fallback) {
    try { return JSON.parse(safeGet(key, "") || "null") || fallback; } catch (_) { return fallback; }
  }

  function safeSet(key, value) {
    try { localStorage.setItem(key, value); return true; } catch (_) { return false; }
  }

  function slugify(value) {
    return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "a-store-app";
  }

  function isAndroidHost() {
    return /Android|A-Store-Android/i.test(navigator.userAgent || "");
  }

  function apkAssetName(app) {
    var version = String(app.version || "1.0.0").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 40) || "1.0.0";
    return "app-" + slugify(app.slug) + "-" + version + ".apk";
  }

  function nativeApkInfo(app) {
    return state.apkIndex[apkAssetName(app)] || null;
  }

  function actionLabel(app) {
    if (isAndroidHost()) return nativeApkInfo(app) ? "Install APK" : "APK building";
    var action = installationState(app);
    return action === "open" ? "Open" : action === "update" ? "Update" : "Install";
  }

  async function loadApkIndex(force) {
    if (!force && state.apkRefreshedAt && Date.now() - state.apkRefreshedAt < 120000) return state.apkIndex;
    try {
      var response = await fetch(APP_APK_RELEASE_API + "?t=" + Date.now(), {cache: "no-store", headers: {accept: "application/vnd.github+json"}});
      if (!response.ok) throw new Error("APK index is not ready");
      var body = await response.json();
      state.apkIndex = {};
      (body.assets || []).forEach(function (releaseAsset) {
        if (!/^app-.+\.apk$/i.test(releaseAsset.name || "")) return;
        state.apkIndex[releaseAsset.name] = {asset: releaseAsset.name, url: releaseAsset.browser_download_url || APP_APK_RELEASE_URL + encodeURIComponent(releaseAsset.name)};
      });
      state.apkRefreshedAt = Date.now();
      emit();
    } catch (_) {
      state.apkRefreshedAt = Date.now();
    }
    return state.apkIndex;
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (character) {
      return {"&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"}[character];
    });
  }

  function notify(message) {
    window.dispatchEvent(new CustomEvent("aos-notification", {detail: {message: message}}));
    if (document.documentElement.dataset.aosStoreStandalone === "true") showToast(message);
  }

  function showToast(message) {
    var old = document.querySelector(".astore-toast");
    if (old) old.remove();
    var toast = document.createElement("div");
    toast.className = "astore-toast";
    toast.style.cssText = "position:fixed;z-index:2147483600;right:18px;bottom:18px;max-width:360px;padding:12px 15px;border:1px solid var(--astore-line);border-radius:7px;color:var(--astore-text);background:var(--astore-panel-solid);box-shadow:var(--astore-shadow);font:12px 'TT Norms',Inter,sans-serif";
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(function () { toast.remove(); }, 4200);
  }

  function readSession() {
    try {
      var session = JSON.parse(safeGet(SESSION_KEY, "null"));
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
      safeSet(SESSION_KEY, JSON.stringify(session));
      return session;
    } catch (_) {
      return null;
    }
  }

  function authMessage(code) {
    return {
      INVALID_LOGIN_CREDENTIALS: "The A-Applications email or password is incorrect.",
      INVALID_EMAIL: "Enter a valid A-Applications email.",
      MISSING_EMAIL: "Enter your A-Applications email.",
      MISSING_PASSWORD: "Enter your A-Applications password.",
      TOO_MANY_ATTEMPTS_TRY_LATER: "Too many attempts. Wait a moment and try again.",
      USER_DISABLED: "This A-Applications account is disabled."
    }[code] || "A-Applications could not sign in. Check the connection and try again.";
  }

  function sessionChanged(session) {
    window.dispatchEvent(new CustomEvent("aos-aapplications-session-change", {detail: {session: session || null}}));
    emit();
  }

  async function signIn(email, password) {
    email = String(email || "").trim().toLowerCase();
    if (!email) throw new Error("Enter your A-Applications email.");
    if (!password) throw new Error("Enter your A-Applications password.");
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
    var session = {
      idToken: result.idToken,
      refreshToken: result.refreshToken,
      uid: result.localId,
      email: String(result.email || email).toLowerCase(),
      expiresAt: Date.now() + Number(result.expiresIn || 3600) * 1000
    };
    safeSet(SESSION_KEY, JSON.stringify(session));
    safeSet("aos-email", session.email);
    sessionChanged(session);
    return session;
  }

  function signOut() {
    try { localStorage.removeItem(SESSION_KEY); } catch (_) {}
    sessionChanged(null);
  }

  function accountLabel() {
    var session = readSession();
    return session ? (session.email || "A-Applications") : "Sign in";
  }

  function updateAccountControls(root) {
    (root || document).querySelectorAll("[data-astore-account]").forEach(function (button) {
      button.classList.toggle("signed-in", Boolean(readSession()));
      var label = button.querySelector("span");
      if (label) label.textContent = accountLabel();
      else button.textContent = accountLabel();
      button.title = readSession() ? "A-Applications account" : "Sign in with A-Applications";
    });
  }

  function openAccountDialog() {
    var existing = document.querySelector(".astore-account-modal");
    if (existing) existing.remove();
    var session = readSession();
    var layer = document.createElement("div");
    layer.className = "astore-modal astore-shell astore-account-modal";
    layer.innerHTML = '<section class="astore-dialog astore-account-dialog" role="dialog" aria-modal="true"><header class="astore-dialog-head"><img src="' + asset("Profile.png") + '" alt=""><span><strong>A-Applications</strong><small>' + (session ? "A-Store account" : "Sign in to A-Store") + '</small></span><button class="astore-close" aria-label="Close"><img src="' + asset("Cross.png") + '" alt=""></button></header><div class="astore-account-body">' + (session
      ? '<p class="astore-account-email">' + escapeHtml(session.email || "Signed in") + '</p><p>Your A-Store publishing identity is active on this device.</p><button class="danger" data-account-signout>Sign out</button>'
      : '<form data-account-form><label class="astore-field">A-Applications email<input type="email" autocomplete="username" data-account-email required></label><label class="astore-field">Password<input type="password" autocomplete="current-password" data-account-password required></label><div class="astore-publish-status" data-account-status>Use the same account you use in A-Applications.</div><button class="primary" type="submit" data-account-submit>Sign in</button></form>') + '</div></section>';
    layer.querySelector(".astore-close").addEventListener("click", function () { layer.remove(); });
    layer.addEventListener("click", function (event) { if (event.target === layer) layer.remove(); });
    if (session) {
      layer.querySelector("[data-account-signout]").addEventListener("click", function () {
        signOut();
        layer.remove();
        notify("Signed out of A-Applications");
      });
    } else {
      var form = layer.querySelector("[data-account-form]");
      form.addEventListener("submit", async function (event) {
        event.preventDefault();
        var button = layer.querySelector("[data-account-submit]");
        var status = layer.querySelector("[data-account-status]");
        button.disabled = true;
        status.className = "astore-publish-status";
        status.textContent = "Signing in...";
        try {
          var account = await signIn(layer.querySelector("[data-account-email]").value, layer.querySelector("[data-account-password]").value);
          layer.remove();
          notify("Signed in to A-Store as " + account.email);
        } catch (error) {
          status.className = "astore-publish-status error";
          status.textContent = error.message;
          button.disabled = false;
        }
      });
    }
    document.body.appendChild(layer);
    var firstInput = layer.querySelector("input");
    if (firstInput) firstInput.focus();
  }

  function fsValue(value) {
    if (value === null || value === undefined) return {nullValue: null};
    if (typeof value === "boolean") return {booleanValue: value};
    if (typeof value === "number") return Number.isInteger(value) ? {integerValue: String(value)} : {doubleValue: value};
    return {stringValue: String(value)};
  }

  function fieldValue(field) {
    if (!field) return undefined;
    if (Object.prototype.hasOwnProperty.call(field, "stringValue")) return field.stringValue;
    if (Object.prototype.hasOwnProperty.call(field, "integerValue")) return Number(field.integerValue);
    if (Object.prototype.hasOwnProperty.call(field, "doubleValue")) return Number(field.doubleValue);
    if (Object.prototype.hasOwnProperty.call(field, "booleanValue")) return Boolean(field.booleanValue);
    return null;
  }

  function decodeAppDocument(document) {
    try {
      var fields = document.fields || {};
      var payload = JSON.parse(fieldValue(fields.payload) || "{}");
      payload.ownerUid = fieldValue(fields.ownerUid) || payload.ownerUid || "";
      payload.downloads = Number(fieldValue(fields.downloads) || 0);
      payload.publishedAt = Number(fieldValue(fields.publishedAt) || payload.publishedAt || 0);
      payload.updatedAt = Number(fieldValue(fields.updatedAt) || payload.updatedAt || 0);
      payload.showcaseUntil = Number(fieldValue(fields.showcaseUntil) || 0);
      payload.slug = payload.slug || document.name.split("/").pop();
      payload.__document = document;
      return normalizeApp(payload);
    } catch (_) {
      return null;
    }
  }

  function normalizeApp(app) {
    var value = Object.assign({}, app || {});
    value.slug = slugify(value.slug || value.name);
    value.name = String(value.name || "Untitled app").slice(0, 64);
    value.description = String(value.description || "An app from A-Store.").slice(0, 400);
    value.category = CATEGORIES.indexOf(value.category) >= 0 ? value.category : "Tools";
    value.version = String(value.version || "1.0.0").slice(0, 20);
    value.logo = String(value.logo || asset("Unnamed app.png"));
    value.preview = String(value.preview || value.logo || asset("Unnamed app.png"));
    value.video = String(value.video || "");
    value.downloads = Number(value.downloads || 0);
    value.showcaseUntil = Number(value.showcaseUntil || 0);
    value.files = value.files && typeof value.files === "object" ? value.files : {};
    value.scan = value.scan && typeof value.scan === "object" ? value.scan : {issues: [], blocked: false};
    if (!value.builtin && value.files["index.html"]) value.scan = scanPackage(value);
    return value;
  }

  function localApps() {
    var apps = safeJson(LOCAL_APPS_KEY, []);
    return Array.isArray(apps) ? apps.map(normalizeApp) : [];
  }

  function storeLocalApp(app) {
    var list = localApps().filter(function (item) { return item.slug !== app.slug; });
    list.push(normalizeApp(app));
    safeSet(LOCAL_APPS_KEY, JSON.stringify(list));
  }

  function mergeCatalog(cloudApps) {
    var bySlug = new Map();
    BUILT_INS.concat(localApps(), cloudApps || []).forEach(function (app) {
      app = normalizeApp(app);
      var current = bySlug.get(app.slug);
      if (!current || Number(app.updatedAt || 0) >= Number(current.updatedAt || 0) || app.builtin) bySlug.set(app.slug, app);
    });
    return Array.from(bySlug.values()).sort(function (left, right) {
      return Number(right.downloads || 0) - Number(left.downloads || 0) || left.name.localeCompare(right.name);
    });
  }

  async function loadCatalog(force) {
    if (state.loading) return state.apps;
    if (!force && state.refreshedAt && Date.now() - state.refreshedAt < 20000) return state.apps;
    state.loading = true;
    state.error = "";
    emit();
    try {
      var response = await fetch(FIRESTORE_ROOT + "/aosStoreApps?pageSize=1000", {cache: "no-store"});
      if (!response.ok) throw new Error("The shared A-Store catalog is not available yet.");
      var body = await response.json();
      var cloudApps = (body.documents || []).map(decodeAppDocument).filter(Boolean);
      state.apps = mergeCatalog(cloudApps);
      state.refreshedAt = Date.now();
    } catch (error) {
      state.apps = mergeCatalog([]);
      state.error = error && error.message || "A-Store is using the local catalog.";
    } finally {
      state.loading = false;
      emit();
    }
    return state.apps;
  }

  function emit() {
    subscribers.forEach(function (listener) {
      try { listener(state); } catch (_) {}
    });
  }

  function subscribe(listener) {
    subscribers.add(listener);
    return function () { subscribers.delete(listener); };
  }

  async function getCloudApp(slug, session) {
    var response = await fetch(FIRESTORE_ROOT + "/aosStoreApps/" + encodeURIComponent(slug), {
      cache: "no-store",
      headers: session ? {authorization: "Bearer " + session.idToken} : {}
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error("A-Store could not read this app.");
    return decodeAppDocument(await response.json());
  }

  async function publishApp(app) {
    var session = await currentSession();
    if (!session) throw new Error("Sign in with A-Applications before publishing to A-Store.");
    app = normalizeApp(app);
    var existing = await getCloudApp(app.slug, session).catch(function () { return null; });
    if (existing && existing.ownerUid && existing.ownerUid !== session.uid) throw new Error("That app name is already used by another developer.");
    var now = Date.now();
    app.ownerUid = session.uid;
    app.publisher = String(session.email || safeGet("aos-profile", "A-Applications developer")).slice(0, 80);
    app.publishedAt = existing ? existing.publishedAt : now;
    app.updatedAt = now;
    app.downloads = existing ? existing.downloads : 0;
    app.showcaseUntil = existing ? existing.showcaseUntil : 0;
    var payload = JSON.stringify(app);
    if (new Blob([payload]).size > MAX_PACKAGE_BYTES) throw new Error("The app package is too large. Keep the complete app under 720 KB.");
    var documentBody = {fields: {
      ownerUid: fsValue(session.uid),
      payload: fsValue(payload),
      downloads: fsValue(app.downloads),
      publishedAt: fsValue(app.publishedAt),
      updatedAt: fsValue(app.updatedAt),
      showcaseUntil: fsValue(app.showcaseUntil)
    }};
    var response = await fetch(FIRESTORE_ROOT + "/aosStoreApps/" + encodeURIComponent(app.slug), {
      method: "PATCH",
      headers: {authorization: "Bearer " + session.idToken, "content-type": "application/json"},
      body: JSON.stringify(documentBody)
    });
    if (!response.ok) {
      var detail = await response.json().catch(function () { return null; });
      throw new Error(detail && detail.error && detail.error.message || "A-Store could not publish the app.");
    }
    storeLocalApp(app);
    await loadCatalog(true);
    return app;
  }

  async function incrementDownload(app) {
    if (app.builtin) return;
    var marker = "aos-store-download-counted:" + app.slug + ":" + app.version;
    if (safeGet(marker, "") === "true") return;
    var session = await currentSession();
    if (!session) return;
    try {
      var latest = await getCloudApp(app.slug, session);
      if (!latest) return;
      var next = Number(latest.downloads || 0) + 1;
      var response = await fetch(FIRESTORE_ROOT + "/aosStoreApps/" + encodeURIComponent(app.slug) + "?updateMask.fieldPaths=downloads", {
        method: "PATCH",
        headers: {authorization: "Bearer " + session.idToken, "content-type": "application/json"},
        body: JSON.stringify({fields: {downloads: fsValue(next)}})
      });
      if (response.ok) safeSet(marker, "true");
    } catch (_) {}
  }

  function installedVersions() {
    var installed = safeJson(INSTALLED_KEY, {});
    return installed && typeof installed === "object" ? installed : {};
  }

  function installationState(app) {
    var installed = installedVersions()[app.slug];
    if (!installed) return "install";
    return installed === app.version ? "open" : "update";
  }

  function installApp(app) {
    var previousState = installationState(app);
    var installed = installedVersions();
    installed[app.slug] = app.version;
    safeSet(INSTALLED_KEY, JSON.stringify(installed));
    if (app.slug === "a-store-dev") safeSet("aos-store-dev-installed", "true");
    if (app.files && app.files["index.html"]) {
      var devApps = safeJson("aos-dev-apps", []);
      if (!Array.isArray(devApps)) devApps = [];
      var packaged = {
        name: app.name,
        domain: app.slug + ".store.a-os.local",
        url: "aos://store/" + app.slug,
        category: app.category,
        description: app.description,
        devCode: compileAppDocument(app),
        version: app.version,
        storeSlug: app.slug,
        icon: app.logo,
        createdAt: new Date().toISOString()
      };
      devApps = devApps.filter(function (item) { return item.storeSlug !== app.slug; });
      devApps.push(packaged);
      safeSet("aos-dev-apps", JSON.stringify(devApps));
    }
    incrementDownload(app);
    notify(app.name + (previousState === "update" ? " updated" : " installed"));
    ensureShelfButton();
    emit();
  }

  function performAppAction(app, button) {
    if (isAndroidHost()) {
      var apk = nativeApkInfo(app);
      if (!apk) {
        notify(app.name + " APK is being built. Refresh A-Store in a few minutes.");
        loadApkIndex(true);
        return;
      }
      incrementDownload(app);
      location.href = apk.url;
      return;
    }
    if (installationState(app) === "open") openApp(app);
    else {
      installApp(app);
      if (button) button.textContent = "Open";
    }
  }

  function normalizePath(path) {
    return String(path || "").replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
  }

  function resolveRelative(base, relative) {
    if (!relative || /^(?:[a-z]+:|\/\/|#|data:|blob:)/i.test(relative)) return relative;
    var baseParts = normalizePath(base).split("/");
    baseParts.pop();
    normalizePath(relative).split("/").forEach(function (part) {
      if (!part || part === ".") return;
      if (part === "..") baseParts.pop();
      else baseParts.push(part);
    });
    return baseParts.join("/");
  }

  function fileDataUrl(path, content) {
    if (typeof content !== "string") return "";
    if (/^data:/i.test(content)) return content;
    var extension = (path.split(".").pop() || "").toLowerCase();
    var mime = {
      png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
      mp4: "video/mp4", webm: "video/webm", mp3: "audio/mpeg", wav: "audio/wav", json: "application/json", css: "text/css", js: "text/javascript"
    }[extension] || "text/plain";
    return "data:" + mime + ";base64," + btoa(unescape(encodeURIComponent(content)));
  }

  function backendBridge(app) {
    var routes = {};
    try {
      var source = app.files["backend/routes.json"] || app.files["backend.json"] || "{}";
      routes = typeof source === "string" ? JSON.parse(source) : source;
    } catch (_) {}
    return "<script>(function(){var routes=" + JSON.stringify(routes) + ";" +
      "window.AStoreBackend={request:function(path,options){var method=((options&&options.method)||'GET').toUpperCase();var route=routes[method+' '+path]||routes[path];return Promise.resolve({ok:route!==undefined,status:route!==undefined?200:404,json:function(){return Promise.resolve(route===undefined?{error:'Route not found'}:route)},text:function(){return Promise.resolve(typeof route==='string'?route:JSON.stringify(route===undefined?{error:'Route not found'}:route))}})},get:function(path){return this.request(path)},post:function(path,body){return this.request(path,{method:'POST',body:body})}};" +
      "var originalOpen=window.open;window.open=function(url){parent.postMessage({type:'astore-open',url:String(url||'')},'*');return null};" +
      "window.alert=function(message){parent.postMessage({type:'astore-alert',app:" + JSON.stringify(app.name) + ",message:String(message)},'*')};" +
      "})();<\/script>";
  }

  function compileAppDocument(app) {
    app = normalizeApp(app);
    var files = app.files || {};
    var html = String(files["index.html"] || "<!doctype html><html><body><h1>" + escapeHtml(app.name) + "</h1></body></html>");
    var parser = new DOMParser();
    var documentNode = parser.parseFromString(html, "text/html");
    documentNode.querySelectorAll("script[src]").forEach(function (element) {
      var path = resolveRelative("index.html", element.getAttribute("src"));
      if (Object.prototype.hasOwnProperty.call(files, path) && typeof files[path] === "string" && !/^data:/i.test(files[path])) {
        element.removeAttribute("src");
        element.textContent = files[path];
      }
    });
    documentNode.querySelectorAll('link[rel~="stylesheet"][href]').forEach(function (element) {
      var path = resolveRelative("index.html", element.getAttribute("href"));
      if (Object.prototype.hasOwnProperty.call(files, path) && typeof files[path] === "string") {
        var style = documentNode.createElement("style");
        style.textContent = files[path];
        element.replaceWith(style);
      }
    });
    documentNode.querySelectorAll("img[src],video[src],audio[src],source[src]").forEach(function (element) {
      var path = resolveRelative("index.html", element.getAttribute("src"));
      if (Object.prototype.hasOwnProperty.call(files, path)) element.setAttribute("src", fileDataUrl(path, files[path]));
    });
    documentNode.querySelectorAll("a[href]").forEach(function (element) {
      var href = element.getAttribute("href");
      var path = resolveRelative("index.html", href);
      if (Object.prototype.hasOwnProperty.call(files, path) && /\.html?$/i.test(path)) {
        element.addEventListener("click", function (event) { event.preventDefault(); });
      } else if (/^https?:/i.test(href || "")) element.setAttribute("target", "_blank");
    });
    documentNode.head.insertAdjacentHTML("afterbegin", backendBridge(app));
    return "<!doctype html>" + documentNode.documentElement.outerHTML;
  }

  function scanPackage(app) {
    var files = app.files || {};
    var metadata = [app.name, app.slug, app.description, app.publisher, app.category].filter(Boolean).join(" ");
    var source = (metadata + Object.keys(files).filter(function (path) { return typeof files[path] === "string" && !/^data:/i.test(files[path]); }).map(function (path) { return "\n/* " + path + " */\n" + files[path]; }).join("")).slice(0, 1200000);
    var issues = [];
    var blocked = "";
    if (!files["index.html"]) blocked = "The folder must contain index.html.";
    if (window.AOS_SECURITY_API && typeof window.AOS_SECURITY_API.dangerReason === "function") {
      blocked = blocked || window.AOS_SECURITY_API.dangerReason({name: app.name, securityScanText: source}, "app");
    }
    if (/\b(?:mirai|xorddos|wanna?cry|tsunami|pnscan|ddos[._:-]?kaiten|jupyter[._:-]?infostealer|magecart|fword|mydoom|lockbit|cryptolocker)\b/i.test(source)) blocked = blocked || "Known malware name or signature";
    if (/(?:localStorage|sessionStorage)\.clear\s*\(|indexedDB\.deleteDatabase\s*\(|caches\.keys\s*\(\)[\s\S]{0,200}caches\.delete/i.test(source)) blocked = blocked || "Code attempts to erase stored application data";
    if (/(?:document\.cookie|localStorage|sessionStorage)[\s\S]{0,180}(?:fetch\s*\(|sendBeacon|WebSocket)/i.test(source)) issues.push("Code may transmit browser data.");
    if (/(?:eval|new\s+Function)\s*\(/i.test(source)) issues.push("Code creates executable JavaScript dynamically.");
    if (/navigator\.(?:credentials|usb|serial|hid)|getUserMedia\s*\(/i.test(source)) issues.push("App requests sensitive device capabilities.");
    if (/window\.open\s*\(|target\s*=\s*["']_blank/i.test(source)) issues.push("App requests external windows; A-OS will keep these inside its browser.");
    if (/(?:setInterval|while\s*\(|for\s*\()[\s\S]{0,280}(?:fetch\s*\(|WebSocket)/i.test(source)) issues.push("Repeated network activity needs review.");
    var packageSize = new Blob([JSON.stringify(app)]).size;
    if (packageSize > MAX_PACKAGE_BYTES) blocked = "The app package is larger than 720 KB.";
    return {blocked: Boolean(blocked), reason: blocked, issues: issues, scannedAt: Date.now(), packageBytes: packageSize, engine: "A-OS Security + 1,000-app reputation baseline"};
  }

  function isEstablished(app, rank) {
    return Boolean(app.trusted || (rank < 1000 && Number(app.downloads || 0) >= 10 && !(app.scan && app.scan.blocked)));
  }

  function reviewText(app, rank) {
    if (app.scan && app.scan.blocked) return {safe: false, title: "A-OS Security blocked this app", detail: app.scan.reason || "Dangerous code was detected."};
    if (!isEstablished(app, rank)) return {safe: false, title: "This app could contain malware", detail: "It is not established in A-Store's 1,000-app reputation list yet. Review its permissions before opening it."};
    if (app.scan && app.scan.issues && app.scan.issues.length) return {safe: false, title: "This app needs extra care", detail: app.scan.issues.join(" ")};
    return {safe: true, title: "Established A-Store app", detail: "This app is in the active 1,000-app reputation list and passed the current A-OS code scan."};
  }

  function appMedia(app, className) {
    if (app.video) return '<video class="' + className + '" src="' + escapeHtml(app.video) + '" muted loop playsinline preload="metadata"></video>';
    return '<img class="' + className + '" src="' + escapeHtml(app.preview || app.logo) + '" alt="">';
  }

  function appCard(app, rank) {
    var review = reviewText(app, rank);
    var article = document.createElement("article");
    article.className = "astore-card";
    article.dataset.slug = app.slug;
    article.innerHTML = '<button class="astore-card-preview" type="button" aria-label="View ' + escapeHtml(app.name) + '">' + appMedia(app, "") + '<span>' + escapeHtml(app.category) + '</span></button>' +
      '<div class="astore-card-body"><button type="button" class="astore-card-logo" aria-label="About ' + escapeHtml(app.name) + '"><img src="' + escapeHtml(app.logo) + '" alt=""></button><div class="astore-card-copy"><strong>' + escapeHtml(app.name) + '</strong><p>' + escapeHtml(app.description) + '</p><small>v' + escapeHtml(app.version) + ' - ' + Number(app.downloads || 0).toLocaleString() + ' downloads</small></div></div>' +
      '<div class="astore-card-footer"><span class="astore-risk' + (review.safe ? " safe" : "") + '">' + escapeHtml(review.safe ? "Verified reputation" : "Review before opening") + '</span><button class="primary" type="button" data-astore-action' + (isAndroidHost() && !nativeApkInfo(app) ? " disabled" : "") + '>' + actionLabel(app) + '</button></div>';
    article.querySelectorAll(".astore-card-preview,.astore-card-logo").forEach(function (button) { button.addEventListener("click", function () { openDetails(app, rank); }); });
    article.querySelector("[data-astore-action]").addEventListener("click", function (event) { performAppAction(app, event.currentTarget); });
    return article;
  }

  function openDetails(app, rank) {
    var review = reviewText(app, rank == null ? state.apps.findIndex(function (item) { return item.slug === app.slug; }) : rank);
    var layer = document.createElement("div");
    layer.className = "astore-modal astore-shell";
    layer.innerHTML = '<section class="astore-dialog" role="dialog" aria-modal="true"><header class="astore-dialog-head"><img src="' + escapeHtml(app.logo) + '" alt=""><span><strong>' + escapeHtml(app.name) + '</strong><small>' + escapeHtml(app.category) + ' - version ' + escapeHtml(app.version) + '</small></span><button class="astore-close" aria-label="Close"><img src="' + asset("Cross.png") + '" alt=""></button></header>' +
      '<div class="astore-detail-body"><div class="astore-detail-media">' + appMedia(app, "") + '</div><div class="astore-detail-copy"><div class="astore-detail-title"><img src="' + escapeHtml(app.logo) + '" alt=""><div><h2>' + escapeHtml(app.name) + '</h2><p>' + escapeHtml(app.publisher || "A-Store publisher") + '</p></div></div><p class="astore-detail-description">' + escapeHtml(app.description) + '</p><div class="astore-review-box' + (review.safe ? " safe" : "") + '"><strong>' + escapeHtml(review.title) + '</strong><p>' + escapeHtml(review.detail) + '</p></div>' + (isAndroidHost() ? '<p class="astore-apk-note">Android installs this as a separate app. Updates keep the same app identity and saved data.</p>' : "") + '<div class="astore-inline-actions"><button class="primary" data-install' + (isAndroidHost() && !nativeApkInfo(app) ? " disabled" : "") + '>' + actionLabel(app) + '</button>' + (app.ownerUid && readSession() && readSession().uid === app.ownerUid ? '<button data-edit>Edit this app</button>' : "") + '</div></div></div></section>';
    layer.addEventListener("click", function (event) { if (event.target === layer) layer.remove(); });
    layer.querySelector(".astore-close").addEventListener("click", function () { layer.remove(); });
    layer.querySelector("[data-install]").addEventListener("click", function () { performAppAction(app, this); });
    var edit = layer.querySelector("[data-edit]");
    if (edit) edit.addEventListener("click", function () { layer.remove(); openDeveloper(app); });
    document.body.appendChild(layer);
    var video = layer.querySelector("video");
    if (video) video.play().catch(function () {});
  }

  function openApp(app) {
    if (app.slug === "a-store-dev") return openDeveloper();
    if (app.url && !app.files["index.html"]) {
      if (document.documentElement.dataset.aosStoreStandalone === "true") {
        location.href = app.url;
      } else {
        localStorage.setItem("aos-browser-pending-tab", JSON.stringify({url: app.url, title: app.name}));
        window.dispatchEvent(new CustomEvent("aos-open-weba", {detail: {url: app.url, title: app.name}}));
        notify(app.name + " opened in OSInternet");
      }
      return;
    }
    if (!app.files["index.html"]) return notify("This app does not include index.html.");
    var layer = document.createElement("div");
    layer.className = "astore-window-layer astore-shell";
    layer.dataset.aStoreSlug = app.slug;
    layer.innerHTML = '<section class="astore-app-window"><header class="astore-window-head"><img src="' + escapeHtml(app.logo) + '" alt=""><span><strong>' + escapeHtml(app.name) + '</strong><small>A-Store app - version ' + escapeHtml(app.version) + '</small></span><button class="astore-close" aria-label="Close"><img src="' + asset("Cross.png") + '" alt=""></button></header><iframe title="' + escapeHtml(app.name) + '" sandbox="allow-scripts allow-forms allow-modals allow-popups allow-downloads" referrerpolicy="no-referrer"></iframe></section>';
    layer.querySelector(".astore-close").addEventListener("click", function () { layer.remove(); ensureShelfButton(); });
    layer.querySelector("iframe").srcdoc = compileAppDocument(app);
    document.body.appendChild(layer);
    ensureShelfButton(app);
  }

  function showAosAlert(appName, message) {
    var layer = document.createElement("div");
    layer.className = "astore-modal astore-shell";
    layer.innerHTML = '<section class="astore-dialog" style="width:min(430px,94vw)"><header class="astore-dialog-head"><img src="' + asset("OS Logo.png") + '" alt=""><span><strong>' + escapeHtml(appName || "A-Store app") + '</strong><small>Message from app</small></span></header><div style="padding:22px"><p style="margin:0 0 18px;line-height:1.55">' + escapeHtml(message) + '</p><button class="primary" data-ok>OK</button></div></section>';
    layer.querySelector("[data-ok]").addEventListener("click", function () { layer.remove(); });
    document.body.appendChild(layer);
  }

  window.addEventListener("message", function (event) {
    var data = event.data;
    if (!data || typeof data !== "object") return;
    if (data.type === "astore-alert") showAosAlert(data.app, data.message);
    if (data.type === "astore-open" && /^https?:\/\//i.test(data.url || "")) {
      if (document.documentElement.dataset.aosStoreStandalone === "true") location.href = data.url;
      else {
        safeSet("aos-browser-pending-tab", JSON.stringify({url: data.url, title: "A-Store link"}));
        window.dispatchEvent(new CustomEvent("aos-open-weba", {detail: {url: data.url, title: "A-Store link"}}));
      }
    }
  });

  function renderCards(container, apps) {
    container.innerHTML = "";
    if (!apps.length) {
      container.innerHTML = '<div class="astore-empty">No apps match this search.</div>';
      return;
    }
    apps.forEach(function (app) { container.appendChild(appCard(app, state.apps.findIndex(function (item) { return item.slug === app.slug; }))); });
  }

  function featuredApps(apps) {
    var now = Date.now();
    return apps.filter(function (app) { return app.showcaseUntil > now || app.downloads >= 1000 || app.builtin && app.downloads >= 1500; });
  }

  function renderFeatured(container, apps) {
    var app = featuredApps(apps)[0];
    if (!app) {
      container.hidden = true;
      return;
    }
    container.hidden = false;
    container.innerHTML = '<div class="astore-featured-media">' + appMedia(app, "") + '</div><div class="astore-featured-copy"><span class="astore-eyebrow">' + (app.showcaseUntil > Date.now() ? "SHOW-OFF APP - THIS WEEK" : "MOST DOWNLOADED") + '</span><h2>' + escapeHtml(app.name) + '</h2><p>' + escapeHtml(app.description) + '</p><div><button class="primary" data-featured-action>View app</button></div></div>';
    container.querySelector("[data-featured-action]").addEventListener("click", function () { openDetails(app, state.apps.indexOf(app)); });
    var video = container.querySelector("video");
    if (video) video.play().catch(function () {});
  }

  function renderStandalone(root) {
    root.className = "astore-shell";
    root.innerHTML = '<header class="astore-topbar"><div class="astore-brand"><span>A</span><div><strong>A-Store</strong><small>Apps for A-OS and Android</small></div></div><label class="astore-search"><img src="' + asset("Search.svg") + '" alt=""><input type="search" placeholder="Search apps, categories, and publishers"></label><div class="astore-actions"><button class="astore-account-button" data-astore-account><img src="' + asset("Profile.png") + '" alt=""><span></span></button><button data-refresh aria-label="Refresh catalog">Refresh</button><button class="astore-install-pwa" data-install-pwa hidden>Install on Windows</button><a class="astore-button" href="' + ANDROID_APK_URL + '">A-Store for Android</a><button class="primary astore-dev-entry" data-dev><img src="' + asset("Code.png") + '" alt="">A-Store Dev</button></div></header><main class="astore-main"><section class="astore-section"><div class="astore-featured" data-featured></div></section><section class="astore-section"><div class="astore-section-head"><div><h2>All apps</h2><p>Every Android app gets its own APK and stable identity. New packages are built within a few minutes of publishing.</p></div><span class="astore-trust-label" data-count></span></div><div class="astore-grid" data-grid></div><div class="astore-error" data-error hidden></div></section></main>';
    var search = root.querySelector("input[type=search]");
    var grid = root.querySelector("[data-grid]");
    var featured = root.querySelector("[data-featured]");
    var error = root.querySelector("[data-error]");
    var installButton = root.querySelector("[data-install-pwa]");
    function refreshView() {
      var query = search.value.trim().toLowerCase();
      var apps = state.apps.filter(function (app) { return !query || (app.name + " " + app.description + " " + app.category + " " + (app.publisher || "")).toLowerCase().includes(query); });
      renderCards(grid, apps);
      renderFeatured(featured, state.apps);
      root.querySelector("[data-count]").textContent = state.apps.length + " apps in catalog";
      error.hidden = !state.error;
      error.textContent = state.error;
      installButton.hidden = !state.installPrompt;
      updateAccountControls(root);
    }
    search.addEventListener("input", refreshView);
    root.querySelector("[data-dev]").addEventListener("click", function () { openDeveloper(); });
    root.querySelector("[data-astore-account]").addEventListener("click", openAccountDialog);
    root.querySelector("[data-refresh]").addEventListener("click", function () { loadCatalog(true); loadApkIndex(true); });
    installButton.addEventListener("click", async function () {
      if (!state.installPrompt) return;
      state.installPrompt.prompt();
      await state.installPrompt.userChoice;
      state.installPrompt = null;
      emit();
    });
    subscribe(refreshView);
    loadCatalog().then(refreshView);
    loadApkIndex().then(refreshView);
  }

  function enhancedStoreSection(store) {
    var section = store.querySelector(".astore-store-extension");
    if (!section) {
      section = document.createElement("section");
      section.className = "astore-store-extension astore-shell";
      section.innerHTML = '<div class="astore-section-head"><div><h2>Developer and community apps</h2><p>New apps publish immediately. Only show-off selections and highly downloaded apps are promoted.</p></div><div class="astore-inline-actions"><button class="astore-account-button" data-astore-account><img src="' + asset("Profile.png") + '" alt=""><span></span></button><a class="astore-button" href="' + ANDROID_APK_URL + '">Android APK</a><button class="astore-dev-entry" data-dev><img src="' + asset("Code.png") + '" alt="">A-Store Dev</button></div></div><div class="astore-featured" data-featured hidden></div><div class="astore-grid" data-grid></div>';
      store.appendChild(section);
      section.querySelector("[data-dev]").addEventListener("click", function () {
        if (installationState(BUILT_INS[0]) !== "open") installApp(BUILT_INS[0]);
        openDeveloper();
      });
      section.querySelector("[data-astore-account]").addEventListener("click", openAccountDialog);
    }
    updateAccountControls(section);
    var community = state.apps.filter(function (app) { return app.slug === "a-store-dev" || !app.builtin; });
    renderCards(section.querySelector("[data-grid]"), community);
    renderFeatured(section.querySelector("[data-featured]"), community);
  }

  function enhanceAosStore(forceRefresh) {
    document.querySelectorAll(".store-modern").forEach(function (store) {
      if (forceRefresh || !store.querySelector(".astore-store-extension")) enhancedStoreSection(store);
    });
  }

  function ensureShelfButton(openAppValue) {
    document.querySelectorAll(".shelf").forEach(function (shelf) {
      var existing = shelf.querySelector("[data-astore-shelf]");
      var shouldShow = Boolean(openAppValue || safeGet("aos-store-dev-installed", "") === "true" && document.querySelector(".astore-dev-window"));
      if (!shouldShow) {
        if (existing) existing.remove();
        return;
      }
      if (existing) return;
      var button = document.createElement("button");
      button.className = "astore-shelf-button";
      button.dataset.astoreShelf = "true";
      button.title = openAppValue ? openAppValue.name : "A-Store Dev";
      button.innerHTML = '<img src="' + escapeHtml(openAppValue ? openAppValue.logo : asset("Code.png")) + '" alt="">';
      button.addEventListener("click", function () { if (openAppValue) openApp(openAppValue); else openDeveloper(); });
      shelf.insertBefore(button, shelf.querySelector(".status") || null);
    });
  }

  function fileIcon(path) {
    if (/\.html?$/i.test(path)) return "html.png";
    if (/\.css$/i.test(path)) return "css.png";
    if (/\.(?:js|mjs|cjs)$/i.test(path)) return "js.png";
    if (/\.(?:png|jpe?g|gif|webp|svg)$/i.test(path)) return "Image.png";
    return "Text Editor.png";
  }

  function readFile(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result)); };
      reader.onerror = function () { reject(reader.error); };
      if (TEXT_FILE.test(file.name) || /^text\//.test(file.type)) reader.readAsText(file);
      else reader.readAsDataURL(file);
    });
  }

  async function importDeviceFolder(fileList) {
    var result = {};
    var files = Array.from(fileList || []);
    if (!files.length) throw new Error("Choose a folder containing index.html.");
    var rootName = (files[0].webkitRelativePath || files[0].name).split("/")[0];
    for (var index = 0; index < files.length; index += 1) {
      var file = files[index];
      if (file.size > MAX_PACKAGE_BYTES) throw new Error(file.name + " is too large for an A-Store package.");
      var path = normalizePath(file.webkitRelativePath || file.name);
      if (path.indexOf(rootName + "/") === 0) path = path.slice(rootName.length + 1);
      if (!path || /(?:^|\/)\.(?:git|svn)(?:\/|$)|(?:^|\/)node_modules(?:\/|$)/i.test(path)) continue;
      result[path] = await readFile(file);
    }
    if (!result["index.html"]) throw new Error("The selected folder does not contain index.html at its top level.");
    return result;
  }

  function aosFilesFolder(folderId) {
    var files = safeJson("aos-files", []);
    if (!Array.isArray(files)) files = [];
    var folder = files.find(function (item) { return item.id === folderId && item.type === "folder"; });
    if (!folder) throw new Error("That A-OS folder is no longer available.");
    var result = {};
    function walk(parentId, prefix) {
      files.filter(function (item) { return item.parent === parentId; }).forEach(function (item) {
        var path = prefix ? prefix + "/" + item.name : item.name;
        if (item.type === "folder") walk(item.id, path);
        else result[normalizePath(path)] = String(item.content == null ? "" : item.content);
      });
    }
    walk(folder.id, "");
    if (!result["index.html"]) throw new Error("This A-OS folder does not contain index.html at its top level.");
    return result;
  }

  function chooseAosFolder() {
    return new Promise(function (resolve, reject) {
      var files = safeJson("aos-files", []);
      var folders = Array.isArray(files) ? files.filter(function (item) { return item.type === "folder"; }) : [];
      var layer = document.createElement("div");
      layer.className = "astore-modal astore-shell";
      layer.innerHTML = '<section class="astore-dialog" style="width:min(520px,94vw)"><header class="astore-dialog-head"><img src="' + asset("Files.png") + '" alt=""><span><strong>Choose from A-OS Files</strong><small>Select the app folder containing index.html</small></span><button class="astore-close"><img src="' + asset("Cross.png") + '" alt=""></button></header><div style="padding:14px;display:grid;gap:7px;max-height:420px;overflow:auto" data-folders></div></section>';
      var list = layer.querySelector("[data-folders]");
      if (!folders.length) list.innerHTML = '<div class="astore-empty">There are no folders in A-OS Files yet.</div>';
      folders.forEach(function (folder) {
        var button = document.createElement("button");
        button.style.cssText = "display:flex;align-items:center;gap:10px;text-align:left";
        button.innerHTML = '<img src="' + asset("Files.png") + '" alt="" style="width:30px;height:30px;object-fit:contain"><span><strong style="display:block">' + escapeHtml(folder.name) + '</strong><small style="color:var(--astore-muted)">A-OS Files folder</small></span>';
        button.addEventListener("click", function () {
          try { var result = aosFilesFolder(folder.id); layer.remove(); resolve(result); } catch (error) { layer.remove(); reject(error); }
        });
        list.appendChild(button);
      });
      layer.querySelector(".astore-close").addEventListener("click", function () { layer.remove(); reject(new Error("Folder selection cancelled.")); });
      document.body.appendChild(layer);
    });
  }

  function askFileName() {
    return new Promise(function (resolve) {
      var layer = document.createElement("div");
      layer.className = "astore-modal astore-shell";
      layer.innerHTML = '<section class="astore-dialog" style="width:min(430px,94vw)"><header class="astore-dialog-head"><img src="' + asset("Text Editor.png") + '" alt=""><span><strong>New app file</strong><small>Use a path such as scripts/app.js</small></span></header><div style="padding:18px"><label class="astore-field">File path<input value="app.js" data-name></label><div class="astore-inline-actions"><button data-cancel>Cancel</button><button class="primary" data-create>Create</button></div></div></section>';
      var input = layer.querySelector("[data-name]");
      layer.querySelector("[data-cancel]").addEventListener("click", function () { layer.remove(); resolve(""); });
      layer.querySelector("[data-create]").addEventListener("click", function () { var value = normalizePath(input.value); layer.remove(); resolve(value); });
      document.body.appendChild(layer);
      input.focus();
      input.select();
    });
  }

  function defaultProject() {
    return {
      "index.html": '<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n  <title>My A-Store App</title>\n  <link rel="stylesheet" href="styles.css">\n</head>\n<body>\n  <main>\n    <h1>My A-Store App</h1>\n    <p>Edit these files, preview the app, then publish it.</p>\n    <button id="hello">Test app</button>\n  </main>\n  <script src="app.js"><\/script>\n</body>\n</html>',
      "styles.css": 'body { margin: 0; min-height: 100vh; display: grid; place-items: center; color: #102334; background: #eef7fb; font-family: system-ui, sans-serif; }\nmain { width: min(520px, 88%); }\nbutton { padding: 10px 14px; }',
      "app.js": 'document.querySelector("#hello").addEventListener("click", function () {\n  alert("Hello from A-Store");\n});'
    };
  }

  function openDeveloper(existingApp) {
    var previous = document.querySelector(".astore-dev-window");
    if (previous) return;
    var project = existingApp && existingApp.files && Object.keys(existingApp.files).length ? Object.assign({}, existingApp.files) : defaultProject();
    var selected = project["index.html"] !== undefined ? "index.html" : Object.keys(project)[0];
    var metadata = {
      name: existingApp ? existingApp.name : "My A-Store App",
      slug: existingApp ? existingApp.slug : "my-a-store-app",
      description: existingApp ? existingApp.description : "A new app made with A-Store Dev.",
      category: existingApp ? existingApp.category : "Tools",
      version: existingApp ? existingApp.version : "1.0.0",
      logo: existingApp ? existingApp.logo : asset("Code.png"),
      preview: existingApp ? existingApp.preview : asset("Code.png"),
      video: existingApp ? existingApp.video : ""
    };
    var layer = document.createElement("div");
    layer.className = "astore-window-layer astore-shell";
    layer.innerHTML = '<section class="astore-dev-window"><header class="astore-window-head"><img src="' + asset("Code.png") + '" alt=""><span><strong>A-Store Dev</strong><small>HTML app studio - folders, local backend routes, publishing, and updates</small></span><button data-preview>Preview</button><button data-publish-panel>Publish</button><button class="astore-close" aria-label="Close"><img src="' + asset("Cross.png") + '" alt=""></button></header><div class="astore-dev-layout"><aside class="astore-dev-files"><div class="astore-dev-toolbar"><button data-new>New file</button><button data-backend>Backend</button></div><div class="astore-dev-toolbar"><button data-aos-folder>A-OS Files</button><button data-device-folder>Device folder</button><input type="file" webkitdirectory multiple hidden data-folder-input></div><div class="astore-file-list" data-file-list></div></aside><main class="astore-dev-editor"><div class="astore-editor-head" data-editor-name></div><textarea class="astore-code-editor" spellcheck="false" data-editor></textarea></main><aside class="astore-dev-publish" data-publish><h3>Publish to A-Store</h3><p>Apps appear in the catalog immediately. Promotion is reserved for one-week show-off selections and highly downloaded apps.</p><label class="astore-field">App name<input data-meta="name" maxlength="64"></label><label class="astore-field">Store ID<input data-meta="slug" maxlength="64"></label><label class="astore-field">Description<textarea data-meta="description" maxlength="400"></textarea></label><label class="astore-field">Category<select data-meta="category">' + CATEGORIES.map(function (category) { return '<option>' + category + '</option>'; }).join("") + '</select></label><label class="astore-field">Version<input data-meta="version" maxlength="20"></label><div class="astore-media-pickers"><label class="astore-media-picker" data-logo-picker>Logo<input type="file" accept="image/*" hidden data-media="logo"></label><label class="astore-media-picker" data-preview-picker>Preview<input type="file" accept="image/*" hidden data-media="preview"></label><label class="astore-media-picker" data-video-picker>Video<input type="file" accept="video/mp4,video/webm" hidden data-media="video"></label></div><label class="astore-field">Preview video URL (optional)<input data-meta="video" placeholder="https://..."></label><div class="astore-login-note" data-login-note></div><div class="astore-publish-status" data-status>Ready to scan this project.</div><div class="astore-inline-actions"><button data-scan>Check app</button><button class="primary" data-submit>Publish now</button></div></aside></div></section>';
    document.body.appendChild(layer);
    ensureShelfButton();
    var editor = layer.querySelector("[data-editor]");
    var fileList = layer.querySelector("[data-file-list]");
    var status = layer.querySelector("[data-status]");
    var publishPanel = layer.querySelector("[data-publish]");

    function updateMediaPicker(kind) {
      var picker = layer.querySelector("[data-" + kind + "-picker]");
      var value = metadata[kind];
      if (kind === "video" && value) picker.innerHTML = '<video src="' + escapeHtml(value) + '" muted></video><input type="file" accept="video/mp4,video/webm" hidden data-media="video">';
      else if (value) picker.innerHTML = '<img src="' + escapeHtml(value) + '" alt=""><input type="file" accept="image/*" hidden data-media="' + kind + '">';
      picker.querySelector("input").addEventListener("change", mediaChange);
    }

    function renderFileList() {
      fileList.innerHTML = "";
      Object.keys(project).sort(function (a, b) { return (a === "index.html" ? -1 : b === "index.html" ? 1 : a.localeCompare(b)); }).forEach(function (path) {
        var row = document.createElement("div");
        row.tabIndex = 0;
        row.setAttribute("role", "button");
        row.className = "astore-file-row" + (path === selected ? " active" : "");
        row.innerHTML = '<img src="' + asset(fileIcon(path)) + '" alt=""><span>' + escapeHtml(path) + '</span><button type="button" class="astore-file-delete" title="Delete file">x</button>';
        row.addEventListener("click", function (event) {
          if (event.target.closest(".astore-file-delete")) return;
          if (selected) project[selected] = editor.value;
          selected = path;
          renderEditor();
          renderFileList();
        });
        row.addEventListener("keydown", function (event) {
          if (event.key !== "Enter" && event.key !== " ") return;
          if (event.target.closest(".astore-file-delete")) return;
          event.preventDefault();
          row.click();
        });
        row.querySelector(".astore-file-delete").addEventListener("click", function (event) {
          event.stopPropagation();
          if (path === "index.html") return notify("index.html is required and cannot be removed.");
          delete project[path];
          if (selected === path) selected = "index.html";
          renderEditor();
          renderFileList();
        });
        fileList.appendChild(row);
      });
    }

    function renderEditor() {
      layer.querySelector("[data-editor-name]").textContent = selected || "No file selected";
      var content = project[selected];
      editor.value = typeof content === "string" && !/^data:/i.test(content) ? content : "Binary asset - replace it by importing the folder again.";
      editor.disabled = typeof content !== "string" || /^data:/i.test(content);
    }

    function syncEditor() {
      if (selected && !editor.disabled) project[selected] = editor.value;
    }

    function syncMetadata() {
      layer.querySelectorAll("[data-meta]").forEach(function (input) { metadata[input.dataset.meta] = input.value.trim(); });
      metadata.slug = slugify(metadata.slug || metadata.name);
    }

    function appDraft() {
      syncEditor();
      syncMetadata();
      return normalizeApp(Object.assign({}, metadata, {files: Object.assign({}, project)}));
    }

    function setStatus(message, kind) {
      status.className = "astore-publish-status" + (kind ? " " + kind : "");
      status.textContent = message;
    }

    async function mediaChange(event) {
      var input = event.currentTarget;
      var file = input.files && input.files[0];
      if (!file) return;
      if (file.size > MAX_MEDIA_BYTES) return setStatus("Keep each logo, preview, or video under 260 KB.", "error");
      metadata[input.dataset.media] = await readFile(file);
      updateMediaPicker(input.dataset.media);
    }

    layer.querySelectorAll("[data-meta]").forEach(function (input) {
      input.value = metadata[input.dataset.meta] || "";
      if (input.dataset.meta === "name") input.addEventListener("input", function () {
        if (!existingApp) layer.querySelector('[data-meta="slug"]').value = slugify(input.value);
      });
    });
    updateMediaPicker("logo");
    updateMediaPicker("preview");
    if (metadata.video) updateMediaPicker("video");
    else layer.querySelector('[data-media="video"]').addEventListener("change", mediaChange);
    layer.querySelectorAll('[data-media="logo"],[data-media="preview"]').forEach(function (input) { input.addEventListener("change", mediaChange); });
    var session = readSession();
    var loginNote = layer.querySelector("[data-login-note]");
    loginNote.innerHTML = session ? "Publishing as <strong>" + escapeHtml(session.email || "your A-Applications account") + "</strong>. Updates keep the same Store ID." : 'Sign in with A-Applications before publishing. <button type="button" data-dev-signin>Sign in</button>';
    var developerSignIn = layer.querySelector("[data-dev-signin]");
    if (developerSignIn) developerSignIn.addEventListener("click", openAccountDialog);
    editor.addEventListener("input", syncEditor);
    layer.querySelector(".astore-close").addEventListener("click", function () { layer.remove(); ensureShelfButton(); });
    layer.querySelector("[data-publish-panel]").addEventListener("click", function () { publishPanel.scrollTop = 0; });
    layer.querySelector("[data-new]").addEventListener("click", async function () {
      var path = await askFileName();
      if (!path) return;
      syncEditor();
      if (project[path] !== undefined) return setStatus("That file already exists.", "error");
      project[path] = /\.json$/i.test(path) ? "{}" : "";
      selected = path;
      renderFileList();
      renderEditor();
    });
    layer.querySelector("[data-backend]").addEventListener("click", function () {
      syncEditor();
      if (!project["backend/routes.json"]) project["backend/routes.json"] = '{\n  "GET /api/hello": {"message": "Hello from the local A-Store backend"},\n  "POST /api/save": {"saved": true}\n}';
      selected = "backend/routes.json";
      renderFileList();
      renderEditor();
      setStatus("Apps can call AStoreBackend.get('/api/hello') or AStoreBackend.post('/api/save', data).", "success");
    });
    layer.querySelector("[data-device-folder]").addEventListener("click", function () { layer.querySelector("[data-folder-input]").click(); });
    layer.querySelector("[data-folder-input]").addEventListener("change", async function (event) {
      try { project = await importDeviceFolder(event.target.files); selected = "index.html"; renderFileList(); renderEditor(); setStatus("Folder imported. Review the files before publishing.", "success"); }
      catch (error) { setStatus(error.message, "error"); }
      event.target.value = "";
    });
    layer.querySelector("[data-aos-folder]").addEventListener("click", async function () {
      try { project = await chooseAosFolder(); selected = "index.html"; renderFileList(); renderEditor(); setStatus("A-OS Files folder imported.", "success"); }
      catch (error) { if (!/cancelled/i.test(error.message)) setStatus(error.message, "error"); }
    });
    layer.querySelector("[data-preview]").addEventListener("click", function () {
      var draft = appDraft();
      var scan = scanPackage(draft);
      draft.scan = scan;
      if (scan.blocked) return setStatus("Preview blocked: " + scan.reason, "error");
      openApp(draft);
    });
    layer.querySelector("[data-scan]").addEventListener("click", function () {
      var scan = scanPackage(appDraft());
      if (scan.blocked) setStatus("Blocked: " + scan.reason, "error");
      else if (scan.issues.length) setStatus("Review warning: " + scan.issues.join(" "), "error");
      else setStatus("No dangerous code was detected. New apps still show an unverified warning until they enter the 1,000-app reputation list.", "success");
    });
    layer.querySelector("[data-submit]").addEventListener("click", async function () {
      var button = this;
      var draft = appDraft();
      if (draft.name.length < 3) return setStatus("Use an app name with at least 3 characters.", "error");
      var scan = scanPackage(draft);
      draft.scan = scan;
      if (scan.blocked) return setStatus("Publishing blocked: " + scan.reason, "error");
      button.disabled = true;
      setStatus("Publishing " + draft.name + "...", "");
      try {
        var published = await publishApp(draft);
        setStatus(published.name + " version " + published.version + " is live in A-Store.", "success");
        notify(published.name + " published to A-Store");
      } catch (error) {
        storeLocalApp(draft);
        setStatus(error.message + " The project is also saved locally on this device.", "error");
      } finally {
        button.disabled = false;
      }
    });
    renderFileList();
    renderEditor();
  }

  function init() {
    window.addEventListener("beforeinstallprompt", function (event) { event.preventDefault(); state.installPrompt = event; emit(); });
    var standaloneRoot = document.querySelector("[data-astore-root]");
    if (standaloneRoot) renderStandalone(standaloneRoot);
    var observer = new MutationObserver(function () { enhanceAosStore(false); ensureShelfButton(); });
    observer.observe(document.documentElement, {childList: true, subtree: true});
    subscribe(function () { enhanceAosStore(true); });
    enhanceAosStore(false);
    loadCatalog();
    loadApkIndex();
    setInterval(function () { loadCatalog(true); }, 30000);
    setInterval(function () { loadApkIndex(false); }, 120000);
    window.addEventListener("storage", function (event) { if (event.key === SESSION_KEY) sessionChanged(readSession()); });
    window.addEventListener("aos-aapplications-session-change", function () { updateAccountControls(document); });
    window.addEventListener("aos-restore-app", function (event) {
      var detail = event.detail || {};
      if (!detail.slug) return;
      var app = state.apps.concat(BUILT_INS).find(function (candidate) { return candidate.slug === detail.slug; });
      if (app) openApp(app);
    });
  }

  window.AOS_STORE_PLATFORM = {
    loadCatalog: loadCatalog,
    openDeveloper: openDeveloper,
    openDetails: openDetails,
    openApp: openApp,
    installApp: installApp,
    publishApp: publishApp,
    loadApkIndex: loadApkIndex,
    scanPackage: scanPackage,
    compileAppDocument: compileAppDocument,
    signIn: signIn,
    signOut: signOut,
    openAccount: openAccountDialog,
    getState: function () { return state; }
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, {once: true});
  else init();
})();
