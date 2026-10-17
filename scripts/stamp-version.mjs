import {readFileSync, writeFileSync} from "node:fs";

const path = new URL("../public/version.json", import.meta.url);
let current = {version: "1.2.1"};

try {
  current = {...current, ...JSON.parse(readFileSync(path, "utf8"))};
} catch {
  // A missing stamp is repaired before deployment.
}

const stamp = {
  version: String(current.version || "1.2.1"),
  build: new Date().toISOString(),
  revision: process.env.GITHUB_SHA || process.env.AOS_BUILD_REVISION || "local-deploy"
};

writeFileSync(path, JSON.stringify(stamp, null, 2) + "\n");
console.log("Stamped A-OS build", stamp.build);
