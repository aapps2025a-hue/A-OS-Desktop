import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const chrome = process.env.AOS_CHROME_BIN;
const url = process.env.AOS_SMOKE_URL || "http://127.0.0.1:8765/";
const port = Number(process.env.AOS_CDP_PORT || 9339);
const nativeIso = new URL(url).searchParams.get("aosLiveIso") === "1";
const profile = mkdtempSync(join(tmpdir(), "aos-app-smoke-"));
const requiredApps = [
  "OSInternet",
  "Files",
  "A-Store",
  "Camera",
  "File Assist",
  "Settings",
  "Terminal",
  "Storage",
  "MediaView",
  "DeviceSource"
];

if (!chrome) throw new Error("Set AOS_CHROME_BIN to a Chromium or Chrome executable");
if (typeof WebSocket !== "function") throw new Error("This smoke test requires Node.js with WebSocket support");

const browser = spawn(chrome, [
  "--headless=new",
  "--no-sandbox",
  "--disable-gpu",
  "--disable-dev-shm-usage",
  "--window-size=1365,768",
  "--no-first-run",
  "--no-default-browser-check",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  url
], { stdio: "ignore" });

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function target() {
  const deadline = Date.now() + 15000;
  const expectedOrigin = new URL(url).origin;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const page = targets.find((item) => item.type === "page" && item.url.startsWith(expectedOrigin));
      if (page) return page;
    } catch (_) {}
    await sleep(150);
  }
  throw new Error("Chrome DevTools did not become ready");
}

function connect(webSocketDebuggerUrl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketDebuggerUrl);
    const pending = new Map();
    let nextId = 1;
    socket.addEventListener("open", () => {
      resolve({
        socket,
        send(method, params = {}) {
          const id = nextId++;
          socket.send(JSON.stringify({ id, method, params }));
          return new Promise((resolveCommand, rejectCommand) => pending.set(id, { resolveCommand, rejectCommand }));
        }
      });
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id || !pending.has(message.id)) return;
      const request = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) request.rejectCommand(new Error(message.error.message));
      else request.resolveCommand(message.result);
    });
    socket.addEventListener("error", () => reject(new Error("Chrome DevTools WebSocket failed")));
  });
}

