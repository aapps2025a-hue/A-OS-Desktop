(function () {
  "use strict";

  if (new URLSearchParams(window.location.search).get("aosLiveIso") !== "1") return;

  var reported = false;
  function reportReady() {
    if (reported) return;
    var root = document.getElementById("root");
    if (!root || !root.firstElementChild) return;
    reported = true;
    fetch("/__aos_browser_ready", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "A-OS HTML mounted"
    }).catch(function () {});
  }

  var observer = new MutationObserver(reportReady);
  function watch() {
    var root = document.getElementById("root");
    if (root) observer.observe(root, { childList: true, subtree: true });
    reportReady();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", watch, { once: true });
  } else {
    watch();
  }
  window.addEventListener("load", reportReady, { once: true });
})();
