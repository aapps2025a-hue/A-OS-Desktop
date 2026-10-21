import { readFileSync, writeFileSync } from 'node:fs';
const file = new URL('../public/assets/index-D5wdOlTt-managed9.js', import.meta.url);
let code = readFileSync(file, 'utf8');
function replace(before, after) {
  if (code.split(before).length !== 2) throw new Error('Expected one match: ' + before.slice(0, 80));
  code = code.replace(before, after);
}
replace('$0=Ag.filter(n=>!["aos-profile","aos-email","aos-profiles"].includes(n))', '$0=window.AOS_USER_PROFILES.configure(Ag.filter(n=>!["aos-profile","aos-email","aos-profiles"].includes(n)))');
replace('localStorage.removeItem(Ms(ii));let wn=localStorage.getItem("aos-password");wn&&!localStorage.getItem(ma(ii))&&localStorage.setItem(ma(ii),wn)', 'let wn=localStorage.getItem(ma(ii));wn===null?(wn=localStorage.getItem("aos-password"),wn!==null&&localStorage.setItem(ma(ii),wn)):localStorage.setItem("aos-password",wn);C(wn||"")');
replace('Xs=w=>!!w&&w===E,co=w=>{}', 'Xs=w=>w===(localStorage.getItem(ma(Ue))??E),co=w=>{try{window.AOS_USER_PROFILES.save(w)}catch{}}');
const start = code.indexOf('gs=(w,U=!1)=>{var Y;');
const end = code.indexOf(',Sl=(w="A-OS contact"', start);
if (start < 0 || end < 0) throw new Error('Profile switch function not found');
code = code.slice(0, start) + 'gs=(w,U=!1)=>{try{window.AOS_USER_PROFILES.activate(w,U)}catch(F){Ie(F.message||"Unable to save user settings");return}I("");ye(null);location.reload()}' + code.slice(end);
replace('!Xs(R)&&(xt==null?void 0:xt.aApplicationsEmail)', '!Xs(R)&&localStorage.getItem(ma(Ue))===null&&(xt==null?void 0:xt.aApplicationsEmail)');
writeFileSync(file, code);
