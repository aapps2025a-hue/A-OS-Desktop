(function () {
  "use strict";

  if (window.top !== window || window.AOS_BOOT_GIF) return;

  var CHOICE_KEY = "aos-boot-gif-choice";
  var APP_GIFS_KEY = "aos-boot-gif-apps";
  var DEFAULT_ID = "default";
  var builtInGifs = [
    {id: DEFAULT_ID, label: "Default", src: "./assets/os/splash.gif", duration: 3400},
    {id: "no-text", label: "No-Text", src: "./assets/os/splash-no-text.gif", duration: 5900}
  ];

  function safeJson(key, fallback) {
    try {
      var value = JSON.parse(localStorage.getItem(key) || "null");
      return value && typeof value === "object" ? value : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function safeSet(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (_) {
      return false;
    }
  }

  function appGifs() {
    var value = safeJson(APP_GIFS_KEY, {});
    return value && !Array.isArray(value) ? value : {};
  }

  function allGifs() {
    var gifs = builtInGifs.slice();
    var packageSource = "";
    var packageName = "A-OS package";
    try {
      packageSource = localStorage.getItem("aos-custom-splash-gif") || "";
      packageName = localStorage.getItem("aos-custom-name") || packageName;
    } catch (_) {}
    if (/^data:image\/gif;base64,/i.test(packageSource) && packageSource.length <= 1200000) {
      gifs.push({id: "aos-package", label: "A-OS package: " + packageName.slice(0, 48), src: packageSource, duration: 5000});
    }
    var apps = appGifs();
    Object.keys(apps).sort(function (left, right) {
      return String(apps[left].label || left).localeCompare(String(apps[right].label || right));
    }).forEach(function (id) {
      var item = apps[id];
      if (!item || !/^data:image\/gif;base64,/i.test(item.src || "")) return;
      gifs.push({
        id: id,
        label: String(item.label || "App boot GIF").slice(0, 72),
        src: item.src,
        duration: Math.max(1200, Math.min(15000, Number(item.duration || 5000)))
      });
    });
    return gifs;
  }

  function selectedGif() {
    var selected = "";
    try { selected = localStorage.getItem(CHOICE_KEY) || DEFAULT_ID; } catch (_) { selected = DEFAULT_ID; }
    return allGifs().find(function (item) { return item.id === selected; }) || builtInGifs[0];
  }

  function setSelected(id) {
    var item = allGifs().find(function (candidate) { return candidate.id === id; }) || builtInGifs[0];
    safeSet(CHOICE_KEY, item.id);
    window.dispatchEvent(new CustomEvent("aos-boot-gif-changed", {detail: {gif: item}}));
    window.dispatchEvent(new CustomEvent("aos-notification", {detail: {message: "Boot GIF changed to " + item.label + ". It will play on the next start."}}));
    updateSettingsControls();
    return item;
  }

  function packageId(app) {
    return "app:" + String(app && (app.slug || app.storeSlug || app.name) || "package")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64);
  }

  function registerPackage(app, activate) {
    var files = app && app.files && typeof app.files === "object" ? app.files : {};
    var source = files["splash.gif"];
    if (typeof source !== "string" || !/^data:image\/gif;base64,/i.test(source)) return null;
    if (source.length > 1200000) return null;

    var id = packageId(app);
    var apps = appGifs();
    apps[id] = {
      label: "App: " + String(app.name || app.slug || "A-OS package").slice(0, 60),
      src: source,
      duration: Math.max(1200, Math.min(15000, Number(app.bootGifDuration || 5000)))
    };
    if (!safeSet(APP_GIFS_KEY, JSON.stringify(apps))) return null;
    window.dispatchEvent(new CustomEvent("aos-boot-gif-registry-changed", {detail: {id: id}}));
    if (activate === true) setSelected(id);
    else updateSettingsControls();
    return id;
  }

  function removePackage(app) {
    var id = packageId(app);
    var apps = appGifs();
    if (!apps[id]) return;
    var wasSelected = false;
    try { wasSelected = localStorage.getItem(CHOICE_KEY) === id; } catch (_) {}
    delete apps[id];
    safeSet(APP_GIFS_KEY, JSON.stringify(apps));
    if (wasSelected) safeSet(CHOICE_KEY, DEFAULT_ID);
    updateSettingsControls();
  }

  window.AOS_BOOT_GIF = {
    list: allGifs,
    current: selectedGif,
    select: setSelected,
    registerPackage: registerPackage,
    removePackage: removePackage,
    requiredPackageFilename: "splash.gif"
  };

  var preferenceStyle = document.createElement("style");
  preferenceStyle.id = "aos-boot-gif-settings-style";
  preferenceStyle.textContent = [
    ".aos-boot-gif-setting{align-items:center!important}",
    ".aos-boot-gif-setting select{min-width:130px;max-width:190px}",
    ".aos-boot-gif-setting small{display:block}",
    "@media(max-width:560px){.aos-boot-gif-setting{align-items:flex-start!important;gap:8px!important;flex-direction:column!important}.aos-boot-gif-setting select{width:100%;max-width:none}}"
  ].join("");
  document.head.appendChild(preferenceStyle);

  function fillSelect(select) {
    var current = selectedGif().id;
    var signature = allGifs().map(function (item) { return item.id + ":" + item.label; }).join("|");
    if (select.dataset.aosBootOptions !== signature) {
      select.textContent = "";
      allGifs().forEach(function (item) {
        var option = document.createElement("option");
        option.value = item.id;
        option.textContent = item.label;
        select.appendChild(option);
      });
      select.dataset.aosBootOptions = signature;
    }
    select.value = current;
  }

  function updateSettingsControls() {
    document.querySelectorAll(".aos-boot-gif-setting select").forEach(fillSelect);
  }

  function addSettingsControls() {
    document.querySelectorAll("select").forEach(function (select) {
      var options = Array.from(select.options).map(function (option) { return option.textContent.trim(); });
      var label = select.closest("label");
      if (!label || label.textContent.indexOf("Taskbar position") === -1 || options.indexOf("Bottom") === -1) return;
      var parent = label.parentElement;
      if (!parent) return;
      var setting = parent.querySelector(".aos-boot-gif-setting");
      if (!setting) {
        setting = document.createElement("label");
        setting.className = "select-setting aos-boot-gif-setting";
        setting.innerHTML = '<span><b>Boot GIF</b><small>Choose the animation shown when A-OS starts</small></span><select aria-label="Boot GIF"></select>';
        label.insertAdjacentElement("afterend", setting);
        setting.querySelector("select").addEventListener("change", function (event) {
          setSelected(event.currentTarget.value);
        });
      }
      fillSelect(setting.querySelector("select"));
    });
  }

  var settingsUpdatePending = false;
  function scheduleSettingsUpdate() {
    if (settingsUpdatePending) return;
    settingsUpdatePending = true;
    window.requestAnimationFrame(function () {
      settingsUpdatePending = false;
      addSettingsControls();
    });
  }

  var settingsObserver = new MutationObserver(scheduleSettingsUpdate);
  settingsObserver.observe(document.documentElement, {childList: true, subtree: true});
  window.addEventListener("aos-boot-gif-registry-changed", scheduleSettingsUpdate);
  window.addEventListener("aos-package-installed", function (event) {
    var detail = event.detail || {};
    registerPackage(detail.app || detail.package || detail, false);
  });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scheduleSettingsUpdate, {once: true});
  else scheduleSettingsUpdate();

  if (document.getElementById("aos-boot-sequence")) return;

  var currentScript = document.currentScript;
  var chosen = selectedGif();
  var source = chosen.src;
  if (!/^data:/i.test(source)) {
    var bootImage = new URL(source, currentScript && currentScript.src || location.href);
    bootImage.searchParams.set("boot", String(Date.now()));
    source = bootImage.href;
  }

  var style = document.createElement("style");
  style.id = "aos-boot-sequence-style";
  style.textContent = [
    "html.aos-is-booting, html.aos-is-booting body { background:#06111f !important; overflow:hidden !important; }",
    "#aos-boot-sequence { position:fixed; inset:0; z-index:2147483647; display:grid; place-items:center; background:#06111f; opacity:1; transition:opacity 700ms ease; }",
    "#aos-boot-sequence.aos-boot-fade { opacity:0; pointer-events:none; }",
    "#aos-boot-sequence img { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; display:block; }",
    "@media (prefers-reduced-motion: reduce) { #aos-boot-sequence { transition-duration:240ms; } }"
  ].join("");

  var overlay = document.createElement("div");
  overlay.id = "aos-boot-sequence";
  overlay.setAttribute("aria-hidden", "true");

  var image = document.createElement("img");
  image.alt = "";
  image.decoding = "sync";
  image.src = source;
  overlay.appendChild(image);

  document.documentElement.classList.add("aos-is-booting");
  document.head.appendChild(style);
  document.documentElement.appendChild(overlay);

  var finished = false;
  function finishBoot() {
    if (finished) return;
    finished = true;
    overlay.classList.add("aos-boot-fade");
    window.setTimeout(function () {
      overlay.remove();
      style.remove();
      document.documentElement.classList.remove("aos-is-booting");
      window.dispatchEvent(new CustomEvent("aos-boot-complete"));
    }, 760);
  }

  image.addEventListener("load", function () {
    var duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 1200 : chosen.duration;
    window.setTimeout(finishBoot, duration);
  }, {once: true});
  image.addEventListener("error", function () {
    window.setTimeout(finishBoot, 350);
  }, {once: true});
  window.setTimeout(finishBoot, Math.max(5200, chosen.duration + 1800));
})();
