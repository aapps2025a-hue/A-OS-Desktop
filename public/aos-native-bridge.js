(function () {
  "use strict";

  var isLiveIso = new URLSearchParams(window.location.search).get("aosLiveIso") === "1";
  if (!isLiveIso || window.AOS_NATIVE_BRIDGE) return;

  document.documentElement.classList.add("aos-live-iso");
  var systemState = null;
  var batteryManager = new EventTarget();
  var batteryKnown = false;
  var batteryAvailable = false;
  var batteryWaiters = [];
  batteryManager.charging = false;
  batteryManager.chargingTime = Infinity;
  batteryManager.dischargingTime = Infinity;
  batteryManager.level = 0;

  function request(path, options) {
    return fetch(path, Object.assign({
      cache: "no-store",
      credentials: "same-origin",
      headers: {"Content-Type": "application/json"}
    }, options || {})).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (body) {
        if (!response.ok || body.ok === false) throw new Error(body.error || "A-OS hardware service is unavailable.");
        return body;
      });
    });
  }

  function post(path, body) {
    return request(path, {method: "POST", body: JSON.stringify(body || {})});
  }

  function applyBattery(next) {
    if (!next || !next.available) {
      batteryKnown = true;
      batteryAvailable = false;
      batteryWaiters.splice(0).forEach(function (waiter) {
        waiter.reject(new Error("This device has no battery."));
      });
      return;
    }
    var nextLevel = Math.max(0, Math.min(1, Number(next.percentage || 0) / 100));
    var chargingChanged = batteryManager.charging !== Boolean(next.charging);
    var levelChanged = batteryManager.level !== nextLevel;
    batteryManager.charging = Boolean(next.charging);
    batteryManager.level = nextLevel;
    batteryManager.chargingTime = batteryManager.charging ? 0 : Infinity;
    batteryKnown = true;
    batteryAvailable = true;
    batteryWaiters.splice(0).forEach(function (waiter) { waiter.resolve(batteryManager); });
    if (chargingChanged) batteryManager.dispatchEvent(new Event("chargingchange"));
    if (levelChanged) batteryManager.dispatchEvent(new Event("levelchange"));
  }

  try {
    Object.defineProperty(navigator, "getBattery", {
      configurable: true,
      value: function () {
        return new Promise(function (resolve, reject) {
          if (!batteryKnown) {
            batteryWaiters.push({resolve: resolve, reject: reject});
          } else if (batteryAvailable) {
            resolve(batteryManager);
          } else {
            reject(new Error("This device has no battery."));
          }
        });
      }
    });
  } catch (_) {
    navigator.getBattery = function () {
      return new Promise(function (resolve, reject) {
        if (!batteryKnown) batteryWaiters.push({resolve: resolve, reject: reject});
        else if (batteryAvailable) resolve(batteryManager);
        else reject(new Error("This device has no battery."));
      });
    };
  }

  function versionIdentity(value) {
    return value ? String(value.version || "") + "|" + String(value.build || "") : "";
  }

  function checkRemoteUpdate(state) {
    var packagedValue = state && state.packagedVersion;
    var remoteValue = state && state.remoteVersion;
    if (packagedValue && remoteValue && packagedValue.revision && packagedValue.revision === remoteValue.revision) {
      window.dispatchEvent(new CustomEvent("aos-update-status", {detail: {required: false}}));
      return;
    }
    var packaged = versionIdentity(state && state.packagedVersion);
    var remote = versionIdentity(state && state.remoteVersion);
    if (!packaged || !remote || packaged === remote) {
      window.dispatchEvent(new CustomEvent("aos-update-status", {detail: {required: false}}));
      return;
    }
    var packagedTime = Date.parse(packagedValue && packagedValue.build || "");
    var remoteTime = Date.parse(remoteValue && remoteValue.build || "");
    if (Number.isFinite(packagedTime) && Number.isFinite(remoteTime) && remoteTime <= packagedTime) {
      window.dispatchEvent(new CustomEvent("aos-update-status", {detail: {required: false}}));
      return;
    }
    window.dispatchEvent(new CustomEvent("aos-update-status", {
      detail: {
        required: true,
        packagedVersion: packagedValue,
        remoteVersion: remoteValue,
        persistent: Boolean(state && state.persistent)
      }
    }));
    var key = "aos-native-update-" + remote;
    try {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, "shown");
    } catch (_) {}
    window.dispatchEvent(new CustomEvent("aos-notification", {
      detail: {message: "An A-OS update is ready. Open the update indicator to review and install it."}
    }));
  }

  function refreshSystem() {
    return request("/__aos/system").then(function (state) {
      systemState = state;
      applyBattery(state.battery);
      window.dispatchEvent(new CustomEvent("aos-native-system", {detail: state}));
      return state;
    }).catch(function () { return systemState; });
  }

  window.AOS_NATIVE_BRIDGE = {
    request: request,
    post: post,
    refresh: refreshSystem,
    get state() { return systemState; }
  };

  window.aosNetworkBridge = {
    scan: function () {
      return request("/__aos/wifi/scan").then(function (value) { return value.networks || []; });
    },
    connect: function (ssid, password) {
      return post("/__aos/wifi/connect", {ssid: ssid, password: password || ""})
        .then(function () { return refreshSystem(); })
        .then(function () { return true; })
        .catch(function () { return false; });
    },
    toggle: function (enabled) {
      return post("/__aos/wifi/toggle", {enabled: Boolean(enabled)}).then(refreshSystem);
    },
    toggleInternet: function (enabled) {
      return post("/__aos/networking/toggle", {enabled: Boolean(enabled)}).then(refreshSystem);
    },
    check: function () {
      return request("/__aos/network/check").then(refreshSystem);
    }
  };

  window.aosUpdateBridge = {
    check: function () {
      return request("/__aos/update").then(function (state) {
        checkRemoteUpdate(state);
        return state;
      });
    },
    status: function () {
      return request("/__aos/update/status");
    },
    apply: function () {
      return post("/__aos/update/apply", {});
    }
  };

  window.aosBluetoothBridge = {
    scan: function () {
      return request("/__aos/bluetooth/scan").then(function (value) { return value.devices || []; });
    },
    connect: function (address) {
      return post("/__aos/bluetooth/connect", {address: address}).then(refreshSystem);
    },
    toggle: function (enabled) {
      return post("/__aos/bluetooth/toggle", {enabled: Boolean(enabled)}).then(refreshSystem);
    }
  };

  window.aosAudioBridge = {
    setVolume: function (percentage) {
      return post("/__aos/volume", {percentage: Number(percentage)}).then(refreshSystem);
    }
  };

  window.aosDisplayBridge = {
    setBrightness: function (percentage) {
      return post("/__aos/brightness", {percentage: Number(percentage)}).then(refreshSystem);
    }
  };

  window.aosPowerBridge = {
    perform: function (action) {
      var normalized = action === "restart" ? "restart" : action === "hibernate" ? "hibernate" : "shutdown";
      var save = window.AOS_SESSION_PERSISTENCE && typeof window.AOS_SESSION_PERSISTENCE.save === "function"
        ? window.AOS_SESSION_PERSISTENCE.save(normalized)
        : Promise.resolve();
      return Promise.resolve(save).then(function () {
        return post("/__aos/power/" + normalized, {});
      });
    }
  };

  refreshSystem();
  window.setInterval(refreshSystem, 10000);
  window.setTimeout(function () {
    request("/__aos/update").then(checkRemoteUpdate).catch(function () {});
  }, 5000);
  window.setInterval(function () {
    request("/__aos/update").then(checkRemoteUpdate).catch(function () {});
  }, 60000);
})();
