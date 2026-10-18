(function () {
  "use strict";

  if (!window.AOS_NATIVE_BRIDGE || window.AOS_INSTALLATION_WIZARD) return;
  window.AOS_INSTALLATION_WIZARD = true;

  var COMPLETE_KEY = "aos-native-installation-complete-v2";
  var TARGET_KEY = "aos-native-installation-target";
  var baseUrl = new URL("./", document.currentScript ? document.currentScript.src : window.location.href);
  var overlay = null;
  var step = 0;
  var selectedTarget = "live";
  var targets = [];

  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function shouldShow() {
    var force = new URLSearchParams(window.location.search).get("aosInstall") === "1";
    if (force) return true;
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
  }

  function renderStorage() {
    var main = mainShell("Where to install A\u2011OS", "Choose where A-OS should keep this device's settings and files. The live installer never erases a drive.");
    var list = element("div", "aos-installer__targets");
    list.setAttribute("role", "radiogroup");
    targets.forEach(function (item) { list.appendChild(targetButton(item)); });
    main.appendChild(list);
    actions(main, {
      label: "Next",
      disabled: !selected(),
      onClick: function () { step = 1; render(); }
    });
    return main;
  }

  function renderNetwork() {
    var state = window.AOS_NATIVE_BRIDGE.state || {};
    var network = state.wifi && state.wifi.network;
    var main = mainShell("Connect this device", network ? "Connected to " + network + ". You can continue or choose a different nearby network." : "Connect to Wi-Fi now, or continue and connect later from Quick Settings.");
    var card = element("div", "aos-installer__targets");
    var button = element("button", "aos-installer__target");
    button.type = "button";
    var image = document.createElement("img");
    image.src = icon("Settings.png");
    image.alt = "";
    var copy = element("span", "");
    copy.append(element("b", "", network || "Wi-Fi and Bluetooth"), element("small", "", network ? "This device is online" : "Search for real nearby devices and networks"));
    button.append(image, copy, element("small", "", "Open controls"));
    button.addEventListener("click", function () {
      window.dispatchEvent(new CustomEvent("aos-open-native-controls", {detail: {tab: "wifi"}}));
    });
    card.appendChild(button);
    main.appendChild(card);
    actions(main, {
      back: true,
      label: "Next",
      onClick: function () { step = 2; render(); }
    });
    return main;
  }

  function completeInstallation(main, button) {
    button.disabled = true;
    button.textContent = "Installing";
    var progress = element("div", "aos-installer__progress");
    var bar = element("span", "");
    progress.appendChild(bar);
    main.insertBefore(progress, main.querySelector(".aos-installer__actions"));
    window.requestAnimationFrame(function () { bar.style.width = "32%"; });
    window.setTimeout(function () { bar.style.width = "72%"; }, 550);
    window.setTimeout(function () { bar.style.width = "100%"; }, 1150);
    window.setTimeout(function () {
      try {
        localStorage.setItem(COMPLETE_KEY, "1");
        localStorage.setItem(TARGET_KEY, selectedTarget);
      } catch (_) {}
      overlay.classList.add("is-finished");
      window.dispatchEvent(new CustomEvent("aos-installation-complete", {detail: {target: selectedTarget}}));
      window.setTimeout(function () {
        if (overlay) overlay.remove();
        overlay = null;
      }, 450);
    }, 1650);
  }

  function renderInstall() {
    var target = selected();
    var main = mainShell("Ready to install A\u2011OS", "A-OS will prepare the live system, keep your selected storage preference, and then open the normal A-OS account setup.");
    var summary = element("div", "aos-installer__targets");
    summary.appendChild(targetButton(target));
    main.appendChild(summary);
    var row = element("div", "aos-installer__actions");
    var back = element("button", "", "Back");
    back.type = "button";
    back.addEventListener("click", function () { step = 1; render(); });
    var install = element("button", "primary", "Install A-OS");
    install.type = "button";
    install.addEventListener("click", function () { completeInstallation(main, install); });
    row.append(back, install);
    main.appendChild(row);
    return main;
  }

  function render() {
    if (!overlay) return;
    var windowNode = overlay.querySelector(".aos-installer__window");
    windowNode.innerHTML = "";
    windowNode.appendChild(step === 0 ? renderStorage() : step === 1 ? renderNetwork() : renderInstall());
    var sidebar = element("aside", "aos-installer__steps");
    renderSteps(sidebar);
    windowNode.appendChild(sidebar);
  }

  function show() {
    if (!shouldShow() || overlay || !document.body) return;
    targets = [{
      id: "live",
      name: "A-OS live system",
      description: "Start safely without erasing or repartitioning this computer",
      size: "Recommended",
      removable: false
    }];
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
          id: String(item.id || item.name),
          name: item.name || "Storage device",
          description: item.description || "Detected storage",
          size: formatBytes(item.size),
          removable: Boolean(item.removable)
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
