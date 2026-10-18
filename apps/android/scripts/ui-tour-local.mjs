// Windows/local companion to ui-tour-android.sh. No build-host SSH, uploads or embedded credentials.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const arg = name => { const i = process.argv.indexOf('--'+name); return i < 0 ? undefined : process.argv[i+1]; };
const serial = arg('serial');
const out = path.resolve(arg('out') || path.join(root, '../nexus-shots'));
const origin = process.env.NEXUS_DEV_ORIGIN;
if (!serial || !origin || !arg('session')) throw new Error('Use --serial SERIAL --session PRIVATE_LOGIN_JSON [--out DIR] and NEXUS_DEV_ORIGIN.');
const base = new URL(origin);
if (base.protocol !== 'https:' || base.hostname === 'nexus.znetworks.id' || base.port !== '8443') throw new Error('A DEV HTTPS origin on port 8443 is required.');
const session = JSON.parse(fs.readFileSync(arg('session'), 'utf8'));
const pkg = 'id.znetworks.nexus';
const adb = (...args) => execFileSync('adb', ['-s', serial, ...args], {maxBuffer:32*1024*1024, timeout:30000});
if (!adb('emu','avd','name').toString().split(/\r?\n/).some(x=>x.trim()==='Pixel_7')) throw new Error('This tour is restricted to AVD Pixel_7.');
fs.mkdirSync(out, {recursive:true});
const pause = ms => new Promise(r=>setTimeout(r,ms));
const save = id => { const file=path.join(out,id+'.png');fs.writeFileSync(file,adb('exec-out','screencap','-p'));return file; };
async function get(route) {
  const response = await fetch(new URL(route,base), {redirect:'error',headers:{Cookie:session.cookieName+'='+session.token,'X-Nexus-Client':'android/0.1.6','X-Nexus-Lang':'en'}});
  if (!response.ok) throw new Error(route+' HTTP '+response.status);
  return response.json();
}
async function launch(step, id, route) {
  adb('logcat','-c');
  const extras=['--es','nexusTour','1','--es','nexusServer','dev','--es','nexusTourStep',step];
  if(id) extras.push('--es','nexusTourScreen',id);
  if(route) extras.push('--es','nexusTourRoute',route);
  adb('shell','am','start','-S','-n',pkg+'/.MainActivity',...extras);
  for(let n=0;n<70;n++) {
    await pause(500);
    const log=adb('logcat','-d','-s','NEXUS_TOUR:I').toString();
    if(log.includes('status=server-switched')) return launch(step,id,route);
    if(log.includes('status=not-signed-in') || log.includes('session-import-failed')) throw new Error('Session unavailable');
    if(log.includes('status=settled '+id) || step==='session'&&log.includes('status=signed-in')) {await pause(1500);return;}
  }
  throw new Error('No settled status for '+(id||step));
}
export function nodes() {
  adb('shell','uiautomator','dump','/sdcard/nexus-tour.xml');
  const xml=adb('shell','cat','/sdcard/nexus-tour.xml').toString();
  return [...xml.matchAll(/<node\s+([^>]+)>?/g)].map(match=>{
    const attributes=Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(m=>[m[1],m[2].replaceAll('&amp;','&').replaceAll('&quot;','"')]));
    const b=[...attributes.bounds?.matchAll(/\d+/g)||[]].map(x=>Number(x[0]));
    return {...attributes,x:(b[0]+b[2])/2,y:(b[1]+b[3])/2};
  });
}
export async function tap(label) {
  const options=label.replace(/^[?~]/,'').split('|');
  const n=nodes().find(n=>options.some(v=>label.startsWith('~')?(n.text+' '+n['content-desc']).includes(v):n.text===v||n['content-desc']===v));
  if(!n) return false;
  adb('shell','input','tap',String(Math.round(n.x)),String(Math.round(n.y)));await pause(1200);return true;
}

