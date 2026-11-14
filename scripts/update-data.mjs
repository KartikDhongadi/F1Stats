import {readFile, mkdir, unlink} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepareSource,publishBundles} from './bundles.mjs';
import {eligibleSessions, assetKey} from '../public/data-store.js';
import {atomicJson, validAsset, saveAsset, selectSessions, checksum, acquireLock, metadataEndpoints, isRecent, RECHECK_ENDPOINTS} from './archive.mjs';
const args = process.argv.slice(2);
const allowed = new Set(['--all', '--refresh', '--metadata-only', '--meeting', '--year', '--help']);
for (let i=0;i<args.length;i++) {
  if (!allowed.has(args[i])) throw Error(`Unknown argument: ${args[i]}`);
  if (['--meeting','--year'].includes(args[i])) {if (!/^\d+$/.test(args[++i] || '')) throw Error('Expected a numeric argument.');}
}
if (args.includes('--help')) {
  console.log('npm run update-data -- [--all | --meeting ID] [--refresh] [--metadata-only] [--year 2026]\nDefault: latest completed weekend, plus any weekend after your first saved one that has files missing.\nResults and standings from the last 14 days are re-checked for corrections. Practice is always excluded. Existing files are verified and skipped.');
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
const lock = await acquireLock(lockPath, String(year));
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
  let selected;
  if (args.includes('--all') || args.includes('--meeting')) selected = selectSessions(available, {all:args.includes('--all'), meeting:value('--meeting')});
  else {
    // Default run: the latest weekend, plus anything after the first saved weekend that is
    // recent or has files missing. A season with nothing saved still starts with one weekend.
    const seasonHasTelemetry = Object.keys(manifest.assets).some(key => key.includes('/car_data/'));
    async function missingFiles(session) {
      if (!manifest.sessions.some(s => s.session_key === session.session_key)) return true;
      const params = {session_key:session.session_key};
      if (metadataEndpoints(session).some(endpoint => !manifest.assets[assetKey(endpoint, params)])) return true;
      // A season saved with --metadata-only is not silently upgraded to full telemetry.
      if (args.includes('--metadata-only') || !seasonHasTelemetry) return false;
      try {
        const drivers = JSON.parse(await readFile(path.join(root, assetKey('drivers', params)+'.json'), 'utf8'));
        return drivers.some(d => !manifest.assets[assetKey('car_data', {...params, driver_number:d.driver_number})]);
      } catch {return true;}
    }
    const keys = new Set(selectSessions(available).map(s => s.session_key));
    const firstSaved = Math.min(...manifest.sessions.map(s => Date.parse(s.date_start)));
    const added = [];
    for (const session of available) {
      if (keys.has(session.session_key) || !(Date.parse(session.date_start) > firstSaved)) continue;
      if (isRecent(session) || await missingFiles(session)) {keys.add(session.session_key); added.push(session);}
    }
    selected = available.filter(s => keys.has(s.session_key));
    if (added.length) console.log(`Also including ${added.length} earlier session(s) that are recent or have files missing: ${added.map(s => `${s.country_name} ${s.session_name}`).join(', ')}.`);
  }
  if (!selected.length) throw Error('No completed eligible sessions found for this selection.');
  console.log(`Selected ${selected.length} sessions. Practice excluded. ${args.includes('--metadata-only')?'Metadata only.':'Full sampled car telemetry for all session drivers.'}`);
  const persist = async () => {manifest.updatedAt = new Date().toISOString(); await atomicJson(manifestPath, manifest);};
  async function get(endpoint, params, recheck=false) {
    const key=assetKey(endpoint, params);
    const saved = !args.includes('--refresh') && await validAsset(root, key, manifest.assets[key]);
    if (saved && !recheck) {
      console.log(`Already saved: ${key}`);
      return endpoint==='car_data' ? null : JSON.parse(await readFile(path.join(root,key+'.json'),'utf8'));
    }
    if (saved) {
      // Recent results can change after penalties or corrections. The saved copy is replaced
      // only when the provider returns something new and non-empty; a failed check keeps it.
      console.log(`Checking for corrections: ${key}…`);
      let rows = null;
      try {rows = await request(endpoint, params);} catch (error) {
        if (interrupted) throw error;
        console.log(`Could not check ${key} (${error.message}) Keeping the saved copy.`);
      }
      if (rows?.length && checksum(Buffer.from(JSON.stringify(rows))) !== manifest.assets[key].sha256) {
        await saveAsset(root,manifest,endpoint,params,rows);
        await persist();
        console.log(`Updated with corrections: ${rows.length} rows.`);
        return rows;
      }
      if (rows) console.log(rows.length ? 'No change.' : 'Provider returned no rows; kept the saved copy.');
      return JSON.parse(await readFile(path.join(root,key+'.json'),'utf8'));
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
    const recheck=isRecent(session);
    for(const endpoint of metadataEndpoints(session).slice(1)) await get(endpoint,params,recheck&&RECHECK_ENDPOINTS.has(endpoint));
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
