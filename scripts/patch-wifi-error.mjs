import {readFileSync, writeFileSync} from 'node:fs';
const path = new URL('../public/assets/index-D5wdOlTt-managed9.js', import.meta.url);
let code = readFileSync(path, 'utf8');
const before = 'h.secure&&!b||(await Promise.resolve(g.connect(h.ssid,b))?n.setNetwork(h.ssid):window.alert("Incorrect Wi-Fi password or the network could not be joined."))';
const after = 'if(h.secure&&!b)return;try{await Promise.resolve(g.connect(h.ssid,b))?n.setNetwork(h.ssid):window.alert("The Wi-Fi network could not be joined. Check the adapter and network availability.")}catch(error){window.alert(error.message||"The Wi-Fi connection failed.")}';
if (code.split(before).length !== 2) throw Error('Expected one Wi-Fi setup handler');
writeFileSync(path, code.replace(before, after));
