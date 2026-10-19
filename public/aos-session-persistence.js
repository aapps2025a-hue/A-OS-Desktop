(function () {
  "use strict";

  if (window.AOS_SESSION_PERSISTENCE) return;

  var SNAPSHOT_KEY = "aos-hibernate-snapshot";
  var PENDING_KEY = "aos-hibernate-restore-pending";

  function visible(element) {
    if (!element || !(element instanceof HTMLElement)) return false;
    var style = window.getComputedStyle(element);
    var bounds = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0 && bounds.width > 1 && bounds.height > 1;
  }

  function textOf(element) {
    return String(element && (element.getAttribute("aria-label") || element.title || element.alt || element.textContent) || "").replace(/\s+/g, " ").trim();
  }

  function openApps() {
    var seen = new Set();
    return Array.from(document.querySelectorAll(".system-window, .astore-window-layer, .astore-modal")).filter(visible).map(function (element) {
      var heading = element.querySelector(".window-title, .astore-window-head strong, header b, header strong, header h1, header h2");
      var title = textOf(heading);
      var slug = element.dataset.aStoreSlug || (element.querySelector("[data-a-store-slug]") || {}).dataset && element.querySelector("[data-a-store-slug]").dataset.aStoreSlug || "";
      if (!title || /sign in|choose from|new app file|message from app/i.test(title)) return null;
      var identity = slug || title.toLowerCase();
      if (seen.has(identity)) return null;
      seen.add(identity);
      return {title: title, slug: slug};
    }).filter(Boolean);
  }

  function sessionValues() {
    var values = {};
    try {
      for (var index = 0; index < sessionStorage.length; index += 1) {
        var key = sessionStorage.key(index);
        if (key) values[key] = sessionStorage.getItem(key);
      }
    } catch (_) {}
    return values;
  }

  function save(reason) {
    var snapshot = {
      version: 1,
      reason: reason || "hibernate",
      savedAt: Date.now(),
      apps: openApps(),
      sessionStorage: sessionValues()
    };
    try {
      localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
      if (snapshot.reason === "hibernate") localStorage.setItem(PENDING_KEY, "true");
    } catch (_) {}
    window.dispatchEvent(new CustomEvent("aos-session-saved", {detail: snapshot}));
    return Promise.resolve(snapshot);
  }

  function readSnapshot() {
    try { return JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || "null"); } catch (_) { return null; }
  }

  function restoreSessionValues(snapshot) {
    if (!snapshot || !snapshot.sessionStorage) return;
    Object.keys(snapshot.sessionStorage).forEach(function (key) {
      try { sessionStorage.setItem(key, String(snapshot.sessionStorage[key])); } catch (_) {}
    });
  }

  function normalized(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  function launchControl(title) {
    var wanted = normalized(title);
    if (!wanted) return null;
    var controls = Array.from(document.querySelectorAll(".desktop-icon, .shelf button, button[aria-label], button[title], [role='button'][aria-label]"));
    return controls.find(function (control) {
      if (!visible(control) || control.closest(".system-window, .astore-window-layer, .astore-modal, .login-modern")) return false;
      var labels = [textOf(control), textOf(control.querySelector("img")), textOf(control.querySelector("span"))].map(normalized).filter(Boolean);
      return labels.some(function (label) { return label === wanted || label.indexOf(wanted) !== -1 || wanted.indexOf(label) !== -1; });
    }) || null;
  }

  function restoreOpenApps(snapshot) {
    var apps = Array.isArray(snapshot && snapshot.apps) ? snapshot.apps : [];
    apps.forEach(function (app, index) {
      window.setTimeout(function () {
        window.dispatchEvent(new CustomEvent("aos-restore-app", {detail: app}));
        if (app.slug) return;
        var control = launchControl(app.title);
        if (control) control.click();
      }, index * 220);
    });
  }

  function desktopReady() {
    var desktop = document.querySelector(".desktop, .desktop-modern, [class*='desktop']");
    var visibleLogin = Array.from(document.querySelectorAll(".login-modern")).some(visible);
    return Boolean(desktop && !visibleLogin && document.querySelector(".shelf"));
  }

  function restoreWhenReady(snapshot) {
    var restored = false;
    var observer = new MutationObserver(tryRestore);
    var timer = window.setInterval(function () {
      tryRestore();
    }, 1000);

    function tryRestore() {
      if (restored || !desktopReady()) return;
      restored = true;
      window.clearInterval(timer);
      observer.disconnect();
      restoreOpenApps(snapshot);
      try { localStorage.removeItem(PENDING_KEY); } catch (_) {}
      window.dispatchEvent(new CustomEvent("aos-session-restored", {detail: snapshot}));
    }

    observer.observe(document.documentElement, {childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "hidden"]});
    tryRestore();
  }

  var initialSnapshot = readSnapshot();
  restoreSessionValues(initialSnapshot);
  try {
    if (localStorage.getItem(PENDING_KEY) === "true" && initialSnapshot) {
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { restoreWhenReady(initialSnapshot); }, {once: true});
      else restoreWhenReady(initialSnapshot);
    }
  } catch (_) {}

  window.AOS_SESSION_PERSISTENCE = {save: save, snapshot: readSnapshot};
})();
