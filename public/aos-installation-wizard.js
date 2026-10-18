(function () {
  "use strict";

  if (!window.AOS_NATIVE_BRIDGE || window.AOS_INSTALLATION_WIZARD) return;
  window.AOS_INSTALLATION_WIZARD = true;

  var COMPLETE_KEY = "aos-native-installation-complete-v3";
  var TARGET_KEY = "aos-native-installation-target";
  var baseUrl = new URL("./", document.currentScript ? document.currentScript.src : window.location.href);
  var overlay = null;
  var step = 0;
  var selectedTarget = "live";
  var targets = [];
  var pollTimer = 0;

  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function shouldShow() {
    var force = new URLSearchParams(window.location.search).get("aosInstall") === "1";
    if (force) return true;
    if (window.AOS_NATIVE_BRIDGE.state && window.AOS_NATIVE_BRIDGE.state.persistent) {
      try { localStorage.setItem(COMPLETE_KEY, "1"); } catch (_) {}
      return false;
    }
    try { return localStorage.getItem(COMPLETE_KEY) !== "1"; } catch (_) { return true; }
  }

  function icon(name) {
    return new URL("./assets/icons/" + name, baseUrl).href;
  }

  function formatBytes(value) {
    var bytes = Number(value || 0);
    if (!Number.isFinite(bytes) || bytes <= 0) return "Storage size unavailable";
    var units = ["B", "KB", "MB", "GB", "TB"];
    var index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return (bytes / Math.pow(1024, index)).toFixed(index > 2 ? 1 : 0) + " " + units[index];
  }

  function selected() {
    return targets.find(function (item) { return item.id === selectedTarget; }) || targets[0];
  }

  function renderSteps(sidebar) {
    sidebar.innerHTML = "";
    sidebar.appendChild(element("h2", "", "Install A-OS"));
    ["Where to install", "Connect this device", "Install and start"].forEach(function (label, index) {
      var item = element("div", "aos-installer__step" + (index === step ? " is-current" : "") + (index < step ? " is-complete" : ""));
      item.append(element("span", "", index < step ? "\u2713" : String(index + 1)), element("b", "", label));
      sidebar.appendChild(item);
    });
  }

  function targetButton(item) {
    var button = element("button", "aos-installer__target");
    button.type = "button";
    button.setAttribute("role", "radio");
    button.setAttribute("aria-checked", String(item.id === selectedTarget));
    if (item.installable === false) button.disabled = true;
    var image = document.createElement("img");
    image.src = icon(item.removable ? "Settings.png" : "OS Logo.png");
    image.alt = "";
    var text = element("span", "");
    text.append(element("b", "", item.name), element("small", "", item.description));
    button.append(image, text, element("small", "", item.size));
    button.addEventListener("click", function () {
      selectedTarget = item.id;
      render();
    });
    return button;
  }

  function mainShell(title, lead) {
    var main = element("main", "aos-installer__main");
    var brand = element("div", "aos-installer__brand");
    var logo = document.createElement("img");
    logo.src = icon("OS Logo.png");
    logo.alt = "";
    brand.append(logo, element("span", "", "A-OS Installation Wizard"));
    main.append(brand, element("h1", "", title), element("p", "aos-installer__lead", lead));
    return main;
  }

  function actions(main, options) {
    var row = element("div", "aos-installer__actions");
    if (options.back) {
      var back = element("button", "", "Back");
      back.type = "button";
      back.addEventListener("click", function () { step -= 1; render(); });
      row.appendChild(back);
    }
    var next = element("button", "primary", options.label || "Continue");
    next.type = "button";
    next.disabled = Boolean(options.disabled);
    next.addEventListener("click", options.onClick);
    row.appendChild(next);
    main.appendChild(row);
    return next;
  }

  function renderStorage() {
    var main = mainShell("Where to install A\u2011OS", "Choose the safe live session or a real drive. Installing to a drive erases everything currently stored on that drive.");
    var list = element("div", "aos-installer__targets");
    list.setAttribute("role", "radiogroup");
    targets.forEach(function (item) { list.appendChild(targetButton(item)); });
    main.appendChild(list);
    actions(main, {label: "Next", disabled: !selected() || selected().installable === false, onClick: function () { step = 1; render(); }});
    return main;
  }

  function renderNetwork() {
    var state = window.AOS_NATIVE_BRIDGE.state || {};
    var network = state.wifi && state.wifi.network;
    var main = mainShell("Connect this device", network && network !== "Offline" ? "Connected to " + network + ". You can continue or choose another network." : "Connect now, or continue and connect later from Device controls.");
    var card = element("div", "aos-installer__targets");
    var button = element("button", "aos-installer__target");
    button.type = "button";
    var image = document.createElement("img");
    image.src = icon("Settings.png");
    image.alt = "";
    var copy = element("span", "");
    copy.append(element("b", "", network || "Internet, Wi-Fi and Bluetooth"), element("small", "", "Use real nearby devices and networks"));
    button.append(image, copy, element("small", "", "Open controls"));
    button.addEventListener("click", function () { window.dispatchEvent(new CustomEvent("aos-open-native-controls", {detail: {tab: "wifi"}})); });
    card.appendChild(button);
    main.appendChild(card);
    actions(main, {back: true, label: "Next", onClick: function () { step = 2; render(); }});
    return main;
  }

  function finishLive() {
    try {
      localStorage.setItem(COMPLETE_KEY, "1");
      localStorage.setItem(TARGET_KEY, "live");
    } catch (_) {}
    overlay.classList.add("is-finished");
    window.dispatchEvent(new CustomEvent("aos-installation-complete", {detail: {target: "live"}}));
    window.setTimeout(function () {
      if (overlay) overlay.remove();
      overlay = null;
    }, 450);
  }

  function showInstallProgress(main) {
    main.innerHTML = "";
    main.appendChild(element("h1", "", "Installing A-OS"));
    var message = element("p", "aos-installer__lead", "Preparing the selected drive...");
    var progress = element("div", "aos-installer__progress");
    var bar = element("span", "");
    progress.appendChild(bar);
    main.append(message, progress);
    function poll() {
      window.AOS_NATIVE_BRIDGE.request("/__aos/install/status").then(function (state) {
        bar.style.width = Math.max(0, Math.min(100, Number(state.progress || 0))) + "%";
        message.textContent = state.error || state.message || "Installing A-OS...";
        if (state.stage === "complete") {
          var note = element("p", "aos-installer__warning", "Installation is complete. Remove the installation USB or DVD before restarting.");
          var restart = element("button", "primary", "Restart A-OS");
          restart.type = "button";
          restart.addEventListener("click", function () { window.AOS_NATIVE_BRIDGE.post("/__aos/power/restart", {}); });
          main.append(note, restart);
          return;
        }
        if (state.stage === "error") {
          var back = element("button", "", "Back");
          back.type = "button";
          back.addEventListener("click", function () { step = 2; render(); });
          main.appendChild(back);
          return;
        }
        pollTimer = window.setTimeout(poll, 1000);
      }).catch(function (error) {
        message.textContent = error && error.message ? error.message : "A-OS lost contact with the installer.";
        pollTimer = window.setTimeout(poll, 1800);
      });
    }
    poll();
  }

  function startDiskInstall(main, target, confirmation, button) {
    button.disabled = true;
    button.textContent = "Starting";
    window.AOS_NATIVE_BRIDGE.post("/__aos/install", {target: target.id, confirmation: confirmation.value}).then(function () {
      showInstallProgress(main);
    }).catch(function (error) {
      button.disabled = false;
      button.textContent = "Erase drive and install A-OS";
      var old = main.querySelector(".aos-installer__error");
      if (old) old.remove();
      main.insertBefore(element("p", "aos-installer__error", error && error.message ? error.message : "Installation could not start."), main.querySelector(".aos-installer__actions"));
    });
  }

  function renderInstall() {
    var target = selected();
    var isLive = target && target.id === "live";
    var main = mainShell(isLive ? "Start A-OS without installing" : "Ready to install A\u2011OS", isLive ? "A-OS will run from the installation media. Changes are not guaranteed to survive a restart." : "A-OS will copy the bootable system and create persistent storage for accounts, settings, apps, and files.");
    var summary = element("div", "aos-installer__targets");
    summary.appendChild(targetButton(target));
    main.appendChild(summary);
    if (isLive) {
      actions(main, {back: true, label: "Start live A-OS", onClick: finishLive});
      return main;
    }
    main.appendChild(element("p", "aos-installer__warning", "Everything on " + target.id + " will be permanently erased. This cannot be undone."));
    var label = element("label", "aos-installer__confirm");
    label.appendChild(element("span", "", "Type ERASE " + target.id + " to confirm"));
    var confirmation = document.createElement("input");
    confirmation.type = "text";
    confirmation.autocomplete = "off";
    confirmation.spellcheck = false;
    label.appendChild(confirmation);
    main.appendChild(label);
    var install = actions(main, {back: true, label: "Erase drive and install A-OS", disabled: true, onClick: function () { startDiskInstall(main, target, confirmation, install); }});
    confirmation.addEventListener("input", function () { install.disabled = confirmation.value !== "ERASE " + target.id; });
    return main;
  }

  function render() {
    if (!overlay) return;
    window.clearTimeout(pollTimer);
    var windowNode = overlay.querySelector(".aos-installer__window");
    windowNode.innerHTML = "";
    windowNode.appendChild(step === 0 ? renderStorage() : step === 1 ? renderNetwork() : renderInstall());
    var sidebar = element("aside", "aos-installer__steps");
    renderSteps(sidebar);
    windowNode.appendChild(sidebar);
  }

  function show() {
    if (!shouldShow() || overlay || !document.body) return;
    targets = [{id: "live", name: "A-OS live system", description: "Try A-OS without changing this computer", size: "Safe option", removable: false, installable: true}];
    overlay = element("section", "aos-installer");
    overlay.id = "aos-installation-wizard";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "A-OS Installation Wizard");
    overlay.appendChild(element("div", "aos-installer__window"));
    document.body.appendChild(overlay);
    render();
    window.AOS_NATIVE_BRIDGE.request("/__aos/storage").then(function (result) {
      (result.targets || []).forEach(function (item) {
        targets.push({
          id: String(item.id || item.name), name: item.name || "Storage device",
          description: item.description || "Detected storage", size: formatBytes(item.size),
          removable: Boolean(item.removable), installable: item.installable !== false,
          blockedReason: item.blockedReason || ""
        });
      });
      render();
    }).catch(function () {});
  }

  window.addEventListener("aos-boot-complete", show, {once: true});
  window.setTimeout(function () {
    if (!document.getElementById("aos-boot-sequence")) show();
  }, 5600);
})();
