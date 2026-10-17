import {cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync} from "node:fs";
import {extname, join} from "node:path";
import {fileURLToPath} from "node:url";

const source = new URL("../public/", import.meta.url);
const output = new URL("../_site/", import.meta.url);

rmSync(output, {recursive: true, force: true});
mkdirSync(output, {recursive: true});
cpSync(source, output, {recursive: true});

function walk(folder) {
  for (const entry of readdirSync(folder, {withFileTypes: true})) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) {
      walk(path);
      continue;
    }
    if (![".html", ".js", ".css", ".json"].includes(extname(entry.name))) continue;
    const original = readFileSync(path, "utf8");
    const relativeAssets = original
      .replaceAll('"/assets/', '"./assets/')
      .replaceAll("'/assets/", "'./assets/")
      .replaceAll("`/assets/", "`./assets/")
      .replaceAll("url(/assets/", "url(./assets/");
    if (relativeAssets !== original) writeFileSync(path, relativeAssets);
  }
}

walk(fileURLToPath(output));
writeFileSync(
  new URL("version.json", output),
  JSON.stringify({
    version: "1.2.1",
    build: new Date().toISOString(),
    revision: process.env.GITHUB_SHA || "github-pages"
  }, null, 2) + "\n"
);
cpSync(new URL("index.html", output), new URL("404.html", output));

