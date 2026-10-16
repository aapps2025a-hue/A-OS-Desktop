(function () {
  "use strict";

  if (window.AOS_WINDOW_OPTIONS_API) return;

  var STORAGE_KEY = "aos-app-window-options";
  var observer = null;
  var enhanceQueued = false;

  function parse(value, fallback) {
    try { return JSON.parse(value); } catch (_) { return fallback; }
  }

  function readSettings() {
    var settings = parse(localStorage.getItem(STORAGE_KEY) || "{}", {});
    return settings && typeof settings === "object" ? settings : {};
  }

  function titleFor(windowElement) {
    var title = windowElement.querySelector(":scope > header b");
    return title ? title.textContent.trim() : "Application";
  }

  function keyFor(windowElement) {
    return titleFor(windowElement).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "application";
  }

  function optionFor(windowElement) {
    var settings = readSettings();
    return Object.assign({allowClose: true, backgroundMode: "default", color: "#e8f6fb"}, settings[keyFor(windowElement)] || {});
  }

  function saveOption(windowElement, next) {
    var settings = readSettings();
    settings[keyFor(windowElement)] = Object.assign({}, optionFor(windowElement), next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    applyOption(windowElement);
  }

  function wallpaperValue() {
    var wallpaper = localStorage.getItem("aos-wallpaper") || "Aqua A (Default).png";
    if (/^(?:data:|blob:|https?:)/i.test(wallpaper)) return 'url("' + wallpaper.replace(/"/g, "%22") + '") center / cover no-repeat';
    return 'url("/assets/backgrounds/' + encodeURIComponent(wallpaper) + '") center / cover no-repeat';
  }

  function applyOption(windowElement) {
    var option = optionFor(windowElement);
    var closeButton = windowElement.querySelector(":scope > header .window-controls-center button[aria-label='Close']");
    windowElement.dataset.aosAllowClose = option.allowClose === false ? "false" : "true";
    if (closeButton) {
      closeButton.dataset.aosCloseLocked = option.allowClose === false ? "true" : "false";
      closeButton.title = option.allowClose === false ? "Close disabled for this app" : "Close";
    }
    if (option.backgroundMode === "color") {
      windowElement.classList.add("aos-window-custom-background");
      windowElement.style.setProperty("--aos-app-background", option.color || "#e8f6fb");
    } else if (option.backgroundMode === "wallpaper") {
      windowElement.classList.add("aos-window-custom-background");
      windowElement.style.setProperty("--aos-app-background", wallpaperValue());
    } else {
      windowElement.classList.remove("aos-window-custom-background");
      windowElement.style.removeProperty("--aos-app-background");
    }
  }

  function closeMenus(except) {
    document.querySelectorAll(".aos-window-options-popover").forEach(function (menu) {
      if (menu !== except) menu.remove();
    });
  }

  function openOptions(windowElement, button) {
    var existing = windowElement.querySelector(":scope > .aos-window-options-popover");
    if (existing) {
      existing.remove();
      return;
    }
    closeMenus();
    var option = optionFor(windowElement);
    var menu = document.createElement("section");
    menu.className = "aos-window-options-popover";
    menu.setAttribute("role", "dialog");
    menu.setAttribute("aria-label", titleFor(windowElement) + " window options");
    menu.innerHTML = '<header><img src="/assets/icons/Settings.png" alt=""><span><b>Window options</b><small></small></span><button type="button" data-close-options aria-label="Close options">x</button></header>' +
      '<label class="aos-window-toggle"><span><b>Allow this app to close</b><small>Turn this off to keep the app open.</small></span><input type="checkbox" data-allow-close></label>' +
      '<label><span><b>Window background</b><small>Choose a background for this app.</small></span><select data-background-mode><option value="default">App default</option><option value="color">Custom colour</option><option value="wallpaper">Desktop wallpaper</option></select></label>' +
      '<label data-colour-row><span><b>Background colour</b><small>Used when Custom colour is selected.</small></span><input type="color" data-background-colour></label>' +
      '<button type="button" class="aos-window-reset" data-reset-options>Reset this app</button>';
    menu.querySelector("header small").textContent = titleFor(windowElement);
    var allowClose = menu.querySelector("[data-allow-close]");
    var mode = menu.querySelector("[data-background-mode]");
    var colour = menu.querySelector("[data-background-colour]");
    var colourRow = menu.querySelector("[data-colour-row]");
    allowClose.checked = option.allowClose !== false;
    mode.value = option.backgroundMode || "default";
    colour.value = option.color || "#e8f6fb";
    colourRow.hidden = mode.value !== "color";
    allowClose.addEventListener("change", function () { saveOption(windowElement, {allowClose: allowClose.checked}); });
    mode.addEventListener("change", function () {
      colourRow.hidden = mode.value !== "color";
      saveOption(windowElement, {backgroundMode: mode.value});
    });
    colour.addEventListener("input", function () { saveOption(windowElement, {backgroundMode: "color", color: colour.value}); });
    menu.querySelector("[data-close-options]").addEventListener("click", function () { menu.remove(); });
    menu.querySelector("[data-reset-options]").addEventListener("click", function () {
      var settings = readSettings();
      delete settings[keyFor(windowElement)];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      menu.remove();
      applyOption(windowElement);
    });
    windowElement.appendChild(menu);
    button.setAttribute("aria-expanded", "true");
  }

  function addWindowOptions(windowElement) {
    if (windowElement.dataset.aosWindowOptions === "true") {
      applyOption(windowElement);
      return;
    }
    var header = windowElement.querySelector(":scope > header");
    if (!header) return;
    windowElement.dataset.aosWindowOptions = "true";
    var right = header.lastElementChild;
    if (!right) return;
    var button = document.createElement("button");
    button.type = "button";
    button.className = "aos-window-options-button";
    button.setAttribute("aria-label", "Window options");
    button.setAttribute("aria-expanded", "false");
    button.title = "Window options";
    button.innerHTML = '<img src="/assets/icons/Settings.png" alt="">';
    button.addEventListener("click", function (event) {
      event.stopPropagation();
      openOptions(windowElement, button);
    });
    right.insertBefore(button, right.firstChild);
    applyOption(windowElement);
  }

  function addAosImporter(windowElement) {
    if (titleFor(windowElement) !== "Files" || windowElement.dataset.aosPackageImporter === "true") return;
    var newFile = Array.from(windowElement.querySelectorAll("button")).find(function (button) { return button.textContent.trim() === "New File"; });
    if (!newFile || !newFile.parentElement) return;
    windowElement.dataset.aosPackageImporter = "true";
    var input = document.createElement("input");
    input.type = "file";
    input.accept = ".aos";
    input.hidden = true;
    input.dataset.aosAllowedPicker = "true";
    var button = document.createElement("button");
    button.type = "button";
    button.className = "aos-package-import-button";
    button.textContent = "Get .aos from PC";
    button.addEventListener("click", function () { input.click(); });
    input.addEventListener("change", function () {
      var file = input.files && input.files[0];
      input.value = "";
      if (!file) return;
      if (!/\.aos$/i.test(file.name)) {
        showToast("Choose an .aos package.");
        return;
      }
      if (typeof window.AOS_IMPORT_PACKAGE !== "function") {
        showToast("A-OS package installer is still starting. Try again.");
        return;
      }
      showToast("Checking " + file.name + " before installation...");
      window.AOS_IMPORT_PACKAGE(file);
    });
    newFile.parentElement.insertBefore(button, newFile);
    windowElement.appendChild(input);
  }

  function showToast(message) {
    var old = document.getElementById("aos-window-options-toast");
    if (old) old.remove();
    var toast = document.createElement("div");
    toast.id = "aos-window-options-toast";
    toast.textContent = message;
    document.body.appendChild(toast);
    window.setTimeout(function () { toast.remove(); }, 3200);
  }

  function enhance() {
    enhanceQueued = false;
    document.querySelectorAll(".system-window").forEach(function (windowElement) {
      addWindowOptions(windowElement);
      addAosImporter(windowElement);
    });
  }

  function queueEnhance() {
    if (enhanceQueued) return;
    enhanceQueued = true;
    window.requestAnimationFrame(enhance);
  }

  function ensureStyles() {
    if (document.getElementById("aos-window-options-styles")) return;
    var style = document.createElement("style");
    style.id = "aos-window-options-styles";
    style.textContent = ".aos-window-options-button{width:30px;height:30px;border:0!important;background:transparent!important;display:grid;place-items:center;cursor:pointer;border-radius:6px;padding:4px}.aos-window-options-button:hover{background:#ffffff2b!important}.aos-window-options-button img{width:20px!important;height:20px!important;object-fit:contain}.aos-window-options-popover{position:absolute;z-index:2147483000;right:10px;top:48px;width:min(340px,calc(100% - 20px));color:#eaf6fb;background:#0c1923f5;border:1px solid #ffffff30;border-radius:8px;box-shadow:0 24px 70px #000a;padding:14px;font:13px Inter,system-ui,sans-serif;display:grid;gap:12px}.aos-window-options-popover header{height:auto!important;padding:0 0 10px!important;border-bottom:1px solid #ffffff20;display:flex!important;gap:9px!important;position:static!important}.aos-window-options-popover header>img{width:32px!important;height:32px!important;object-fit:contain}.aos-window-options-popover header span,.aos-window-options-popover label span{display:grid;flex:1}.aos-window-options-popover small{color:#9db2bf}.aos-window-options-popover header button{width:28px;height:28px;border:0;border-radius:5px;background:#263b48;color:#fff;cursor:pointer}.aos-window-options-popover label{display:flex;align-items:center;gap:12px}.aos-window-options-popover select{max-width:132px;background:#fff;color:#16242d;border:0;border-radius:5px;padding:8px}.aos-window-options-popover input[type=checkbox]{width:42px;height:23px;accent-color:#2bc99a}.aos-window-options-popover input[type=color]{width:46px;height:34px;padding:2px;border:1px solid #ffffff38;border-radius:5px;background:transparent}.aos-window-reset{border:0;border-radius:6px;padding:9px 11px;background:#263b48;color:#fff;font-weight:800;cursor:pointer}.system-window .window-controls-center button[data-aos-close-locked=true]{opacity:.35}.system-window.aos-window-custom-background{background:var(--aos-app-background)!important}.system-window.aos-window-custom-background>:not(header):not(.aos-window-options-popover):not(.window-resize-handle){background:var(--aos-app-background)!important}.system-window.aos-window-custom-background>header{background:color-mix(in srgb,#071827 58%,transparent)!important;color:#fff}.aos-package-import-button{border:0;border-radius:8px;background:#0877ad;color:#fff;padding:7px 10px;font-size:12px;font-weight:850;cursor:pointer;white-space:nowrap}#aos-window-options-toast{position:fixed;z-index:2147483647;left:50%;bottom:82px;transform:translateX(-50%);color:#effbff;background:#0b1b25f2;border:1px solid #ffffff36;border-radius:7px;box-shadow:0 14px 48px #0009;padding:11px 15px;font:800 12px Inter,system-ui,sans-serif}";
    document.head.appendChild(style);
  }

  document.addEventListener("click", function (event) {
    var closeButton = event.target.closest && event.target.closest(".system-window > header .window-controls-center button[aria-label='Close']");
    if (closeButton) {
      var windowElement = closeButton.closest(".system-window");
      if (windowElement && optionFor(windowElement).allowClose === false) {
        event.preventDefault();
        event.stopImmediatePropagation();
        showToast(titleFor(windowElement) + " is set to stay open. Change it in Window options.");
        return;
      }
    }
    if (!event.target.closest || !event.target.closest(".aos-window-options-popover,.aos-window-options-button")) closeMenus();
  }, true);

  window.addEventListener("DOMContentLoaded", function () {
    ensureStyles();
    queueEnhance();
    observer = new MutationObserver(queueEnhance);
    observer.observe(document.body, {childList: true, subtree: true});
  }, {once: true});

  window.AOS_WINDOW_OPTIONS_API = {refresh: queueEnhance, getSettings: readSettings};
})();