// Share one login between the API lookups and the debug app. Input stays in its private files directory.
execFileSync('adb',['-s',serial,'shell','run-as',pkg,'sh','-c',"'cat > files/tour-login.json'"],
  {input:JSON.stringify(session),timeout:10000});
await launch('session');
const config=JSON.parse(fs.readFileSync(path.join(root,'apps/ios/scripts/ui-tour-screens.json'),'utf8'));
const projects=await get('/api/projects');
const project=arg('project') || projects.find(p=>p.name==='ZZ QA Manager')?.id;
const outlet=projects.find(p=>p.name==='ZZ QA Manager Outlet')?.id;
const forms=project?await get('/api/forms?projectId='+project).catch(()=>[]):[];
const form=(Array.isArray(forms)?forms:forms.forms||[])[0]?.id;
const legal=await get('/api/legal/documents?q=%5BTEST%5D').catch(()=>({documents:[]}));
const doc=legal.documents?.[0]?.id;
const links=await get('/api/legal/request-links').catch(()=>({links:[]}));
const legalLink=(Array.isArray(links)?links:links.links||[])[0];
const routes={dashboard:'home','my-tasks':'tasks',calendar:'calendar',messages:'messages',gideon:'gideon',notifications:'inbox',threads:'threads',
  vault:'vault?folder=&trash=',submissions:'submissions','room-booking':'rooms',projects:'projects',leaderboard:'leaderboard',
  profile:'profile/'+session.user.id,attendance:'attendance',tickets:'tickets',settings:'account','settings-security':'account','project-templates':'projects',
  'form-builder':form?'form-builder/'+project+'?form='+form:null,
  'legal-archive':'legal?tab=documents','legal-document':doc?'legal-doc/'+doc:null,'legal-templates':'legal?tab=templates',
  'legal-requests':'legal?tab=requests','legal-settings':'legal?tab=settings',
  'legal-request-form':legalLink?.token?'legal-request-form/'+legalLink.token:null};
for(const view of ['overview','board','list','table','calendar','timeline']) routes['project-'+view]=project?'project/'+project+'?view='+view:null;
for(const view of ['overview','calendar','day','settings']) routes['outlet-'+view]=outlet?'project/'+outlet+'?view='+(['overview','settings'].includes(view)?'overview':'calendar'):null;
const only=arg('only')?.split(',');
const report=[];
for(const screen of config.screens) {
  if(only&&!only.includes(screen.id)) continue;
  if(screen.id==='login') { report.push({id:screen.id,result:fs.existsSync(path.join(out,'login.png'))?'captured before session import':'skipped: capture before signing in'});continue; }
  const route=routes[screen.id];
  if(!route) { const result=screen.id.startsWith('socmed-')?'skipped: no native Social Media Report screen':!screen.app?'skipped: web-only screen':'skipped: no QA fixture or native route';report.push({id:screen.id,result});console.log(screen.id+': '+result);continue; }
  try {
    await launch('screen',screen.id,route);
    let actionResult;
    if(screen.id==='project-templates') {
      await tap('Add|Tambah'); actionResult=await tap('New project|Proyek baru');
    } else if(screen.id==='settings-security') actionResult=await tap('Security|Keamanan');
    else if(screen.id==='outlet-settings') actionResult=await tap('Report settings|Pengaturan laporan');
    else if(screen.id==='outlet-day') {
      const day=nodes().find(n=>n.text==='15');
      if(day) {adb('shell','input','tap',String(Math.round(day.x)),String(Math.round(day.y)));await pause(900);actionResult=true;} else actionResult=false;
    }
    const file=save(screen.id);
    report.push({id:screen.id,result:actionResult===false?'blocked: requested action is absent on this native screen':'captured; visual review pending',file});
    console.log(screen.id+': '+report.at(-1).result);
  } catch(error) {report.push({id:screen.id,result:'failed: '+error.message});console.log(screen.id+': failed');}
  fs.writeFileSync(path.join(out,'tour-report.json'),JSON.stringify(report,null,2));
}
fs.writeFileSync(path.join(out,'tour-report.json'),JSON.stringify(report,null,2));
