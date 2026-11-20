import {lapChoices,lapLabel,fastestClean,createLapTools} from './lap-selection.js';
import {createRacePicker,createDriverPicker} from './selectors.js';
import {prepareWeather,renderWeather} from './weather.js';
import {createRaceView} from './race-ui.js';
import {isRace} from './race.js';
import {createQualifyingView} from './qualifying-ui.js';
import {isQualifying} from './qualifying.js';
import {createArchiveClient, eligibleSessions} from './data-store.js';
import {lapTime,prepareTelemetry,interpolate,deltaTrace,telemetryWindow} from './telemetry.js';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
let selectedYear=2026;
const seasonYears=Array.from({length:Math.max(2026,new Date().getFullYear())-2022},(_,i)=>Math.max(2026,new Date().getFullYear())-i);
let archive=createArchiveClient(fetch,selectedYear);
let archiveInfo;
const API='https://api.openf1.org/v1/';
const state={view:'season',table:'results',sessions:[],races:[],drivers:[],laps:[],results:[],standings:[],teams:[],traces:null,summary:null,standingsFor:null};
const esc=v=>String(v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const color=d=>/^[\da-f]{6}$/i.test(d?.team_colour||'')?'#'+d.team_colour:'#a7b1c1';
const driver=n=>state.drivers.find(d=>d.driver_number===Number(n));
const titleCase=text=>String(text).toLowerCase().replace(/(^|[\s'-])(\p{L})/gu,(m,a,b)=>a+b.toUpperCase());
const niceName=full=>{const parts=String(full||'').trim().split(/\s+/);return parts.length>1?parts[0]+' '+titleCase(parts.slice(1).join(' ')):full||'';};
const lastName=full=>{const parts=String(full||'').trim().split(/\s+/);return titleCase(parts.length>1?parts.slice(1).join(' '):parts[0]||'');};
const driverName=n=>niceName(driver(n)?.full_name)||`Driver ${n}`;
const stat=(title,value,caption)=>`<div class="stat"><small>${esc(title)}</small><strong>${esc(value)}</strong><span>${esc(caption)}</span></div>`;
const empty=(title,body)=>`<div class="empty"><span>⌁</span><h2>${esc(title)}</h2><p>${esc(body)}</p></div>`;
function status(message,error=false){$('#status').textContent=message;$('#status').classList.toggle('error',error);}
function setHeading(eyebrow,title,subtitle){$('#breadcrumb').textContent=eyebrow;$('#title').textContent=title;$('#subtitle').textContent=subtitle;}
function setRail(html){const rail=$('#rail-extra');rail.innerHTML=html||'';return html?rail:null;}
// --- Loading model -------------------------------------------------------------
// Every user action runs as a task with a level: 3 = season, 2 = weekend / session / view,
// 1 = detail (one lap's telemetry, a standings tab). A new action replaces the running
// task when its level is the same or higher; the replaced task stops at its next data
// read and never touches the page again. Lower-level controls stay disabled only while
// the data they depend on is being rebuilt.
let running=null,token=0;
class Superseded extends Error{constructor(){super('Replaced by a newer action.');this.superseded=true;}}
async function guard(promise){
 const mine=token;
 try{const value=await promise;if(mine!==token)throw new Superseded();return value;}
 catch(error){if(mine!==token&&!error?.superseded)throw new Superseded();throw error;}
}
const busyLevel=()=>running?.level??0;
let lastRequest=0,onlineTurn=Promise.resolve();
const memory=new Map();
async function rawApi(endpoint,params={}){
 if($('#source').value==='saved')return archive.query(endpoint,params);
 const key=endpoint+'?'+new URLSearchParams(params),cacheKey='apex-v1:'+key;
 const saved=memory.get(key);if(saved&&Date.now()-saved.at<3600000)return saved.data;
 try{const cached=JSON.parse(localStorage.getItem(cacheKey));if(cached&&Date.now()-cached.at<3600000){memory.set(key,cached);return cached.data;}}catch{}
 // Online requests take turns, so request spacing holds when a newer action replaces an
 // older one, and a replaced request that has not started yet never reaches OpenF1.
 const mine=token,turn=onlineTurn;let release;onlineTurn=new Promise(resolve=>release=resolve);
 await turn;
 try{
 if(mine!==token)throw new Superseded();
 const again=memory.get(key);if(again&&Date.now()-again.at<3600000)return again.data;
 await new Promise(resolve=>setTimeout(resolve,Math.max(0,1100-(Date.now()-lastRequest))));lastRequest=Date.now();
 let response;try{response=await fetch(API+key,{signal:AbortSignal.timeout(25000)});}catch{throw Error('Could not reach OpenF1. Check your internet connection and try Reload data. Your app runs locally, but real race data needs internet.');}
 if(response.status===404){const body=await response.json().catch(()=>null);if(body?.detail==='No results found.')return [];throw Error('The requested OpenF1 data endpoint was not found.');}
 if(!response.ok){if(response.status===429)throw Error('OpenF1’s free request limit was reached. Wait a minute, then try again. Cached data remains available.');if([401,403].includes(response.status))throw Error('OpenF1 is restricting access right now. Free historical access may be temporarily unavailable; try again later. No subscription is required by this app.');throw Error(`OpenF1 returned error ${response.status}. Please try again later.`);}
 const data=await response.json();if(!Array.isArray(data))throw Error('OpenF1 returned an unexpected response. Try again later.');
 memory.set(key,{at:Date.now(),data});try{localStorage.setItem(cacheKey,JSON.stringify({at:Date.now(),data}));}catch{}
 return data;
 }finally{release();}
}
const api=(endpoint,params)=>guard(rawApi(endpoint,params));
let weatherRows=[];
function showWeather(contexts){renderWeather($('#weather-summary'),weatherRows,contexts);}
async function loadWeather(){
 weatherRows=[];showWeather([{time:NaN,label:'Loading conditions…'}]);
 const session=state.sessions.find(s=>s.session_key===Number($('#session').value));
 try{weatherRows=prepareWeather(await api('weather',{session_key:$('#session').value}));}catch(e){if(e?.superseded)throw e;}
 showWeather([{time:Date.parse(session?.date_start),label:(session?.session_name||'Session')+' · scheduled start'}]);
}
function lapWeather(){
 showWeather((state.view==='compare'?['a','b']:['a']).map(suffix=>{
  const lap=state.laps.find(l=>l.driver_number===Number($('#driver-'+suffix).value)&&l.lap_number===Number($('#lap-'+suffix).value));
  return {time:Date.parse(lap?.date_start),label:lap?`${state.view==='compare'?suffix.toUpperCase()+' · ':''}${driverName(lap.driver_number)} · Lap ${lap.lap_number} start`:'Select a timed lap'};
 }));
}
const driverPickers=Object.fromEntries(['a','b'].map(suffix=>[suffix,createDriverPicker($('#driver-'+suffix),()=>state.drivers,'Choose driver '+suffix.toUpperCase())]));
const lapTools=Object.fromEntries(['a','b'].map(suffix=>[suffix,createLapTools($('#lap-'+suffix),{getLaps:()=>state.laps.filter(l=>l.driver_number===Number($('#driver-'+suffix).value))})]));
const racePicker=createRacePicker({years:seasonYears,onSeasonChange:year=>run(()=>changeSeason(year),3),loadSummary:()=>archive.summary(),onSelect:key=>run(async()=>{$('#race').value=key;await raceChanged();})});
let firstRaceSelection=true;
function refreshSelectionControls(){
 const weekend=state.races.find(s=>s.session_key===Number($('#race').value));
 $('#selected-weekend').textContent=weekend?`${weekend.country_name} · ${weekend.circuit_short_name}`:'No completed weekends';
 const seasonLoading=busyLevel()>=3;$('#change-race').disabled=seasonLoading;$('#browse-races').disabled=seasonLoading;
 const sessions=state.sessions.filter(s=>s.meeting_key===weekend?.meeting_key);
 $('#session-buttons').innerHTML=sessions.map(s=>`<button type="button" data-session="${s.session_key}" aria-pressed="${String(s.session_key)===$('#session').value}" ${seasonLoading?'disabled':''}>${esc(s.session_name==='Sprint Shootout'?'Sprint qualifying':s.session_name)}</button>`).join('');
 $$('[data-session]').forEach(button=>button.onclick=()=>run(async()=>{
  const session=sessions.find(s=>s.session_key===Number(button.dataset.session));
  if(![...$('#session').options].some(o=>o.value===button.dataset.session))$('#session').add(new Option(session.session_name,session.session_key));
  $('#session').value=button.dataset.session;
  if(state.view==='race-overview'&&isQualifying(session))await viewChanged('qualifying');
  else if(state.view==='qualifying'&&isRace(session))await viewChanged('race-overview');
  else await sessionChanged();
 }));
 Object.values(driverPickers).forEach(picker=>picker.sync());Object.values(lapTools).forEach(tools=>tools.sync());
}
async function sessionChanged(){state.laps=[];state.table='results';$$('[data-table]').forEach(b=>b.classList.toggle('active',b.dataset.table==='results'));if(state.view==='season')await loadRace();else if(state.view==='qualifying')await loadQualifying();else if(state.view==='race-overview')await loadRaceOverview();else await loadSession();}
$('#change-race').onclick=()=>racePicker.open($('#race').value);
$('#browse-races').onclick=()=>racePicker.open($('#race').value);
options($('#season-year'),seasonYears,year=>year,year=>year,selectedYear);
$('#season-year').onchange=()=>run(()=>changeSeason(Number($('#season-year').value)),3);
async function changeSeason(year){
 if(!seasonYears.includes(year))return;
 selectedYear=year;$('#season-year').value=String(year);archive=createArchiveClient(fetch,year);archiveInfo=null;
 await init();
}
function clearSeason(){
 state.sessions=[];state.races=[];state.drivers=[];state.laps=[];state.results=[];state.standings=[];state.teams=[];state.traces=null;state.summary=null;state.standingsFor=null;
 $('#race').innerHTML='';$('#session').innerHTML='';$('#session-buttons').innerHTML='';$('#stats').innerHTML='';$('#season-calendar').innerHTML='';$('#season-progress').innerHTML='';$('#season-progress-note').textContent='';
 for(const suffix of ['a','b']){$('#driver-'+suffix).innerHTML='';$('#lap-'+suffix).innerHTML='';}
 for(const target of ['#table','#qualifying','#race-overview','#telemetry'])$(target).innerHTML=empty('Loading season…',`Reading ${selectedYear} data.`);
 $('#season-badge').textContent=selectedYear+' SEASON';$('#sidebar-season').textContent=selectedYear;
 $('#data-info').textContent='';setRail('');racePicker.reset(selectedYear);refreshSelectionControls();
}
function unavailableSeason(message){
 racePicker.reset(selectedYear,message);status(message,true);$('#data-info').textContent=message;
 for(const target of ['#table','#qualifying','#race-overview','#telemetry'])$(target).innerHTML=empty(`${selectedYear} data unavailable`,message);
}

const openOverviewLaps=laps=>run(async()=>{
 if(laps.some(l=>!l))return;
 await viewChanged(laps.length===2?'compare':'explorer');
 for(const [i,lap] of laps.entries()){
  const suffix=i?'b':'a';$('#driver-'+suffix).value=String(lap.driver_number);updateLaps(suffix);$('#lap-'+suffix).value=String(lap.lap_number);
 }
 await loadTelemetry();
});
const qualifyingView=createQualifyingView($('#qualifying'),{query:api,openLaps:openOverviewLaps,onWeather:context=>showWeather([context]),setRail,setHeading});
const raceView=createRaceView($('#race-overview'),{query:api,openLaps:openOverviewLaps,onWeather:context=>showWeather([context]),setRail,setHeading,showResults:()=>run(()=>viewChanged('season'))});
async function loadRaceOverview(){sessionOptions();await loadWeather();status('Loading race overview…');await raceView.load(state.sessions.find(s=>s.session_key===Number($('#session').value)));status('Race overview · Switch between Story, Pace, Strategy and Events.');}
function sessionOptions(){
 const weekend=state.races.find(s=>s.session_key===Number($('#race').value));
 if(!weekend)return;
 const sessions=state.sessions.filter(s=>s.meeting_key===weekend.meeting_key&&(state.view!=='qualifying'||isQualifying(s))&&(state.view!=='race-overview'||isRace(s)));
 const previous=$('#session').value;
 const preferred=sessions.find(s=>s.session_name===(state.view==='race-overview'?'Race':'Qualifying'))?.session_key;
 options($('#session'),sessions,s=>s.session_key,s=>s.session_name,sessions.some(s=>String(s.session_key)===previous)?previous:preferred);
}
async function loadQualifying(){sessionOptions();await loadWeather();status('Loading qualifying overview for all drivers…');await qualifyingView.load(state.sessions.find(s=>s.session_key===Number($('#session').value)));status('Qualifying overview · Every session driver is shown · Select a lap for sector details or telemetry.');}
// Controls that work at any time, and controls that depend on a loaded session.
const ALWAYS_ENABLED='[data-view], #season-year, #picker-year, #source, #refresh, dialog [data-close]';
const DETAIL_CONTROLS='#driver-a, #driver-b, #lap-a, #lap-b, #load, [data-table]';
function applyBusy(){
 const level=busyLevel();
 $('#status').classList.toggle('loading',level>0);
 $$('button, select').forEach(e=>{e.disabled=level>=3?!e.matches(ALWAYS_ENABLED):level===2&&e.matches(DETAIL_CONTROLS);});
 $$('[data-unavailable]').forEach(e=>e.disabled=true);
 if(!state.races.length){$('#race').disabled=true;$('#load').disabled=true;}
 if(!state.laps.length)$('#load').disabled=true;
 const weekend=state.races.find(s=>s.session_key===Number($('#race').value));
 $$('[data-table=drivers],[data-table=teams]').forEach(b=>{const unavailable=weekend?.session_name!=='Race';b.disabled=b.disabled||unavailable;b.title=unavailable?'Championship standings are available after the Grand Prix.':'';});
 refreshSelectionControls();
}
function showFailure(error,job){
 status(error.message,true);
 const target=$(state.view==='season'?'#table':state.view==='qualifying'?'#qualifying':state.view==='race-overview'?'#race-overview':'#telemetry');
 target.innerHTML=`<div class="empty"><span>⌁</span><h2>Data could not be loaded</h2><p>${esc(error.message)}</p><p><button type="button" class="primary" data-retry>Try again ↻</button></p><p>Your season, race, session, driver and lap choices are kept.</p></div>`;
 target.querySelector('[data-retry]').onclick=()=>run(job.task,job.initial);
}
async function run(task,level=2){
 if(running&&level<running.level)return;
 const mine=++token,job=running={task,level,initial:level};
 applyBusy();
 try{await task();}
 catch(error){if(!error?.superseded&&mine===token)showFailure(error,job);}
 finally{if(running===job){running=null;applyBusy();}}
}
function options(el,rows,value,label,selected){el.innerHTML=rows.map(r=>`<option value="${esc(value(r))}">${esc(label(r))}</option>`).join('');if(selected!=null&&rows.some(r=>String(value(r))===String(selected)))el.value=selected;}
async function init(){
 clearSeason();weatherRows=[];showWeather([{time:NaN,label:'Loading session…'}]);status(`Loading completed ${selectedYear} sessions…`);
 if($('#source').value==='saved'){
  try{archiveInfo=await guard(archive.manifest());}
  catch(e){if(e?.superseded)throw e;unavailableSeason(`Saved ${selectedYear} data is not available. Close the race grid if open and choose OpenF1 online under Data & settings, or download it in VS Code: npm run update-data -- --year ${selectedYear} --all`);showWeather([{time:NaN,label:'No session selected'}]);return;}
  $('#data-info').textContent=`Saved ${selectedYear} archive · Last updated `+new Date(archiveInfo.updatedAt).toLocaleString()+' · '+archiveInfo.sessions.length+' sessions · No OpenF1 requests from this view';
 }else $('#data-info').textContent=`${selectedYear} · Online mode · Calls OpenF1 directly · One-hour browser cache`;
 state.sessions=eligibleSessions(await api('sessions',{year:selectedYear})).filter(s=>Number(s.year)===selectedYear);
 const weekends=new Map();for(const session of state.sessions){const previous=weekends.get(session.meeting_key);if(!previous||previous.session_name!=='Race')weekends.set(session.meeting_key,session);}state.races=[...weekends.values()];
 if(!state.races.length){unavailableSeason('No completed qualifying, sprint or race sessions are available for this season and data source. Choose another season or source.');showWeather([{time:NaN,label:'No session selected'}]);return;}
 options($('#race'),state.races,s=>s.session_key,s=>`${s.country_name} · ${s.circuit_short_name}`,state.races.at(-1).session_key);
 // The season summary feeds the calendar, the points chart and the race grid. It is optional.
 if($('#source').value==='saved'){try{state.summary=await guard(archive.summary());}catch(e){if(e?.superseded)throw e;state.summary=null;}}
 // The season is known from here on, so choosing a race or view may replace the default race load.
 if(running){running.level=2;applyBusy();}
 await guard(racePicker.load(state.races,state.sessions,$('#race').value));await raceChanged();
 if(firstRaceSelection){firstRaceSelection=false;racePicker.open($('#race').value);}
}
async function raceChanged(){const race=state.races.find(r=>r.session_key===Number($('#race').value));if(!race)return;state.traces=null;state.laps=[];$('#telemetry').innerHTML=empty('Find the story in a lap.','Choose a driver and a timed lap, then load telemetry to begin.');const sessions=state.sessions.filter(s=>s.meeting_key===race.meeting_key);options($('#session'),sessions,s=>s.session_key,s=>s.session_name,race.session_key);state.table='results';$$('[data-table]').forEach(b=>b.classList.toggle('active',b.dataset.table==='results'));if(state.view==='qualifying')await loadQualifying();else if(state.view==='race-overview')await loadRaceOverview();else{await loadRace();if(state.view!=='season')await loadSession();}}

// --- Season home -------------------------------------------------------------
async function loadRace(){
 await loadWeather();const key=$('#session').value;status('Loading session classification…');$('#table').innerHTML=empty('Loading race data…','Reading the selected classification.');$('#stats').innerHTML='';state.results=[];
 state.drivers=await api('drivers',{session_key:key});state.results=await api('session_result',{session_key:key});
 // Standings belong to the weekend's Grand Prix. Provider beta data: missing is shown as missing.
 const race=state.races.find(r=>r.session_key===Number($('#race').value));
 if(race?.session_name==='Race'&&state.standingsFor!==race.session_key){
  state.standings=[];state.teams=[];
  try{state.standings=await api('championship_drivers',{session_key:race.session_key});}catch(e){if(e?.superseded)throw e;}
  try{state.teams=await api('championship_teams',{session_key:race.session_key});}catch(e){if(e?.superseded)throw e;}
  state.standingsFor=race.session_key;
 }else if(race?.session_name!=='Race'){state.standings=[];state.teams=[];state.standingsFor=null;}
 renderSeason();status($('#source').value==='saved'?'Reading saved files · Source: OpenF1':'Historical data · OpenF1 · Responses cached for one hour.');
}
function summaryWeekends(){
 const weekends=state.summary?.weekends;
 if(Array.isArray(weekends)&&weekends.length)return [...weekends].sort((a,b)=>Date.parse(a.date_start)-Date.parse(b.date_start));
 return state.races.map(r=>({meeting_key:r.meeting_key,session_key:r.session_key,country_name:r.country_name,country_code:r.country_code,circuit_short_name:r.circuit_short_name,date_start:r.date_start,sessions:state.sessions.filter(s=>s.meeting_key===r.meeting_key),podium:null}));
}
function renderCalendar(){
 const weekends=summaryWeekends(),current=state.races.find(r=>r.session_key===Number($('#race').value));
 $('#calendar-heading').textContent=`${weekends.length} race weekend${weekends.length===1?'':'s'} saved`;
 $('#season-calendar').innerHTML=weekends.map((w,i)=>{
  const selected=w.meeting_key===current?.meeting_key,winner=w.podium?.[0]?.name;
  const sprint=(w.sessions||[]).some(s=>/Sprint/.test(s.session_name));
  return `<button type="button" class="calendar-card${selected?' selected':''}" data-calendar="${w.meeting_key}" aria-pressed="${selected}"><span class="cal-round">R${i+1} · ${esc(new Date(w.date_start).toLocaleDateString('en-GB',{day:'numeric',month:'short',timeZone:'UTC'}))}</span><strong>${esc(w.country_name)}</strong><span class="cal-circuit">${esc(w.circuit_short_name)}</span><span class="cal-winner">${winner?esc(lastName(winner)):w.podium?'No result saved':'&nbsp;'}</span>${sprint?'<span class="cal-badge">SPRINT</span>':''}</button>`;
 }).join('')||'<p class="small-note panel-pad">No weekends available.</p>';
 $$('[data-calendar]').forEach(b=>b.onclick=()=>{const race=state.races.find(r=>r.meeting_key===Number(b.dataset.calendar));if(race)run(async()=>{$('#race').value=String(race.session_key);await raceChanged();});});
 $('#season-calendar .selected')?.scrollIntoView({block:'nearest',inline:'center'});
}
function renderProgress(){
 const box=$('#season-progress'),note=$('#season-progress-note');
 const weekends=summaryWeekends().filter(w=>Array.isArray(w.standings)&&w.standings.length);
 if(!weekends.length){box.innerHTML=`<div class="race-empty">${$('#source').value==='saved'?'The points chart needs an updated season summary. In VS Code run: npm run bundle-data (no downloads).':'The points chart uses saved files. Choose Saved files under Data & settings to see it.'}</div>`;note.textContent='';return;}
 const current=state.races.find(r=>r.session_key===Number($('#race').value));
 const cutoff=current?Date.parse(current.date_start):Infinity,upto=weekends.filter(w=>Date.parse(w.date_start)<=cutoff);
 const ref=(upto.at(-1)||weekends.at(-1)).standings;
 const top=[...ref].filter(s=>typeof s.points==='number').sort((a,b)=>b.points-a.points).slice(0,6);
 const W=Math.max(600,box.clientWidth),H=320,L=44,R=92,T=16,B=36;
 const n=weekends.length,x=i=>L+(n<2?0:i/(n-1))*(W-L-R);
 const maxPts=Math.max(10,...weekends.flatMap(w=>w.standings.filter(s=>top.some(t=>t.driver_number===s.driver_number)).map(s=>s.points||0)));
 const step=maxPts>300?100:maxPts>120?50:maxPts>50?20:10,maxY=Math.ceil(maxPts/step)*step;
 const y=p=>H-B-p/maxY*(H-T-B);
 let svg='';
 for(let p=0;p<=maxY;p+=step)svg+=`<line x1="${L}" x2="${W-R}" y1="${y(p)}" y2="${y(p)}" stroke="#1f262f"/><text x="${L-8}" y="${y(p)+4}" text-anchor="end">${p}</text>`;
 weekends.forEach((w,i)=>{const code=w.country_code||String(w.country_name).slice(0,3).toUpperCase();svg+=`<text x="${x(i)}" y="${H-12}" text-anchor="middle" class="${w.meeting_key===current?.meeting_key?'is-current':''}">${esc(code)}</text>`;});
 const ci=weekends.findIndex(w=>w.meeting_key===current?.meeting_key);
 if(ci>=0)svg+=`<line x1="${x(ci)}" x2="${x(ci)}" y1="${T}" y2="${H-B}" stroke="#c6f46b" opacity=".35" stroke-dasharray="3 4"/>`;
 const labels=[];
 for(const [rank,t] of top.entries()){
  const pts=weekends.map((w,i)=>({i,p:w.standings.find(s=>s.driver_number===t.driver_number)?.points}));
  let d='',pen=false;for(const {i,p} of pts){if(typeof p!=='number'){pen=false;continue;}d+=(pen?'L':'M')+x(i).toFixed(1)+','+y(p).toFixed(1);pen=true;}
  const c=/^[\da-f]{6}$/i.test(t.team_colour||'')?'#'+t.team_colour:'#9ca5b3';
  svg+=`<path d="${d}" fill="none" stroke="${c}" stroke-width="${rank?2:3}" stroke-linejoin="round" ${rank&&top.slice(0,rank).some(o=>o.team_colour===t.team_colour)?'stroke-dasharray="6 4"':''}/>`;
  const lastPoint=[...pts].reverse().find(o=>typeof o.p==='number');
  if(lastPoint){svg+=`<circle cx="${x(lastPoint.i)}" cy="${y(lastPoint.p)}" r="4" fill="${c}"/>`;labels.push({y:y(lastPoint.p),x:x(lastPoint.i),text:`${t.acronym||lastName(t.name)} ${lastPoint.p}`,c});}
 }
 labels.sort((a,b)=>a.y-b.y);let prev=-Infinity;for(const l of labels){const ly=Math.max(l.y,prev+14);prev=ly;svg+=`<text x="${l.x+9}" y="${ly+4}" fill="${l.c}" class="end-label">${esc(l.text)}</text>`;}
 box.innerHTML=`<div class="chart-wrap"><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Championship points after each Grand Prix for the top six drivers">${svg}<line class="race-cursor" y1="${T}" y2="${H-B}" stroke="#e9edf4" opacity="0" stroke-dasharray="3 4"/></svg><div class="chart-tip" hidden></div></div>`;
 const el=box.querySelector('svg'),tipNode=box.querySelector('.chart-tip'),cursor=el.querySelector('.race-cursor');
 el.onpointermove=event=>{
  const rect=el.getBoundingClientRect(),px=(event.clientX-rect.left)/rect.width*W,i=Math.max(0,Math.min(n-1,Math.round((px-L)/Math.max(1,W-L-R)*(n-1))));
  const w=weekends[i],rows=top.map(t=>({t,p:w.standings.find(s=>s.driver_number===t.driver_number)?.points})).filter(o=>typeof o.p==='number').sort((a,b)=>b.p-a.p);
  cursor.setAttribute('x1',x(i));cursor.setAttribute('x2',x(i));cursor.setAttribute('opacity','.6');
  tipNode.hidden=false;tipNode.innerHTML=`<span class="tip-head">AFTER ${esc(String(w.country_name).toUpperCase())}</span>${rows.map(o=>`<div class="tip-row"><span style="color:${/^[\da-f]{6}$/i.test(o.t.team_colour||'')?'#'+o.t.team_colour:'#9ca5b3'}">${esc(o.t.acronym||lastName(o.t.name))}</span><strong>${o.p}</strong></div>`).join('')}`;
  const left=x(i)/W*100;tipNode.style.left=left<62?`calc(${left}% + 14px)`:'auto';tipNode.style.right=left<62?'auto':`calc(${100-left}% + 14px)`;tipNode.style.top='8%';
 };
 el.onpointerleave=()=>{tipNode.hidden=true;cursor.setAttribute('opacity','0');};
 note.textContent=`Top six in the standings after ${current?.country_name||'the latest race'}. Points after each Grand Prix in the saved season summary; provider championship data is beta.`;
}
function renderSeason(){
 const race=state.races.find(r=>r.session_key===Number($('#race').value));if(!race)return;
 const selected=state.sessions.find(s=>s.session_key===Number($('#session').value))||race;
 const qualifying=/Qualifying|Shootout/.test(selected.session_name);
 const sorted=[...state.results].sort((a,b)=>(a.position??999)-(b.position??999));const winner=sorted.find(r=>r.position===1);
 const standings=[...state.standings].sort((a,b)=>a.position_current-b.position_current),leader=standings[0],second=standings[1];
 const wins=new Map();for(const w of summaryWeekends()){const name=w.podium?.[0]?.name;if(name)wins.set(name,(wins.get(name)||0)+1);}
 const mostWins=[...wins.entries()].sort((a,b)=>b[1]-a[1])[0];
 const raced=summaryWeekends().filter(w=>w.podium?.length).length;
 $('#stats').innerHTML=stat('Championship leader',leader?driverName(leader.driver_number):'Unavailable',leader?`${leader.points_current} points${second?` · ${leader.points_current-second.points_current} ahead of ${lastName(driver(second.driver_number)?.full_name||'')}`:''}`:'Standings follow the Grand Prix')+stat('Most wins',mostWins?niceName(mostWins[0]):'Unavailable',mostWins?`${mostWins[1]} of ${raced} Grands Prix saved`:'Needs saved results')+stat('Different winners',wins.size||'—',raced?`Across ${raced} Grands Prix`:'Needs saved results')+stat(qualifying?'Session leader':'Winner · '+race.country_name,winner?driverName(winner.driver_number):'Unavailable',selected.session_name+' · '+new Date(selected.date_start).toLocaleDateString('en-GB',{day:'numeric',month:'short',timeZone:'UTC'}));
 setHeading(`THE ${selectedYear} SEASON · AFTER ${String(race.country_name).toUpperCase()}`,leader?`${lastName(driver(leader.driver_number)?.full_name||'Leader')} leads${second?` by ${leader.points_current-second.points_current} points`:''}`:`The ${selectedYear} season`,'Pick a weekend from the calendar to open its results, or follow the title fight across the year.');
 renderCalendar();renderProgress();
 $('#race-heading').textContent=race.country_name+' · '+(state.table==='results'?selected.session_name:state.table==='drivers'?'Driver standings':'Constructor standings');
 $('#table-context').textContent=state.table==='results'?'Final session classification. Qualifying times are shown in Q1 / Q2 / Q3 order when provided.':'Championship standings after the selected Grand Prix · arrows show places gained or lost at this race · OpenF1 beta data.';
 const move=(start,now)=>{const d=(start??now)-now;return d>0?`<span class="move up">▲${d}</span>`:d<0?`<span class="move down">▼${-d}</span>`:'<span class="move">–</span>';};
 let headings,rows;
 if(state.table==='results'){headings=['POS','DRIVER','TEAM','LAPS',...(qualifying?[]:['POINTS']),qualifying?(selected.session_name==='Qualifying'?'Q1 / Q2 / Q3':'SQ1 / SQ2 / SQ3'):'GAP / STATUS'];rows=sorted.map(r=>[r.position??'—',nameCell(r.driver_number),esc(driver(r.driver_number)?.team_name),esc(r.number_of_laps),...(qualifying?[]:[esc(r.points??'—')]),esc(r.dsq?'DSQ':r.dns?'DNS':r.dnf?'DNF':qualifying?(Array.isArray(r.duration)?r.duration.map(lapTime).join(' / '):lapTime(r.duration)):r.position===1?'Winner':typeof r.gap_to_leader==='number'?`+${r.gap_to_leader.toFixed(3)}s`:r.gap_to_leader)]);}
 else if(state.table==='drivers'){headings=['POS','','DRIVER','TEAM','THIS RACE','POINTS'];rows=standings.map(r=>[esc(r.position_current),move(r.position_start,r.position_current),nameCell(r.driver_number),esc(driver(r.driver_number)?.team_name),r.points_current>(r.points_start??r.points_current)?'+'+(r.points_current-r.points_start):'—',`<strong>${esc(r.points_current)}</strong>`]);}
 else{const teams=[...state.teams].sort((a,b)=>a.position_current-b.position_current),max=Math.max(1,...teams.map(t=>t.points_current||0));headings=['POS','','CONSTRUCTOR','THIS RACE','POINTS'];rows=teams.map(r=>{const c=color(state.drivers.find(d=>d.team_name===r.team_name));return [esc(r.position_current),move(r.position_start,r.position_current),`<span class="team-line" style="background:${c}"></span><span class="driver-name">${esc(r.team_name)}</span><span class="points-bar"><span style="width:${(r.points_current||0)/max*100}%;background:${c}"></span></span>`,r.points_current>(r.points_start??r.points_current)?'+'+(r.points_current-r.points_start):'—',`<strong>${esc(r.points_current)}</strong>`];});}
 $('#table').innerHTML=rows.length?`<table><thead><tr>${headings.map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`:empty('Data not available yet','No records are available for this selection in the selected data source.');
}
function nameCell(n){return `<span class="team-line" style="background:${color(driver(n))}"></span><span class="driver-name">${esc(driverName(n))}</span>`;}
async function tableChanged(type){
 state.table=type;$$('[data-table]').forEach(b=>b.classList.toggle('active',b.dataset.table===type));
 if(type!=='results'&&((type==='drivers'&&!state.standings.length)||(type==='teams'&&!state.teams.length))){status('Loading championship standings…');$('#table').innerHTML=empty('Loading standings…','Standings reflect the selected race, rather than a different point in the season.');if(type==='drivers')state.standings=await api('championship_drivers',{session_key:$('#race').value});else state.teams=await api('championship_teams',{session_key:$('#race').value});}
 renderSeason();status('Historical data · Standings are shown as of the selected race.');
}

// --- Views -------------------------------------------------------------------
const HEADINGS={season:['SEASON','The season, in focus.','Go beyond the finishing order. Discover the detail behind the drive.'],'race-overview':['RACE','How the race unfolded.','Follow the battles, the pace and the strategy across the entire field.'],qualifying:['QUALIFYING','The whole session. One story.','All drivers, every attempt, and the sectors behind their qualifying times.'],explorer:['TELEMETRY · ONE LAP','Every input. Every tenth.','Follow one driver through a lap, from full throttle to the braking zone.'],compare:['TELEMETRY · COMPARE LAPS','Where the difference lives.','Two laps on one shared distance axis. See where time is gained and lost.']};
function showView(view){
 state.view=view;
 $$('nav [data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view||(view==='compare'&&b.dataset.view==='explorer')));
 $$('.mode-switch [data-view]').forEach(b=>{b.classList.toggle('active',b.dataset.view===view);b.setAttribute('aria-pressed',String(b.dataset.view===view));});
 $('#season').hidden=view!=='season';$('#analysis').hidden=!['explorer','compare'].includes(view);$('#qualifying').hidden=view!=='qualifying';$('#race-overview').hidden=view!=='race-overview';$('#b-controls').hidden=view!=='compare';
 setHeading(...HEADINGS[view]);setRail('');
}
async function viewChanged(view){showView(view);if(!state.races.length)return;sessionOptions();if(view==='race-overview'){await loadRaceOverview();return;}if(view==='qualifying'){await loadQualifying();return;}if(view==='season'){await loadRace();}else{await loadSession();state.traces=null;$('#telemetry').innerHTML=empty('Your next insight starts here.','Choose a timed lap for each selected driver, then load telemetry.');}}
async function loadSession(){state.traces=null;state.laps=[];await loadWeather();$('#telemetry').innerHTML=empty('Select a lap to explore','Telemetry will appear after you load a lap.');status('Loading session drivers and timed laps…');const key=$('#session').value;state.drivers=await api('drivers',{session_key:key});const laps=await api('laps',{session_key:key});
 const warnings=[];
 async function context(endpoint){try{return await api(endpoint,{session_key:key});}catch(e){if(e?.superseded)throw e;warnings.push(endpoint);return [];}}
 const stints=await context('stints'),messages=await context('race_control');
 const session=state.sessions.find(s=>s.session_key===Number(key)),pits=isRace(session)?await context('pit'):[];
 state.laps=lapChoices(laps,stints,pits,messages);const available=state.drivers.filter(d=>state.laps.some(l=>l.driver_number===d.driver_number&&l.lap_duration>0&&l.date_start));for(const suffix of ['a','b']){options($('#driver-'+suffix),available,d=>d.driver_number,d=>niceName(d.full_name),suffix==='b'?available[1]?.driver_number:available[0]?.driver_number);updateLaps(suffix);}status(available.length?'Choose a lap, use Previous / Next, or jump to the fastest clean lap.'+(warnings.length?' Some lap context is unavailable: '+warnings.join(', ')+'. Clean-lap exclusions may be incomplete.':''):'No complete timed laps are available for this session.',!available.length);}
function updateLaps(suffix){driverPickers[suffix].sync();const laps=state.laps.filter(l=>l.driver_number===Number($('#driver-'+suffix).value)&&l.lap_duration>0&&l.date_start).sort((a,b)=>a.lap_number-b.lap_number);const fastest=fastestClean(laps);options($('#lap-'+suffix),laps,l=>l.lap_number,lapLabel,fastest?.lap_number??laps[0]?.lap_number);invalidate();}
function invalidate(){Object.values(lapTools).forEach(tools=>tools.sync());lapWeather();state.traces=null;setRail('');$('#telemetry').innerHTML=empty('Ready when you are.','Load telemetry to inspect the selected lap'+(state.view==='compare'?'s.':'.'));}
async function loadTelemetry(){Object.values(lapTools).forEach(tools=>tools.sync());lapWeather();state.traces=null;setRail('');$('#telemetry').innerHTML=empty('Reading the lap…','Reading saved driver telemetry and selecting the chosen lap.');const traces=[];for(const suffix of state.view==='compare'?['a','b']:['a']){const n=Number($('#driver-'+suffix).value),lap=state.laps.find(l=>l.driver_number===n&&l.lap_number===Number($('#lap-'+suffix).value));if(!lap)throw Error('No valid lap is selected. Choose a different driver or session.');status(`Loading ${driverName(n)} · lap ${lap.lap_number}…`);const rows=await api('car_data',telemetryWindow($('#session').value,n,lap));traces.push({...prepareTelemetry(rows,lap),name:driverName(n),lap});}state.traces=traces;renderTelemetry();status('Telemetry loaded · Hover over the chart, or focus it and use the arrow keys, to inspect every channel.');}

// --- Telemetry: one stacked chart on a shared distance axis --------------------
const CHANNELS={speed:{label:'Speed',unit:'km/h',h:190,min:0,digits:0},throttle:{label:'Throttle',unit:'%',h:80,min:0,max:100,digits:0},brake:{label:'Brake',unit:'on/off, not pressure',h:34,min:0,max:100,step:true},n_gear:{label:'Gear',unit:'',h:80,min:0,step:true,digits:0},acceleration:{label:'Estimated acceleration',unit:'m/s², from speed',h:100,digits:2},rpm:{label:'Engine speed',unit:'RPM',h:90,min:0,digits:0},drs:{label:'DRS',unit:'raw provider code',h:56,min:0,step:true,digits:0},delta:{label:'Estimated gap',unit:'B − A, s · above zero: A ahead',h:120,digits:3}};
let teleLayout=null,telePosition=.5,teleWidth=0;
function renderTelemetry(){
 if(!state.traces)return;
 const [a,b]=state.traces,advanced=$('#advanced').checked;
 const wanted=['speed','throttle','brake','n_gear',...(advanced?['acceleration','rpm','drs']:[]),...(b?['delta']:[])];
 const hasValues=key=>key==='delta'||[a,b].filter(Boolean).some(t=>t.points.some(p=>Number.isFinite(p[key])));
 const fields=wanted.filter(hasValues),missing=wanted.filter(k=>!hasValues(k));
 const topA=Math.max(...a.points.map(p=>p.speed)),topB=b?Math.max(...b.points.map(p=>p.speed)):null;
 const diff=b?b.duration-a.duration:null;
 $('#telemetry').innerHTML=`<div class="lap-cards"><div class="lap-card"><span class="lap-tag a-tag">A</span><div><strong>${esc(a.name)}</strong><small>Lap ${a.lap.lap_number}${a.lap.tyre?' · '+esc(titleCase(a.lap.tyre)):''} · solid line</small></div><strong class="lap-time">${lapTime(a.duration)}</strong></div>${b?`<div class="lap-card"><span class="lap-tag b-tag">B</span><div><strong>${esc(b.name)}</strong><small>Lap ${b.lap.lap_number}${b.lap.tyre?' · '+esc(titleCase(b.lap.tyre)):''} · dashed line</small></div><strong class="lap-time">${lapTime(b.duration)}</strong></div><div class="lap-card diff"><div><small>RECORDED DIFFERENCE</small><strong class="lap-time">${diff>=0?'+':'−'}${Math.abs(diff).toFixed(3)} s</strong><small>${Math.abs(diff)<.0005?'Identical lap times':diff>0?esc(a.name)+' quicker':esc(b.name)+' quicker'}</small></div></div>`:`<div class="lap-card diff"><div><small>TOP SPEED</small><strong class="lap-time">${Math.round(topA)} km/h</strong><small>Estimated distance ${(a.distance/1000).toFixed(2)} km · ${a.points.length} samples</small></div></div>`}</div>
<div class="panel"><div class="panel-heading"><div><span class="eyebrow">ONE SHARED DISTANCE AXIS</span><h2>${b?'Speed, inputs and the gap':'Speed and driver inputs'}</h2></div><div class="legend-row"><span><i class="lg lg-a"></i>A</span>${b?'<span><i class="lg lg-b"></i>B</span>':''}<span><i class="lg lg-brake"></i>A braking</span><span><i class="lg lg-sector"></i>Sector lines (A)</span></div></div><div class="tele-chart" id="tele-chart"></div>${missing.length?`<p class="small-note panel-foot">Not recorded for ${b?'these laps':'this lap'}: ${missing.map(k=>CHANNELS[k].label).join(', ')}.</p>`:''}</div>
<details class="method"><summary>How to read this data & limitations</summary><p>Source: OpenF1 historical car data, approximately 3.7 samples per second. Distance uses trapezoidal integration of speed. ${b?'Both laps are scaled to A’s integrated lap length, so racing-line differences and sampling can shift features. The gap is an estimate; the recorded difference above is official timing.':''}</p><p>Brake is on/off, not pressure. Acceleration uses a centred speed difference across up to five samples; it is longitudinal acceleration, not total g-force. Laps with fewer than 10 samples, boundary gaps over 1.5 seconds or internal gaps over 2 seconds are rejected. Smaller missing intervals are interpolated. Pit laps, traffic, tyres and weather are not controlled for. DRS codes are shown as recorded; 10, 12 and 14 usually mean open, other codes are not interpreted.</p><p>A: ${a.points.length} samples · largest gap ${a.maxGap.toFixed(2)} s${b?` / B: ${b.points.length} samples · largest gap ${b.maxGap.toFixed(2)} s`:''}. Top speed A ${Math.round(topA)} km/h${b?` / B ${Math.round(topB)} km/h`:''}.</p></details>`;
 teleLayout={fields,a,b};teleWidth=0;drawTelemetry();
 const sectorsA=[1,2,3].map(i=>a.lap['duration_sector_'+i]),sectorsB=b?[1,2,3].map(i=>b.lap['duration_sector_'+i]):null;
 const sectorHtml=b?`<section class="rail-card"><span class="eyebrow-muted">WHERE THE TIME GOES · RECORDED SECTORS</span>${sectorsA.map((t,i)=>{const u=sectorsB[i];if(!(t>0&&u>0))return `<div class="list-row"><span>S${i+1}</span><span>Not recorded</span></div>`;const d=u-t,w=Math.min(50,Math.abs(d)/.15*50);return `<div class="sector-diff"><span>S${i+1}</span><span class="diff-bar"><span class="${d>0?'to-a':'to-b'}" style="width:${w}%"></span></span><strong class="${d>0?'a':'b'}">${Math.abs(d)<.0005?'Level':`${d>0?'A':'B'} ${Math.abs(d).toFixed(3)}`}</strong></div>`;}).join('')}<p class="small-note">Lime: A faster in that sector. Blue: B faster.</p></section>`:'';
 setRail(`<section class="rail-card" id="tele-readout"></section>${sectorHtml}`);
 inspectTelemetry(telePosition);
}
function drawTelemetry(){
 const box=$('#tele-chart');if(!box||!teleLayout)return;
 const W=Math.max(600,Math.round(box.clientWidth));if(W===teleWidth)return;teleWidth=W;
 const {fields,a,b}=teleLayout,L=58,R=14,gap=30,x=p=>L+p*(W-L-R);
 const delta=b?deltaTrace(a,b):null;
 let y0=22,svg='';const bands=[];
 for(const key of fields){
  const ch=CHANNELS[key],h=ch.h;
  const sets=key==='delta'?[delta]:[a.points,...(b?[b.points]:[])];
  const values=sets.flat().map(p=>p[key]).filter(Number.isFinite);
  let min=ch.min??Math.min(...values),max=ch.max??Math.max(...values);
  if(key==='delta'){min=Math.min(min,0);max=Math.max(max,0);const pad=Math.max(.02,(max-min)*.1);min-=pad;max+=pad;}
  if(key==='n_gear')max=Math.max(8,max);
  if(!(max>min)){min-=1;max+=1;}
  const top=y0,y=v=>top+h-(v-min)/(max-min)*h;
  svg+=`<rect x="${L}" y="${top}" width="${W-L-R}" height="${h}" rx="4" fill="#0f1318"/><text class="band-title" x="${L}" y="${top-8}">${esc(ch.label.toUpperCase())}${ch.unit?` <tspan class="band-unit">· ${esc(ch.unit)}</tspan>`:''}</text>`;
  if(key==='speed'){let on=null;for(const p of [...a.points,{progress:1,brake:0}]){if(p.brake>=50&&on==null)on=p.progress;if(!(p.brake>=50)&&on!=null){svg+=`<rect x="${x(on)}" y="${top}" width="${Math.max(2,x(p.progress)-x(on))}" height="${h}" fill="#f37e7e" opacity=".13"/>`;on=null;}}}
  const ticks=key==='brake'?[]:key==='delta'?[min+(max-min)*.15,0,max-(max-min)*.15]:[min+(max-min)*.25,min+(max-min)*.5,min+(max-min)*.75];
  for(const t of ticks)svg+=`<line x1="${L}" x2="${W-R}" y1="${y(t)}" y2="${y(t)}" stroke="${key==='delta'&&t===0?'#4a5462':'#1d242d'}"/><text x="${L-8}" y="${y(t)+4}" text-anchor="end">${key==='delta'?(t>0?'+':'')+t.toFixed(2):Math.abs(t)>=100?Math.round(t):t.toFixed(key==='acceleration'?1:0)}</text>`;
  sets.forEach((points,index)=>{let pen=false,d='';for(const p of points){if(!Number.isFinite(p[key])){pen=false;continue;}const px=x(p.progress).toFixed(1),py=y(p[key]).toFixed(1);d+=pen?(ch.step?`H${px}V${py}`:`L${px},${py}`):`M${px},${py}`;pen=true;}svg+=`<path d="${d}" fill="none" stroke="${key==='delta'?'#e7ecf5':index?'#79bcff':'#c6f46b'}" stroke-width="${key==='delta'?2:index?1.7:2}" ${index&&key!=='delta'?'stroke-dasharray="6 4"':''} stroke-linejoin="round"/>`;});
  bands.push({key,top,h});y0+=h+gap;
 }
 const H=y0-gap+30;
 const sector=t=>{const p=a.points.find(q=>q.t>=t);return p?p.progress:null;};
 const s1=a.lap.duration_sector_1,s2=a.lap.duration_sector_2;
 [s1>0?sector(s1):null,s1>0&&s2>0?sector(s1+s2):null].forEach((p,i)=>{if(p!=null)svg+=`<line x1="${x(p)}" x2="${x(p)}" y1="10" y2="${H-26}" stroke="#4a5462" stroke-dasharray="2 4"/><text x="${x(p)+5}" y="12" class="band-unit">S${i+2}</text>`;});
 svg+=`<text x="${L+4}" y="12" class="band-unit">S1</text>`;
 for(let i=0;i<=4;i++)svg+=`<text x="${x(i/4)}" y="${H-8}" text-anchor="${i===0?'start':i===4?'end':'middle'}">${Math.round(a.distance*i/4)} m</text>`;
 svg+=`<line class="tele-cursor" x1="${x(.5)}" x2="${x(.5)}" y1="14" y2="${H-26}" stroke="#ffffff" opacity=".7"/>`;
 box.innerHTML=`<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" tabindex="0" role="img" aria-label="${esc(fields.map(k=>CHANNELS[k].label).join(', '))} by estimated lap distance. Use the left and right arrow keys, Home and End to move the cursor.">${svg}</svg>`;
 teleLayout.x=x;teleLayout.W=W;teleLayout.L=L;teleLayout.R=R;
 const el=box.querySelector('svg');
 el.addEventListener('pointermove',e=>{const r=el.getBoundingClientRect();inspectTelemetry(((e.clientX-r.left)/r.width*W-L)/(W-L-R));});
 el.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();inspectTelemetry(e.key==='Home'?0:e.key==='End'?1:telePosition+(e.key==='ArrowRight'?.01:-.01));}});
 inspectTelemetry(telePosition);
}
function inspectTelemetry(p){
 if(!teleLayout?.x)return;
 telePosition=Math.max(0,Math.min(1,p));
 const {fields,a,b,x}=teleLayout,line=$('#tele-chart .tele-cursor');
 if(line){line.setAttribute('x1',x(telePosition));line.setAttribute('x2',x(telePosition));}
 const out=$('#tele-readout');if(!out)return;
 const format=(key,v)=>v==null||!Number.isFinite(v)?'—':key==='brake'?(v>=50?'On':'Off'):key==='throttle'?Math.round(v)+'%':v.toFixed(CHANNELS[key].digits??1);
 const rows=fields.filter(k=>k!=='delta').map(k=>`<div class="readout-row"><span>${esc(CHANNELS[k].label)}</span><strong class="a">${format(k,interpolate(a.points,telePosition,k))}</strong>${b?`<strong class="b">${format(k,interpolate(b.points,telePosition,k))}</strong>`:''}</div>`).join('');
 const gap=b?interpolate(b.points,telePosition,'t')-interpolate(a.points,telePosition,'t'):null;
 out.innerHTML=`<span class="eyebrow-muted">AT THE CURSOR · ${Math.round(telePosition*a.distance)} m</span><div class="readout-row head"><span></span><span class="a">A</span>${b?'<span class="b">B</span>':''}</div>${rows}${b&&Number.isFinite(gap)?`<div class="readout-gap">Estimated gap <strong>${gap>=0?'+':'−'}${Math.abs(gap).toFixed(3)} s</strong><small>${Math.abs(gap)<.0005?'Level here':gap>0?'A ahead here':'B ahead here'}</small></div>`:''}<p class="small-note">Hover the chart, or focus it and use the arrow keys, Home and End.</p>`;
}
new ResizeObserver(()=>{if(state.traces&&!$('#analysis').hidden)drawTelemetry();}).observe($('#telemetry'));

// --- Wiring --------------------------------------------------------------------
document.addEventListener('click',event=>{const menu=$('#settings');if(menu.open&&!menu.contains(event.target))menu.open=false;});
$$('[data-view]').forEach(b=>b.addEventListener('click',()=>{if(busyLevel()>=3)showView(b.dataset.view);else run(()=>viewChanged(b.dataset.view),2);}));$$('[data-table]').forEach(b=>b.addEventListener('click',()=>run(()=>tableChanged(b.dataset.table),1)));$('#race').addEventListener('change',()=>run(raceChanged));$('#session').addEventListener('change',()=>run(sessionChanged));for(const s of ['a','b']){$('#driver-'+s).addEventListener('change',()=>run(async()=>updateLaps(s),1));$('#lap-'+s).addEventListener('change',()=>run(loadTelemetry,1));}$('#load').addEventListener('click',()=>run(loadTelemetry,1));$('#advanced').addEventListener('change',renderTelemetry);$('#source').addEventListener('change',()=>run(async()=>{archive.reset();state.laps=[];state.races=[];state.sessions=[];state.traces=null;$('#stats').innerHTML='';$('#race').innerHTML='<option>Loading…</option>';$('#data-info').textContent='';await init();},3));$('#refresh').addEventListener('click',()=>run(async()=>{archive.reset();memory.clear();try{Object.keys(localStorage).filter(k=>k.startsWith('apex-v1:')).forEach(k=>localStorage.removeItem(k));}catch{}state.laps=[];await init();},3));run(init,3);
