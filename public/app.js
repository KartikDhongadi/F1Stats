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
const state={view:'season',table:'results',sessions:[],races:[],drivers:[],laps:[],results:[],standings:[],teams:[],traces:null};
const esc=v=>String(v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const color=d=>/^[\da-f]{6}$/i.test(d?.team_colour||'')?'#'+d.team_colour:'#a7b1c1';
const driver=n=>state.drivers.find(d=>d.driver_number===Number(n));
const driverName=n=>driver(n)?.full_name||`Driver ${n}`;
const stat=(title,value,caption)=>`<div class="stat"><small>${esc(title)}</small><strong>${esc(value)}</strong><span>${esc(caption)}</span></div>`;
const empty=(title,body)=>`<div class="empty"><span>⌁</span><h2>${esc(title)}</h2><p>${esc(body)}</p></div>`;
function status(message,error=false){$('#status').textContent=message;$('#status').classList.toggle('error',error);}
let lastRequest=0;
const memory=new Map();
async function api(endpoint,params={}){
 if($('#source').value==='saved')return archive.query(endpoint,params);
 const key=endpoint+'?'+new URLSearchParams(params),cacheKey='apex-v1:'+key;
 const saved=memory.get(key);if(saved&&Date.now()-saved.at<3600000)return saved.data;
 try{const cached=JSON.parse(localStorage.getItem(cacheKey));if(cached&&Date.now()-cached.at<3600000){memory.set(key,cached);return cached.data;}}catch{}
 await new Promise(resolve=>setTimeout(resolve,Math.max(0,1100-(Date.now()-lastRequest))));lastRequest=Date.now();
 let response;try{response=await fetch(API+key,{signal:AbortSignal.timeout(25000)});}catch{throw Error('Could not reach OpenF1. Check your internet connection and try Refresh data. Your app runs locally, but real race data needs internet.');}
 if(response.status===404){const body=await response.json().catch(()=>null);if(body?.detail==='No results found.')return [];throw Error('The requested OpenF1 data endpoint was not found.');}
 if(!response.ok){if(response.status===429)throw Error('OpenF1’s free request limit was reached. Wait a minute, then try again. Cached data remains available.');if([401,403].includes(response.status))throw Error('OpenF1 is restricting access right now. Free historical access may be temporarily unavailable; try again later. No subscription is required by this app.');throw Error(`OpenF1 returned error ${response.status}. Please try again later.`);}
 const data=await response.json();if(!Array.isArray(data))throw Error('OpenF1 returned an unexpected response. Try again later.');
 memory.set(key,{at:Date.now(),data});try{localStorage.setItem(cacheKey,JSON.stringify({at:Date.now(),data}));}catch{}
 return data;
}
let weatherRows=[];
function showWeather(contexts){renderWeather($('#weather-summary'),weatherRows,contexts);}
async function loadWeather(){
 weatherRows=[];showWeather([{time:NaN,label:'Loading conditions…'}]);
 const session=state.sessions.find(s=>s.session_key===Number($('#session').value));
 try{weatherRows=prepareWeather(await api('weather',{session_key:$('#session').value}));}catch{}
 showWeather([{time:Date.parse(session?.date_start),label:(session?.session_name||'Session')+' · scheduled start'}]);
}
function lapWeather(){
 showWeather((state.view==='compare'?['a','b']:['a']).map(suffix=>{
  const lap=state.laps.find(l=>l.driver_number===Number($('#driver-'+suffix).value)&&l.lap_number===Number($('#lap-'+suffix).value));
  return {time:Date.parse(lap?.date_start),label:lap?`${state.view==='compare'?suffix.toUpperCase()+' · ':''}${driverName(lap.driver_number)} · Lap ${lap.lap_number} start`:'Select a timed lap'};
 }));
}
const driverPickers=Object.fromEntries(['a','b'].map(suffix=>[suffix,createDriverPicker($('#driver-'+suffix),()=>state.drivers,'Choose driver '+suffix.toUpperCase())]));
const racePicker=createRacePicker({years:seasonYears,onSeasonChange:year=>run(()=>changeSeason(year)),query:(endpoint,params)=>archive.query(endpoint,params),onSelect:key=>run(async()=>{$('#race').value=key;await raceChanged();})});
let firstRaceSelection=true;
function refreshSelectionControls(){
 const weekend=state.races.find(s=>s.session_key===Number($('#race').value));
 $('#selected-weekend').textContent=weekend?`${weekend.country_name} · ${weekend.circuit_short_name}`:'No completed weekends';
 $('#change-race').disabled=busy;$('#browse-races').disabled=busy;
 const sessions=state.sessions.filter(s=>s.meeting_key===weekend?.meeting_key);
 $('#session-buttons').innerHTML=sessions.map(s=>`<button type="button" data-session="${s.session_key}" aria-pressed="${String(s.session_key)===$('#session').value}" ${busy?'disabled':''}>${esc(s.session_name==='Sprint Shootout'?'Sprint qualifying':s.session_name)}</button>`).join('');
 $$('[data-session]').forEach(button=>button.onclick=()=>run(async()=>{
  const session=sessions.find(s=>s.session_key===Number(button.dataset.session));
  if(![...$('#session').options].some(o=>o.value===button.dataset.session))$('#session').add(new Option(session.session_name,session.session_key));
  $('#session').value=button.dataset.session;
  if(state.view==='race-overview'&&isQualifying(session))await viewChanged('qualifying');
  else if(state.view==='qualifying'&&isRace(session))await viewChanged('race-overview');
  else await sessionChanged();
 }));
 Object.values(driverPickers).forEach(picker=>picker.sync());
}
async function sessionChanged(){state.laps=[];state.table='results';$$('[data-table]').forEach(b=>b.classList.toggle('active',b.dataset.table==='results'));if(state.view==='season')await loadRace();else if(state.view==='qualifying')await loadQualifying();else if(state.view==='race-overview')await loadRaceOverview();else await loadSession();}
$('#change-race').onclick=()=>racePicker.open($('#race').value);
$('#browse-races').onclick=()=>racePicker.open($('#race').value);
options($('#season-year'),seasonYears,year=>year,year=>year,selectedYear);
$('#season-year').onchange=()=>run(()=>changeSeason(Number($('#season-year').value)));
async function changeSeason(year){
 if(!seasonYears.includes(year))return;
 selectedYear=year;$('#season-year').value=String(year);archive=createArchiveClient(fetch,year);archiveInfo=null;
 await init();
}
function clearSeason(){
 state.sessions=[];state.races=[];state.drivers=[];state.laps=[];state.results=[];state.standings=[];state.teams=[];state.traces=null;
 $('#race').innerHTML='';$('#session').innerHTML='';$('#session-buttons').innerHTML='';$('#stats').innerHTML='';
 for(const suffix of ['a','b']){$('#driver-'+suffix).innerHTML='';$('#lap-'+suffix).innerHTML='';}
 for(const target of ['#table','#qualifying','#race-overview','#telemetry'])$(target).innerHTML=empty('Loading season…',`Reading ${selectedYear} data.`);
 $('#season-badge').textContent=selectedYear+' SEASON';$('#sidebar-season').textContent=selectedYear;
 $('#data-info').textContent='';racePicker.reset(selectedYear);refreshSelectionControls();
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
const qualifyingView=createQualifyingView($('#qualifying'),{query:api,openLaps:openOverviewLaps,onWeather:context=>showWeather([context])});
const raceView=createRaceView($('#race-overview'),{query:api,openLaps:openOverviewLaps,onWeather:context=>showWeather([context])});
async function loadRaceOverview(){sessionOptions();await loadWeather();status('Loading race overview…');await raceView.load(state.sessions.find(s=>s.session_key===Number($('#session').value)));status('Race overview · Select drivers, inspect laps, and explore telemetry.');}
function sessionOptions(){
 const weekend=state.races.find(s=>s.session_key===Number($('#race').value));
 if(!weekend)return;
 const sessions=state.sessions.filter(s=>s.meeting_key===weekend.meeting_key&&(state.view!=='qualifying'||isQualifying(s))&&(state.view!=='race-overview'||isRace(s)));
 const previous=$('#session').value;
 const preferred=sessions.find(s=>s.session_name===(state.view==='race-overview'?'Race':'Qualifying'))?.session_key;
 options($('#session'),sessions,s=>s.session_key,s=>s.session_name,sessions.some(s=>String(s.session_key)===previous)?previous:preferred);
}
async function loadQualifying(){sessionOptions();await loadWeather();status('Loading qualifying overview for all drivers…');await qualifyingView.load(state.sessions.find(s=>s.session_key===Number($('#session').value)));status('Qualifying overview · Every session driver is shown · Select a lap for sector details or telemetry.');}
let busy=false;
async function run(task){if(busy)return;busy=true;$$('button, select').forEach(e=>e.disabled=true);$('#advanced').disabled=true;try{await task();}catch(e){status(e.message,true);$(state.view==='season'?'#table':state.view==='qualifying'?'#qualifying':state.view==='race-overview'?'#race-overview':'#telemetry').innerHTML=empty('Data could not be loaded',e.message);}finally{busy=false;$$('button, select').forEach(e=>e.disabled=false);$('#advanced').disabled=false;$$('[data-unavailable]').forEach(e=>e.disabled=true);if(!state.races.length){$('#race').disabled=true;$('#load').disabled=true;}if(!state.laps.length)$('#load').disabled=true;const weekend=state.races.find(s=>s.session_key===Number($('#race').value));$$('[data-table=drivers],[data-table=teams]').forEach(b=>{b.disabled=weekend?.session_name!=='Race';b.title=b.disabled?'Championship standings are available after the Grand Prix.':'';});refreshSelectionControls();}}
function options(el,rows,value,label,selected){el.innerHTML=rows.map(r=>`<option value="${esc(value(r))}">${esc(label(r))}</option>`).join('');if(selected!=null&&rows.some(r=>String(value(r))===String(selected)))el.value=selected;}
function completed(s){return !s.is_cancelled&&Date.parse(s.date_end)<Date.now();}
async function init(){
 clearSeason();weatherRows=[];showWeather([{time:NaN,label:'Loading session…'}]);status(`Loading completed ${selectedYear} sessions…`);
 if($('#source').value==='saved'){
  try{archiveInfo=await archive.manifest();}
  catch{unavailableSeason(`Saved ${selectedYear} data is not available. Close the race grid if open and choose OpenF1 online under Data source, or download it in VS Code: npm run update-data -- --year ${selectedYear} --all`);showWeather([{time:NaN,label:'No session selected'}]);return;}
  $('#data-info').textContent=`Saved ${selectedYear} archive · Last updated `+new Date(archiveInfo.updatedAt).toLocaleString()+' · '+archiveInfo.sessions.length+' sessions · No OpenF1 requests from this view';
 }else $('#data-info').textContent=`${selectedYear} · Online mode · Calls OpenF1 directly · One-hour browser cache`;
 state.sessions=eligibleSessions(await api('sessions',{year:selectedYear})).filter(s=>Number(s.year)===selectedYear);
 const weekends=new Map();for(const session of state.sessions){const previous=weekends.get(session.meeting_key);if(!previous||previous.session_name!=='Race')weekends.set(session.meeting_key,session);}state.races=[...weekends.values()];
 if(!state.races.length){unavailableSeason('No completed qualifying, sprint or race sessions are available for this season and data source. Choose another season or source.');showWeather([{time:NaN,label:'No session selected'}]);return;}
 options($('#race'),state.races,s=>s.session_key,s=>`${s.country_name} · ${s.circuit_short_name}`,state.races.at(-1).session_key);
 await racePicker.load(state.races,state.sessions,$('#race').value);await raceChanged();
 if(firstRaceSelection){firstRaceSelection=false;racePicker.open($('#race').value);}
}
async function raceChanged(){const race=state.races.find(r=>r.session_key===Number($('#race').value));if(!race)return;state.traces=null;state.laps=[];$('#telemetry').innerHTML=empty('Find the story in a lap.','Choose a driver and a timed lap, then load telemetry to begin.');const sessions=state.sessions.filter(s=>s.meeting_key===race.meeting_key);options($('#session'),sessions,s=>s.session_key,s=>s.session_name,race.session_key);state.table='results';$$('[data-table]').forEach(b=>b.classList.toggle('active',b.dataset.table==='results'));if(state.view==='qualifying')await loadQualifying();else if(state.view==='race-overview')await loadRaceOverview();else{await loadRace();if(state.view!=='season')await loadSession();}}
async function loadRace(){await loadWeather();const key=$('#session').value;status('Loading session classification…');$('#table').innerHTML=empty('Loading race data…','Reading the selected classification.');$('#stats').innerHTML='';state.results=[];state.drivers=await api('drivers',{session_key:key});state.results=await api('session_result',{session_key:key});renderSeason();status($('#source').value==='saved'?'Reading saved files · Source: OpenF1':'Historical data · OpenF1 · Responses cached for one hour.');}
function renderSeason(){const race=state.races.find(r=>r.session_key===Number($('#race').value));if(!race)return;const selected=state.sessions.find(s=>s.session_key===Number($('#session').value))||race;const qualifying=/Qualifying|Shootout/.test(selected.session_name);const sorted=[...state.results].sort((a,b)=>(a.position??999)-(b.position??999));const winner=sorted.find(r=>r.position===1);$('#stats').innerHTML=stat('Available race weekends',state.races.length,selectedYear+' · selected data source')+stat(qualifying?'Session leader':'Race winner',winner?driverName(winner.driver_number):'Unavailable',selected.session_name)+stat('Session entries',state.results.length||'—',race.circuit_short_name)+stat('Session date',new Date(selected.date_start).toLocaleDateString('en-GB',{day:'numeric',month:'short',timeZone:'UTC'}),selectedYear+' · date in UTC');$('#race-heading').textContent=race.country_name+' · '+selected.session_name;$('#table-context').textContent=state.table==='results'?'Final session classification. Qualifying times are shown in Q1 / Q2 / Q3 order when provided.':'Championship standings after the selected Grand Prix · OpenF1 beta data.';
 let headings,rows;
 if(state.table==='results'){headings=['POS','DRIVER','TEAM','LAPS',qualifying?(selected.session_name==='Qualifying'?'Q1 / Q2 / Q3':'SQ1 / SQ2 / SQ3'):'GAP / STATUS'];rows=sorted.map(r=>[r.position??'—',nameCell(r.driver_number),esc(driver(r.driver_number)?.team_name),esc(r.number_of_laps),esc(r.dsq?'DSQ':r.dns?'DNS':r.dnf?'DNF':qualifying?(Array.isArray(r.duration)?r.duration.map(lapTime).join(' / '):lapTime(r.duration)):r.position===1?'Winner':typeof r.gap_to_leader==='number'?`+${r.gap_to_leader.toFixed(3)}s`:r.gap_to_leader)]);}
 else if(state.table==='drivers'){headings=['POS','DRIVER','TEAM','POINTS'];rows=[...state.standings].sort((a,b)=>a.position_current-b.position_current).map(r=>[esc(r.position_current),nameCell(r.driver_number),esc(driver(r.driver_number)?.team_name),esc(r.points_current)]);}
 else{headings=['POS','CONSTRUCTOR','POINTS'];rows=[...state.teams].sort((a,b)=>a.position_current-b.position_current).map(r=>[esc(r.position_current),esc(r.team_name),esc(r.points_current)]);}
 $('#table').innerHTML=rows.length?`<table><thead><tr>${headings.map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`:empty('Data not available yet','No records are available for this selection in the selected data source.');}
function nameCell(n){return `<span class="team-line" style="background:${color(driver(n))}"></span><span class="driver-name">${esc(driverName(n))}</span>`;}
async function tableChanged(type){state.table=type;$$('[data-table]').forEach(b=>b.classList.toggle('active',b.dataset.table===type));if(type!=='results'){status('Loading championship standings…');$('#table').innerHTML=empty('Loading standings…','Standings reflect the selected race, rather than a different point in the season.');if(type==='drivers')state.standings=await api('championship_drivers',{session_key:$('#race').value});else state.teams=await api('championship_teams',{session_key:$('#race').value});}renderSeason();status('Historical data · Standings are shown as of the selected race.');}
async function viewChanged(view){state.view=view;$$('nav [data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));$('#season').hidden=view!=='season';$('#analysis').hidden=!['explorer','compare'].includes(view);$('#qualifying').hidden=view!=='qualifying';$('#race-overview').hidden=view!=='race-overview';$('.mode').hidden=['qualifying','race-overview'].includes(view);$('#session-wrap').hidden=false;$('#b-controls').hidden=view!=='compare';const names={'race-overview':['How the race unfolded.','Follow the battles, the pace, and the strategy across the entire field.'],qualifying:['The whole session. One story.','All drivers, every attempt, and the sectors behind their qualifying times.'],season:['The season, in focus.','Go beyond the finishing order. Discover the detail behind the drive.'],explorer:['Every input. Every tenth.','Follow one driver through a lap, from full throttle to the braking zone.'],compare:['Where the difference lives.','Two laps. One shared distance axis. See where time is gained and lost.']};$('#title').textContent=names[view][0];$('#subtitle').textContent=names[view][1];$('#breadcrumb').textContent={'race-overview':'RACE OVERVIEW',qualifying:'QUALIFYING OVERVIEW',season:'SEASON OVERVIEW',explorer:'DRIVER EXPLORER',compare:'COMPARE LAPS'}[view];if(!state.races.length)return;sessionOptions();if(view==='race-overview'){await loadRaceOverview();return;}if(view==='qualifying'){await loadQualifying();return;}if(view==='season'){await loadRace();}else{await loadSession();state.traces=null;$('#telemetry').innerHTML=empty('Your next insight starts here.','Choose a timed lap for each selected driver, then load telemetry.');}}
async function loadSession(){state.traces=null;state.laps=[];await loadWeather();$('#telemetry').innerHTML=empty('Select a lap to explore','Telemetry will appear after you load a lap.');status('Loading session drivers and timed laps…');const key=$('#session').value;state.drivers=await api('drivers',{session_key:key});state.laps=await api('laps',{session_key:key});const available=state.drivers.filter(d=>state.laps.some(l=>l.driver_number===d.driver_number&&l.lap_duration>0&&l.date_start));for(const suffix of ['a','b']){options($('#driver-'+suffix),available,d=>d.driver_number,d=>d.full_name,suffix==='b'?available[1]?.driver_number:available[0]?.driver_number);updateLaps(suffix);}status(available.length?'Choose a driver and lap. The fastest available non-pit-out lap is selected by default.':'No complete timed laps are available for this session.',!available.length);}
function updateLaps(suffix){driverPickers[suffix].sync();const laps=state.laps.filter(l=>l.driver_number===Number($('#driver-'+suffix).value)&&l.lap_duration>0&&l.date_start).sort((a,b)=>a.lap_number-b.lap_number);const clean=laps.filter(l=>!l.is_pit_out_lap);const fastest=[...(clean.length?clean:laps)].sort((a,b)=>a.lap_duration-b.lap_duration)[0];options($('#lap-'+suffix),laps,l=>l.lap_number,l=>`Lap ${l.lap_number} · ${lapTime(l.lap_duration)}${l.is_pit_out_lap?' · pit out':''}`,fastest?.lap_number);invalidate();}
function invalidate(){lapWeather();state.traces=null;$('#telemetry').innerHTML=empty('Ready when you are.','Load telemetry to inspect the selected lap'+(state.view==='compare'?'s.':'.'));}
async function loadTelemetry(){lapWeather();state.traces=null;$('#telemetry').innerHTML=empty('Reading the lap…','Reading saved driver telemetry and selecting the chosen lap.');const traces=[];for(const suffix of state.view==='compare'?['a','b']:['a']){const n=Number($('#driver-'+suffix).value),lap=state.laps.find(l=>l.driver_number===n&&l.lap_number===Number($('#lap-'+suffix).value));if(!lap)throw Error('No valid lap is selected. Choose a different driver or session.');status(`Loading ${driverName(n)} · lap ${lap.lap_number}…`);const rows=await api('car_data',telemetryWindow($('#session').value,n,lap));traces.push({...prepareTelemetry(rows,lap),name:driverName(n),lap});}state.traces=traces;renderTelemetry();status('Telemetry loaded · Hover over a chart, or focus it and use the arrow keys, to inspect all traces.');}
const metrics={speed:['Speed','km/h','How fast the car is travelling. Peaks show the straights; dips show the corners.'],throttle:['Throttle','%','A higher value indicates more throttle input.'],brake:['Brake pedal','on/off','100 means the brake is pressed; 0 means released. This is not brake pressure.'],acceleration:['Estimated acceleration','m/s²','Positive means speeding up; negative means slowing down. Estimated from speed changes.'],n_gear:['Gear','','The selected gear.'],rpm:['Engine speed','RPM','Engine revolutions per minute.'],drs:['DRS status','code','Raw provider code: 10, 12 and 14 mean open; 0 and 1 mean off. Other codes are not inferred.'],delta:['Estimated time difference','s','B minus A: positive means A reaches this distance sooner; negative means B reaches it sooner.']};
function renderTelemetry(){if(!state.traces)return;const [a,b]=state.traces,advanced=$('#advanced').checked;const maxSpeed=Math.max(...a.points.map(p=>p.speed));const fields=['speed','throttle','brake',...(advanced?['acceleration','n_gear','rpm','drs']:[]),...(b?['delta']:[])];$('#telemetry').innerHTML=`<div class="note"><span class="a">A — ${esc(a.name)} · Lap ${a.lap.lap_number}</span>${b?` &nbsp; / &nbsp; <span class="b">B — ${esc(b.name)} · Lap ${b.lap.lap_number}</span>`:''}<br>Distance is estimated from speed. ${b?'Each trace is normalized to A’s integrated lap length; the delta is approximate, not official timing.':'Acceleration is an estimate, not a measured sensor channel.'}</div><div class="stats">${stat('Lap time · A',lapTime(a.duration),'Recorded session timing')}${stat('Top speed · A',Math.round(maxSpeed)+' km/h','Maximum sampled speed')}${b?stat('Lap time · B',lapTime(b.duration),'Recorded session timing'):stat('Estimated distance',(a.distance/1000).toFixed(2)+' km','Integrated from speed samples')}${b?stat('Official lap difference',(b.duration-a.duration>=0?'+':'')+(b.duration-a.duration).toFixed(3)+' s','B − A · positive means A is quicker'):stat('Telemetry samples',a.points.length,'Brake on/off · not brake pressure')}</div>${fields.map(key=>`<div class="chart-card"><div class="chart-top"><h3>${metrics[key][0]} <span style="color:var(--muted)">${metrics[key][1]}</span></h3><span class="readout" id="read-${key}">Move over the chart to inspect</span></div><svg id="chart-${key}" viewBox="0 0 1000 180" preserveAspectRatio="none" tabindex="0" role="img" aria-label="${metrics[key][0]} by estimated lap distance. Use left and right arrow keys to inspect."></svg><p class="chart-description">${metrics[key][2]}</p></div>`).join('')}<details class="method"><summary>How to read this data & limitations</summary><p>Source: OpenF1 historical car data, approximately 3.7 samples per second. Distance uses trapezoidal integration of speed. Comparison aligns normalized integrated distance, not surveyed track position, so racing-line differences and sampling can shift features. The comparison endpoint is approximate; use the recorded lap difference above for the official lap-time difference.</p><p>Acceleration uses a centered speed difference across up to five samples. It is longitudinal acceleration, not total g-force. Laps with fewer than 10 samples, boundary gaps over 1.5 seconds or internal gaps over 2 seconds are rejected. Smaller missing intervals are interpolated. Pit laps, traffic, tyres and weather can affect comparisons; this view does not control for those factors. DRS channels may be absent or inapplicable in some seasons.</p><p>A: ${a.points.length} samples · largest gap ${a.maxGap.toFixed(2)}s${b?` / B: ${b.points.length} samples · largest gap ${b.maxGap.toFixed(2)}s`:''}. All charts use the same estimated distance cursor.</p></details>`;
 for(const key of fields)drawChart(key,a,b);
 let position=.5;function inspect(p){position=Math.max(0,Math.min(1,p));for(const key of fields){const svg=$('#chart-'+key),line=svg.querySelector('.cursor');line.setAttribute('x1',45+position*940);line.setAttribute('x2',45+position*940);const format=v=>v==null?'unavailable':key==='brake'?(v>=50?'ON':'OFF'):v.toFixed(['speed','rpm','n_gear','drs'].includes(key)?0:2);const va=key==='delta'?interpolate(b.points,position,'t')-interpolate(a.points,position,'t'):interpolate(a.points,position,key);$('#read-'+key).textContent=`${Math.round(position*a.distance)} m · ${key==='delta'?'B − A':'A'}: ${format(va)}${b&&key!=='delta'?' / B: '+format(interpolate(b.points,position,key)):''}`;}}
 for(const key of fields){const svg=$('#chart-'+key);svg.addEventListener('pointermove',e=>{const r=svg.getBoundingClientRect();inspect(((e.clientX-r.left)/r.width*1000-45)/940);});svg.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();inspect(e.key==='Home'?0:e.key==='End'?1:position+(e.key==='ArrowRight'?.01:-.01));}});}inspect(.5);
}
function drawChart(key,a,b){const svg=$('#chart-'+key),sets=key==='delta'?[deltaTrace(a,b)]:[a.points,...(b?[b.points]:[])];const values=sets.flat().map(p=>p[key]).filter(Number.isFinite);if(!values.length){svg.innerHTML='<text x="50" y="80" fill="#9199a8" font-size="14">This channel is unavailable for this lap.</text><line class="cursor"/>';return;}let min=Math.min(...values),max=Math.max(...values);if(['speed','throttle','brake','rpm','n_gear','drs'].includes(key))min=0;if(['throttle','brake'].includes(key))max=100;if(key==='delta'){min=Math.min(min,0);max=Math.max(max,0);}if(min===max){min-=1;max+=1;}const y=v=>145-(v-min)/(max-min)*125;let content='';for(let i=0;i<4;i++){const v=min+(max-min)*i/3;content+=`<line x1="45" x2="985" y1="${y(v)}" y2="${y(v)}" stroke="#29303a" stroke-dasharray="3 5"/><text x="0" y="${y(v)+4}" fill="#7c8798" font-size="10">${Math.abs(v)>100?Math.round(v):v.toFixed(1)}</text>`;}for(let i=0;i<=4;i++)content+=`<text x="${45+i*235}" y="173" text-anchor="${i===4?'end':'start'}" fill="#7c8798" font-size="10">${Math.round(a.distance*i/4)} m</text>`;sets.forEach((points,index)=>{let pen=false;const path=points.map(p=>{if(!Number.isFinite(p[key])){pen=false;return '';}const x=(45+p.progress*940).toFixed(2),yp=y(p[key]).toFixed(2);const segment=pen?(['brake','n_gear','drs'].includes(key)?`H${x}V${yp}`:`L${x},${yp}`):`M${x},${yp}`;pen=true;return segment;}).join(' ');content+=`<path d="${path}" fill="none" stroke="${index?'#79bcff':'#c6f46b'}" stroke-width="2" ${index?'stroke-dasharray="6 4"':''} vector-effect="non-scaling-stroke"/>`;});content+='<line class="cursor" x1="45" x2="45" y1="15" y2="145" stroke="#e7ecf5" opacity=".5"/>';svg.innerHTML=content;}
$$('[data-view]').forEach(b=>b.addEventListener('click',()=>run(()=>viewChanged(b.dataset.view))));$$('[data-table]').forEach(b=>b.addEventListener('click',()=>run(()=>tableChanged(b.dataset.table))));$('#race').addEventListener('change',()=>run(raceChanged));$('#session').addEventListener('change',()=>run(sessionChanged));for(const s of ['a','b']){$('#driver-'+s).addEventListener('change',()=>updateLaps(s));$('#lap-'+s).addEventListener('change',invalidate);}$('#load').addEventListener('click',()=>run(loadTelemetry));$('#advanced').addEventListener('change',renderTelemetry);$('#source').addEventListener('change',()=>run(async()=>{archive.reset();state.laps=[];state.races=[];state.sessions=[];state.traces=null;$('#stats').innerHTML='';$('#race').innerHTML='<option>Loading…</option>';$('#data-info').textContent='';await init();}));$('#refresh').addEventListener('click',()=>run(async()=>{archive.reset();memory.clear();try{Object.keys(localStorage).filter(k=>k.startsWith('apex-v1:')).forEach(k=>localStorage.removeItem(k));}catch{}state.laps=[];await init();}));run(init);
