import test from 'node:test';
import assert from 'node:assert/strict';
import {phaseWindows,lapDeletionStates,qualifyingModel,phasePrefix} from '../public/qualifying.js';
const stamp=minute=>new Date(Date.UTC(2026,0,1,12,minute)).toISOString();
const event=(minute,phase,message)=>({date:stamp(minute),qualifying_phase:phase,category:'SessionStatus',message});
const messages=[event(0,1,'SESSION STARTED'),event(5,1,'SESSION ABORTED'),event(10,1,'SESSION STARTED'),event(25,1,'SESSION FINISHED'),event(30,2,'SESSION STARTED'),event(45,2,'SESSION FINISHED')];
const session={session_name:'Qualifying',date_start:stamp(0),date_end:stamp(60)};
test('red flag restart does not shift Q1 and scheduled starts are ignored',()=>{
 const ranges=phaseWindows([...messages,{date:stamp(26),message:'Q2 WILL START AT 12:30',qualifying_phase:2,category:'Other'}]);
 assert.equal(ranges.length,2);assert.equal(ranges[0].start,Date.parse(stamp(0)));assert.equal(ranges[0].end,Date.parse(stamp(25)));assert.equal(ranges[1].start,Date.parse(stamp(30)));
});
test('laps finishing after chequered retain start phase; gaps and missing timestamps remain unknown',()=>{
 const laps=[{driver_number:1,lap_number:1,date_start:stamp(24),lap_duration:120},{driver_number:1,lap_number:2,date_start:stamp(28),lap_duration:60},{driver_number:1,lap_number:3,date_start:null,lap_duration:70}];
 const model=qualifyingModel(session,[],laps,[],messages);
 assert.deepEqual(model.rows[0].attempts.map(l=>l.phase),[1,null,null]);
});
test('deletion matching requires exact driver and lap; reinstatement wins chronologically',()=>{
 const deletion=[{date:stamp(1),message:'CAR 18 (STR) TIME 1:29.337 DELETED - TRACK LIMITS AT TURN 4 LAP 3'}, {date:stamp(2),message:'CAR 18 LAP 3 TIME REINSTATED'}, {date:stamp(3),message:'CAR 1 TIME 1:19.035 DELETED - LAP 6'},{date:stamp(4),message:'CAR 2 TIME 1:18.000 DELETED'}];
 const states=lapDeletionStates(deletion.reverse());assert.equal(states.get('18:3').deleted,false);assert.equal(states.get('1:6').deleted,true);assert.equal(states.size,2);
});
test('keeps all drivers, including no laps and drivers present only in results',()=>{
 const drivers=Array.from({length:22},(_,i)=>({driver_number:i+1,full_name:`Driver ${i+1}`}));
 const model=qualifyingModel(session,drivers,[],[{driver_number:99,position:1,duration:[81,null,null]}],messages);
 assert.equal(model.rows.length,23);assert.equal(model.rows[0].driver.driver_number,99);assert.equal(model.rows.find(r=>r.driver.driver_number===22).attempts.length,0);
 assert.deepEqual(model.rows[0].best,[81,null,null]);
});
test('official best is separate from deleted and pit-out attempts',()=>{
 const laps=[1,2,3].map(n=>({driver_number:1,lap_number:n,date_start:stamp(n),lap_duration:80,is_pit_out_lap:n===3}));
 const model=qualifyingModel(session,[],laps,[{driver_number:1,duration:[80,null,null]}],[...messages,{date:stamp(5),message:'CAR 1 TIME 1:20.000 DELETED - LAP 1'}]);
 assert.deepEqual(model.rows[0].attempts.map(l=>l.best),[false,true,false]);
 assert.deepEqual(model.rows[0].best,[80,null,null]);
});
test('sprint phases use SQ and missing event boundaries are never guessed',()=>{
 assert.equal(phasePrefix({session_name:'Sprint Qualifying'}),'SQ');assert.equal(phasePrefix({session_name:'Sprint Shootout'}),'SQ');
 const model=qualifyingModel(session,[],[{driver_number:1,lap_number:1,date_start:stamp(5),lap_duration:80}],[],[]);
 assert.equal(model.rows[0].attempts[0].phase,null);
});
