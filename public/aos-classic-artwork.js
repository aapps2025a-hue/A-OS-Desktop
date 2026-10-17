(function () {
  "use strict";

  var RESTORE_VERSION = "2026-10-17-classic-2";
  var VERSION_KEY = "aos-classic-artwork-version";
  var BACKUP_KEY = "aos-classic-artwork-backup";

  function readJson(value, fallback) {
    try { return JSON.parse(value); } catch (_) { return fallback; }
  }

  function restoreOverpowered(value) {
    var settings = typeof value === "string" ? readJson(value, {}) : (value || {});
    settings.iconPack = "Default";
    return settings;
  }

  function restoreAppOverrides(value) {
    var overrides = typeof value === "string" ? readJson(value, {}) : (value || {});
    Object.keys(overrides).forEach(function (appId) {
      if (!overrides[appId] || typeof overrides[appId] !== "object") return;
      delete overrides[appId].icon;
    });
    return overrides;
  }

  function restoreWorkspace(key) {
    var workspace = readJson(localStorage.getItem(key), null);
    if (!workspace || typeof workspace !== "object") return;

    workspace["aos-wallpaper"] = "Aqua A (Default).png";
    workspace["aos-icon-pack"] = "{}";
    if (workspace["aos-app-overrides"] !== undefined) {
      workspace["aos-app-overrides"] = JSON.stringify(restoreAppOverrides(workspace["aos-app-overrides"]));
    }
    if (workspace["aos-overpowered"] !== undefined) {
      workspace["aos-overpowered"] = JSON.stringify(restoreOverpowered(workspace["aos-overpowered"]));
    }
    localStorage.setItem(key, JSON.stringify(workspace));
  }

  function restoreClassicArtwork() {
    if (localStorage.getItem(VERSION_KEY) === RESTORE_VERSION) return;

    if (!localStorage.getItem(BACKUP_KEY)) {
      localStorage.setItem(BACKUP_KEY, JSON.stringify({
        wallpaper: localStorage.getItem("aos-wallpaper"),
        iconPack: localStorage.getItem("aos-icon-pack"),
        appOverrides: localStorage.getItem("aos-app-overrides"),
        overpowered: localStorage.getItem("aos-overpowered")
      }));
    }

    localStorage.setItem("aos-wallpaper", "Aqua A (Default).png");
    localStorage.setItem("aos-icon-pack", "{}");

    var appOverridesValue = localStorage.getItem("aos-app-overrides");
    if (appOverridesValue !== null) {
      localStorage.setItem("aos-app-overrides", JSON.stringify(restoreAppOverrides(appOverridesValue)));
    }

    var overpoweredValue = localStorage.getItem("aos-overpowered");
    if (overpoweredValue !== null) {
      localStorage.setItem("aos-overpowered", JSON.stringify(restoreOverpowered(overpoweredValue)));
    }

    for (var index = 0; index < localStorage.length; index += 1) {
      var key = localStorage.key(index);
      if (key && key.indexOf("aos-profile-workspace-") === 0) restoreWorkspace(key);
    }

    localStorage.setItem(VERSION_KEY, RESTORE_VERSION);
  }

  function removeEmojiSettings(root) {
    var scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll("h3").forEach(function (heading) {
      if ((heading.textContent || "").trim() !== "System Emoji Pack") return;
      var card = heading.closest("div.p-6");
      if (card) card.remove();
    });

    scope.querySelectorAll("p").forEach(function (paragraph) {
      if ((paragraph.textContent || "").indexOf("System diagnostics, uptime, emoji packs") !== -1) {
        paragraph.textContent = "System diagnostics, uptime, live index editor, and full system backup.";
      }
    });
  }

  try { restoreClassicArtwork(); } catch (_) {}
  document.documentElement.classList.add("aos-classic-artwork");

  function startCleanup() {
    removeEmojiSettings(document);
    var pending = 0;
    new MutationObserver(function () {
      window.clearTimeout(pending);
      pending = window.setTimeout(function () { removeEmojiSettings(document); }, 20);
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startCleanup, { once: true });
  } else {
    startCleanup();
  }
})();
