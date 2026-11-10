import {readFile, mkdir, open, unlink} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepareSource,publishBundles} from './bundles.mjs';
import {isRace} from '../public/race.js';
import {eligibleSessions, assetKey} from '../public/data-store.js';
import {atomicJson, validAsset, saveAsset, selectSessions} from './archive.mjs';
const args = process.argv.slice(2);
const allowed = new Set(['--all', '--refresh', '--metadata-only', '--meeting', '--year', '--help']);
for (let i=0;i<args.length;i++) {
  if (!allowed.has(args[i])) throw Error(`Unknown argument: ${args[i]}`);
  if (['--meeting','--year'].includes(args[i])) {if (!/^\d+$/.test(args[++i] || '')) throw Error('Expected a numeric argument.');}
}
if (args.includes('--help')) {
  console.log('npm run update-data -- [--all | --meeting ID] [--refresh] [--metadata-only] [--year 2026]\nDefault: latest completed weekend. Practice is always excluded. Existing files are verified and skipped.');
  process.exit(0);
}
if (args.includes('--all') && args.includes('--meeting')) throw Error('Use --all or --meeting, not both.');
const value = flag => args.includes(flag) ? Number(args[args.indexOf(flag)+1]) : undefined;
const year = value('--year') ?? 2026;
const base=fileURLToPath(new URL('../',import.meta.url));
const publicRoot=path.join(base,'public/data',String(year));
const root=path.join(base,'.archive-source',String(year));
const manifestPath = path.join(root, 'manifest.json');
const lockPath = path.join(publicRoot, '.update.lock');
await mkdir(publicRoot,{recursive:true});
await mkdir(root, {recursive:true});
let lock;
try {lock = await open(lockPath, 'wx');} catch {throw Error(`Another update may be running. If a previous update crashed, remove ${lockPath} before retrying.`);}
await lock.writeFile(String(process.pid));
let interrupted = false;
process.once('SIGINT', () => {interrupted = true; console.log('\nStopping after the current request; completed files are retained.');});
let lastRequest = 0;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function request(endpoint, params) {
  for (let attempt=0; attempt<4; attempt++) {
    if (interrupted) throw Error('Update interrupted. Run the same command to resume.');
    // At most about 28 requests/minute, sequentially, with bounded retries.
    await sleep(Math.max(0, 2200 - (Date.now()-lastRequest)));
    lastRequest = Date.now();
    let response;
    try {response = await fetch('https://api.openf1.org/v1/' + endpoint + '?' + new URLSearchParams(params), {signal:AbortSignal.timeout(90000)});} catch (error) {
      if (attempt===3) throw Error(`Network failure for ${endpoint}: ${error.message}`);
      await sleep(5000 * (attempt+1)); continue;
    }
    if ([401,403].includes(response.status)) throw Error('OpenF1 temporarily restricts free access. Try this command later; no paid fallback is used.');
    if (response.status===429 || response.status>=500) {
      if (attempt===3) throw Error(`OpenF1 returned ${response.status}. Run again later to resume.`);
      const retry = Number(response.headers.get('retry-after'));
      const delay = response.status===429 ? Math.max(60000, (Number.isFinite(retry)?retry:0)*1000) : 5000*(attempt+1);
      console.log(`OpenF1 ${response.status}; retrying after ${Math.ceil(delay/1000)} seconds…`);
      if (delay>300000) throw Error('Provider requests a long pause. Resume the update later.');
      await sleep(delay); continue;
    }
    const data = await response.json();
    if (response.status===404 && data.detail==='No results found.') return [];
    if (!response.ok || !Array.isArray(data)) throw Error(`Unexpected OpenF1 response for ${endpoint}: ${response.status}`);
    return data;
  }
}
try {
  await prepareSource(base,year);
  let manifest;
  try {manifest = JSON.parse(await readFile(manifestPath, 'utf8'));} catch (e) {if(e.code!=='ENOENT') throw e;}
  manifest ??= {version:1, year, source:'https://openf1.org/docs/', sessions:[], assets:{}};
  if(manifest.version!==1 || manifest.year!==year) throw Error('Archive version does not match.');
  const available = eligibleSessions(await request('sessions', {year}));
  const selected = selectSessions(available, {all:args.includes('--all'), meeting:value('--meeting')});
  if (!selected.length) throw Error('No completed eligible sessions found for this selection.');
  console.log(`Selected ${selected.length} sessions. Practice excluded. ${args.includes('--metadata-only')?'Metadata only.':'Full sampled car telemetry for all session drivers.'}`);
  const persist = async () => {manifest.updatedAt = new Date().toISOString(); await atomicJson(manifestPath, manifest);};
  async function get(endpoint, params) {
    const key=assetKey(endpoint, params);
    if (!args.includes('--refresh') && await validAsset(root, key, manifest.assets[key])) {
      console.log(`Already saved: ${key}`);
      return endpoint==='car_data' ? null : JSON.parse(await readFile(path.join(root,key+'.json'),'utf8'));
    }
    console.log(`Downloading ${key}…`);
    const rows=await request(endpoint,params);
    await saveAsset(root,manifest,endpoint,params,rows);
    await persist();
    console.log(`Saved ${rows.length} rows.`);
    return rows;
  }
  for (const session of selected) {
    console.log(`\n${session.country_name} · ${session.session_name} · ${session.session_key}`);
    const params={session_key:session.session_key};
    const drivers=await get('drivers', params);
    for(const endpoint of ['laps','session_result','stints','race_control','weather']) await get(endpoint,params);
    if(isRace(session)){await get('position',params);await get('pit',params);}
    if(session.session_name==='Race') {
      await get('championship_drivers',params);
      await get('championship_teams',params);
    }
    // Expose the session only after its metadata has been saved successfully.
    manifest.sessions = eligibleSessions([...manifest.sessions.filter(s=>s.session_key!==session.session_key),session]);
    await persist();
    if(!args.includes('--metadata-only')) for (const driver of drivers) {
      await get('car_data',{...params,driver_number:driver.driver_number});
    }
    await persist();
  }
  const assets=Object.values(manifest.assets);
  console.log(`\nArchive ready: ${manifest.sessions.length} sessions, ${assets.length} files, ${(assets.reduce((n,a)=>n+a.bytes,0)/1024/1024).toFixed(1)} MiB.`);
  console.log('Bundled deployment:',await publishBundles(base,year));
  console.log('Reload saved data in APEX. Commit public/data with the application when ready to deploy.');
} catch(error) {
  console.error(error.message);
  process.exitCode=1;
} finally {
  await lock.close();
  await unlink(lockPath);
}
