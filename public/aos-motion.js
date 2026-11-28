(function () {
  "use strict";

  if (window.AOS_MOTION) return;

  var windowSelector = ".system-window, .astore-app-window, .aos-filedrop-window, .aos-screenshot-window, [role='dialog']";
  var panelSelector = ".quick, .context-menu, .notification, .toast, [role='menu']";
  var visibility = new WeakMap();

  function visible(element) {
    return Boolean(element && element.isConnected && !element.hidden && element.getClientRects().length);
  }

  function play(element, panel) {
    if (!visible(element) || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    var className = panel ? "aos-motion-panel-enter" : "aos-motion-enter";
    element.classList.remove(className);
    void element.offsetWidth;
    element.classList.add(className);
    window.setTimeout(function () { element.classList.remove(className); }, 320);
  }

  function inspect(element, initial) {
    if (!(element instanceof Element)) return;
    var candidates = [];
    if (element.matches(windowSelector + ", " + panelSelector)) candidates.push(element);
    element.querySelectorAll(windowSelector + ", " + panelSelector).forEach(function (candidate) { candidates.push(candidate); });
    candidates.forEach(function (candidate) {
      var now = visible(candidate);
      var before = visibility.get(candidate);
      visibility.set(candidate, now);
      if (now && !initial && before !== true) play(candidate, candidate.matches(panelSelector));
    });
  }

  function start() {
    inspect(document.body, true);
    new MutationObserver(function (mutations) {
      mutations.forEach(function (mutation) {
        if (mutation.type === "childList") mutation.addedNodes.forEach(function (node) { inspect(node, false); });
        else inspect(mutation.target, false);
      });
    }).observe(document.body, {childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "class"]});

    document.addEventListener("pointerdown", function (event) {
      var target = event.target.closest("button, [role='button']");
      if (!target || target.disabled) return;
      target.classList.add("aos-motion-press");
      var release = function () {
        target.classList.remove("aos-motion-press");
        window.removeEventListener("pointerup", release, true);
        window.removeEventListener("pointercancel", release, true);
      };
      window.addEventListener("pointerup", release, true);
      window.addEventListener("pointercancel", release, true);
    }, true);
  }

  window.AOS_MOTION = {play: play};
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, {once: true});
  else start();
})();
