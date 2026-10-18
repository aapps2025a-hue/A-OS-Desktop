import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const firestoreUrl = "https://firestore.googleapis.com/v1/projects/emojis-symbols-online/databases/(default)/documents/aosStoreApps?pageSize=1000";
const genericIcon = join(repoRoot, "android", "astore", "app", "src", "main", "res", "drawable", "astore_icon.png");
const moduleRoot = join(repoRoot, "android", "astore", "storeapp");
const generatedRoot = join(moduleRoot, "build", "generated", "astore");
const defaultGradle = join(repoRoot, "android", "astore", process.platform === "win32" ? "gradlew.bat" : "gradlew");

const builtIns = [
  app("a-store-dev", "A-Store Dev", "1.0.0", "https://a-os-desktop.web.app/store-dev.html", "Code.png"),
  app("a-ai", "A-AI", "1.0.0", "https://a-ai.web.app/", "AI Services (Hidden App).png"),
  app("youtube", "YouTube", "1.0.0", "https://www.youtube.com/", "Video.png"),
  app("wikipedia", "Wikipedia", "1.0.0", "https://www.wikipedia.org/", "Internet.png"),
  app("weba", "WebA", "1.0.0", "https://weba-online.web.app/", "Internet.png")
];

function app(slug, name, version, url, iconName) {
  return { slug, name, version, url, iconName, updatedAt: 1760745600000, builtin: true, files: {} };
}

function argument(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function fieldValue(field) {
  if (!field) return undefined;
  if (Object.hasOwn(field, "stringValue")) return field.stringValue;
  if (Object.hasOwn(field, "integerValue")) return Number(field.integerValue);
  if (Object.hasOwn(field, "doubleValue")) return Number(field.doubleValue);
  if (Object.hasOwn(field, "booleanValue")) return Boolean(field.booleanValue);
  return undefined;
}

function decodeDocument(document) {
  const fields = document.fields || {};
  const value = JSON.parse(fieldValue(fields.payload) || "{}");
  value.slug ||= document.name.split("/").pop();
  value.updatedAt = Number(fieldValue(fields.updatedAt) || value.updatedAt || Date.now());
  value.files = value.files && typeof value.files === "object" ? value.files : {};
  return value;
}

function safeSlug(value) {
  return String(value || "a-store-app").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "a-store-app";
}

function safeVersion(value) {
  return String(value || "1.0.0").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 40) || "1.0.0";
}

function applicationId(slug) {
  return "com.aapps.storeapp.a" + createHash("sha256").update(slug).digest("hex").slice(0, 20);
}

function versionCode(appValue) {
  const seconds = Math.floor(Number(appValue.updatedAt || Date.now()) / 1000);
  return Math.max(1, Math.min(2147483647, seconds));
}

function assetName(appValue) {
  return `app-${safeSlug(appValue.slug)}-${safeVersion(appValue.version)}.apk`;
}

function runGradle(gradle, argumentsList) {
  if (process.platform !== "win32") return spawnSync(gradle, argumentsList, { cwd: repoRoot, stdio: "inherit" });
  const quote = value => `'${String(value).replace(/'/g, "''")}'`;
  const command = `& ${[gradle, ...argumentsList].map(quote).join(" ")}`;
  return spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { cwd: repoRoot, stdio: "inherit" });
}

