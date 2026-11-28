#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = join(ROOT, "build", "showcase-captures");
const TARGET_URL = process.env.AOS_SHOWCASE_URL || "http://127.0.0.1:5013/a-os.html";
const CDP_PORT = Number(process.env.AOS_SHOWCASE_CDP_PORT || 9348);
const PROFILE = join(ROOT, "build", "showcase-chrome-profile");
const CHROME_CANDIDATES = [
  process.env.AOS_CHROME_BIN,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"
].filter(Boolean);
const CHROME = CHROME_CANDIDATES.find(existsSync);

if (!CHROME) throw new Error("Set AOS_CHROME_BIN to Chrome or Edge.");
if (typeof WebSocket !== "function") throw new Error("Node.js with WebSocket support is required.");

rmSync(OUTPUT, { recursive: true, force: true });
rmSync(PROFILE, { recursive: true, force: true });
mkdirSync(OUTPUT, { recursive: true });

const browser = spawn(CHROME, [
  "--headless=new",
  "--no-sandbox",
  "--disable-gpu",
  "--disable-dev-shm-usage",
  "--hide-scrollbars",
  "--window-size=1920,1080",
  "--force-device-scale-factor=1",
  "--no-first-run",
  "--no-default-browser-check",
  `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${PROFILE}`,
  TARGET_URL
], { stdio: "ignore" });

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function target() {
  const deadline = Date.now() + 20000;
  const origin = new URL(TARGET_URL).origin;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
      const targets = await response.json();
      const page = targets.find((item) => item.type === "page" && item.url.startsWith(origin));
      if (page) return page;
    } catch (_) {}
    await sleep(150);
  }
  throw new Error("Chrome DevTools did not become ready.");
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
    socket.addEventListener("error", () => reject(new Error("Chrome DevTools WebSocket failed.")));
  });
}

