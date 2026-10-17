(function () {
  "use strict";

  if (new URLSearchParams(window.location.search).get("aosLiveIso") !== "1") return;

  var documentReported = false;
  var desktopReported = false;

  function sendReady(message) {
    fetch("/__aos_browser_ready", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: message
    }).catch(function () {});
  }

  function reportDocumentReady() {
    if (documentReported) return;
    documentReported = true;
    sendReady("A-OS HTML document loaded");
  }

  function reportDesktopReady() {
    if (desktopReported) return;
    var root = document.getElementById("root");
    if (!root || !root.firstElementChild) return;
    desktopReported = true;
    sendReady("A-OS desktop mounted");
  }

  var observer = new MutationObserver(reportDesktopReady);
  function watch() {
    reportDocumentReady();
    var root = document.getElementById("root");
    if (root) observer.observe(root, { childList: true, subtree: true });
    reportDesktopReady();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", watch, { once: true });
  } else {
    watch();
  }
  window.addEventListener("load", reportDesktopReady, { once: true });
})();
