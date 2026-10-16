(() => {
  const LAUNCHER_ID = "aos-tv-screen-app";
  const TASKBAR_ID = "aos-tv-screen-taskbar";
  const WINDOW_ID = "aos-tv-screen-window";
  const localTv = /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname)
    ? `${window.location.origin}/?cast=desktop`
    : "https://a-os-tv.web.app/?cast=desktop";
  const TV_ORIGIN = new URL(localTv).origin;
  let captureTimer = 0;
  let captureActive = false;

  const addStyles = () => {
    if (document.getElementById("aos-tv-screen-styles")) return;
    const style = document.createElement("style");
    style.id = "aos-tv-screen-styles";
    style.textContent = `
      #${LAUNCHER_ID} img{object-fit:contain}
      #${TASKBAR_ID}{position:relative}
      #${TASKBAR_ID} img{object-fit:contain;width:42px;height:42px;pointer-events:none}
      #${TASKBAR_ID}>span{background:#149ad2;border-radius:4px;width:6px;height:3px;position:absolute;bottom:1px;left:50%;transform:translateX(-50%)}
      #${WINDOW_ID}{z-index:2147482000;color:#fff;background:#07131f;border:1px solid #3a566b;border-radius:8px;grid-template-rows:52px 1fr;display:grid;position:fixed;top:4vh;right:4vw;bottom:86px;left:4vw;overflow:hidden;box-shadow:0 28px 100px #000b}
      #${WINDOW_ID}>header{background:#06131e;border-bottom:1px solid #2b465a;grid-template-columns:auto 1fr auto;align-items:center;gap:11px;padding:7px 12px;display:grid;font-family:system-ui}
      #${WINDOW_ID}>header img{object-fit:contain;width:36px;height:36px}
      #${WINDOW_ID}>header span{display:grid}#${WINDOW_ID}>header small{color:#8fa8ba;font-size:9px}
      #${WINDOW_ID}>header button{color:#fff;background:#173044;border:1px solid #3d596d;border-radius:50%;place-items:center;width:38px;height:38px;font-size:22px;display:grid;cursor:pointer}
      #${WINDOW_ID}>iframe{background:#07131f;border:0;width:100%;height:100%}
      @media(max-width:700px){#${WINDOW_ID}{border:0;border-radius:0;top:0;right:0;bottom:70px;left:0}}
    `;
    document.head.appendChild(style);
  };

  const stopDeviceCapture = () => {
    captureActive = false;
    window.clearTimeout(captureTimer);
    captureTimer = 0;
  };

  const sendCaptureError = (iframe, message) => {
    iframe?.contentWindow?.postMessage({type: "aos-cast-device-capture-error", message}, TV_ORIGIN);
  };

  const captureDeviceFrame = async (iframe) => {
    if (!captureActive || !iframe?.isConnected) return;
    try {
      if (typeof window.html2canvas !== "function") throw new Error("The A-OS screen capture service did not load.");
      const target = document.querySelector(".desktop") || document.getElementById("root") || document.body;
      const scale = Math.min(1, 1280 / Math.max(target.clientWidth, 1));
      const canvas = await window.html2canvas(target, {
        allowTaint: false,
        backgroundColor: "#07131f",
        logging: false,
        scale,
        useCORS: true,
        ignoreElements: (element) => element.id === WINDOW_ID || Boolean(element.closest?.(`#${WINDOW_ID}`)),
      });
      const frame = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
      if (captureActive && frame) {
        iframe.contentWindow?.postMessage({type: "aos-cast-device-frame", frame}, TV_ORIGIN);
      }
    } catch (error) {
      sendCaptureError(iframe, error?.message || "A-OS Desktop could not provide its screen.");
      stopDeviceCapture();
      return;
    }
    if (captureActive) captureTimer = window.setTimeout(() => captureDeviceFrame(iframe), 350);
  };

  const startDeviceCapture = (iframe) => {
    stopDeviceCapture();
    captureActive = true;
    captureDeviceFrame(iframe);
  };

  const syncRunningButton = () => {
    const shelf = document.querySelector(".desktop .shelf");
    const running = Boolean(document.getElementById(WINDOW_ID));
    let button = document.getElementById(TASKBAR_ID);
    if (!running || !shelf) {
      button?.remove();
      return;
    }
    if (button) return;
    button = document.createElement("button");
    button.id = TASKBAR_ID;
    button.className = "shelf-icon state-open";
    button.type = "button";
    button.title = "Share A-OS TV Screen";
    button.setAttribute("aria-label", "Share A-OS TV Screen");
    button.innerHTML = '<img src="/assets/icons/This PC.png" alt=""><span></span>';
    button.addEventListener("click", open);
    const status = shelf.querySelector(".status");
    shelf.insertBefore(button, status || null);
  };

  const close = () => {
    stopDeviceCapture();
    document.getElementById(WINDOW_ID)?.remove();
    syncRunningButton();
  };

  const open = () => {
    const existing = document.getElementById(WINDOW_ID);
    if (existing) {
      existing.focus();
      return;
    }
    const panel = document.createElement("section");
    panel.id = WINDOW_ID;
    panel.tabIndex = -1;
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Share A-OS TV Screen");
    panel.innerHTML = `
      <header>
        <img src="/assets/icons/This PC.png" alt="">
        <span><b>Share A-OS TV Screen</b><small>Connect A-OS Desktop and A-OS TV on your local network</small></span>
        <button type="button" aria-label="Close Share A-OS TV Screen">&times;</button>
      </header>
      <iframe src="${localTv}" title="Share A-OS TV Screen" allow="autoplay; fullscreen" referrerpolicy="origin"></iframe>
    `;
    panel.querySelector("button")?.addEventListener("click", close);
    document.body.appendChild(panel);
    panel.focus();
    syncRunningButton();
  };

  const addLauncherApp = () => {
    document.querySelectorAll(".desktop .launcher").forEach((launcher) => {
      if (launcher.querySelector(`#${LAUNCHER_ID}`)) return;
      const grids = Array.from(launcher.children).filter((child) => child.tagName === "DIV");
      const grid = grids.find((child) => child.querySelector("button"));
      if (!grid) return;
      const button = document.createElement("button");
      button.id = LAUNCHER_ID;
      button.type = "button";
      button.title = "Connect to an A-OS TV screen";
      button.innerHTML = '<span><img src="/assets/icons/This PC.png" alt=""></span>Share A-OS TV Screen';
      button.addEventListener("click", open);
      grid.appendChild(button);
    });
  };

  const enhance = () => {
    addLauncherApp();
    syncRunningButton();
  };

  addStyles();
  enhance();
  const observer = new MutationObserver(enhance);
  observer.observe(document.documentElement, {childList: true, subtree: true});
  window.addEventListener("message", (event) => {
    const panel = document.getElementById(WINDOW_ID);
    const iframe = panel?.querySelector("iframe");
    if (!iframe || event.origin !== TV_ORIGIN || event.source !== iframe.contentWindow) return;
    if (event.data?.type === "aos-cast-close") close();
    if (event.data?.type === "aos-cast-start-device-capture") startDeviceCapture(iframe);
    if (event.data?.type === "aos-cast-stop-device-capture") stopDeviceCapture();
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && document.getElementById(WINDOW_ID)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      close();
    }
  }, true);
})();
