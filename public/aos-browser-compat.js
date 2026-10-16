(function () {
  "use strict";

  var root = window;

  if (!root.globalThis) root.globalThis = root;

  if (!String.prototype.replaceAll) {
    Object.defineProperty(String.prototype, "replaceAll", {
      configurable: true,
      writable: true,
      value: function (search, replacement) {
        if (search instanceof RegExp) {
          if (!search.global) throw new TypeError("replaceAll requires a global regular expression");
          return this.replace(search, replacement);
        }
        return this.split(String(search)).join(replacement);
      }
    });
  }

  if (!String.prototype.padStart) {
    Object.defineProperty(String.prototype, "padStart", {
      configurable: true,
      writable: true,
      value: function (targetLength, padding) {
        var result = String(this);
        var target = Math.max(0, Number(targetLength) || 0);
        var fill = padding === undefined ? " " : String(padding);
        if (!fill) return result;
        while (result.length < target) result = fill + result;
        return result.slice(result.length - target);
      }
    });
  }

  if (!Array.prototype.at) {
    Object.defineProperty(Array.prototype, "at", {
      configurable: true,
      writable: true,
      value: function (index) {
        var position = Number(index) || 0;
        if (position < 0) position += this.length;
        return this[position];
      }
    });
  }

  if (!Array.prototype.flat) {
    Object.defineProperty(Array.prototype, "flat", {
      configurable: true,
      writable: true,
      value: function (depth) {
        var level = depth === undefined ? 1 : Number(depth) || 0;
        var flatten = function (items, remaining) {
          return items.reduce(function (result, item) {
            return result.concat(Array.isArray(item) && remaining > 0 ? flatten(item, remaining - 1) : item);
          }, []);
        };
        return flatten(this, level);
      }
    });
  }

  if (!Array.prototype.flatMap) {
    Object.defineProperty(Array.prototype, "flatMap", {
      configurable: true,
      writable: true,
      value: function (callback, thisArg) {
        return this.map(callback, thisArg).flat();
      }
    });
  }

  if (!Object.fromEntries) {
    Object.fromEntries = function (entries) {
      return Array.from(entries).reduce(function (result, entry) {
        result[entry[0]] = entry[1];
        return result;
      }, {});
    };
  }

  if (!root.structuredClone) {
    root.structuredClone = function (value) {
      if (value === undefined) return undefined;
      return JSON.parse(JSON.stringify(value));
    };
  }

  if (!root.requestIdleCallback) {
    root.requestIdleCallback = function (callback) {
      return root.setTimeout(function () {
        callback({ didTimeout: false, timeRemaining: function () { return 0; } });
      }, 1);
    };
    root.cancelIdleCallback = function (id) { root.clearTimeout(id); };
  }

  var cryptoObject = root.crypto || root.msCrypto;
  if (cryptoObject && !cryptoObject.randomUUID) {
    try {
      cryptoObject.randomUUID = function () {
        var bytes = new Uint8Array(16);
        if (cryptoObject.getRandomValues) cryptoObject.getRandomValues(bytes);
        else for (var index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
        bytes[6] = (bytes[6] & 15) | 64;
        bytes[8] = (bytes[8] & 63) | 128;
        var hex = Array.prototype.map.call(bytes, function (value) { return value.toString(16).padStart(2, "0"); });
        return hex.slice(0, 4).join("") + "-" + hex.slice(4, 6).join("") + "-" + hex.slice(6, 8).join("") + "-" + hex.slice(8, 10).join("") + "-" + hex.slice(10).join("");
      };
    } catch (error) {
      // Some browsers expose a non-extensible Crypto object. A-OS keeps running without this optional fallback.
    }
  }

  if (root.CSS && !root.CSS.escape) {
    root.CSS.escape = function (value) {
      return String(value).replace(/[^a-zA-Z0-9_-]/g, function (character) {
        return "\\" + character.codePointAt(0).toString(16) + " ";
      });
    };
  }

  var originalAlert = root.alert ? root.alert.bind(root) : function () {};
  var alertQueue = [];
  var activeAlert = false;
  var previousFocus = null;

  function messageText(value) {
    if (typeof value === "string") return value;
    try {
      return typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);
    } catch (error) {
      return String(value);
    }
  }

  function installAlertStyles() {
    if (document.getElementById("aos-compat-alert-style")) return;
    var style = document.createElement("style");
    style.id = "aos-compat-alert-style";
    style.textContent = [
      ".aos-compat-alert{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:20px;background:rgba(2,10,20,.56);font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}",
      ".aos-compat-alert[hidden]{display:none}",
      ".aos-compat-alert__window{width:min(430px,100%);overflow:hidden;border:1px solid rgba(255,255,255,.62);border-radius:8px;background:rgba(250,253,255,.98);box-shadow:0 24px 80px rgba(0,0,0,.42);color:#102239}",
      ".aos-compat-alert__title{height:44px;display:flex;align-items:center;gap:9px;padding:0 10px 0 14px;border-bottom:1px solid #d9e5ec;background:#eef6fa;font-size:13px;font-weight:800}",
      ".aos-compat-alert__title img{width:22px;height:22px;object-fit:contain}",
      ".aos-compat-alert__title span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".aos-compat-alert__close{width:32px;height:32px;border:0;border-radius:6px;background:transparent;color:#5e6e78;font-size:22px;line-height:1;cursor:pointer}",
      ".aos-compat-alert__close:hover{background:#df3f4f;color:#fff}",
      ".aos-compat-alert__body{display:flex;align-items:flex-start;gap:14px;padding:22px 22px 16px}",
      ".aos-compat-alert__body>img{width:38px;height:38px;object-fit:contain;flex:0 0 auto}",
      ".aos-compat-alert__message{max-height:260px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px;line-height:1.55}",
      ".aos-compat-alert__actions{display:flex;justify-content:flex-end;padding:0 22px 20px}",
      ".aos-compat-alert__ok{min-width:86px;border:0;border-radius:6px;background:#0b74e5;color:#fff;padding:10px 18px;font:800 13px inherit;cursor:pointer}",
      ".aos-compat-alert__ok:hover{background:#075ebc}",
      "@media (prefers-color-scheme:dark){.aos-compat-alert__window{border-color:#415464;background:#101e2a;color:#eef8fc}.aos-compat-alert__title{border-color:#304453;background:#162936}.aos-compat-alert__close{color:#b9c8d1}}"
    ].join("");
    document.head.appendChild(style);
  }

  function closeAlert() {
    var overlay = document.getElementById("aos-compat-alert");
    if (overlay) overlay.remove();
    activeAlert = false;
    if (previousFocus && typeof previousFocus.focus === "function") previousFocus.focus();
    previousFocus = null;
    showNextAlert();
  }

  function showNextAlert() {
    if (activeAlert || alertQueue.length === 0 || !document.body) return;
    activeAlert = true;
    previousFocus = document.activeElement;
    installAlertStyles();

    var next = alertQueue.shift();
    var overlay = document.createElement("div");
    overlay.id = "aos-compat-alert";
    overlay.className = "aos-compat-alert";
    overlay.setAttribute("role", "alertdialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "aos-compat-alert-title");
    overlay.setAttribute("aria-describedby", "aos-compat-alert-message");

    var panel = document.createElement("section");
    panel.className = "aos-compat-alert__window";
    panel.innerHTML = '<header class="aos-compat-alert__title"><img src="./assets/icons/OS Logo.png" alt=""><span id="aos-compat-alert-title"></span><button class="aos-compat-alert__close" type="button" aria-label="Close">&times;</button></header><main class="aos-compat-alert__body"><img src="./assets/icons/Safe.png" alt=""><div class="aos-compat-alert__message" id="aos-compat-alert-message"></div></main><footer class="aos-compat-alert__actions"><button class="aos-compat-alert__ok" type="button">OK</button></footer>';
    panel.querySelector("#aos-compat-alert-title").textContent = next.title || "A-OS Application";
    panel.querySelector("#aos-compat-alert-message").textContent = next.message;

    var fallbackIcon = panel.querySelector(".aos-compat-alert__body>img");
    fallbackIcon.addEventListener("error", function () { fallbackIcon.src = "./assets/icons/OS Logo.png"; }, { once: true });
    panel.querySelector(".aos-compat-alert__close").addEventListener("click", closeAlert);
    panel.querySelector(".aos-compat-alert__ok").addEventListener("click", closeAlert);
    overlay.addEventListener("keydown", function (event) {
      if (event.key === "Escape" || event.key === "Enter") {
        event.preventDefault();
        closeAlert();
      }
    });
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    panel.querySelector(".aos-compat-alert__ok").focus();
  }

  function aosAlert(value, title) {
    alertQueue.push({ message: messageText(value), title: title || "A-OS Application" });
    showNextAlert();
  }

  root.AOS_BROWSER_COMPAT = {
    alert: aosAlert,
    originalAlert: originalAlert,
    supportedBrowsers: "Current Chrome, Edge, Firefox and Safari"
  };
  root.alert = aosAlert;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", showNextAlert, { once: true });
  }
})();
