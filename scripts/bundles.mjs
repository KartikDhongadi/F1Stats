import {mkdir,readFile,writeFile,rename,unlink,readdir} from 'node:fs/promises';
import path from 'node:path';
import {gzipSync,gunzipSync} from 'node:zlib';
import {atomicJson,checksum,saveAsset} from './archive.mjs';
import {writeSeasonSummary} from './season-summary.mjs';
import {unpackCarData} from '../public/data-store.js';
const TARGET=5*1024*1024,HARD=20*1024*1024,RAW=32*1024*1024;
const json=async file=>JSON.parse(await readFile(file,'utf8'));
const legacyFile=(key,entry)=>key+(entry.encoding==='gzip'?'.json.gz':'.json');
export async function prepareSource(base,year){
 const source=path.join(base,'.archive-source',String(year)),published=path.join(base,'public/data',String(year));
 await mkdir(source,{recursive:true});
 try{await readFile(path.join(source,'manifest.json'));return source;}catch(e){if(e.code!=='ENOENT')throw e;}
 let manifest;try{manifest=await json(path.join(published,'manifest.json'));}catch(e){if(e.code==='ENOENT')return source;throw e;}
 if(manifest.version===2){
  // A fresh Git clone contains only deployable bundles. Recreate the private source
  // archive losslessly so normal updates can resume without re-downloading seasons.
  const restored={version:1,year,source:manifest.source,sessions:manifest.sessions,assets:{},updatedAt:manifest.updatedAt};
  let lastFile,lastBundle;
  for(const [key,entry] of Object.entries(manifest.assets)){
   const parts=key.split('/'),endpoint=parts[1],rows=[];
   for(const chunk of entry.chunks){
    if(!/^\d+\/bundles\/[a-z]+-[a-f0-9]+\.json\.gz$/.test(chunk.file))throw Error('Invalid bundle path.');
    if(lastFile!==chunk.file){const bytes=await readFile(path.join(published,chunk.file));if(checksum(bytes)!==chunk.sha256)throw Error(`Bundle checksum mismatch: ${chunk.file}`);lastBundle=JSON.parse(gunzipSync(bytes));lastFile=chunk.file;}
    if(lastBundle.format!=='apex-bundle-v1')throw Error('Unsupported bundle format.');
    const value=lastBundle.datasets[chunk.member],records=endpoint==='car_data'?unpackCarData(value):value;
    if(!Array.isArray(records))throw Error(`Invalid dataset: ${key}`);
    for(const row of records)rows.push(row);
   }
   if(rows.length!==entry.rows)throw Error(`Incomplete dataset: ${key}`);
   await saveAsset(source,restored,endpoint,{session_key:parts[0],driver_number:parts[2]},rows);
   restored.assets[key].updatedAt=entry.updatedAt;
  }
  await atomicJson(path.join(source,'manifest.json'),restored);return source;
 }
 if(manifest.version!==1)throw Error(`Unsupported source archive for ${year}.`);
 for(const [key,entry] of Object.entries(manifest.assets)){
  const relative=legacyFile(key,entry),bytes=await readFile(path.join(published,relative));
  if(checksum(bytes)!==entry.sha256)throw Error(`Source checksum mismatch: ${year}/${relative}. Repair the original archive before bundling.`);
  await mkdir(path.dirname(path.join(source,relative)),{recursive:true});await writeFile(path.join(source,relative),bytes);
 }
 await atomicJson(path.join(source,'manifest.json'),manifest);return source;
}
function encode(units){return Buffer.from(JSON.stringify({format:'apex-bundle-v1',datasets:Object.fromEntries(units.map(u=>[u.member,u.value]))}));}
function splitUnit(unit){
 const rows=Array.isArray(unit.value)?unit.value:unit.value.rows;
 const raw=encode([unit]);const compressed=gzipSync(raw,{level:9});
 if(raw.length<=RAW&&compressed.length<=TARGET)return [unit];
 if(rows.length<=1){if(raw.length>RAW||compressed.length>HARD)throw Error(`A single record in ${unit.key} is too large to bundle safely.`);return [unit];}
 const middle=Math.ceil(rows.length/2);
 return [rows.slice(0,middle),rows.slice(middle)].flatMap((part,i)=>splitUnit({...unit,member:unit.member+'-'+i,value:Array.isArray(unit.value)?part:{...unit.value,rows:part}}));
}
export async function publishBundles(base,year){
 const source=path.join(base,'.archive-source',String(year)),dest=path.join(base,'public/data',String(year));
 const original=await json(path.join(source,'manifest.json'));
 if(original.version!==1||original.year!==year)throw Error('Invalid source archive version/year.');
 let previous;try{previous=await json(path.join(dest,'manifest.json'));}catch(e){if(e.code!=='ENOENT')throw e;}
 const manifest={...original,version:2,format:'apex-archive-v2',bundledAt:new Date().toISOString(),assets:{}};
 let fileCount=0,totalBytes=0,largest=0;
 async function flush(session,kind,units){
  if(!units.length)return;
  const raw=encode(units),bytes=gzipSync(raw,{level:9});
  if(bytes.length>HARD||raw.length>RAW)throw Error('Bundle exceeds its safety ceiling.');
  const sha256=checksum(bytes),file=`${session}/bundles/${kind}-${sha256.slice(0,24)}.json.gz`;
  await mkdir(path.dirname(path.join(dest,file)),{recursive:true});await writeFile(path.join(dest,file)+'.tmp',bytes);await rename(path.join(dest,file)+'.tmp',path.join(dest,file));
  fileCount++;totalBytes+=bytes.length;largest=Math.max(largest,bytes.length);
  for(const unit of units){
   const entry=manifest.assets[unit.key]??={rows:original.assets[unit.key].rows,updatedAt:original.assets[unit.key].updatedAt,sourceSha256:original.assets[unit.key].sha256,chunks:[]};
   let from=null,to=null;
   if(kind==='telemetry'){
    let low=Infinity,high=-Infinity,valid=true;
    for(const row of unit.value.rows){const time=Date.parse(row[0]);if(!Number.isFinite(time)){valid=false;break;}low=Math.min(low,time);high=Math.max(high,time);}
    if(valid&&Number.isFinite(low)){from=low;to=high;}
   }
   entry.chunks.push({file,member:unit.member,sha256,bytes:bytes.length,rawBytes:raw.length,from,to});
  }
 }
 for(const session of original.sessions){
  const entries=Object.entries(original.assets).filter(([key])=>key.startsWith(session.session_key+'/'));
  const oldKeys=Object.keys(previous?.assets||{}).filter(key=>key.startsWith(session.session_key+'/'));
  let reusable=previous?.version===2&&oldKeys.length===entries.length&&entries.every(([key,entry])=>previous.assets[key]?.sourceSha256===entry.sha256);
  const oldFiles=new Map();
  if(reusable){
   for(const [key] of entries)for(const chunk of previous.assets[key].chunks)oldFiles.set(chunk.file,chunk);
   for(const [file,chunk] of oldFiles){try{if(checksum(await readFile(path.join(dest,file)))!==chunk.sha256){reusable=false;break;}}catch{reusable=false;break;}}
  }
  if(reusable){
   for(const [key,entry] of entries)manifest.assets[key]={...previous.assets[key],updatedAt:entry.updatedAt};
   for(const chunk of oldFiles.values()){fileCount++;totalBytes+=chunk.bytes;largest=Math.max(largest,chunk.bytes);}
   console.log(`Reused ${year}/${session.session_key}`);continue;
  }
  console.log(`Bundling ${year}/${session.session_key} · ${session.session_name}`);
  for(const kind of ['metadata','telemetry']){
   let group=[];
   for(const [key,entry] of entries.filter(([key])=>(key.includes('/car_data/')?'telemetry':'metadata')===kind)){
    const bytes=await readFile(path.join(source,legacyFile(key,entry)));
    if(checksum(bytes)!==entry.sha256)throw Error(`Source checksum mismatch: ${key}`);
    const value=JSON.parse(entry.encoding==='gzip'?gunzipSync(bytes).toString():bytes.toString());
    for(const unit of splitUnit({key,member:key,value})){
     const candidate=[...group,unit],raw=encode(candidate);
     // Cap telemetry fan-out as well as byte size: selecting one driver fetches at most four members.
     if(group.length&&(raw.length>RAW||(kind==='telemetry'&&candidate.length>4)||gzipSync(raw,{level:9}).length>TARGET)){
      await flush(session.session_key,kind,group);group=[];
     }
     group.push(unit);
    }
   }
   await flush(session.session_key,kind,group);
  }
 }
 // Publish only after all bundles exist. The original files remain outside public/.
 await writeSeasonSummary(dest,manifest);
 await atomicJson(path.join(dest,'manifest.json'),manifest);
 const keep=new Set(Object.values(manifest.assets).flatMap(a=>a.chunks.map(c=>c.file)));
 const legacyEntries=previous?.version===1?previous.assets:original.assets;
 for(const [key,entry] of Object.entries(legacyEntries))await unlink(path.join(dest,legacyFile(key,entry))).catch(e=>{if(e.code!=='ENOENT')throw e;});
 // Retire obsolete content-addressed bundles, including leftovers from interrupted builds.
 for(const session of await readdir(dest,{withFileTypes:true})){
  if(!session.isDirectory()||!/^\d+$/.test(session.name))continue;
  const dir=path.join(dest,session.name,'bundles');
  let files;try{files=await readdir(dir);}catch(e){if(e.code==='ENOENT')continue;throw e;}
  for(const name of files){const file=`${session.name}/bundles/${name}`;if(name.endsWith('.json.gz')&&!keep.has(file))await unlink(path.join(dest,file));}
 }
 return {year,sessions:manifest.sessions.length,files:fileCount+2,MiB: +((totalBytes+manifest.summary.bytes)/1024/1024).toFixed(2),largestMiB:+(largest/1024/1024).toFixed(2)};
}
