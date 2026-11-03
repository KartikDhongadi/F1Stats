import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareTelemetry,interpolate,deltaTrace,lapTime,telemetryWindow} from '../public/telemetry.js';
const start=Date.parse('2026-03-08T05:00:00Z');
function samples(duration,speed){return Array.from({length:duration*4+1},(_,i)=>({date:new Date(start+i*250).toISOString(),speed:typeof speed==='function'?speed(i/4):speed,brake:i<20?0:100}));}
function lap(duration){return{date_start:new Date(start).toISOString(),lap_duration:duration};}
test('constant speed integrates to distance in metres without acceleration',()=>{const t=prepareTelemetry(samples(60,180),lap(60));assert.equal(t.distance,3000);assert.equal(t.points[50].acceleration,0);assert.equal(t.points.at(-1).progress,1);});
test('speed ramp derives signed acceleration in metres per second squared',()=>{const t=prepareTelemetry(samples(20,t=>72+3.6*t),lap(20));assert.ok(Math.abs(t.points[30].acceleration-1)<1e-10);const braking=prepareTelemetry(samples(20,t=>180-7.2*t),lap(20));assert.ok(Math.abs(braking.points[30].acceleration+2)<1e-10);});
test('distance comparison uses B minus A sign and interpolates',()=>{const a=prepareTelemetry(samples(60,180),lap(60)),b=prepareTelemetry(samples(75,144),lap(75));assert.equal(a.distance,b.distance);assert.equal(deltaTrace(a,b).at(-1).delta,15);assert.equal(interpolate(a.points,.5,'t'),30);assert.equal(deltaTrace(a,a).every(p=>p.delta===0),true);});
test('rejects missing lap boundaries and large interior gaps',()=>{assert.throws(()=>prepareTelemetry(samples(60,180).slice(12),lap(60)),/incomplete/);assert.throws(()=>prepareTelemetry(samples(60,180).filter((_,i)=>i<30||i>45),lap(60)),/incomplete/);assert.throws(()=>prepareTelemetry([],lap(60)),/Too few/);});
test('sorts and deduplicates samples and does not interpolate brake status',()=>{const s=samples(10,100);const t=prepareTelemetry([...s,s[3]].reverse(),lap(10));assert.equal(t.points.length,s.length);assert.equal(interpolate(t.points,.49,'brake'),0);assert.equal(interpolate(t.points,.51,'brake'),100);});
test('lap formatting preserves milliseconds and missing values',()=>{assert.equal(lapTime(83.125),'1:23.125');assert.equal(lapTime(null),'—');assert.equal(lapTime(0),'—');});

test('telemetry query uses OpenF1 comparison keys and accurate lap boundaries',()=>{
 const params=new URLSearchParams(telemetryWindow(11404,1,lap(79.8)));
 assert.equal(params.get('date>'),new Date(start).toISOString());
 assert.equal(params.get('date<'),new Date(start+79800).toISOString());
 assert.equal(params.has('date>='),false);
 assert.equal(params.get('driver_number'),'1');
});