function dangerousReason(appValue) {
  if (appValue.scan?.blocked) return appValue.scan.reason || "The catalog security scan blocked this app.";
  const files = appValue.files || {};
  const source = [appValue.name, appValue.description, ...Object.entries(files).map(([path, content]) => `${path}\n${typeof content === "string" && !content.startsWith("data:") ? content : ""}`)].join("\n").slice(0, 1_200_000);
  if (!appValue.url && !files["index.html"]) return "The app does not contain index.html.";
  if (/\b(?:mirai|xorddos|wanna?cry|tsunami|pnscan|ddos[._:-]?kaiten|jupyter[._:-]?infostealer|magecart|fword|mydoom|lockbit|cryptolocker)\b/i.test(source)) return "Known malware name or signature.";
  if (/(?:localStorage|sessionStorage)\.clear\s*\(|indexedDB\.deleteDatabase\s*\(|caches\.keys\s*\(\)[\s\S]{0,200}caches\.delete/i.test(source)) return "Code attempts to erase application data.";
  return "";
}

function safeRelativePath(value) {
  const normalized = String(value || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.split("/").some(part => !part || part === "." || part === "..")) return "";
  return normalized;
}

function decodeFile(content) {
  if (typeof content !== "string") return Buffer.from("");
  const match = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(content);
  if (!match) return Buffer.from(content, "utf8");
  return match[2] ? Buffer.from(match[3], "base64") : Buffer.from(decodeURIComponent(match[3]), "utf8");
}

function nativeBridge(appValue) {
  let routes = {};
  try {
    routes = JSON.parse(appValue.files?.["backend/routes.json"] || appValue.files?.["backend.json"] || "{}");
  } catch {}
  return `(function(){\n` +
    `const routes=${JSON.stringify(routes)};\n` +
    `window.AStoreBackend={request(path,options){const method=((options&&options.method)||"GET").toUpperCase();const route=routes[method+" "+path]??routes[path];return Promise.resolve({ok:route!==undefined,status:route!==undefined?200:404,json:()=>Promise.resolve(route===undefined?{error:"Route not found"}:route),text:()=>Promise.resolve(typeof route==="string"?route:JSON.stringify(route===undefined?{error:"Route not found"}:route))})},get(path){return this.request(path)},post(path,body){return this.request(path,{method:"POST",body})}};\n` +
    `})();\n`;
}

async function prepareApp(appValue) {
  await rm(generatedRoot, { recursive: true, force: true });
  const assetsRoot = join(generatedRoot, "assets");
  const webRoot = join(assetsRoot, "www");
  const drawableRoot = join(generatedRoot, "res", "drawable");
  await mkdir(webRoot, { recursive: true });
  await mkdir(drawableRoot, { recursive: true });

  if (appValue.files?.["index.html"]) {
    for (const [pathValue, content] of Object.entries(appValue.files)) {
      const relative = safeRelativePath(pathValue);
      if (!relative) continue;
      const destination = join(webRoot, ...relative.split("/"));
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, decodeFile(content));
    }
    await writeFile(join(webRoot, "aos-native-bridge.js"), nativeBridge(appValue), "utf8");
    const indexPath = join(webRoot, "index.html");
    let html = await readFile(indexPath, "utf8");
    const bridgeTag = '<script src="aos-native-bridge.js"></script>';
    html = /<head(?:\s[^>]*)?>/i.test(html) ? html.replace(/<head(\s[^>]*)?>/i, match => match + bridgeTag) : bridgeTag + html;
    await writeFile(indexPath, html, "utf8");
  } else {
    await writeFile(join(webRoot, "index.html"), "<!doctype html><meta charset=\"utf-8\"><title>A-Store App</title>", "utf8");
  }

  let iconSource = genericIcon;
  if (appValue.iconName) {
    const candidate = join(repoRoot, "public", "assets", "icons", appValue.iconName);
    if (existsSync(candidate)) iconSource = candidate;
  }
  if (typeof appValue.logo === "string" && /^data:image\/png;base64,/i.test(appValue.logo)) {
    await writeFile(join(drawableRoot, "app_icon.png"), decodeFile(appValue.logo));
  } else {
    await cp(iconSource, join(drawableRoot, "app_icon.png"));
  }
}

async function catalog() {
  const response = await fetch(argument("--catalog-url", firestoreUrl), { headers: { "user-agent": "A-Store-APK-Builder/1.0" } });
  if (!response.ok) throw new Error(`A-Store catalog returned HTTP ${response.status}`);
  const body = await response.json();
  const bySlug = new Map();
  for (const appValue of [...builtIns, ...(body.documents || []).map(decodeDocument)]) {
    const slug = safeSlug(appValue.slug || appValue.name);
    const normalized = { ...appValue, slug, name: String(appValue.name || "A-Store App").slice(0, 64), version: String(appValue.version || "1.0.0").slice(0, 20) };
    bySlug.set(slug, normalized);
  }
  return [...bySlug.values()];
}

async function main() {
  const output = resolve(argument("--output", join(repoRoot, "dist", "astore-apks")));
  const gradle = resolve(argument("--gradle", defaultGradle));
  const debug = process.argv.includes("--debug");
  const only = argument("--only", "");
  const signingVariables = ["ASTORE_KEYSTORE_PATH", "ASTORE_KEYSTORE_PASSWORD", "ASTORE_KEY_ALIAS", "ASTORE_KEY_PASSWORD"];
  if (!debug && signingVariables.some(name => !process.env[name])) throw new Error("Release APK signing variables are required.");
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  const apps = (await catalog()).filter(appValue => !only || appValue.slug === only);
  const index = { generatedAt: new Date().toISOString(), apps: {} };

  for (const appValue of apps) {
    const blocked = dangerousReason(appValue);
    if (blocked) {
      console.warn(`Skipping ${appValue.slug}: ${blocked}`);
      continue;
    }
    console.log(`Building ${appValue.name} ${appValue.version}`);
    const cleanResult = runGradle(gradle, ["-p", join(repoRoot, "android", "astore"), ":storeapp:clean"]);
    if (cleanResult.status !== 0) throw new Error(`Gradle could not clean ${appValue.slug}.`);
    await prepareApp(appValue);
    const task = debug ? ":storeapp:assembleDebug" : ":storeapp:assembleRelease";
    const result = runGradle(gradle, ["-p", join(repoRoot, "android", "astore"), task,
      `-PastoreApplicationId=${applicationId(appValue.slug)}`,
      `-PastoreAppName=${appValue.name}`,
      `-PastoreVersionCode=${versionCode(appValue)}`,
      `-PastoreVersionName=${appValue.version}`,
      `-PastoreStartUrl=${appValue.files?.["index.html"] ? "" : String(appValue.url || "")}`
    ]);
    if (result.status !== 0) throw new Error(`Gradle failed while building ${appValue.slug}.`);
    const variant = debug ? "debug" : "release";
    const apkPath = join(moduleRoot, "build", "outputs", "apk", variant, `storeapp-${variant}.apk`);
    const filename = assetName(appValue);
    await cp(apkPath, join(output, filename));
    index.apps[appValue.slug] = {
      name: appValue.name,
      version: appValue.version,
      versionCode: versionCode(appValue),
      applicationId: applicationId(appValue.slug),
      asset: filename
    };
  }

  await writeFile(join(output, "apk-index.json"), JSON.stringify(index, null, 2) + "\n", "utf8");
  console.log(`Built ${Object.keys(index.apps).length} installable A-Store APKs in ${output}`);
}

main().catch(error => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
