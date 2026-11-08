import {readFileSync, writeFileSync} from "node:fs";

const path = new URL("../public/assets/index-D5wdOlTt-managed9.js", import.meta.url);
let code = readFileSync(path, "utf8");

const installBefore = 'localStorage.setItem("aos-custom-html",X),localStorage.setItem("aos-custom-name",ka)';
const installAfter = 'localStorage.setItem("aos-custom-html",X),He.get("splash.gif")&&localStorage.setItem("aos-custom-splash-gif",He.get("splash.gif")),localStorage.setItem("aos-custom-name",ka)';
if (code.split(installBefore).length !== 2) throw new Error("Expected one A-OS package install handler");
code = code.replace(installBefore, installAfter);

const removeBefore = 'localStorage.removeItem("aos-custom-html"),localStorage.removeItem("aos-custom-name")';
const removeAfter = 'localStorage.removeItem("aos-custom-html"),localStorage.removeItem("aos-custom-name"),localStorage.removeItem("aos-custom-splash-gif")';
if (!code.includes(removeBefore)) throw new Error("Expected an A-OS package recovery handler");
code = code.replaceAll(removeBefore, removeAfter);

writeFileSync(path, code);
