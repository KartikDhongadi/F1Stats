import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareWeather,weatherAt,weatherCard} from '../public/weather.js';
const date=n=>new Date(1700000000000+n*1000).toISOString();
const time=n=>Date.parse(date(n));
test('weather alignment sorts samples, drops bad timestamps, and never uses the future',()=>{
 const rows=prepareWeather([{date:date(60),air_temperature:30},{date:'invalid'},{date:date(0),air_temperature:20}]);
 assert.equal(rows.length,2);assert.equal(weatherAt(rows,time(-1)).reading,null);
 assert.equal(weatherAt(rows,time(59)).reading.air_temperature,20);
 assert.equal(weatherAt(rows,time(60)).reading.air_temperature,30);
 assert.equal(weatherAt(rows,null).reading,null);
});
test('weather older than three minutes is labelled and not shown as selected conditions',()=>{
 const rows=prepareWeather([{date:date(0),track_temperature:42,rainfall:1}]);
 assert.equal(weatherAt(rows,time(180)).stale,false);assert.equal(weatherAt(rows,time(181)).stale,true);
 const html=weatherCard(rows,{time:time(181),label:'Lap 4'});
 assert.match(html,/Stale reading/);assert.doesNotMatch(html,/42.0°C|Rain reported/);
});
test('zero values stay valid and unknown rainfall is not assumed dry',()=>{
 const rows=prepareWeather([{date:date(0),air_temperature:0,humidity:0,wind_speed:0,wind_direction:0,rainfall:0}]);
 const html=weatherCard(rows,{time:time(0),label:'Lap <1>'});
 assert.match(html,/0.0°C/);assert.match(html,/0.0 km\/h/);assert.match(html,/No rain reported/);assert.match(html,/Wind direction N/);assert.match(html,/Lap &lt;1&gt;/);
 assert.match(weatherCard(prepareWeather([{date:date(0),rainfall:null}]),{time:time(0),label:'Test'}),/Rain unknown/);
});
test('comparison laps select independent weather readings with correct wind units',()=>{
 const rows=prepareWeather([{date:date(0),wind_speed:2,rainfall:0},{date:date(60),wind_speed:4,rainfall:1}]);
 assert.match(weatherCard(rows,{time:time(20),label:'A'}),/7.2 km\/h/);
 assert.match(weatherCard(rows,{time:time(70),label:'B'}),/14.4 km\/h/);
 assert.match(weatherCard([],{time:time(70),label:'B'}),/No weather reading available/);
});