async function main() {
  const page = await target();
  const cdp = await connect(page.webSocketDebuggerUrl);
  const evaluate = async (expression) => {
    const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) {
      const description = result.exceptionDetails.exception && result.exceptionDetails.exception.description;
      throw new Error(description || result.exceptionDetails.text || "Browser evaluation failed");
    }
    return result.result.value;
  };
  const waitFor = async (expression, label, timeout = 30000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return;
      await sleep(200);
    }
    const pageText = await evaluate("document.body ? document.body.innerText.replace(/\\s+/g, ' ').slice(0, 500) : 'no document body'");
    throw new Error(`Timed out waiting for ${label}. Page text: ${pageText}`);
  };
  const appButton = (label) => `[...document.querySelectorAll("button")].find((button) => button.getAttribute("aria-label") === ${JSON.stringify(label)})`;

  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Page.navigate", { url });
  await waitFor("document.readyState === 'complete'", "the initial page");
  if (process.env.AOS_WIFI_SMOKE === "1") {
    await evaluate(`(async () => {
      window.AOS_NATIVE_BRIDGE = {state:{wifi:{enabled:true}}, refresh:async()=>({wifi:{enabled:true}})};
      window.aosNetworkBridge = {
        scan: async()=>[{ssid:"Test Network",secure:true,strength:80}],
        connect: async()=>{throw new Error("No Wi-Fi adapter available (test)");}
      };
      await new Promise((resolve,reject)=>{
        const script=document.createElement("script");script.src="./aos-live-native-runtime.js?wifi-test=1";
        script.onload=resolve;script.onerror=reject;document.body.appendChild(script);
      });
      const tiles=document.createElement("div");tiles.className="quick-tiles";
      tiles.innerHTML="<button><b>Wi-Fi</b></button>";
      document.body.appendChild(tiles);
      tiles.querySelector("button").click();
    })()`);
    await waitFor(`Boolean(document.querySelector('.aos-native-device input'))`, "Wi-Fi panel from immediate Quick Settings click");
    await evaluate(`document.querySelector('.aos-native-device button').click()`);
    await waitFor(`document.querySelector('.aos-native-wifi-status').textContent.includes('No Wi-Fi adapter available')`, "visible connection error");
    await evaluate(`window.aosNetworkBridge.connect=async()=>true;document.querySelector('.aos-native-device button').click()`);
    await waitFor(`Boolean(document.querySelector('.aos-native-device button')) && !document.querySelector('.aos-native-device button').disabled`, "connection retry completing");
    console.log("PASS: immediate Quick Settings click opens Wi-Fi, failed connections show inline errors, retry completes");
    cdp.socket.close();
    return;
  }
  await waitFor(
    `(() => { try { localStorage.getItem("aos-configured"); return location.origin === ${JSON.stringify(new URL(url).origin)}; } catch (_) { return false; } })()`,
    "A-OS origin storage"
  );
  await evaluate(`
    localStorage.setItem("aos-configured", "true");
    localStorage.setItem("aos-no-locking", "true");
    localStorage.setItem("aos-profile", "Person");
    localStorage.setItem("aos-profile-password-Person", "AosTest123!");
    localStorage.setItem("aos-password", "AosTest123!");
    localStorage.setItem("aos-username", "ISO App Test");
    localStorage.setItem("aos-files", JSON.stringify([{
      id: "smoke-iso",
      name: "A-OS Desktop.iso",
      type: "file",
      parent: "root",
      content: "",
      icon: "Downloads.png",
      mime: "application/x-iso9660-image"
    }]));
    location.reload();
  `);
  const desktopDeadline = Date.now() + 50000;
  while (Date.now() < desktopDeadline && !(await evaluate(`${appButton("Files")} != null`))) {
    await evaluate(`(() => {
      const setInput = (input, value) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        setter.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      };
      const passwordInputs = [...document.querySelectorAll('input[type="password"]')];
      passwordInputs.forEach((input) => setInput(input, "AosTest123!"));
      const unlock = document.querySelector('input[placeholder="Enter password"]');
      if (unlock) setInput(unlock, "AosTest123!");
      const labels = ["Continue", "Finish setup", "Complete setup", "Unlock", "Sign in", "Start A-OS"];
      const button = [...document.querySelectorAll("button")].find((item) => {
        const text = item.textContent.trim();
        const style = getComputedStyle(item);
        return !item.disabled && style.display !== "none" && style.visibility !== "hidden" && labels.includes(text);
      });
      if (button) button.click();
      return Boolean(button);
    })()`);
    await sleep(250);
  }
  await waitFor(`${appButton("Files")} != null`, "the A-OS desktop", 1000);

  if (process.env.AOS_TWEMOJI_SMOKE === "1") {
    await evaluate(`${appButton("Settings")}.click()`);
    await waitFor(`[...document.querySelectorAll("button")].some(button => button.textContent.trim() === "Power Preferences")`, "Power Preferences settings");
    await evaluate(`[...document.querySelectorAll("button")].find(button => button.textContent.trim() === "Power Preferences").click()`);
    await waitFor(`[...document.querySelectorAll("h3")].some(heading => heading.textContent.trim() === "System Emoji Pack")`, "System Emoji Pack settings");
    await waitFor(`[...document.querySelectorAll("button")].some(button => button.textContent.trim() === "Twitter / Twemoji")`, "Twitter Twemoji option");
    await evaluate(`[...document.querySelectorAll("button")].find(button => button.textContent.trim() === "Twitter / Twemoji").click()`);
    await waitFor(`localStorage.getItem("aos-active-emoji-pack") === "Twitter / Twemoji"`, "saved Twitter Twemoji selection");
    await evaluate(`window.dispatchEvent(new KeyboardEvent("keydown", {key:".",code:"Period",ctrlKey:true,bubbles:true}))`);
    await waitFor(`Boolean(document.querySelector('.aos-complete-emoji-picker'))`, "local Twemoji picker");
    await waitFor(`document.querySelector('.aos-complete-emoji-footer').textContent.includes("Twitter / Twemoji 14.0.2")`, "Twemoji picker label");
    const twemojiImage = await evaluate(`document.querySelector('.aos-complete-emoji-item img').getAttribute('src')`);
    if (!twemojiImage.includes("/assets/emojis/aos-complete/svg/")) throw new Error("Twemoji did not use the local SVG pack");
    console.log("PASS: Twitter / Twemoji settings option persists and opens the local 3,624-image pack");
    cdp.socket.close();
    return;
  }

  if (process.env.AOS_PROFILE_SMOKE === "1") {
    const result = await evaluate(`(() => {
      const api = window.AOS_USER_PROFILES;
      localStorage.setItem("aos-wallpaper", "Porto.png");
      localStorage.setItem("aos-shelf-position", "left");
      localStorage.setItem(api.passwordKey("Second User"), "SecondPassword!");
      api.activate({name:"Second User"}, true);
      if (localStorage.getItem("aos-password") !== "SecondPassword!") throw Error("Wrong second password");
      if (localStorage.getItem("aos-wallpaper") !== null) throw Error("Inherited wallpaper");
      localStorage.setItem("aos-wallpaper", "Faro.jpg");
      localStorage.setItem("aos-shelf-position", "right");
      api.activate({name:"Person"});
      if (localStorage.getItem("aos-password") !== "AosTest123!") throw Error("Wrong first password");
      if (localStorage.getItem("aos-wallpaper") !== "Porto.png") throw Error("Lost first wallpaper");
      if (localStorage.getItem("aos-shelf-position") !== "left") throw Error("Lost taskbar position");
      return true;
    })()`);
    if (!result) throw new Error("Profile switch failed");
    await evaluate("location.reload()");
    await waitFor(`Boolean(document.querySelector('input[type="password"]'))`, "password prompt after reload");
    const enterPassword = async (password) => evaluate(`(() => {
      const input = document.querySelector('input[type="password"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, ${JSON.stringify(password)});
      input.dispatchEvent(new Event("input", {bubbles:true}));
      input.dispatchEvent(new Event("change", {bubbles:true}));
      const form = input.closest("form");
      form.requestSubmit();
    })()`);
    await enterPassword("SecondPassword!");
    await sleep(500);
    if (await evaluate(`Boolean(document.querySelector('.shelf'))`)) throw new Error("Another user's password unlocked this profile");
    await enterPassword("AosTest123!");
    await waitFor(`localStorage.getItem("aos-wallpaper") === "Porto.png" && Boolean(document.querySelector('.shelf'))`, "saved desktop after reload");
    const images = await evaluate(`Promise.all(["Porto.png","Faro.jpg"].map(name => new Promise(resolve => {
      const img = new Image(); img.onload = () => resolve(img.naturalWidth >= 1280); img.onerror = () => resolve(false);
      img.src = './assets/backgrounds/' + name;
    })))`);
    if (images.some(value => !value)) throw new Error("Photographic wallpaper failed to load");
    console.log("PASS: Chrome desktop boots, switches profiles, reloads saved settings and loads both photographs");
    cdp.socket.close();
    return;
  }

  if (process.env.AOS_TASKBAR_SMOKE === "1") {
    await waitFor(`Boolean(window.AOS_TASKBAR_STUDIO && document.querySelector('.shelf .aos-taskbar-resize-handle'))`, "the taskbar studio runtime");
    await evaluate(`${appButton("Settings")}.click()`);
    await waitFor(`[...document.querySelectorAll("button")].some((button) => button.textContent.trim() === "Appearance")`, "Appearance settings");
    await evaluate(`[...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Appearance").click()`);
    await waitFor(`document.querySelectorAll('[data-aos-taskbar-layout]').length === 5`, "the five taskbar layouts");
    const taskbarResult = await evaluate(`(async () => {
      const api = window.AOS_TASKBAR_STUDIO;
      api.setLayout('floating-segmented');
      api.setSize(76);
      const shelf = document.querySelector('.desktop > .shelf');
      const apps = [...shelf.querySelectorAll('.shelf-icon, .astore-shelf-button, .aos-filedrop-taskbar')];
      const first = apps[apps.length - 1];
      const second = apps.find((button) => button !== first && !['Files', 'OSInternet'].includes(button.getAttribute('aria-label')));
      const before = apps.map((button) => button.getAttribute('aria-label'));
      const transfer = new DataTransfer();
      first.dispatchEvent(new DragEvent('dragstart', {bubbles:true,dataTransfer:transfer}));
      const bounds = second.getBoundingClientRect();
      second.dispatchEvent(new DragEvent('dragover', {bubbles:true,cancelable:true,dataTransfer:transfer,clientX:bounds.right-1,clientY:bounds.top+4}));
      shelf.dispatchEvent(new DragEvent('drop', {bubbles:true,cancelable:true,dataTransfer:transfer}));
      first.dispatchEvent(new DragEvent('dragend', {bubbles:true,dataTransfer:transfer}));
      const after = [...shelf.querySelectorAll('.shelf-icon, .astore-shelf-button, .aos-filedrop-taskbar')].map((button) => button.getAttribute('aria-label'));
      const search = shelf.querySelector('.search-pill');
      const status = shelf.querySelector('.status');
      const launcher = shelf.querySelector('.launcher-button');
      const controlTarget = shelf.querySelector('[data-aos-taskbar-drag="ready"]:not(.search-pill)');
      const controlBefore = [...shelf.querySelectorAll('[data-aos-taskbar-drag="ready"]')].indexOf(search);
      const controlTransfer = new DataTransfer();
      search.dispatchEvent(new DragEvent('dragstart', {bubbles:true,dataTransfer:controlTransfer}));
      const controlBounds = controlTarget.getBoundingClientRect();
      controlTarget.dispatchEvent(new DragEvent('dragover', {bubbles:true,cancelable:true,dataTransfer:controlTransfer,clientX:controlBounds.left+1,clientY:controlBounds.top+4}));
      shelf.dispatchEvent(new DragEvent('drop', {bubbles:true,cancelable:true,dataTransfer:controlTransfer}));
      search.dispatchEvent(new DragEvent('dragend', {bubbles:true,dataTransfer:controlTransfer}));
      const controlAfter = [...shelf.querySelectorAll('[data-aos-taskbar-drag="ready"]')].indexOf(search);
      const settings = ${appButton("Settings")};
      const icon = settings.querySelector('img') ? settings.querySelector('img').src : '';
      api.createDesktopShortcut('Settings', icon, 500, 180);
      api.addShortcutFile('Settings', icon);
      api.addBrowserPin('Settings', icon);
      const layer = document.querySelector('#aos-desktop-widgets-layer');
      layer.querySelectorAll('.aos-taskbar-smoke-widget').forEach((item) => item.remove());
      for (const name of ['Smoke one', 'Smoke two']) {
        const widget = document.createElement('div');
        widget.className = 'aos-taskbar-smoke-widget';
        widget.style.cssText = 'position:absolute;left:24px;top:24px;width:190px;height:100px;background:#fff;';
        widget.innerHTML = '<span class="truncate">' + name + '</span>';
        layer.appendChild(widget);
      }
      localStorage.removeItem('aos-widget-safe-positions');
      await new Promise((resolve) => requestAnimationFrame(resolve));
      api.resolveWidgets();
      await new Promise((resolve) => setTimeout(resolve, 260));
      const widgets = [...layer.querySelectorAll('.aos-taskbar-smoke-widget')].map((item) => item.getBoundingClientRect());
      const reservedElements = [...document.querySelectorAll('.desktop-files > button, .desk-shortcut, .wallmark img, .shelf')];
      const reserved = reservedElements.map((item) => item.getBoundingClientRect());
      const overlap = (a, b) => a.left < b.right + 1 && a.right + 1 > b.left && a.top < b.bottom + 1 && a.bottom + 1 > b.top;
      const widgetSafe = widgets.length === 2 && !overlap(widgets[0], widgets[1]) && widgets.every((widget) => reserved.every((item) => !overlap(widget, item)));
      const soundFiles = JSON.parse(localStorage.getItem('aos-files') || '[]');
      const soundResponses = await Promise.all(['/assets/sounds/aos-4-notification.wav', '/assets/sounds/aos-4-ringtone.wav'].map((url) => fetch(url)));
      const customPointerControl = document.querySelector('.aos-custom-pointer-setting');
      return {
        referenceHidden: !document.querySelector('.aos-taskbar-reference'),
        layout: document.querySelector('.desktop').classList.contains('aos-taskbar-layout-floating-segmented'),
        size: localStorage.getItem('aos-taskbar-size') === '76',
        reorder: before.join('|') !== after.join('|'),
        draggable: apps.every((button) => button.draggable),
        controlReorder: controlBefore !== controlAfter,
        controlsDraggable: [search, status, launcher].every((item) => item && item.draggable),
        pointerSort: search && search.dataset.aosPointerSort === 'ready',
        customPointer: Boolean(window.AOS_POINTERS && customPointerControl && customPointerControl.querySelector('input[type="file"][data-aos-allowed-picker="true"]:not(:disabled)')),
        shortcut: Boolean(document.querySelector('.aos-taskbar-desktop-shortcut')),
        file: JSON.parse(localStorage.getItem('aos-files') || '[]').some((file) => file.name === 'Settings.aoslink'),
        pins: JSON.parse(localStorage.getItem('aos-taskbar-browser-pins') || '[]').some((pin) => pin.label === 'Settings'),
        widgets: widgetSafe,
        status: Boolean(document.querySelector('.status.aos-status-modern .aos-status-date')),
        handle: Boolean(document.querySelector('.aos-taskbar-resize-handle')),
        sounds: localStorage.getItem('aos-notification-tone') === 'file:aos-4-default-notification' && localStorage.getItem('aos-ringtone-tone') === 'file:aos-4-default-ringtone' && soundFiles.some((file) => file.id === 'aos-4-default-notification' && file.parent === 'os-root' && file.mime === 'audio/wav' && /\.wav$/i.test(file.name)) && soundFiles.some((file) => file.id === 'aos-4-default-ringtone' && file.parent === 'os-root' && file.mime === 'audio/wav' && /\.wav$/i.test(file.name)) && soundResponses.every((response) => response.ok),
        widgetDetail: widgetSafe ? null : {
          widgets: widgets.map((rect) => ({left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom})),
          hits: reservedElements.filter((item, index) => widgets.some((widget) => overlap(widget, reserved[index]))).map((item) => {
            const rect = item.getBoundingClientRect();
            return {name:item.getAttribute('aria-label') || item.className,left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom};
          }),
          dragging: layer.dataset.aosWidgetDragging || '',
          reservedCount: reserved.length,
          saved: localStorage.getItem('aos-widget-safe-positions'),
          desktop: (() => { const rect = document.querySelector('.desktop').getBoundingClientRect(); return {left:rect.left,top:rect.top,width:rect.width,height:rect.height}; })()
        }
      };
    })()`);
    const taskbarChecks = ["referenceHidden", "layout", "size", "reorder", "draggable", "controlReorder", "controlsDraggable", "pointerSort", "customPointer", "shortcut", "file", "pins", "widgets", "status", "handle", "sounds"];
    if (taskbarChecks.some((key) => taskbarResult[key] !== true)) {
      throw new Error(`Taskbar studio regression: ${JSON.stringify(taskbarResult)}`);
    }
    await evaluate(`${appButton("OSInternet")}.click()`);
    await waitFor(`Boolean(document.querySelector('.browser-bookmarks .aos-app-browser-pin'))`, "the app pin inside OSInternet");
    console.log("PASS: A-OS 4.0 taskbar controls, sounds, resizing, desktop/Files/browser drops and widget collision avoidance");
    cdp.socket.close();
    return;
  }

  if (nativeIso) {
    await evaluate(`document.querySelector(".shelf button.status").click()`);
    await waitFor(`Boolean(document.querySelector(".quick"))`, "the ISO quick settings panel");
    await waitFor(
      `Boolean(document.querySelector('.quick label[data-aos-hardware-control="volume"] input[type="range"]'))`,
      "the native sound control"
    );
    await waitFor(
      `Boolean(document.querySelector('.quick label[data-aos-hardware-control="brightness"] input[type="range"]'))`,
      "the native brightness control"
    );
    await evaluate(`document.querySelector(".shelf button.status").click()`);
  }

  await waitFor(`${appButton("FileDrop")} != null`, "the FileDrop desktop app");
  await evaluate(`${appButton("FileDrop")}.click()`);
  await waitFor(
    `Boolean(document.querySelector('.aos-filedrop-window:not([hidden])') && document.querySelector('.aos-filedrop-taskbar'))`,
    "FileDrop to open in a window and appear on the taskbar"
  );
  await waitFor(
    `Boolean(document.querySelector('.aos-filedrop-offline'))`,
    "FileDrop's browser transfer guidance"
  );
  const fileDropBrowser = await evaluate(`(async () => {
    const upload = document.querySelector('.aos-filedrop-window [data-fd-upload]');
    const picker = document.querySelector('.aos-filedrop-window [data-fd-upload-input]');
    const windowRect = document.querySelector('.aos-filedrop-window').getBoundingClientRect();
    await window.AOS_FILEDROP.importFiles([new File(['FileDrop browser test'], 'browser-filedrop.txt', {type:'text/plain'})]);
    const files = JSON.parse(localStorage.getItem('aos-files') || '[]');
    return {
      noExe: document.querySelector('.aos-filedrop-window').textContent.includes('No app or EXE needed'),
      upload: Boolean(upload),
      picker: Boolean(picker && picker.dataset.aosAllowedPicker === 'true' && !picker.disabled),
      fits: windowRect.top >= 0 && windowRect.bottom <= innerHeight,
      bounds: {top: windowRect.top, bottom: windowRect.bottom, height: windowRect.height, viewport: innerHeight},
      imported: files.some((file) => file.name === 'browser-filedrop.txt' && file.parent === 'downloads')
    };
  })()`);
  if (!fileDropBrowser.noExe || !fileDropBrowser.upload || !fileDropBrowser.picker || !fileDropBrowser.fits || !fileDropBrowser.imported) {
    throw new Error(`FileDrop browser mode regression: ${JSON.stringify(fileDropBrowser)}`);
  }
  await evaluate(`(() => {
    const toggle = document.querySelector('.aos-filedrop-window [data-fd-enabled]');
    if (!toggle.checked) toggle.click();
  })()`);
  await waitFor(
    `document.querySelector('.aos-filedrop-window [data-fd-enabled]').checked && JSON.parse(localStorage.getItem('aos-filedrop-browser-state') || '{}').enabled === true`,
    "FileDrop to stay enabled in browser mode"
  );
  await evaluate(`document.querySelector('.aos-filedrop-window [data-fd-close]').click()`);
  await waitFor(
    `document.querySelector('.aos-filedrop-window').hidden && !document.querySelector('.aos-filedrop-taskbar')`,
    "FileDrop to close and leave the taskbar"
  );

  await evaluate(`document.dispatchEvent(new KeyboardEvent("keydown", {key:"s",code:"KeyS",ctrlKey:true,bubbles:true,cancelable:true}))`);
  await waitFor(`Boolean(document.querySelector('.aos-screenshot-selector'))`, "Ctrl+S screenshot selection");
  await evaluate(`(() => {
    const selector = document.querySelector('.aos-screenshot-selector');
    selector.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true,button:0,clientX:80,clientY:90,pointerId:31}));
    selector.dispatchEvent(new PointerEvent('pointermove', {bubbles:true,buttons:1,clientX:420,clientY:310,pointerId:31}));
    selector.dispatchEvent(new PointerEvent('pointerup', {bubbles:true,button:0,clientX:420,clientY:310,pointerId:31}));
  })()`);
  await waitFor(
    `Boolean(document.querySelector('.aos-screenshot-window:not([hidden]) canvas') && document.querySelector('.aos-screenshot-window canvas').width > 100)`,
    "the screenshot crop-and-paint window",
    30000
  );
  await evaluate(`document.querySelector('.aos-screenshot-window [data-screenshot-save]').click()`);
  await waitFor(
    `JSON.parse(localStorage.getItem('aos-files') || '[]').some(file => /^Screenshot .*\\.png$/.test(file.name) && file.source === 'A-OS Screenshot Studio')`,
    "the screenshot saved in A-OS Files"
  );
  await evaluate(`document.querySelector('.aos-screenshot-window [data-screenshot-close]').click()`);

  for (const label of requiredApps) {
    await waitFor(`${appButton(label)} != null`, `${label} on the taskbar`);
    await evaluate(`${appButton(label)}.click()`);
    await waitFor(`${appButton(label)}.classList.contains("state-open")`, `${label} to open`);
  }

  await waitFor(
    `JSON.parse(localStorage.getItem("aos-files") || "[]").some((file) => file.name === "A-OS Desktop.iso" && file.icon === "ISO.png")`,
    "the custom ISO extension mapping"
  );
  const isoIconResponse = await evaluate(`fetch("./assets/icons/ISO.png").then((response) => ({
    ok: response.ok,
    contentType: response.headers.get("content-type") || "",
    size: Number(response.headers.get("content-length") || 0)
  }))`);
  if (!isoIconResponse.ok || !isoIconResponse.contentType.includes("image/png") || isoIconResponse.size < 1000) {
    throw new Error(`The custom ISO icon did not load correctly: ${JSON.stringify(isoIconResponse)}`);
  }

  await evaluate(`${appButton("Settings")}.click()`);
  await waitFor(`[...document.querySelectorAll("button")].some((button) => button.textContent.trim() === "Appearance")`, "Appearance settings");
  await evaluate(`[...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Appearance").click()`);
  await waitFor(
    `["Porto", "Faro"].every((name) => [...document.querySelectorAll(".wall-grid button span")].some((item) => item.textContent.trim() === name))`,
    "the restored Porto and Faro wallpapers"
  );
  const wallpaperPaths = await evaluate(`[
    window.getSystemWallpaper("Porto.png"),
    window.getSystemWallpaper("Faro.jpg")
  ]`);
  if (!wallpaperPaths[0].endsWith("/assets/backgrounds/Porto.png") || !wallpaperPaths[1].endsWith("/assets/backgrounds/Faro.jpg")) {
    throw new Error(`Restored wallpaper resolver returned unexpected paths: ${wallpaperPaths.join(", ")}`);
  }

  await waitFor(
    `Boolean(window.AOS_FAMILY_DEVICE && typeof window.AOS_FAMILY_DEVICE.open === "function")`,
    "the A-OS 3.5 Family Device runtime"
  );
  await evaluate("window.AOS_FAMILY_DEVICE.open()");
  await waitFor(
    `Boolean(document.querySelector("#aos-family-app") && document.querySelector("#aos-family-app").textContent.includes("Family Device"))`,
    "the Family Device app"
  );
  await evaluate(`document.querySelector("#aos-family-app [data-family-close]").click()`);
  await waitFor(`!document.querySelector("#aos-family-app")`, "the Family Device app to close");

  const syncResponse = await evaluate(`fetch("/api/a-applications-sync").then(async (response) => ({
    status: response.status,
    contentType: response.headers.get("content-type") || "",
    body: await response.text()
  }))`);
  if (syncResponse.status !== 401 || !syncResponse.contentType.includes("application/json") || !syncResponse.body.trim().startsWith("{")) {
    throw new Error(`Account restore did not return a JSON response: ${JSON.stringify(syncResponse)}`);
  }

  const storeWindowResult = await evaluate(`(() => {
    const app = {
      slug: "smoke-window-app",
      name: "Smoke Window App",
      description: "A window lifecycle check",
      category: "Tools",
      version: "1.0.0",
      logo: "/assets/icons/Code.png",
      files: {"index.html": "<!doctype html><title>Smoke</title><main>Store app is running</main>"}
    };
    window.AOS_STORE_PLATFORM.installApp(app);
    window.AOS_STORE_PLATFORM.openApp(app);
    const layer = document.querySelector('[data-a-store-slug="smoke-window-app"]');
    const header = layer && layer.querySelector(".astore-window-head");
    if (!layer || !header) throw Error("A-Store app did not create its own window");
    const start = layer.getBoundingClientRect();
    header.dispatchEvent(new PointerEvent("pointerdown", {bubbles:true,button:0,clientX:start.left+40,clientY:start.top+20,pointerId:4}));
    window.dispatchEvent(new PointerEvent("pointermove", {bubbles:true,clientX:start.left+120,clientY:start.top+65,pointerId:4}));
    window.dispatchEvent(new PointerEvent("pointerup", {bubbles:true,clientX:start.left+120,clientY:start.top+65,pointerId:4}));
    const end = layer.getBoundingClientRect();
    const registered = JSON.parse(localStorage.getItem("aos-dev-apps") || "[]").some((item) => item.storeSlug === app.slug);
    const taskbar = Boolean(document.querySelector('[data-astore-shelf="smoke-window-app"]'));
    return window.AOS_SESSION_PERSISTENCE.save("hibernate").then((snapshot) => ({
      registered,
      taskbar,
      moved: Math.abs(end.left - start.left) > 20 || Math.abs(end.top - start.top) > 20,
      saved: snapshot.apps.some((item) => item.slug === app.slug && item.geometry && item.geometry.width > 300)
    }));
  })()`);
  if (!storeWindowResult.registered || !storeWindowResult.taskbar || !storeWindowResult.moved || !storeWindowResult.saved) {
    throw new Error(`A-Store window or hibernate persistence regression: ${JSON.stringify(storeWindowResult)}`);
  }
  await evaluate(`document.querySelector('[data-a-store-slug="smoke-window-app"] .astore-close').click(); localStorage.removeItem("aos-hibernate-restore-pending")`);
  await waitFor(`!document.querySelector('[data-a-store-slug="smoke-window-app"]') && !document.querySelector('[data-astore-shelf="smoke-window-app"]')`, "the A-Store app window and taskbar entry to close");

  const touchPointerResult = await evaluate(`(() => {
    const pointer = document.querySelector("#aos-custom-pointer");
    window.dispatchEvent(new PointerEvent("pointermove", {bubbles:true,pointerType:"touch",clientX:73,clientY:91,pointerId:8}));
    return {exists:Boolean(pointer), transform:pointer ? pointer.style.transform : "", ready:pointer ? pointer.classList.contains("pointer-ready") : false};
  })()`);
  if (!touchPointerResult.exists || !touchPointerResult.ready || !touchPointerResult.transform.includes("73px") || !touchPointerResult.transform.includes("91px")) {
    throw new Error(`Touch pointer did not follow the contact point: ${JSON.stringify(touchPointerResult)}`);
  }

  await evaluate(`
    localStorage.setItem("aos-family-active-member", JSON.stringify({id:"smoke-child",name:"Alex",ageGroup:"7-",signedInAt:Date.now()}));
    location.reload();
  `);
  const childDesktopDeadline = Date.now() + 30000;
  while (Date.now() < childDesktopDeadline && !(await evaluate(`Boolean(document.querySelector(".aos-child-launcher"))`))) {
    await evaluate(`(() => {
      const input = document.querySelector('input[type="password"]');
      if (input) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        setter.call(input, "AosTest123!");
        input.dispatchEvent(new Event("input", {bubbles:true}));
        input.dispatchEvent(new Event("change", {bubbles:true}));
      }
      const button = [...document.querySelectorAll("button")].find((item) => ["Continue", "Unlock", "Sign in"].includes(item.textContent.trim()));
      if (button) button.click();
    })()`);
    await sleep(250);
  }
  await waitFor(`Boolean(document.querySelector(".aos-child-launcher .aos-child-app-grid"))`, "the simplified child launcher", 30000);
  await evaluate(`[...document.querySelectorAll(".aos-child-app-grid button")].find((button) => button.textContent.includes("Paint")).click()`);
  await waitFor(`Boolean(document.querySelector(".paint-app canvas"))`, "Paint to open from the child launcher");
  await evaluate(`[...document.querySelectorAll(".aos-child-app-grid button")].find((button) => button.textContent.includes("Games")).click()`);
  await waitFor(`Boolean(document.querySelector("#aos-child-games"))`, "the child Games screen");
  await evaluate(`document.querySelector('#aos-child-games [data-game="tic"]').click()`);
  await waitFor(`document.querySelectorAll(".aos-child-tic-grid button").length === 9`, "the tic-tac-toe game board");

  const visibleArea = await evaluate("document.body.getBoundingClientRect().width > 900 && document.body.getBoundingClientRect().height > 500");
  if (!visibleArea) throw new Error("A-OS rendered an empty or undersized page");
  console.log(`A-OS app smoke test passed: ${requiredApps.join(", ")}`);
  cdp.socket.close();
}

try {
  await main();
} finally {
  browser.kill("SIGKILL");
  await Promise.race([
    new Promise((resolve) => browser.once("exit", resolve)),
    sleep(3000)
  ]);
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (error) {
    console.warn(`Could not remove temporary Chrome profile ${profile}: ${error.message}`);
  }
}
