(function () {
  "use strict";

  if (window.top !== window || document.getElementById("aos-boot-sequence")) return;

  var currentScript = document.currentScript;
  var bootImage = new URL("./assets/os/A-OS Boot.gif", currentScript && currentScript.src || location.href);
  bootImage.searchParams.set("boot", String(Date.now()));

  var style = document.createElement("style");
  style.id = "aos-boot-sequence-style";
  style.textContent = [
    "html.aos-is-booting, html.aos-is-booting body { background:#06111f !important; overflow:hidden !important; }",
    "#aos-boot-sequence { position:fixed; inset:0; z-index:2147483647; display:grid; place-items:center; background:#06111f; opacity:1; transition:opacity 700ms ease; }",
    "#aos-boot-sequence.aos-boot-fade { opacity:0; pointer-events:none; }",
    "#aos-boot-sequence img { width:100%; height:100%; object-fit:cover; display:block; }",
    "@media (prefers-reduced-motion: reduce) { #aos-boot-sequence { transition-duration:240ms; } }"
  ].join("");

  var overlay = document.createElement("div");
  overlay.id = "aos-boot-sequence";
  overlay.setAttribute("aria-hidden", "true");

  var image = document.createElement("img");
  image.alt = "";
  image.decoding = "sync";
  image.src = bootImage.href;
  overlay.appendChild(image);

  document.documentElement.classList.add("aos-is-booting");
  document.head.appendChild(style);
  document.documentElement.appendChild(overlay);

  var finished = false;
  function finishBoot() {
    if (finished) return;
    finished = true;
    overlay.classList.add("aos-boot-fade");
    window.setTimeout(function () {
      overlay.remove();
      style.remove();
      document.documentElement.classList.remove("aos-is-booting");
      window.dispatchEvent(new CustomEvent("aos-boot-complete"));
    }, 760);
  }

  image.addEventListener("load", function () {
    var duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 1200 : 3400;
    window.setTimeout(finishBoot, duration);
  }, {once: true});
  image.addEventListener("error", function () {
    window.setTimeout(finishBoot, 350);
  }, {once: true});
  window.setTimeout(finishBoot, 5200);
})();
