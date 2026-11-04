import test from 'node:test';
import assert from 'node:assert/strict';
import {isRace,positionAt,raceClock,eventRaceLap,eventType,normalizeStints,raceModel,pacePoints,linePath} from '../public/race.js';
const date=s=>new Date(1700000000000+s*1000).toISOString();
const lap=(driver,n,start,duration)=>({driver_number:driver,lap_number:n,date_start:date(start),lap_duration:duration});
test('race scope includes sprint aliases and excludes qualifying',()=>{
 for(const session_name of ['Race','Sprint','Sprint Race'])assert.ok(isRace({session_name}));
 assert.equal(isRace({session_name:'Sprint Qualifying'}),false);
});
test('position sampling carries forward but never borrows future observations',()=>{
 const stream=[{time:10,position:4},{time:20,position:2}];
 assert.equal(positionAt(stream,9),null);assert.equal(positionAt(stream,10),4);assert.equal(positionAt(stream,19),4);assert.equal(positionAt(stream,20),2);
});
test('common clock uses earliest crossing and next start, preserving missing laps',()=>{
 const clock=raceClock([lap(1,1,0,null),lap(1,2,60,60),lap(2,1,0,65)],4);
 assert.deepEqual(clock.map(p=>p.time),[Date.parse(date(60)),Date.parse(date(120)),null,null]);
});
test('retirements end traces while lapped drivers use the same clock',()=>{
 const model=raceModel({},[{driver_number:1},{driver_number:2},{driver_number:3}],
 [lap(1,1,0,60),lap(1,2,60,60),lap(2,1,0,90)],
 [{driver_number:1,number_of_laps:2},{driver_number:2,number_of_laps:1,dnf:true},{driver_number:3,dns:true}],
 [{driver_number:1,date:date(1),position:1},{driver_number:2,date:date(1),position:2},{driver_number:3,date:date(1),position:3}],[],[],[]);
 assert.deepEqual(model.rows.find(r=>r.driver.driver_number===2).positionPoints.map(p=>p.position),[2,null]);
 assert.deepEqual(model.rows.find(r=>r.driver.driver_number===3).positionPoints.map(p=>p.position),[null,null]);
});
test('stints retain inclusive single laps and label inferred ends',()=>{
 const rows=normalizeStints([{lap_start:1,lap_end:1},{lap_start:2},{lap_start:5,lap_end:10}],7);
 assert.deepEqual(rows.map(s=>[s.lap_start,s.end,s.endInferred]),[[1,1,false],[2,4,true],[5,7,false]]);
});
test('events outside actual race timing are excluded and laps are approximate',()=>{
 const model=raceModel({},[],[lap(1,1,0,60),lap(1,2,60,60)],[],[],[],[],[
 {date:date(-100),message:'OLD'}, {date:date(61),message:'VSC DEPLOYED'}, {date:date(61),message:'VSC DEPLOYED'}]);
 assert.equal(model.events.length,1);assert.equal(model.events[0].raceLap,2);assert.equal(model.events[0].type,'Virtual safety car');
 assert.equal(eventRaceLap(Date.parse(date(-1)),model.clock,model.start,model.end),null);
 assert.equal(eventType({flag:'RED'}),'Red flag / suspension');
});
test('pace ceiling preserves long laps in model and breaks filtered or missing paths',()=>{
 const row={laps:[{lap_number:1,lap_duration:90},{lap_number:2,lap_duration:2200},{lap_number:3,lap_duration:91},{lap_number:5,lap_duration:92}]};
 const points=pacePoints(row,180).map(p=>({...p,lap:p.lap_number}));
 assert.equal(points[1].value,null);assert.equal(pacePoints(row)[1].value,2200);
 assert.equal(linePath(points,x=>x,y=>y,'value'),'M1.00,90.00  M3.00,91.00 M5.00,92.00');
});
test('driver roster retains all entries even without lap records',()=>{
 const model=raceModel({},Array.from({length:22},(_,i)=>({driver_number:i+1})),[],[],[],[],[],[]);
 assert.equal(model.rows.length,22);assert.equal(model.maxLap,0);
});
