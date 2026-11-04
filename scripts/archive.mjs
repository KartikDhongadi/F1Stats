import {mkdir, readFile, writeFile, rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {gzipSync} from 'node:zlib';
import {assetKey, packCarData} from '../public/data-store.js';
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
  if (bytes.length > 24 * 1024 * 1024) throw Error(`Asset ${key} exceeds the static hosting file size target.`);
  const file = path.join(root, key + (encoding === 'gzip' ? '.json.gz' : '.json'));
  await mkdir(path.dirname(file), {recursive:true});
  await writeFile(file+'.tmp', bytes);
  await rename(file+'.tmp', file);
  manifest.assets[key] = {sha256:checksum(bytes), bytes:bytes.length, encoding, rows:rows.length, updatedAt:new Date().toISOString()};
}
export function selectSessions(sessions, {all = false, meeting} = {}) {
  if (all) return sessions;
  const id = meeting ?? sessions.at(-1)?.meeting_key;
  return sessions.filter(s => s.meeting_key === Number(id));
}
