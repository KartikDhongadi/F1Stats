import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {atomicJson} from './archive.mjs';
export async function writeSeasonSummary(root,manifest){
 let cachedFile,cachedBundle;
 async function dataset(key){
  const asset=manifest.assets[key];if(!asset)return [];
  if(manifest.version===1){const bytes=await readFile(path.join(root,key+(asset.encoding==='gzip'?'.json.gz':'.json')));return JSON.parse(asset.encoding==='gzip'?gunzipSync(bytes):bytes);}
  const rows=[];
  for(const chunk of asset.chunks){
   if(cachedFile!==chunk.file){cachedBundle=JSON.parse(gunzipSync(await readFile(path.join(root,chunk.file))));cachedFile=chunk.file;}
   const part=cachedBundle.datasets[chunk.member];if(!Array.isArray(part))throw Error(`Invalid summary dataset ${key}`);
   for(const row of part)rows.push(row);
  }
  return rows;
 }
 const meetings=new Map();
 for(const session of manifest.sessions){const group=meetings.get(session.meeting_key)||[];group.push(session);meetings.set(session.meeting_key,group);}
 const weekends=[];
 for(const [meeting_key,sessions] of meetings){
  const gp=sessions.find(s=>s.session_name==='Race'),representative=gp||sessions.at(-1);
  let podium=[],standings=null;
  if(gp){
   const results=await dataset(`${gp.session_key}/session_result`),drivers=await dataset(`${gp.session_key}/drivers`);
   podium=results.filter(r=>r.position>=1&&r.position<=3&&!r.dsq&&!r.dns).sort((a,b)=>a.position-b.position).map(r=>({position:r.position,driver_number:r.driver_number,name:drivers.find(d=>d.driver_number===r.driver_number)?.full_name||`Driver ${r.driver_number}`}));
   // Championship points after this Grand Prix, for the season chart. Provider beta data:
   // a weekend without saved standings simply has none, and nothing is estimated.
   const championship=await dataset(`${gp.session_key}/championship_drivers`);
   if(championship.length)standings=championship.filter(c=>Number.isInteger(c.driver_number)).sort((a,b)=>(a.position_current??99)-(b.position_current??99)).map(c=>{const d=drivers.find(d=>d.driver_number===c.driver_number);return {driver_number:c.driver_number,acronym:d?.name_acronym||null,name:d?.full_name||`Driver ${c.driver_number}`,team_colour:d?.team_colour||null,position:c.position_current??null,points:c.points_current??null};});
  }
  weekends.push({meeting_key,session_key:representative.session_key,country_name:representative.country_name,country_code:representative.country_code||null,circuit_short_name:representative.circuit_short_name,date_start:representative.date_start,sessions:sessions.map(s=>({session_key:s.session_key,session_name:s.session_name,date_start:s.date_start})),podium,...(standings?{standings}:{})});
 }
 weekends.sort((a,b)=>Date.parse(b.date_start)-Date.parse(a.date_start));
 const value={format:'apex-season-summary-v1',year:manifest.year,updatedAt:manifest.updatedAt,weekends};
 if(Buffer.byteLength(JSON.stringify(value))>20*1024*1024)throw Error('Season summary exceeds asset size ceiling.');
 const file='season-summary.json',entry=await atomicJson(path.join(root,file),value);manifest.summary={file,...entry};
 return entry;
}
