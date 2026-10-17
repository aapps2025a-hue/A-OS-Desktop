(function () {
  "use strict";

  var RESTORE_VERSION = "2026-10-17-classic-3";
  var ASSET_VERSION = "20261017-classic3";
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

  function versionClassicAsset(value) {
    if (!value || /^(data:|blob:)/i.test(value)) return value;
    try {
      var url = new URL(value, document.baseURI);
      if (url.origin !== window.location.origin) return value;
      if (!/\/assets\/(icons|backgrounds)\//.test(url.pathname)) return value;
      if (url.searchParams.get("v") === ASSET_VERSION) return value;
      url.searchParams.set("v", ASSET_VERSION);
      return url.href;
    } catch (_) {
      return value;
    }
  }

  function refreshClassicAssets(root) {
    var scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll("img[src], source[src]").forEach(function (asset) {
      var source = asset.getAttribute("src");
      var versioned = versionClassicAsset(source);
      if (versioned !== source) asset.setAttribute("src", versioned);
    });

    scope.querySelectorAll("[style]").forEach(function (element) {
      var background = element.style && element.style.backgroundImage;
      if (!background || background.indexOf("url(") === -1) return;
      var versioned = background.replace(/url\((["']?)(.*?)\1\)/g, function (_, quote, source) {
        return "url(\"" + versionClassicAsset(source) + "\")";
      });
      if (versioned !== background) element.style.backgroundImage = versioned;
    });

    document.querySelectorAll("link[rel~='icon'][href]").forEach(function (asset) {
      var source = asset.getAttribute("href");
      var versioned = versionClassicAsset(source);
      if (versioned !== source) asset.setAttribute("href", versioned);
    });
  }

  try { restoreClassicArtwork(); } catch (_) {}
  document.documentElement.classList.add("aos-classic-artwork");

  function startCleanup() {
    removeEmojiSettings(document);
    refreshClassicAssets(document);
    var pending = 0;
    new MutationObserver(function () {
      window.clearTimeout(pending);
      pending = window.setTimeout(function () {
        removeEmojiSettings(document);
        refreshClassicAssets(document);
      }, 20);
    }).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["src", "style"],
      childList: true,
      subtree: true
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startCleanup, { once: true });
  } else {
    startCleanup();
  }
})();
