import { readFileSync, writeFileSync } from 'node:fs';
const path = new URL('../public/assets/index-D5wdOlTt-managed9.js', import.meta.url);
let code = readFileSync(path, 'utf8');
const before = 'Xs=w=>w===(localStorage.getItem(ma(Ue))??E)';
if (!code.includes(before)) throw new Error('Password checker not found');
code = code.replace(before, 'Xs=w=>{let U=localStorage.getItem(ma(Ue));return U!==null?w===U:!!w&&w===E}');
code = code.replace('wn!==null&&localStorage.setItem(ma(ii),wn)', 'wn&&localStorage.setItem(ma(ii),wn)');
writeFileSync(path, code);
