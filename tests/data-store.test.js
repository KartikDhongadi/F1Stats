import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {eligibleSessions,packCarData,unpackCarData,createArchiveClient,assetKey} from '../public/data-store.js';
import {saveAsset,validAsset,selectSessions} from '../scripts/archive.mjs';
const rows=[{date:'2026-01-01T00:00:00Z',speed:100,throttle:0,brake:100,n_gear:2,rpm:6000,drs:null},{date:'2026-01-01T00:00:01Z',speed:110,throttle:50,brake:0,n_gear:3,rpm:7000,drs:null}];
test('all sprint aliases included; practice, cancelled and future sessions excluded',()=>{
 const sessions=['Practice 1','Qualifying','Race','Sprint Qualifying','Sprint Shootout','Sprint','Sprint Race'].map((session_name,i)=>({session_name,session_key:i,date_start:'2026-01-01',date_end:'2026-01-02'}));
 sessions.push({...sessions[2],is_cancelled:true},{...sessions[1],date_end:'2099-01-01'});
 assert.equal(eligibleSessions(sessions,Date.parse('2026-02-01')).length,6);
});
test('telemetry storage preserves every value, null and sample without downsampling',()=>{assert.deepEqual(unpackCarData(packCarData(rows)),rows);});
test('archive reads local URLs only and reuses a driver file across lap windows',async()=>{
 const calls=[],manifest={version:1,year:2026,sessions:[],assets:{'12/car_data/1':{sha256:'abc'}}};
 const client=createArchiveClient(async url=>{calls.push(url);return {ok:true,json:async()=>url.includes('manifest')?manifest:packCarData(rows)};});
 const params={session_key:12,driver_number:1,'date>':rows[1].date};
 assert.deepEqual(await client.query('car_data',params),[rows[1]]);
 assert.equal((await client.query('car_data',{session_key:12,driver_number:1})).length,2);
 assert.equal(calls.length,2);assert.ok(calls.every(url=>url.startsWith('data/')));
 await assert.rejects(client.query('laps',{session_key:12}),/not been downloaded/);
 assert.equal(calls.length,2);
 client.reset();await client.query('car_data',params);assert.equal(calls.length,4);
});
test('missing archive fails clearly without fetching external APIs',async()=>{
 const calls=[];const client=createArchiveClient(async url=>{calls.push(url);return {ok:false};});
 await assert.rejects(client.query('sessions'),/npm run update-data/);assert.deepEqual(calls,['data/2026/manifest.json']);
});
test('saved assets are resumable, detect corruption and retry empty data',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'apex-test-'));
 try{const manifest={assets:{}};await saveAsset(root,manifest,'car_data',{session_key:12,driver_number:1},rows);
 const key='12/car_data/1';assert.equal(await validAsset(root,key,manifest.assets[key]),true);
 await writeFile(path.join(root,key+'.json.gz'),'broken');assert.equal(await validAsset(root,key,manifest.assets[key]),false);
 await saveAsset(root,manifest,'laps',{session_key:12},[]);assert.equal(await validAsset(root,'12/laps',manifest.assets['12/laps']),false);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('latest weekend includes qualifying and sprint even before the grand prix finishes',()=>{
 const s=[{meeting_key:1},{meeting_key:2,session_name:'Sprint Qualifying'},{meeting_key:2,session_name:'Sprint'},{meeting_key:2,session_name:'Qualifying'}];
 assert.equal(selectSessions(s).length,3);assert.equal(selectSessions(s,{all:true}).length,4);assert.equal(selectSessions(s,{meeting:1}).length,1);
 assert.throws(()=>assetKey('laps',{session_key:'../../'}),/Invalid/);
});

test('browser decodes gzip archives and hosts that transparently decompress them',async()=>{
 const {gzipSync}=await import('node:zlib');
 const text=JSON.stringify(packCarData(rows));
 for(const body of [gzipSync(text),Buffer.from(text)]){
  const manifest={version:1,year:2026,sessions:[],assets:{'12/car_data/1':{sha256:'abc',encoding:'gzip'}}};
  const client=createArchiveClient(async url=>url.includes('manifest')?new Response(JSON.stringify(manifest)):new Response(body));
  assert.deepEqual(await client.query('car_data',{session_key:12,driver_number:1}),rows);
 }
});
