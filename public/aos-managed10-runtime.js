(function () {
  "use strict";

  if (window.AOS_MANAGED10_RUNTIME) return;
  window.AOS_MANAGED10_RUNTIME = true;

  var UPDATE_BASELINE_KEY = "aos-update-baseline";
  var UPDATE_NOTICE_KEY = "aos-update-notice";
  var updateTimer = 0;
  var mutationTimer = 0;

  function safeGet(key) {
    try { return localStorage.getItem(key); } catch (_) { return null; }
  }

  function safeSet(key, value) {
    try { localStorage.setItem(key, value); } catch (_) {}
  }

  function notify(message) {
    window.dispatchEvent(new CustomEvent("aos-notification", {
      detail: {message: String(message)}
    }));
  }

  function showAosAlert(appName, message) {
    window.dispatchEvent(new CustomEvent("aos-show-alert", {
      detail: {appName: appName || "Embedded Application", message: String(message || "")}
    }));
  }

  function wireEmbedAlert(frame) {
    if (!frame || frame.dataset.aosAlertBridge === "ready") return;
    frame.dataset.aosAlertBridge = "ready";

    function connect() {
      try {
        var childWindow = frame.contentWindow;
        var childDocument = frame.contentDocument;
        if (!childWindow || !childDocument) return;
        childWindow.alert = function (message) {
          showAosAlert(frame.title || childDocument.title || "Embedded Application", message);
        };
      } catch (_) {
        // Cross-origin embeds use the existing postMessage alert bridge when supported.
      }
    }

    frame.addEventListener("load", connect);
    connect();
  }

  function removeAosPackageUpload() {
    document.querySelectorAll('input[type="file"][accept*=".aos" i]').forEach(function (input) {
      input.disabled = true;
      input.remove();
    });

    document.querySelectorAll('[role="dialog"][aria-label="Choose an OS package"]').forEach(function (dialog) {
      var backdrop = dialog.closest(".source-chooser-backdrop");
      (backdrop || dialog).remove();
    });

    document.querySelectorAll("button").forEach(function (button) {
      var text = (button.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
      var title = (button.getAttribute("title") || "").toLowerCase();
      if (text === "upload .aos" || text === "upload aos" || title === "upload .aos") {
        button.remove();
      }
    });
  }

  function weatherDescription(code) {
    if (code === 0) return "Clear";
    if (code === 1 || code === 2) return "Mostly clear";
    if (code === 3) return "Cloudy";
    if (code === 45 || code === 48) return "Fog";
    if (code >= 51 && code <= 57) return "Drizzle";
    if (code >= 61 && code <= 67) return "Rain";
    if (code >= 71 && code <= 77) return "Snow";
    if (code >= 80 && code <= 82) return "Showers";
    if (code >= 85 && code <= 86) return "Snow showers";
    if (code >= 95) return "Thunderstorm";
    return "Current conditions";
  }

  function weatherLocation() {
    return {
      latitude: Number(safeGet("aos-weather-lat") || 51.5072),
      longitude: Number(safeGet("aos-weather-lon") || -0.1276),
      name: safeGet("aos-weather-place") || "London"
    };
  }

  function makeWeatherWidget(frame) {
    if (!frame || frame.dataset.aosWeatherReplaced === "true") return;
    var content = frame.parentElement;
    var widget = content && content.parentElement;
    if (!content || !widget) return;

    frame.dataset.aosWeatherReplaced = "true";
    widget.className = "aos-weather-native";
    widget.setAttribute("aria-label", "Weather Station");
    widget.innerHTML = [
      '<header class="aos-weather-header">',
      '  <span class="aos-weather-title"><img src="./assets/icons/Weather.png" alt="">Weather</span>',
      '  <button type="button" class="aos-weather-refresh" aria-label="Refresh weather" title="Refresh weather">Refresh</button>',
      '</header>',
      '<div class="aos-weather-body" aria-live="polite">',
      '  <div class="aos-weather-primary">',
      '    <strong class="aos-weather-temperature">--</strong>',
      '    <span class="aos-weather-condition">Loading weather</span>',
      '  </div>',
      '  <div class="aos-weather-place">London</div>',
      '  <div class="aos-weather-details">',
      '    <span><small>Feels like</small><b data-weather="feels">--</b></span>',
      '    <span><small>Humidity</small><b data-weather="humidity">--</b></span>',
      '    <span><small>Wind</small><b data-weather="wind">--</b></span>',
      '  </div>',
      '</div>'
    ].join("");

    var refresh = widget.querySelector(".aos-weather-refresh");
    refresh.addEventListener("click", function (event) {
      event.stopPropagation();
      loadWeather(widget, true);
    });
    loadWeather(widget, false);
  }

  async function loadWeather(widget, userRequested) {
    if (!widget || widget.dataset.aosWeatherLoading === "true") return;
    widget.dataset.aosWeatherLoading = "true";
    var button = widget.querySelector(".aos-weather-refresh");
    if (button) button.disabled = true;
    var locationData = weatherLocation();
    var params = new URLSearchParams({
      latitude: String(locationData.latitude),
      longitude: String(locationData.longitude),
      current: "temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m",
      timezone: "auto"
    });

    try {
      var response = await fetch("https://api.open-meteo.com/v1/forecast?" + params.toString(), {cache: "no-store"});
      if (!response.ok) throw new Error("Weather service unavailable");
      var result = await response.json();
      var current = result.current || {};
      var units = result.current_units || {};
      widget.querySelector(".aos-weather-temperature").textContent = Math.round(Number(current.temperature_2m)) + (units.temperature_2m || "°C");
      widget.querySelector(".aos-weather-condition").textContent = weatherDescription(Number(current.weather_code));
      widget.querySelector(".aos-weather-place").textContent = locationData.name;
      widget.querySelector('[data-weather="feels"]').textContent = Math.round(Number(current.apparent_temperature)) + (units.apparent_temperature || "°C");
      widget.querySelector('[data-weather="humidity"]').textContent = Math.round(Number(current.relative_humidity_2m)) + (units.relative_humidity_2m || "%");
      widget.querySelector('[data-weather="wind"]').textContent = Math.round(Number(current.wind_speed_10m)) + " " + (units.wind_speed_10m || "km/h");
      widget.dataset.aosWeatherState = "ready";
      if (userRequested) notify("Weather Station has been refreshed.");
    } catch (_) {
      widget.querySelector(".aos-weather-temperature").textContent = "--";
      widget.querySelector(".aos-weather-condition").textContent = "Weather unavailable offline";
      widget.querySelector(".aos-weather-place").textContent = locationData.name;
      widget.dataset.aosWeatherState = "offline";
    } finally {
      widget.dataset.aosWeatherLoading = "false";
      if (button) button.disabled = false;
    }
  }

  function scanPage() {
    document.querySelectorAll("iframe").forEach(function (frame) {
      wireEmbedAlert(frame);
      if (frame.title === "A-OS Weather Station") removeWeatherExternalLink(frame);
    });
    decorateEmojiPack();
    removeAosPackageUpload();
  }

  function removeWeatherExternalLink(frame) {
    var content = frame && frame.parentElement;
    var widget = content && content.parentElement;
    if (!widget) return;

    widget.querySelectorAll('a[title="Open in new window"], a[target="_blank"][href*="a-os--weather"]')
      .forEach(function (link) { link.remove(); });
    widget.setAttribute("data-aos-weather-embed", "true");
  }

  var AOS_EMOJI_IMAGES = [
    "emoji-00.png", "emoji-01.png", "emoji-02.png", "emoji-03.png",
    "emoji-04.png", "emoji-05.png", "emoji-06.png", "emoji-07.png",
    "emoji-08.png", "emoji-09.png", "emoji-10.png", "emoji-11.png",
    "emoji-12.png", "emoji-13.png", "emoji-14.png", "emoji-15.png"
  ];

  function decorateEmojiPack() {
    document.querySelectorAll(".emoji-pack-chip").forEach(function (chip) {
      if (/A-OS 3D Neo/i.test(chip.textContent || "")) chip.textContent = "A-OS Originals";
    });

    var buttons = Array.from(document.querySelectorAll(".emoji-grid button.aos-3d-emoji"));
    buttons.slice(0, AOS_EMOJI_IMAGES.length).forEach(function (button, index) {
      var span = button.querySelector("span");
      if (!span || span.querySelector("img")) return;
      var fallback = span.textContent || "";
      span.textContent = "";
      var image = document.createElement("img");
      image.src = "./assets/emojis/aos-3d/" + AOS_EMOJI_IMAGES[index] + "?v=managed11";
      image.alt = fallback;
      image.decoding = "async";
      image.addEventListener("error", function () {
        span.textContent = fallback;
      }, {once: true});
      span.appendChild(image);
    });

    document.querySelectorAll(".emoji-picker footer span:first-child").forEach(function (label) {
      if (/A-OS Official Pack|A-OS 3D Neo/i.test(label.textContent || "")) {
        label.textContent = "A-OS Originals";
      }
    });
  }

  function scheduleScan() {
    window.clearTimeout(mutationTimer);
    mutationTimer = window.setTimeout(scanPage, 40);
  }

  async function checkForUpdate() {
    if (document.visibilityState === "hidden") return;
    try {
      var response = await fetch("./version.json?update=" + Date.now(), {cache: "no-store"});
      if (!response.ok) return;
      var data = await response.json();
      var identity = String(data.version || "") + "|" + String(data.build || "");
      if (identity === "|") return;
      var baseline = safeGet(UPDATE_BASELINE_KEY);
      if (!baseline) {
        safeSet(UPDATE_BASELINE_KEY, identity);
        if (!window.AOS_NATIVE_BRIDGE) window.dispatchEvent(new CustomEvent("aos-update-status", {detail: {required: false}}));
        if (safeGet("aos-profile") && safeGet(UPDATE_NOTICE_KEY) !== identity) {
          safeSet(UPDATE_NOTICE_KEY, identity);
          notify("A-OS " + (data.version || "") + " has been updated with the latest improvements.");
        }
        return;
      }
      if (baseline !== identity && safeGet(UPDATE_NOTICE_KEY) !== identity) {
        safeSet(UPDATE_BASELINE_KEY, identity);
        safeSet(UPDATE_NOTICE_KEY, identity);
        if (!window.AOS_NATIVE_BRIDGE) window.dispatchEvent(new CustomEvent("aos-update-status", {detail: {required: true, version: data.version || ""}}));
        notify("A-OS " + (data.version || "") + " has been updated. Restart A-OS to use the latest version.");
      } else {
        if (!window.AOS_NATIVE_BRIDGE) window.dispatchEvent(new CustomEvent("aos-update-status", {detail: {required: false}}));
      }
    } catch (_) {}
  }

  function start() {
    if (safeGet("aos-original-emoji-pack-version") !== "1") {
      safeSet("aos-emoji-pack", "aos-3d");
      safeSet("aos-original-emoji-pack-version", "1");
    }
    scanPage();
    var observer = new MutationObserver(scheduleScan);
    observer.observe(document.documentElement, {childList: true, subtree: true});
    checkForUpdate();
    updateTimer = window.setInterval(checkForUpdate, 60000);
    window.addEventListener("focus", checkForUpdate);
    document.addEventListener("visibilitychange", checkForUpdate);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, {once: true});
  } else {
    start();
  }

  window.addEventListener("beforeunload", function () {
    window.clearInterval(updateTimer);
    window.clearTimeout(mutationTimer);
  });
})();
