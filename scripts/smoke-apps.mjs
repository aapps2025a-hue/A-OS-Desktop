import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const chrome = process.env.AOS_CHROME_BIN;
const url = process.env.AOS_SMOKE_URL || "http://127.0.0.1:8765/";
const port = Number(process.env.AOS_CDP_PORT || 9339);
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
  await waitFor(
    `(() => { try { localStorage.getItem("aos-configured"); return location.origin === ${JSON.stringify(new URL(url).origin)}; } catch (_) { return false; } })()`,
    "A-OS origin storage"
  );
  await evaluate(`
    localStorage.setItem("aos-configured", "true");
    localStorage.setItem("aos-no-locking", "true");
    localStorage.setItem("aos-profile", "Person");
    localStorage.setItem("aos-username", "ISO App Test");
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

  for (const label of requiredApps) {
    await waitFor(`${appButton(label)} != null`, `${label} on the taskbar`);
    await evaluate(`${appButton(label)}.click()`);
    await waitFor(`${appButton(label)}.classList.contains("state-open")`, `${label} to open`);
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
