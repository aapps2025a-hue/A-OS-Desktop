(function () {
  "use strict";

  if (window.AOS_DEVICE_STATUS) return;

  var activeTracks = new Set();
  var updateRequired = false;
  var nativeMicrophoneActive = false;
  var mutationTimer = 0;
  var baseUrl = new URL("./", document.currentScript ? document.currentScript.src : window.location.href);

  function notify(message) {
    window.dispatchEvent(new CustomEvent("aos-notification", {detail: {message: message}}));
  }

  function microphoneActive() {
    var active = false;
    activeTracks.forEach(function (track) {
      if (track.readyState !== "ended") active = true;
    });
    return active;
  }

  function refreshIndicators() {
    document.querySelectorAll(".aos-device-status-corner").forEach(function (root) {
      var update = root.querySelector("[data-aos-device-status='update']");
      var microphone = root.querySelector("[data-aos-device-status='microphone']");
      if (update) update.classList.toggle("is-visible", updateRequired);
      if (microphone) microphone.classList.toggle("is-visible", nativeMicrophoneActive || microphoneActive());
      root.hidden = !updateRequired && !nativeMicrophoneActive && !microphoneActive();
    });
  }

  function trackMicrophone(track) {
    if (!track || track.kind !== "audio" || activeTracks.has(track)) return;
    activeTracks.add(track);
    var originalStop = track.stop && track.stop.bind(track);
    if (originalStop) {
      try {
        track.stop = function () {
          originalStop();
          activeTracks.delete(track);
          refreshIndicators();
        };
      } catch (_) {}
    }
    track.addEventListener("ended", function () {
      activeTracks.delete(track);
      refreshIndicators();
    }, {once: true});
    refreshIndicators();
  }

  function instrumentWindow(targetWindow) {
    var mediaDevices;
    try {
      mediaDevices = targetWindow.navigator && targetWindow.navigator.mediaDevices;
      if (!mediaDevices || !mediaDevices.getUserMedia || mediaDevices.__aosInstrumented) return;
      var original = mediaDevices.getUserMedia.bind(mediaDevices);
      mediaDevices.getUserMedia = function (constraints) {
        return original(constraints).then(function (stream) {
          if (constraints && constraints.audio) stream.getAudioTracks().forEach(trackMicrophone);
          return stream;
        });
      };
      Object.defineProperty(mediaDevices, "__aosInstrumented", {value: true});
    } catch (_) {}
  }

  function statusButton(kind, iconName, label) {
    var button = document.createElement("button");
    button.type = "button";
    button.dataset.aosDeviceStatus = kind;
    button.title = label;
    button.setAttribute("aria-label", label);
    var image = document.createElement("img");
    image.src = new URL("./assets/icons/" + iconName, baseUrl).href;
    image.alt = "";
    button.appendChild(image);
    button.addEventListener("click", function () { notify(label); });
    return button;
  }

  function installCorner() {
    document.querySelectorAll(".shelf").forEach(function (shelf) {
      if (shelf.querySelector(":scope > .aos-device-status-corner")) return;
      var root = document.createElement("div");
      root.className = "aos-device-status-corner";
      root.hidden = true;
      root.append(
        statusButton("update", "Reboot.png", "An A-OS update is ready. Restart after updating to use it."),
        statusButton("microphone", "Record.png", "An app is using the microphone.")
      );
      var status = shelf.querySelector(":scope > .status");
      shelf.insertBefore(root, status || null);
    });
    refreshIndicators();
  }

  function instrumentFrames() {
    document.querySelectorAll("iframe").forEach(function (frame) {
      try { instrumentWindow(frame.contentWindow); } catch (_) {}
      if (frame.dataset.aosMicrophoneWatch) return;
      frame.dataset.aosMicrophoneWatch = "true";
      frame.addEventListener("load", function () {
        try { instrumentWindow(frame.contentWindow); } catch (_) {}
      });
    });
  }

  function scan() {
    installCorner();
    instrumentFrames();
  }

  function scheduleScan() {
    window.clearTimeout(mutationTimer);
    mutationTimer = window.setTimeout(scan, 60);
  }

  window.AOS_DEVICE_STATUS = {
    instrumentWindow: instrumentWindow,
    refresh: refreshIndicators
  };

  instrumentWindow(window);
  window.addEventListener("aos-update-status", function (event) {
    updateRequired = Boolean(event.detail && event.detail.required);
    refreshIndicators();
  });
  window.addEventListener("aos-native-system", function (event) {
    nativeMicrophoneActive = Boolean(event.detail && event.detail.microphoneActive);
    refreshIndicators();
  });

  var observer = new MutationObserver(scheduleScan);
  function start() {
    scan();
    observer.observe(document.documentElement, {childList: true, subtree: true});
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, {once: true});
  else start();
})();