async function main() {
  const page = await target();
  const cdp = await connect(page.webSocketDebuggerUrl);
  const evaluate = async (expression) => {
    const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) {
      const description = result.exceptionDetails.exception && result.exceptionDetails.exception.description;
      throw new Error(description || result.exceptionDetails.text || "Browser evaluation failed.");
    }
    return result.result.value;
  };
  const waitFor = async (expression, label, timeout = 30000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return;
      await sleep(180);
    }
    throw new Error(`Timed out waiting for ${label}.`);
  };
  const capture = async (name) => {
    await sleep(260);
    const result = await cdp.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false
    });
    writeFileSync(join(OUTPUT, `${name}.png`), Buffer.from(result.data, "base64"));
    process.stdout.write(`Captured ${name}\n`);
  };
  const clickApp = async (name) => {
    const clicked = await evaluate(`(() => {
      const normalize = (value) => String(value || '').trim().toLowerCase();
      const wanted = normalize(${JSON.stringify(name)});
      const button = [...document.querySelectorAll('button')].find((item) => normalize(item.getAttribute('aria-label')) === wanted || normalize(item.title) === wanted);
      if (!button) return false;
      button.click();
      return true;
    })()`);
    if (!clicked) throw new Error(`Could not find the ${name} app button.`);
    await sleep(900);
  };
  const dismissPanels = async () => {
    await evaluate(`(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',bubbles:true}));
      const searchClose = document.querySelector('[data-sys-search-close]');
      if (searchClose) searchClose.click();
      const aiClose = document.querySelector('.sparkle-embed > button');
      if (aiClose) aiClose.click();
      document.body.click();
    })()`);
    await sleep(220);
  };

  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false,
    screenWidth: 1920,
    screenHeight: 1080
  });
  await cdp.send("Page.navigate", { url: TARGET_URL });
  await waitFor("document.readyState === 'complete'", "the initial page");
  await evaluate(`(() => {
    localStorage.setItem('aos-configured', 'true');
    localStorage.setItem('aos-no-locking', 'true');
    localStorage.setItem('aos-profile', 'Showcase');
    localStorage.setItem('aos-profile-password-Showcase', 'AosShowcase!');
    localStorage.setItem('aos-password', 'AosShowcase!');
    localStorage.setItem('aos-username', 'A-OS');
    localStorage.setItem('aos-wallpaper', 'Aqua A (Default).png');
    localStorage.setItem('aos-show-system-status-bar', 'true');
    localStorage.setItem('aos-taskbar-layout', 'floating-unified');
    localStorage.setItem('aos-taskbar-size', '72');
    localStorage.setItem('aos-pointer-text-enabled', 'false');
    localStorage.setItem('aos-shelf-position', 'bottom');
    sessionStorage.setItem('aos-skip-login', 'true');
    location.reload();
  })()`);

  const desktopDeadline = Date.now() + 50000;
  while (Date.now() < desktopDeadline && !(await evaluate("Boolean(document.querySelector('.desktop .shelf'))"))) {
    await evaluate(`(() => {
      const input = document.querySelector('input[placeholder="Enter password"]');
      if (input) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(input, 'AosShowcase!');
        input.dispatchEvent(new Event('input', {bubbles:true}));
      }
      const button = [...document.querySelectorAll('button')].find((item) => ['Unlock','Continue','Start A-OS'].includes(item.textContent.trim()));
      if (button) button.click();
    })()`);
    await sleep(250);
  }
  await waitFor("Boolean(document.querySelector('.desktop .shelf'))", "the A-OS desktop", 2000);
  await sleep(1800);
  await evaluate(`(() => {
    const desktop = document.querySelector('.desktop');
    desktop.classList.add('aos-status-bar-visible');
    document.documentElement.style.setProperty('--window-blur', '0px');
    document.body.classList.remove('glassmorphism-mode');
    document.documentElement.classList.remove('glassmorphism-mode');
    document.querySelectorAll('.system-window').forEach((item) => item.style.backdropFilter = 'none');
  })()`);

  await capture("01-desktop");

  await evaluate("document.querySelector('.search-pill').click()");
  await waitFor("Boolean(document.querySelector('.aos-sys-search:not([hidden])'))", "SYS Search");
  await capture("02-search");
  await dismissPanels();

  await evaluate("document.querySelector('.shelf > .status').click()");
  await waitFor("Boolean(document.querySelector('.quick')) && getComputedStyle(document.querySelector('.quick')).display !== 'none'", "Quick Settings");
  const quickSettingsReady = await evaluate(`(() => ({
    movableTiles: document.querySelectorAll('.quick-tiles > [data-aos-quick-drag="ready"]').length,
    filePins: Boolean(document.querySelector('.quick .aos-quick-file-pins'))
  }))()`);
  if (quickSettingsReady.movableTiles < 3 || !quickSettingsReady.filePins) throw new Error("Quick Settings customisation did not initialise.");
  await capture("03-quick-settings");
  await evaluate("document.querySelector('.shelf > .status').click()");
  await dismissPanels();

  await evaluate("document.querySelector('.shelf > [aria-label=\"AI shortcut\"]').click()");
  await waitFor("Boolean(document.querySelector('.sparkle-embed'))", "A-AI");
  await capture("04-a-ai");
  await dismissPanels();

  await evaluate("document.querySelector('[data-status-action=\"openbox\"]').click()");
  await waitFor("!document.querySelector('[data-status-menu=\"openbox\"]').hidden", "the OpenBox menu");
  await capture("05-openbox");
  await dismissPanels();

  await evaluate(`(() => {
    const desktop = document.querySelector('.desktop');
    [...desktop.classList].filter((name) => name.startsWith('aos-taskbar-layout-')).forEach((name) => desktop.classList.remove(name));
    desktop.classList.add('aos-taskbar-layout-wide-centered');
  })()`);
  await capture("06-taskbar-wide");
  await evaluate(`(() => {
    const desktop = document.querySelector('.desktop');
    desktop.classList.remove('aos-taskbar-layout-wide-centered');
    desktop.classList.add('aos-taskbar-layout-floating-unified');
  })()`);

  await clickApp("Files");
  await waitFor("Boolean(document.querySelector('.system-window .aos-files-location-input'))", "the editable Files location bar");
  await evaluate(`(() => {
    const input = document.querySelector('.system-window .aos-files-location-input');
    input.value = 'C://Users/Showcase/Downloads';
    input.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', code:'Enter', bubbles:true}));
  })()`);
  await waitFor("/\\/Downloads$/i.test(document.querySelector('.system-window .aos-files-location-input').value)", "typed Files navigation");
  const searchFileLocation = await evaluate(`(() => {
    const files = JSON.parse(localStorage.getItem('aos-files') || '[]');
    const file = files.find((item) => item && item.type === 'file' && item.parent === 'documents');
    if (!file) return false;
    window.dispatchEvent(new CustomEvent('aos-files-open-location', {detail:{folder:file.parent,fileId:file.id}}));
    return true;
  })()`);
  if (searchFileLocation) await waitFor("/\\/Documents$/i.test(document.querySelector('.system-window .aos-files-location-input').value)", "a file's real Files location");
  await clickApp("Settings");
  await capture("07-windows");

  await clickApp("A-Store");
  await capture("08-store");

  await clickApp("FileDrop");
  const obsoleteFileDropBanner = await evaluate("document.body.textContent.includes('No app or EXE needed')");
  if (obsoleteFileDropBanner) throw new Error("The obsolete FileDrop install banner is still visible.");
  await capture("09-filedrop");

  cdp.socket.close();
}

try {
  await main();
} finally {
  browser.kill();
  await sleep(250);
  rmSync(PROFILE, { recursive: true, force: true });
}

