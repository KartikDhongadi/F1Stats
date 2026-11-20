import test from 'node:test';
import assert from 'node:assert/strict';
import {describeEvent,eventDrivers,messageLocalTime,aidOffBands,trackLimitCounts} from '../public/race-events.js';
import {wetBands,stintPace} from '../public/race.js';
const names={23:'Albon',27:'Hulkenberg',87:'Bearman',55:'Sainz',51:'Camara'};
const nameOf=n=>names[n]||`Car ${n}`;
const event=(message,extra={})=>({message,category:'Other',flag:null,...extra});

test('penalties, served penalties and stewards decisions are reworded without losing the original',()=>{
 const given=describeEvent(event('FIA STEWARDS: 5 SECOND TIME PENALTY FOR CAR 23 (ALB) - REJOINING UNSAFELY (14:50:05)'),nameOf);
 assert.equal(given.kind,'penalty');assert.equal(given.key,true);
 assert.equal(given.title,'5-second penalty · Albon');assert.equal(given.detail,'Rejoining unsafely');
 assert.equal(given.local,'14:50:05');assert.match(given.original,/REJOINING UNSAFELY/);
 const served=describeEvent(event('FIA STEWARDS: PENALTY SERVED - 10 SECOND TIME PENALTY FOR CAR 27 (HUL) - LEAVING THE TRACK (15:09:09)'),nameOf);
 assert.equal(served.title,'Penalty served · Hulkenberg');assert.equal(served.detail,'10 second time penalty');
 const after=describeEvent(event('FIA STEWARDS: INCIDENT INVOLVING CAR 23 (ALB) WILL BE INVESTIGATED AFTER THE RACE - UNSAFE RELEASE (15:26:15)'),nameOf);
 assert.equal(after.kind,'stewards');assert.equal(after.key,true);assert.equal(after.detail,'Unsafe release');
 const noted=describeEvent(event('TURN 6 INCIDENT INVOLVING CARS 87 (BEA) AND 55 (SAI) NOTED (14:44:23)'),nameOf);
 assert.equal(noted.key,false);assert.deepEqual(noted.drivers,[87,55]);assert.equal(noted.title,'Incident noted · Bearman & Sainz');
});

test('flags, track limits, race status and unknown notices',()=>{
 assert.equal(describeEvent(event('WAVED BLUE FLAG FOR CAR 44 (HAM)',{category:'Flag',flag:'BLUE',driver_number:44}),nameOf).kind,'blue');
 const yellow=describeEvent(event('DOUBLE YELLOW IN TRACK SECTOR 2',{category:'Flag',flag:'DOUBLE YELLOW'}),nameOf);
 assert.equal(yellow.kind,'yellow');assert.equal(yellow.detail,'Track sector 2');assert.equal(yellow.key,false);
 const limits=describeEvent(event('CAR 51 (CAM) TIME 1:26.329 DELETED - TRACK LIMITS AT TURN 2 LAP 22 14:35:06'),nameOf);
 assert.equal(limits.kind,'limits');assert.equal(limits.title,'Lap time deleted · Camara');assert.equal(limits.detail,'Track limits at turn 2 · lap 22');
 assert.equal(describeEvent(event('SAFETY CAR DEPLOYED',{category:'SafetyCar'}),nameOf).title,'Safety car deployed');
 assert.equal(describeEvent(event('VIRTUAL SAFETY CAR ENDING',{category:'SafetyCar'}),nameOf).title,'Virtual safety car ending');
 assert.equal(describeEvent(event('RED FLAG',{category:'Flag',flag:'RED'}),nameOf).title,'Red flag');
 assert.equal(describeEvent(event('OVERTAKE DISABLED'),nameOf).title,'Overtake mode disabled');
 assert.equal(describeEvent(event('DRS ENABLED'),nameOf).title,'DRS enabled');
 const other=describeEvent(event('PIT EXIT CLOSED'),nameOf);
 assert.equal(other.kind,'other');assert.equal(other.title,'Pit exit closed');assert.equal(other.key,false);
});

test('car numbers, local times, aid-off bands and track-limit counts',()=>{
 assert.deepEqual(eventDrivers({message:'NOTHING HERE',driver_number:4}),[4]);
 assert.equal(messageLocalTime('NO TIME'),null);
 const entries=[{original:'OVERTAKE ENABLED',lap:23,time:2},{original:'OVERTAKE DISABLED',lap:62,time:3}];
 assert.deepEqual(aidOffBands(entries,71),[{from:1,to:22},{from:62,to:71}]);
 const counted=[{kind:'limits',title:'Lap time deleted · A',drivers:[51]},{kind:'limits',title:'Lap time deleted · A',drivers:[51]},{kind:'limits',title:'Lap time reinstated · A',drivers:[51]},{kind:'limits',title:'Lap time deleted · B',drivers:[5]}];
 assert.deepEqual(trackLimitCounts(counted),[[51,2],[5,1]]);
});

test('wet bands need a majority on wet-weather tyres and never count laps without stints',()=>{
 const row=stints=>({stints});
 const rows=[row([{compound:'INTERMEDIATE',lap_start:1,end:3},{compound:'SOFT',lap_start:4,end:6}]),row([{compound:'INTERMEDIATE',lap_start:1,end:4},{compound:'SOFT',lap_start:5,end:6}]),row([{compound:'SOFT',lap_start:1,end:6}])];
 assert.deepEqual(wetBands(rows,8),[{from:1,to:3}]);
 assert.deepEqual(wetBands([],5),[]);
});

test('stint pace leaves out boundary, pit and deleted laps and reports the median',()=>{
 const lap=(n,t,extra={})=>({lap_number:n,lap_duration:t,...extra});
 const row={stints:[{compound:'SOFT',lap_start:1,end:7}],laps:[lap(1,99),lap(2,80),lap(3,82),lap(4,90,{deleted:true}),lap(5,81),lap(6,70,{pitIn:true}),lap(7,99)]};
 const [s]=stintPace(row);
 assert.equal(s.count,3);assert.equal(s.median,81);assert.equal(s.best,80);
 assert.equal(stintPace({stints:[{compound:'HARD',lap_start:1,end:2}],laps:[lap(1,80),lap(2,80)]})[0].median,null);
});
