(function () {
  "use strict";

  var QUICK_BUTTON_KEY = "aos-show-taskbar-quick-button";
  var POWER_SCREEN_ID = "aos-lock-power-screen";
  var POWER_STATE_KEY = "aos-device-power-state";

  var style = document.createElement("style");
  style.id = "aos-desktop-experience-styles";
  style.textContent = [
    "@media (min-width:601px){",
    ".desktop.shelf-left .shelf,.desktop.shelf-right .shelf{top:12px!important;bottom:12px!important;width:70px!important;height:auto!important;flex-direction:column!important;padding:8px!important;overflow-x:hidden!important;overflow-y:auto!important}",
    ".desktop.shelf-left .shelf{left:12px!important;right:auto!important}",
    ".desktop.shelf-right .shelf{right:12px!important;left:auto!important}",
    ".desktop.shelf-left .search-pill,.desktop.shelf-right .search-pill{display:none!important}",
    ".desktop.shelf-left .shelf>i,.desktop.shelf-right .shelf>i{border-left:0!important;border-top:1px solid #9fb8c9!important;width:38px!important;height:0!important;margin:5px 0!important}",
    ".desktop.shelf-left .status,.desktop.shelf-right .status{flex-direction:column!important;width:52px!important;min-width:52px!important;height:auto!important;min-height:96px!important;margin-left:0!important;margin-top:auto!important;padding:7px 5px!important;gap:7px!important}",
    ".desktop.shelf-left .status>span:nth-child(2),.desktop.shelf-right .status>span:nth-child(2){font-size:10px!important}",
    ".desktop.shelf-left .launcher,.desktop.shelf-left .quick{left:94px!important;right:auto!important;top:auto!important;bottom:12px!important}",
    ".desktop.shelf-right .launcher,.desktop.shelf-right .quick{right:94px!important;left:auto!important;top:auto!important;bottom:12px!important}",
    ".desktop.shelf-left .desk-shortcut{left:94px!important}",
    ".desktop.web-window-active.shelf-left .shelf{left:12px!important;right:auto!important}",
    ".desktop.web-window-active.shelf-right .shelf{right:calc(var(--web-panel-width) + 12px)!important;left:auto!important}",
    "}",
    ".desktop.aos-hide-taskbar-quick .shelf-bird,.desktop.aos-hide-taskbar-quick .shelf-emoji{display:none!important}",
    ".aos-quick-symbol-setting{align-items:center!important}",
    ".aos-quick-symbol-setting input{appearance:none;width:42px;height:24px;border:0;border-radius:20px;background:#a7b7c3;position:relative;cursor:pointer;transition:background .2s}",
    ".aos-quick-symbol-setting input:after{content:'';position:absolute;width:18px;height:18px;left:3px;top:3px;border-radius:50%;background:#fff;box-shadow:0 1px 4px #07182d44;transition:transform .2s}",
    ".aos-quick-symbol-setting input:checked{background:#1184d3}",
    ".aos-quick-symbol-setting input:checked:after{transform:translateX(18px)}",
    ".system-window .os-center-app{color:#e9f2f8!important;background:#07111a!important;width:100%!important;height:calc(100% - 43px)!important;min-height:0!important;display:block!important;overflow:auto!important}",
    ".aos-os-center-runtime{min-height:100%;color:#eaf4fa;background:#07111a;font-family:Inter,system-ui,sans-serif;padding:0 0 34px;overflow:auto}",
    ".aos-os-center-hero{background:#0c1c29;border-bottom:1px solid #ffffff1b;padding:30px;display:grid;grid-template-columns:64px 1fr;gap:18px;align-items:center}",
    ".aos-os-center-hero img{width:60px;height:60px;object-fit:contain}",
    ".aos-os-center-hero small,.aos-os-center-section>small{color:#61d9e7;letter-spacing:1.2px;font-size:9px;font-weight:900}",
    ".aos-os-center-hero h1{font-size:26px;margin:3px 0 4px}",
    ".aos-os-center-hero p,.aos-os-center-card p{color:#9db0be;margin:0;line-height:1.5}",
    ".aos-os-center-main{max-width:980px;margin:auto;padding:24px;display:grid;gap:18px}",
    ".aos-os-center-status{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}",
    ".aos-os-center-card,.aos-os-center-section{background:#0d1a25;border:1px solid #ffffff1d;border-radius:8px;padding:18px}",
    ".aos-os-center-card{display:grid;gap:5px}.aos-os-center-card b{font-size:17px}.aos-os-center-card span{color:#6ce0a9;font-size:10px;font-weight:850}",
    ".aos-os-center-section h2{font-size:19px;margin:5px 0 14px}",
    ".aos-os-center-actions{display:flex;flex-wrap:wrap;gap:9px}",
    ".aos-os-center-actions button,.aos-os-center-actions a{color:#06131d;background:#67d9e7;border:0;border-radius:7px;padding:11px 14px;font-weight:850;text-decoration:none;cursor:pointer}",
    ".aos-os-center-actions .secondary{color:#eaf4fa;background:#193246;border:1px solid #3b5a70}",
    ".aos-os-center-result{color:#9ee8c4;min-height:18px;margin:13px 0 0;font-size:11px;font-weight:750}",
    ".login-power-controls{position:absolute;right:22px;bottom:20px;z-index:25;display:flex;gap:9px}",
    ".login-power-controls button{color:#fff;background:#071827d9;border:1px solid #ffffff48;border-radius:8px;display:flex;align-items:center;gap:8px;padding:9px 12px;font-weight:800;box-shadow:0 8px 28px #0005;cursor:pointer}",
    ".login-power-controls img{width:24px;height:24px;object-fit:contain}",
    ".aos-lock-power-screen{z-index:2147483500;color:#fff;background:#03080e;display:grid;place-content:center;justify-items:center;gap:16px;position:fixed;inset:0;font-family:Inter,system-ui,sans-serif}",
    ".tv-desktop-mode>.aos-lock-power-screen{position:absolute}",
    ".aos-lock-power-screen img{width:88px;height:88px;object-fit:contain}.aos-lock-power-screen h1,.aos-lock-power-screen p{margin:0}",
    ".aos-lock-power-screen p{color:#9fb2c1}.aos-lock-power-screen button{color:#07111a;background:#69dbea;border:0;border-radius:8px;padding:12px 18px;font-weight:900;cursor:pointer}",
    "@media(max-width:700px){.aos-os-center-status{grid-template-columns:1fr}.aos-os-center-hero{grid-template-columns:48px 1fr;padding:22px}.aos-os-center-hero img{width:46px;height:46px}.login-power-controls{right:12px;bottom:10px}.login-power-controls span{display:none}}",
    "@media (hover:none) and (pointer:coarse){.desktop #aos-custom-pointer{display:block}.desktop,.desktop *{cursor:none!important}}"
  ].join("");
  document.head.appendChild(style);

  function quickButtonVisible() {
    return localStorage.getItem(QUICK_BUTTON_KEY) !== "false";
  }

  function applyQuickButtonPreference() {
    document.querySelectorAll(".desktop").forEach(function (desktop) {
      desktop.classList.toggle("aos-hide-taskbar-quick", !quickButtonVisible());
    });
  }

  function addSettingsControls() {
    document.querySelectorAll("select").forEach(function (select) {
      var options = Array.from(select.options).map(function (option) { return option.textContent.trim(); });
      var label = select.closest("label");
      if (!label || label.textContent.indexOf("Taskbar position") === -1 || options.indexOf("Bottom") === -1 || options.indexOf("Top") === -1) return;
      ["Left", "Right"].forEach(function (position) {
        if (options.indexOf(position) !== -1) return;
        var option = document.createElement("option");
        option.value = position;
        option.textContent = position;
        select.appendChild(option);
      });
      var help = label.querySelector("small");
      var helpText = "Place it at the bottom, top, left, or right";
      if (help && help.textContent !== helpText) help.textContent = helpText;

      var parent = label.parentElement;
      if (!parent || parent.querySelector(".aos-quick-symbol-setting")) return;
      var toggleLabel = document.createElement("label");
      toggleLabel.className = "select-setting aos-quick-symbol-setting";
      toggleLabel.innerHTML = '<span><b>Taskbar quick button symbol</b><small>Show the customizable quick-action symbol</small></span><input type="checkbox" aria-label="Show Taskbar quick button symbol">';
      var input = toggleLabel.querySelector("input");
      input.checked = quickButtonVisible();
      input.addEventListener("change", function () {
        localStorage.setItem(QUICK_BUTTON_KEY, input.checked ? "true" : "false");
        applyQuickButtonPreference();
      });
      label.insertAdjacentElement("afterend", toggleLabel);
    });
  }

  function osCenterHtml() {
    return '<div class="aos-os-center-runtime">' +
      '<header class="aos-os-center-hero"><img src="/assets/icons/OS Logo.png" alt=""><div><small>A-OS SYSTEM</small><h1>A-OS Operating System Center</h1><p>Manage this A-OS installation, verify protection, and open system services.</p></div></header>' +
      '<main class="aos-os-center-main">' +
        '<section class="aos-os-center-status"><article class="aos-os-center-card"><span>OPERATIONAL</span><b>System status</b><p>A-OS Desktop is running normally.</p></article><article class="aos-os-center-card"><span>ACTIVE</span><b>Security service</b><p>Real-time scanning is enabled.</p></article><article class="aos-os-center-card"><span>CURRENT</span><b>Release channel</b><p>A-OS 3.0 stable.</p></article></section>' +
        '<section class="aos-os-center-section"><small>DEVICE ACTIONS</small><h2>System tools</h2><div class="aos-os-center-actions"><button type="button" data-os-center-action="updates">Check for updates</button><button type="button" class="secondary" data-os-center-action="files">Open Files</button><a class="secondary" href="https://a-os-tv.web.app" target="_blank" rel="noopener">Open A-OS TV</a></div><p class="aos-os-center-result" data-os-center-result>OS Center is ready.</p></section>' +
        '<section class="aos-os-center-section"><small>ABOUT THIS DEVICE</small><h2>Complete A-OS environment</h2><p>A-OS Files, Security, A-Store, OSInternet, desktop apps, profiles, and device settings are available from this installation.</p></section>' +
      '</main></div>';
  }

  function enhanceOsCenter() {
    document.querySelectorAll(".system-window").forEach(function (windowElement) {
      var title = windowElement.querySelector("header b, header strong");
      if (!title || title.textContent.trim() !== "OS Center") return;
      if (windowElement.querySelector(".aos-os-center-runtime")) return;
      Array.from(windowElement.children).forEach(function (child) {
        if (child.matches("header") || child.matches("button[aria-label*='Resize'], .window-resize, .resize-handle")) return;
        child.remove();
      });
      var root = document.createElement("section");
      root.className = "os-center-app";
      root.innerHTML = osCenterHtml();
      windowElement.appendChild(root);
      root.querySelector("[data-os-center-action='updates']").addEventListener("click", function () {
        var result = root.querySelector("[data-os-center-result]");
        result.textContent = navigator.onLine ? "A-OS is up to date. Security definitions are current." : "Connect to the internet to check for updates.";
      });
      root.querySelector("[data-os-center-action='files']").addEventListener("click", function () {
        var files = document.querySelector('.shelf [aria-label="Files"]');
        if (files) files.click();
      });
    });
  }

  function showPowerScreen(login, mode) {
    var host = login && login.closest ? login.closest(".tv-desktop-mode") || document.body : document.body;
    if (!host) return;
    var previous = document.getElementById(POWER_SCREEN_ID);
    if (previous) previous.remove();
    var nativePower = window.aosPowerBridge && typeof window.aosPowerBridge.perform === "function";
    if (nativePower) localStorage.removeItem(POWER_STATE_KEY);
    else if (mode === "shutdown") localStorage.setItem(POWER_STATE_KEY, "off");
    else if (mode === "hibernate") localStorage.setItem(POWER_STATE_KEY, "hibernating");
    else localStorage.removeItem(POWER_STATE_KEY);
    document.querySelectorAll("audio,video").forEach(function (media) {
      try { media.pause(); } catch (_) {}
    });
    var screen = document.createElement("section");
    screen.id = POWER_SCREEN_ID;
    screen.className = "aos-lock-power-screen";
    var heading = mode === "restart" ? "Restarting A-OS" : mode === "hibernate" ? "A-OS is hibernating" : "A-OS is shut down";
    var message = mode === "restart" ? "Starting system services..." : mode === "hibernate" ? "Your open work is saved. Wake this device to continue where you left off." : "This browser session has powered off. Reload the page to start A-OS again.";
    screen.innerHTML = '<img src="/assets/icons/OS Logo.png" alt=""><h1>' + heading + '</h1><p>' + message + '</p>' + (mode === "hibernate" && !nativePower ? '<button type="button">Wake A-OS</button>' : '');
    host.appendChild(screen);
    if (nativePower) {
      window.aosPowerBridge.perform(mode).catch(function (error) {
        var paragraph = screen.querySelector("p");
        paragraph.textContent = error && error.message ? error.message : "A-OS could not complete the power request.";
      });
      return;
    }
    if (mode === "shutdown") {
      document.title = "A-OS is shut down";
      window.setTimeout(function () { try { window.close(); } catch (_) {} }, 350);
      return;
    }
    if (mode === "hibernate") {
      document.title = "A-OS is hibernating";
      screen.querySelector("button").addEventListener("click", function () {
        localStorage.removeItem(POWER_STATE_KEY);
        document.title = "A-OS Desktop 3.0";
        screen.remove();
      });
      return;
    }
    window.setTimeout(function () {
      if (host.classList && host.classList.contains("tv-desktop-mode")) screen.remove();
      else window.location.reload();
    }, 1400);
  }

  function restorePowerState() {
    if (localStorage.getItem(POWER_STATE_KEY) === "off" && !document.getElementById(POWER_SCREEN_ID)) showPowerScreen(null, "shutdown");
    if (localStorage.getItem(POWER_STATE_KEY) === "hibernating" && !document.getElementById(POWER_SCREEN_ID)) showPowerScreen(null, "hibernate");
  }

  function addLockPowerControls() {
    document.querySelectorAll(".login-modern").forEach(function (login) {
      if (login.querySelector(".login-power-controls")) return;
      var controls = document.createElement("div");
      controls.className = "login-power-controls";
      controls.innerHTML = '<button type="button" data-lock-power="restart"><img src="/assets/icons/Reboot.png" alt=""><span>Restart</span></button><button type="button" data-lock-power="hibernate"><img src="/assets/icons/Shutdown.png" alt=""><span>Hibernate</span></button><button type="button" data-lock-power="shutdown"><img src="/assets/icons/Shutdown.png" alt=""><span>Shut down</span></button>';
      controls.addEventListener("click", function (event) {
        var button = event.target.closest("button[data-lock-power]");
        if (button) showPowerScreen(login, button.dataset.lockPower);
      });
      login.appendChild(controls);
    });
  }

  function addQuickHibernate() {
    document.querySelectorAll(".quick-profile").forEach(function (profile) {
      if (profile.querySelector("[data-aos-power='hibernate']")) return;
      var shutdown = Array.from(profile.querySelectorAll("button")).find(function (button) {
        return /shut down|shutdown/i.test(button.getAttribute("aria-label") || button.title || button.textContent || (button.querySelector("img") && button.querySelector("img").alt) || "");
      });
      if (!shutdown) return;
      var button = document.createElement("button");
      button.type = "button";
      button.dataset.aosPower = "hibernate";
      button.setAttribute("aria-label", "Hibernate");
      button.title = "Hibernate";
      button.innerHTML = '<img src="/assets/icons/Shutdown.png" alt="Hibernate">';
      button.addEventListener("click", function () { showPowerScreen(null, "hibernate"); });
      shutdown.insertAdjacentElement("beforebegin", button);
    });
  }

  function enhance() {
    addSettingsControls();
    applyQuickButtonPreference();
    enhanceOsCenter();
    addLockPowerControls();
    addQuickHibernate();
    restorePowerState();
  }

  var scheduled = false;
  function scheduleEnhance() {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(function () {
      scheduled = false;
      enhance();
    });
  }

  enhance();
  new MutationObserver(scheduleEnhance).observe(document.documentElement, {childList: true, subtree: true});
  window.addEventListener("DOMContentLoaded", scheduleEnhance, {once: true});
  window.addEventListener("storage", scheduleEnhance);
})();
