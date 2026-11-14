import {mkdir, readFile, writeFile, rename, open, stat, unlink} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {gzipSync} from 'node:zlib';
import {assetKey, packCarData} from '../public/data-store.js';
import {isRace} from '../public/race.js';
export const checksum = data => createHash('sha256').update(data).digest('hex');
export async function atomicJson(file, value) {
  await mkdir(path.dirname(file), {recursive: true});
  const text = JSON.stringify(value);
  await writeFile(file + '.tmp', text);
  await rename(file + '.tmp', file);
  return {sha256: checksum(text), bytes: Buffer.byteLength(text)};
}
export async function validAsset(root, key, entry) {
  if (!entry || entry.rows === 0) return false; // Retry source records that were not available yet.
  try { return checksum(await readFile(path.join(root, key + (entry.encoding === 'gzip' ? '.json.gz' : '.json')))) === entry.sha256; } catch { return false; }
}
export async function saveAsset(root, manifest, endpoint, params, rows) {
  const key = assetKey(endpoint, params);
  const value = endpoint === 'car_data' ? packCarData(rows) : rows;
  const encoding = endpoint === 'car_data' ? 'gzip' : 'json';
  const bytes = encoding === 'gzip' ? gzipSync(JSON.stringify(value), {level:9}) : Buffer.from(JSON.stringify(value));
  // Individual files are local working sources. Deployment size limits are
  // enforced by the bundler, which can split large datasets without data loss.
  const file = path.join(root, key + (encoding === 'gzip' ? '.json.gz' : '.json'));
  await mkdir(path.dirname(file), {recursive:true});
  await writeFile(file+'.tmp', bytes);
  await rename(file+'.tmp', file);
  manifest.assets[key] = {sha256:checksum(bytes), bytes:bytes.length, encoding, rows:rows.length, updatedAt:new Date().toISOString()};
}
// Metadata saved for every session, in download order. 'drivers' is always first.
export function metadataEndpoints(session) {
  return ['drivers','laps','session_result','stints','race_control','weather',
    ...(isRace(session) ? ['position','pit'] : []),
    ...(session.session_name === 'Race' ? ['championship_drivers','championship_teams'] : [])];
}
// Results and standings can change for a while after a session (penalties, corrections).
export const RECENT_MS = 14*24*60*60*1000;
export const RECHECK_ENDPOINTS = new Set(['session_result','championship_drivers','championship_teams']);
export const isRecent = (session, now = Date.now()) => now - Date.parse(session.date_end) < RECENT_MS;
// The lock file stores the owning process ID. A lock left by a crashed run names a
// process that no longer exists, so it can be cleared safely instead of by hand.
export async function acquireLock(lockPath, label) {
  for (let attempt=0; attempt<2; attempt++) {
    try {const lock = await open(lockPath, 'wx'); await lock.writeFile(String(process.pid)); return lock;}
    catch (error) {if (error.code !== 'EEXIST') throw error;}
    let pid, ageMs;
    try {pid = Number((await readFile(lockPath, 'utf8')).trim()); ageMs = Date.now() - (await stat(lockPath)).mtimeMs;}
    catch (error) {if (error.code === 'ENOENT') continue; throw error;}
    let running;
    if (Number.isInteger(pid) && pid > 0) {try {process.kill(pid, 0); running = true;} catch (error) {running = error.code !== 'ESRCH';}}
    else running = ageMs < 60000; // No readable process ID: treat as abandoned only once it is clearly old.
    if (running || attempt) throw Error(`Another update or bundle operation is running for ${label}${running && pid > 0 ? ` (process ${pid})` : ''}. Wait for it to finish, then retry.`);
    console.log(`Removing a lock left by an earlier run that is no longer active (${label}).`);
    await unlink(lockPath).catch(error => {if (error.code !== 'ENOENT') throw error;});
  }
  throw Error(`Could not lock ${label} for updating. Retry in a moment.`);
}
export function selectSessions(sessions, {all = false, meeting} = {}) {
  if (all) return sessions;
  const id = meeting ?? sessions.at(-1)?.meeting_key;
  return sessions.filter(s => s.meeting_key === Number(id));
}
