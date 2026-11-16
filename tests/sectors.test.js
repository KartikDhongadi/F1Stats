import test from 'node:test';
import assert from 'node:assert/strict';
import {sectorBests,sectorClass,idealLap} from '../public/sectors.js';
import {gapPoints,raceHighlights} from '../public/race.js';
const lap=(driver_number,lap_number,s1,s2,s3,extra={})=>({driver_number,lap_number,duration_sector_1:s1,duration_sector_2:s2,duration_sector_3:s3,...extra});
test('sector bests ignore deleted laps and missing sectors; ideal lap sums the three bests',()=>{
 const laps=[lap(1,1,20,30,25),lap(1,2,19,31,null),lap(1,3,18,29,24,{deleted:true}),lap(2,1,19.5,29.5,26)];
 const bests=sectorBests(laps);
 assert.deepEqual(bests.session,[19,29.5,25]);
 assert.equal(idealLap(bests,1),19+30+25);
 assert.equal(idealLap(bests,3),null);
 assert.equal(sectorClass(bests,laps[1],0),'purple');
 assert.equal(sectorClass(bests,laps[0],1),'green');
 assert.equal(sectorClass(bests,laps[3],2),'green');
 assert.equal(sectorClass(bests,laps[3],0),'green');
 assert.equal(sectorClass(bests,laps[0],0),'');
 assert.equal(sectorClass(bests,laps[1],2),'');
});
test('gap is measured at the driver own completion of each race lap and never interpolated',()=>{
 const clock=[{lap:1,time:100000},{lap:2,time:190000},{lap:3,time:null}];
 const row={completed:2,laps:[{lap_number:1,start:10000,end:103500},{lap_number:2,start:103500,end:null},{lap_number:3,start:197000,end:null}]};
 const points=gapPoints(row,clock,5);
 assert.equal(points[0].gap,3.5);assert.equal(points[0].value,3.5);
 assert.equal(points[1].gap,7);assert.equal(points[1].value,null);
 assert.equal(points[2].gap,null);
});
test('race highlights pick one record each and report ties for places gained',()=>{
 const row=(n,grid,position,laps,pits=[])=>({driver:{driver_number:n},grid,result:{position},laps,pits});
 const model={rows:[
  row(1,1,1,[{lap_number:1,lap_duration:80,st_speed:310},{lap_number:2,lap_duration:78,deleted:true}],[{lap_number:1,stop_duration:2.4}]),
  row(2,5,3,[{lap_number:1,lap_duration:79,st_speed:322}],[{lap_number:1,stop_duration:2.1}]),
  row(3,6,4,[{lap_number:1,lap_duration:81}])]};
 const h=raceHighlights(model);
 assert.equal(h.fastest.lap.lap_duration,79);
 assert.equal(h.trap.lap.st_speed,322);
 assert.equal(h.stop.pit.stop_duration,2.1);
 assert.equal(h.gain.places,2);assert.equal(h.gain.ties,1);assert.equal(h.gain.row.driver.driver_number,2);
});
