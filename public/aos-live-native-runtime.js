(function () {
  "use strict";

  if (!window.AOS_NATIVE_BRIDGE || window.AOS_LIVE_NATIVE_RUNTIME) return;
  window.AOS_LIVE_NATIVE_RUNTIME = true;

  var baseUrl = new URL("./", document.currentScript ? document.currentScript.src : window.location.href);
  var panel = null;
  var panelTab = "wifi";
  var scanTimer = 0;
  var mutationTimer = 0;
  var emojiAssetsPromise = null;
  var hardwareControlTimer = 0;

  function notify(message) {
    window.dispatchEvent(new CustomEvent("aos-notification", {
      detail: {message: String(message)}
    }));
  }

  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function nativeError(error) {
    var message = error && error.message ? error.message : "The hardware service could not complete this request.";
    notify(message);
  }

  function closePanel() {
    if (panel) panel.remove();
    panel = null;
    window.clearTimeout(scanTimer);
  }

  function panelShell() {
    var overlay = element("div", "aos-native-panel");
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "A-OS device controls");
    overlay.addEventListener("mousedown", function (event) {
      if (event.target === overlay) closePanel();
    });

    var windowNode = element("section", "aos-native-panel__window");
    var header = element("header", "aos-native-panel__header");
    var icon = document.createElement("img");
    icon.src = new URL("./assets/icons/Settings.png", baseUrl).href;
    icon.alt = "";
    var title = element("strong", "", panelTab === "update" ? "A-OS Update" : "Device controls");
    var close = element("button", "aos-native-panel__close", "\u00d7");
    close.type = "button";
    close.setAttribute("aria-label", "Close");
    close.addEventListener("click", closePanel);
    header.append(icon, title, close);

    var tabs = element("nav", "aos-native-panel__tabs");
    var entries = [["internet", "Internet"], ["wifi", "Wi-Fi"], ["bluetooth", "Bluetooth"], ["update", "Updates"]];
    if (!(window.AOS_NATIVE_BRIDGE.state || {}).persistent) entries.push(["install", "Install"]);
    entries.forEach(function (entry) {
      if (panelTab === "update") return;
      var button = element("button", "", entry[1]);
      button.type = "button";
      button.dataset.tab = entry[0];
      button.setAttribute("aria-selected", String(entry[0] === panelTab));
      button.addEventListener("click", function () {
        if (entry[0] === "update") {
          openUpdatePanel();
          return;
        }
        if (entry[0] === "install") {
          closePanel();
          if (window.AOS_INSTALLATION_WIZARD && typeof window.AOS_INSTALLATION_WIZARD.open === "function") {
            window.AOS_INSTALLATION_WIZARD.open();
          } else {
            nativeError(new Error("The A-OS installer is not available."));
          }
          return;
        }
        panelTab = entry[0];
        renderPanel();
      });
      tabs.appendChild(button);
    });

    var body = element("main", "aos-native-panel__body");
    windowNode.append(header, tabs, body);
    overlay.appendChild(windowNode);
    document.body.appendChild(overlay);
    return overlay;
  }

  function toolbar(label, enabled, onToggle, onRefresh) {
    var bar = element("div", "aos-native-panel__toolbar");
    var status = element("span", "");
    status.append(element("b", "", label), element("small", "", enabled ? "On" : "Off"));
    var toggle = element("button", "", enabled ? "Turn off" : "Turn on");
    toggle.type = "button";
    toggle.addEventListener("click", function () {
      toggle.disabled = true;
      Promise.resolve(onToggle(!enabled)).then(renderPanel).catch(nativeError);
    });
    bar.append(status, toggle);
    if (onRefresh) {
      var refresh = element("button", "primary", "Scan");
      refresh.type = "button";
      refresh.addEventListener("click", onRefresh);
      bar.appendChild(refresh);
    }
    return bar;
  }

  function wifiDevice(item) {
    var row = element("article", "aos-native-device");
    var details = element("span", "");
    details.append(
      element("b", "", item.ssid),
      element("small", "", (item.connected ? "Connected | " : "") + item.strength + "% | " + (item.security || (item.secure ? "Secured" : "Open")))
    );
    var password = document.createElement("input");
    password.type = "password";
    password.placeholder = item.secure ? "Wi-Fi password" : "Open network";
    password.autocomplete = "current-password";
    password.disabled = !item.secure || item.connected;
    var connect = element("button", item.connected ? "" : "primary", item.connected ? "Connected" : "Connect");
    connect.type = "button";
    connect.disabled = Boolean(item.connected);
    connect.addEventListener("click", function () {
      connect.disabled = true;
      connect.textContent = "Connecting";
      window.aosNetworkBridge.connect(item.ssid, password.value).then(function (ok) {
        if (!ok) throw new Error("A-OS could not connect to " + item.ssid + ".");
        notify("Connected to " + item.ssid + ".");
        renderPanel();
      }).catch(function (error) {
        connect.disabled = false;
        connect.textContent = "Connect";
        nativeError(error);
      });
    });
    row.append(details, password, connect);
    return row;
  }

  function bluetoothDevice(item) {
    var row = element("article", "aos-native-device");
    var details = element("span", "");
    details.append(
      element("b", "", item.name || "Bluetooth device"),
      element("small", "", item.address + (item.paired ? " | Paired" : "") + (item.connected ? " | Connected" : ""))
    );
    var connect = element("button", item.connected ? "" : "primary", item.connected ? "Connected" : (item.paired ? "Connect" : "Pair"));
    connect.type = "button";
    connect.disabled = Boolean(item.connected);
    connect.addEventListener("click", function () {
      connect.disabled = true;
      connect.textContent = item.paired ? "Connecting" : "Pairing";
      window.aosBluetoothBridge.connect(item.address).then(function () {
        notify("Connected to " + (item.name || item.address) + ".");
        renderPanel();
      }).catch(function (error) {
        connect.disabled = false;
        connect.textContent = item.paired ? "Connect" : "Pair";
        nativeError(error);
      });
    });
    row.append(details, connect);
    return row;
  }

  function renderPanel() {
    closePanel();
    panel = panelShell();
    var body = panel.querySelector(".aos-native-panel__body");
    var state = window.AOS_NATIVE_BRIDGE.state || {};
    var isInternet = panelTab === "internet";
    var isWifi = panelTab === "wifi";
    var enabled = isInternet ? Boolean(state.networking && state.networking.enabled) : isWifi ? Boolean(state.wifi && state.wifi.enabled) : Boolean(state.bluetooth && state.bluetooth.enabled);
    body.appendChild(toolbar(
      isInternet ? "Internet access" : isWifi ? "Wi-Fi" : "Bluetooth",
      enabled,
      function (next) {
        return isInternet ? window.aosNetworkBridge.toggleInternet(next) : isWifi ? window.aosNetworkBridge.toggle(next) : window.aosBluetoothBridge.toggle(next);
      },
      isInternet ? null : function () { loadDevices(body, isWifi); }
    ));
    if (isInternet) {
      var connectivity = state.connectivity || {};
      body.appendChild(element("p", "aos-native-empty", enabled ? (connectivity.message || "Internet access is enabled for Ethernet, Wi-Fi, A-OS apps, and embedded websites.") : "Internet access is off. Local A-OS files and settings still work."));
      if (enabled) {
        var check = element("button", "primary", "Check connection");
        check.type = "button";
        check.addEventListener("click", function () {
          check.disabled = true;
          check.textContent = "Checking";
          window.aosNetworkBridge.check().then(renderPanel).catch(nativeError);
        });
        body.appendChild(check);
      }
    } else {
      loadDevices(body, isWifi);
    }
  }

  function loadDevices(body, isWifi) {
    body.querySelectorAll(".aos-native-device, .aos-native-empty").forEach(function (node) { node.remove(); });
    var loading = element("p", "aos-native-empty", isWifi ? "Searching for nearby Wi-Fi networks..." : "Searching for nearby Bluetooth devices...");
    body.appendChild(loading);
    var operation = isWifi ? window.aosNetworkBridge.scan() : window.aosBluetoothBridge.scan();
    Promise.resolve(operation).then(function (items) {
      loading.remove();
      if (!items.length) {
        body.appendChild(element("p", "aos-native-empty", isWifi ? "No Wi-Fi networks found." : "No Bluetooth devices found. Put the device in pairing mode and scan again."));
        return;
      }
      items.forEach(function (item) {
        body.appendChild(isWifi ? wifiDevice(item) : bluetoothDevice(item));
      });
    }).catch(function (error) {
      loading.textContent = error && error.message ? error.message : "The scan could not be completed.";
    });
  }

  function openPanel(tab) {
    panelTab = tab || "wifi";
    renderPanel();
  }

  window.AOS_OPEN_DEVICE_CONTROLS = openPanel;

  function versionLabel(value) {
    if (!value) return "Unavailable";
    var version = value.version ? "A-OS " + value.version : "A-OS build";
    var revision = String(value.revision || "");
    if (/^[0-9a-f]{40}$/i.test(revision)) version += " (" + revision.slice(0, 8) + ")";
    return version;
  }

  function updateProgress(body) {
    body.innerHTML = "";
    var message = element("p", "aos-native-update__message", "Preparing the A-OS update...");
    var progress = element("div", "aos-native-update__progress");
    var bar = element("span", "");
    progress.appendChild(bar);
    body.append(message, progress);
    function poll() {
      if (!panel || panelTab !== "update") return;
      window.aosUpdateBridge.status().then(function (state) {
        message.textContent = state.error || state.message || "Updating A-OS...";
        bar.style.width = Math.max(0, Math.min(100, Number(state.progress || 0))) + "%";
        if (state.stage === "complete") {
          var restart = element("button", "primary", "Restart A-OS");
          restart.type = "button";
          restart.addEventListener("click", function () { confirmPower("restart"); });
          body.appendChild(restart);
          return;
        }
        if (state.stage === "error") {
          var retry = element("button", "", "Back");
          retry.type = "button";
          retry.addEventListener("click", openUpdatePanel);
          body.appendChild(retry);
          return;
        }
        window.setTimeout(poll, 1000);
      }).catch(function (error) {
        message.textContent = error && error.message ? error.message : "A-OS lost contact with the updater.";
        window.setTimeout(poll, 1800);
      });
    }
    poll();
  }

  function openUpdatePanel() {
    panelTab = "update";
    closePanel();
    panel = panelShell();
    var body = panel.querySelector(".aos-native-panel__body");
    body.appendChild(element("p", "aos-native-empty", "Checking for a newer A-OS build..."));
    window.aosUpdateBridge.check().then(function (state) {
      body.innerHTML = "";
      var current = element("article", "aos-native-update__version");
      current.append(element("small", "", "Installed"), element("b", "", versionLabel(state.packagedVersion)));
      var latest = element("article", "aos-native-update__version");
      latest.append(element("small", "", "Published"), element("b", "", versionLabel(state.remoteVersion)));
      body.append(current, latest);
      var sameRevision = state.packagedVersion && state.remoteVersion && state.packagedVersion.revision === state.remoteVersion.revision;
      var installedTime = Date.parse(state.packagedVersion && state.packagedVersion.build || "");
      var publishedTime = Date.parse(state.remoteVersion && state.remoteVersion.build || "");
      var publishedIsOlder = Number.isFinite(installedTime) && Number.isFinite(publishedTime) && publishedTime <= installedTime;
      if (sameRevision || publishedIsOlder) {
        body.appendChild(element("p", "aos-native-empty", "This device already has the latest published A-OS files."));
        return;
      }
      if (!state.remoteVersion) {
        body.appendChild(element("p", "aos-native-update__warning", "A-OS could not reach the update service. Check Internet access and try again."));
        return;
      }
      if (!state.persistent) {
        body.appendChild(element("p", "aos-native-update__warning", "This is a live session. Install A-OS to a drive first if you want the update to survive a restart."));
      }
      body.appendChild(element("p", "aos-native-empty", "A-OS will download the exact published source revision and replace only the A-OS application files. Your accounts, settings, and files stay in place."));
      var apply = element("button", "primary", "Download and install in background");
      apply.type = "button";
      apply.addEventListener("click", function () {
        apply.disabled = true;
        window.aosUpdateBridge.apply().then(function () { updateProgress(body); }).catch(function (error) {
          apply.disabled = false;
          nativeError(error);
        });
      });
      body.appendChild(apply);
    }).catch(nativeError);
  }

  function updateQuickSettings(state) {
    document.querySelectorAll(".quick-tiles button").forEach(function (button) {
      var label = button.querySelector("b");
      var detail = button.querySelector("small");
      if (!label || !detail) return;
      if (label.textContent.trim() === "Wi-Fi" && state.wifi) {
        detail.textContent = state.wifi.enabled ? (state.connectivity && state.connectivity.checked && !state.connectivity.online ? "No Internet" : (state.wifi.network || "Available")) : "Off";
        button.classList.toggle("on", Boolean(state.wifi.enabled));
      }
      if (label.textContent.trim() === "Bluetooth" && state.bluetooth) {
        detail.textContent = state.bluetooth.enabled ? "On" : "Off";
        button.classList.toggle("on", Boolean(state.bluetooth.enabled));
      }
    });
    updateHardwareSliders(state);
  }

  function controlImage(name, alt) {
    var image = document.createElement("img");
    image.src = new URL("./assets/icons/" + name, baseUrl).href;
    image.alt = alt || "";
    return image;
  }

  function applyHardwareValue(kind, input) {
    window.clearTimeout(hardwareControlTimer);
    hardwareControlTimer = window.setTimeout(function () {
      var operation = kind === "volume"
        ? window.aosAudioBridge.setVolume(input.value)
        : window.aosDisplayBridge.setBrightness(input.value);
      Promise.resolve(operation).catch(nativeError);
    }, 80);
  }

  function wireHardwareSlider(label, kind) {
    if (!label || label.dataset.aosHardwareControl) return;
    var input = label.querySelector('input[type="range"]');
    if (!input) return;
    label.dataset.aosHardwareControl = kind;
    input.min = kind === "brightness" ? "5" : "0";
    input.max = "100";
    input.addEventListener("input", function () { applyHardwareValue(kind, input); });
  }

  function ensureBrightnessSlider() {
    var existing = document.querySelector('.quick label[data-aos-hardware-control="brightness"], .quick .aos-native-brightness');
    if (existing) return existing;
    var volume = Array.from(document.querySelectorAll(".quick label.slider")).find(function (label) {
      var image = label.querySelector("img[alt]");
      return image && image.alt.trim().toLowerCase() === "volume";
    });
    if (!volume || !volume.parentNode) return null;
    var brightness = element("label", "slider aos-native-brightness");
    brightness.title = "Screen brightness";
    var input = document.createElement("input");
    input.type = "range";
    input.value = "100";
    input.setAttribute("aria-label", "Screen brightness");
    brightness.append(controlImage("Less.png", "Brightness"), input, controlImage("More.png", ""));
    volume.insertAdjacentElement("afterend", brightness);
    return brightness;
  }

  function updateHardwareSliders(state) {
    var volume = Array.from(document.querySelectorAll(".quick label.slider")).find(function (label) {
      var image = label.querySelector("img[alt]");
      return image && image.alt.trim().toLowerCase() === "volume";
    });
    var brightness = ensureBrightnessSlider();
    wireHardwareSlider(volume, "volume");
    wireHardwareSlider(brightness, "brightness");
    [[volume, state.volume, "Sound hardware is unavailable"], [brightness, state.brightness, "Hardware brightness is unavailable on this display"]].forEach(function (entry) {
      var label = entry[0];
      var value = entry[1];
      if (!label) return;
      var input = label.querySelector('input[type="range"]');
      var available = Boolean(value && value.available);
      input.disabled = !available;
      label.classList.toggle("is-unavailable", !available);
      label.title = available ? (label.dataset.aosHardwareControl === "volume" ? "Sound volume" : "Screen brightness") : entry[2];
      if (available && document.activeElement !== input) input.value = String(value.percentage);
    });
  }

  function wireQuickSettings() {
    document.querySelectorAll(".quick-tiles button").forEach(function (button) {
      if (button.dataset.aosNativeControl) return;
      var label = button.querySelector("b");
      if (!label) return;
      var name = label.textContent.trim();
      if (name !== "Wi-Fi" && name !== "Bluetooth") return;
      button.dataset.aosNativeControl = "true";
      button.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        openPanel(name === "Wi-Fi" ? "wifi" : "bluetooth");
      }, true);
    });
    updateQuickSettings(window.AOS_NATIVE_BRIDGE.state || {});
  }

  function addSetupHardwareButton() {
    var setup = document.querySelector(".setup .setup-content");
    if (!setup || setup.querySelector(".aos-native-setup-device")) return;
    var heading = setup.querySelector("h1");
    if (!heading || !/connect to the internet/i.test(heading.textContent || "")) return;
    var button = element("button", "aos-native-setup-device", "Wi-Fi and Bluetooth devices");
    button.type = "button";
    button.addEventListener("click", function () { openPanel("wifi"); });
    var header = setup.querySelector("header");
    if (header) header.insertAdjacentElement("afterend", button);
  }

  function loadEmojiAssets() {
    if (emojiAssetsPromise) return emojiAssetsPromise;
    emojiAssetsPromise = Promise.all([
      fetch(new URL("./assets/emojis/aos-complete/catalog.json", baseUrl)).then(function (response) { return response.json(); }),
      fetch(new URL("./assets/emojis/aos-3d/manifest.json", baseUrl)).then(function (response) { return response.json(); })
    ]);
    return emojiAssetsPromise;
  }

  function wireEmbed(frame) {
    if (!frame || frame.dataset.aosNativeEmbed === "ready") return;
    frame.dataset.aosNativeEmbed = "ready";
    var permissions = (frame.getAttribute("allow") || "").split(";").map(function (item) { return item.trim(); }).filter(Boolean);
    ["clipboard-read", "clipboard-write", "fullscreen", "autoplay", "encrypted-media", "picture-in-picture", "web-share", "camera", "microphone", "geolocation"].forEach(function (permission) {
      if (permissions.indexOf(permission) === -1) permissions.push(permission);
    });
    frame.setAttribute("allow", permissions.join("; "));
    frame.setAttribute("allowfullscreen", "");

    function install() {
      try {
        if (window.AOS_DEVICE_STATUS) window.AOS_DEVICE_STATUS.instrumentWindow(frame.contentWindow);
      } catch (_) {}
      loadEmojiAssets().then(function (catalogs) {
        var childWindow;
        var childDocument;
        try {
          childWindow = frame.contentWindow;
          childDocument = frame.contentDocument;
          if (!childWindow || !childDocument || !childDocument.head || childWindow.AOS_COMPLETE_EMOJI_PACK) return;
          childWindow.AOS_COMPLETE_EMOJI_CATALOG = catalogs[0];
          childWindow.AOS_ORIGINAL_EMOJI_MANIFEST = catalogs[1];
        } catch (_) {
          if (frame.contentWindow) frame.contentWindow.postMessage({type: "aos-emoji-support", shortcut: "Ctrl+."}, "*");
          return;
        }
        var style = childDocument.createElement("link");
        style.rel = "stylesheet";
        style.href = new URL("./aos-embed-emoji.css", baseUrl).href;
        var script = childDocument.createElement("script");
        script.src = new URL("./aos-complete-emoji-pack.js", baseUrl).href;
        childDocument.head.append(style, script);
      }).catch(function () {});
    }

    frame.addEventListener("load", install);
    install();
  }

  function browserMenu(browser) {
    if (!browser || browser.dataset.aosNativeMenu === "ready") return;
    var toolbar = browser.querySelector(".browser-toolbar");
    if (!toolbar) return;
    browser.dataset.aosNativeMenu = "ready";
    var emoji = element("button", "aos-native-browser-emoji");
    emoji.type = "button";
    emoji.title = "Emoji and clipboard";
    emoji.setAttribute("aria-label", "Open emoji and clipboard");
    var emojiImage = document.createElement("img");
    emojiImage.src = new URL("./assets/emojis/aos-3d/emoji-00.png", baseUrl).href;
    emojiImage.alt = "";
    emoji.appendChild(emojiImage);
    emoji.addEventListener("click", function () {
      window.dispatchEvent(new CustomEvent("aos-open-quick-palette", {detail: {tab: "emoji"}}));
    });
    var trigger = element("button", "aos-native-browser-menu-button", "\u22ee");
    trigger.type = "button";
    trigger.title = "More browser options";
    trigger.setAttribute("aria-label", "More browser options");
    var menu = element("div", "aos-native-browser-menu");
    menu.hidden = true;
    [
      ["Copy address", function () {
        var input = toolbar.querySelector(".browser-address input");
        if (input && navigator.clipboard) navigator.clipboard.writeText(input.value).then(function () { notify("Address copied."); });
      }],
      ["Open full screen", function () {
        if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(function () {});
        else document.exitFullscreen().catch(function () {});
      }],
      ["Print page", function () {
        var frame = browser.querySelector(".browser-viewport iframe");
        try { if (frame && frame.contentWindow) frame.contentWindow.print(); } catch (_) { window.print(); }
      }],
      ["Clear browser tabs", function () {
        try {
          localStorage.removeItem("aos-browser-tabs");
          localStorage.removeItem("aos-browser-active");
        } catch (_) {}
        notify("Saved OSInternet tabs were cleared.");
      }]
    ].forEach(function (entry) {
      var action = element("button", "", entry[0]);
      action.type = "button";
      action.addEventListener("click", function () {
        menu.hidden = true;
        entry[1]();
      });
      menu.appendChild(action);
    });
    trigger.addEventListener("click", function () { menu.hidden = !menu.hidden; });
    toolbar.append(emoji, trigger);
    browser.appendChild(menu);
  }

  function autoEnterAos() {
    if (document.getElementById("aos-boot-sequence")) return;
    var button = document.querySelector("main.boot > button");
    if (!button || button.dataset.aosAutoStarted) return;
    button.dataset.aosAutoStarted = "true";
    window.setTimeout(function () { button.click(); }, 120);
  }

  function scanPage() {
    wireQuickSettings();
    addSetupHardwareButton();
    autoEnterAos();
    document.querySelectorAll("iframe").forEach(wireEmbed);
    document.querySelectorAll(".aos-browser").forEach(browserMenu);
  }

  function scheduleScan() {
    window.clearTimeout(mutationTimer);
    mutationTimer = window.setTimeout(scanPage, 60);
  }

  function confirmPower(action) {
    var overlay = element("div", "aos-native-panel");
    var windowNode = element("section", "aos-native-panel__window");
    windowNode.style.width = "min(430px, 100%)";
    var header = element("header", "aos-native-panel__header");
    var titles = {
      restart: "Restart A-OS?",
      shutdown: "Shut down A-OS?",
      hibernate: "Hibernate A-OS?"
    };
    var descriptions = {
      restart: "Open work will be closed and the real device will restart.",
      shutdown: "Open work will be closed and the real device will power off.",
      hibernate: "A-OS will save this session, turn off, and restore your open work when the device wakes."
    };
    var labels = {restart: "Restart", shutdown: "Shut down", hibernate: "Hibernate"};
    var title = element("strong", "", titles[action]);
    header.appendChild(title);
    var body = element("main", "aos-native-panel__body");
    body.appendChild(element("p", "", descriptions[action]));
    var actions = element("div", "aos-native-panel__toolbar");
    var cancel = element("button", "", "Cancel");
    var proceed = element("button", "primary", labels[action]);
    cancel.addEventListener("click", function () { overlay.remove(); });
    proceed.addEventListener("click", function () {
      proceed.disabled = true;
      try {
        localStorage.setItem("aos-last-power-action", JSON.stringify({action: action, at: Date.now()}));
      } catch (_) {}
      window.dispatchEvent(new CustomEvent("aos-before-power", {detail: {action: action}}));
      window.AOS_NATIVE_BRIDGE.post("/__aos/power/" + action, {}).then(function () {
        overlay.innerHTML = "";
        var state = element("section", "aos-native-power-state");
        var logo = document.createElement("img");
        logo.src = new URL("./assets/icons/OS Logo.png", baseUrl).href;
        logo.alt = "";
        state.append(logo, element("h1", "", action === "hibernate" ? "Saving your A-OS session" : action === "restart" ? "Restarting A-OS" : "Shutting down A-OS"));
        overlay.appendChild(state);
      }).catch(function (error) {
        proceed.disabled = false;
        nativeError(error);
      });
    });
    actions.append(cancel, proceed);
    body.appendChild(actions);
    windowNode.append(header, body);
    overlay.appendChild(windowNode);
    document.body.appendChild(overlay);
  }

  document.addEventListener("click", function (event) {
    var button = event.target && event.target.closest && event.target.closest("button");
    if (!button || button.closest(".aos-native-panel")) return;
    var label = (button.getAttribute("aria-label") || button.title || button.textContent || "").trim().toLowerCase();
    if (/^(restart|shut down|shutdown|hibernate)$/.test(label)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      confirmPower(label === "restart" ? "restart" : label === "hibernate" ? "hibernate" : "shutdown");
    }
  }, true);

  window.addEventListener("aos-native-system", function (event) {
    updateQuickSettings(event.detail || {});
  });
  window.addEventListener("aos-open-native-controls", function (event) {
    openPanel(event.detail && event.detail.tab || "wifi");
  });
  window.addEventListener("aos-open-update", openUpdatePanel);
  window.addEventListener("aos-boot-complete", autoEnterAos);
  window.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && panel) closePanel();
  }, true);

  var observer = new MutationObserver(scheduleScan);
  function start() {
    scanPage();
    observer.observe(document.documentElement, {childList: true, subtree: true});
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, {once: true});
  else start();
})();
