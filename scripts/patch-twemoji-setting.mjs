import {readFileSync, writeFileSync} from "node:fs";

const path = new URL("../public/assets/index-D5wdOlTt-managed9.js", import.meta.url);
let code = readFileSync(path, "utf8");

function replaceOnce(before, after) {
  if (code.split(before).length !== 2) throw new Error("Expected one match: " + before.slice(0, 80));
  code = code.replace(before, after);
}

replaceOnce(
  "Choose between iOS, Meta WhatsApp, Telegram, Google, and 3D Cyber emoji packs",
  "Choose between Twitter Twemoji, iOS, Meta WhatsApp, Telegram, Google, and 3D Cyber emoji packs"
);
replaceOnce(
  '[{id:"iOS / Apple",label:"iOS / Apple",icon:hx},{id:"Meta / WhatsApp",label:"Meta / WhatsApp",icon:C1},{id:"Telegram",label:"Telegram",icon:ew},{id:"Google Noto",label:"Google Noto",icon:Fc},{id:"3D Cyber",label:"3D Cyber",icon:dl}]',
  '[{id:"Twitter / Twemoji",label:"Twitter / Twemoji",icon:hx},{id:"iOS / Apple",label:"iOS / Apple",icon:hx},{id:"Meta / WhatsApp",label:"Meta / WhatsApp",icon:C1},{id:"Telegram",label:"Telegram",icon:ew},{id:"Google Noto",label:"Google Noto",icon:Fc},{id:"3D Cyber",label:"3D Cyber",icon:dl}]'
);
replaceOnce("grid grid-cols-2 sm:grid-cols-5 gap-2.5", "grid grid-cols-2 sm:grid-cols-3 gap-2.5");

writeFileSync(path, code);
