import {isRace, raceModel, pacePoints, linePath} from './race.js';
import {lapTime} from './telemetry.js';
const esc=value=>String(value??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const tyreStyle={SOFT:['S','#f37e7e','#281113'],MEDIUM:['M','#efcf6f','#2b230f'],HARD:['H','#e0e5ed','#222933'],INTERMEDIATE:['I','#80c794','#152c1e'],WET:['W','#7cb4ee','#132a42'],UNKNOWN:['?','#9ca5b3','#202630']};
const palettes=['#c6f46b','#79bcff','#ffa17a','#b7a0ff','#70d6bf','#ed8bd0'];
const patterns=['','7 4','2 3','10 3 2 3'];
function timeText(seconds){return typeof seconds==='number'&&Number.isFinite(seconds)?seconds.toFixed(3)+' s':'Unavailable';}
export function createRaceView(root,{query,openLaps,onWeather=()=>{}}) {
  let model,visible=new Set(),selected,pinned,inspectLap=1,ceiling=180,eventFilter='key',observer,colors=new Map(),dashes=new Map(),warnings=[];
  const $=selector=>root.querySelector(selector);
  const rowFor=id=>model.rows.find(r=>r.driver.driver_number===Number(id));
  const findLap=key=>model.rows.flatMap(r=>r.laps).find(l=>l.key===key);
  const name=id=>rowFor(id)?.driver.full_name||`Driver ${id}`;
  const series=()=>model.rows.filter(r=>visible.has(r.driver.driver_number));
  const xTicks=()=>Array.from(new Set([1,...Array.from({length:5},(_,i)=>Math.round((model.maxLap-1)*(i+1)/5)+1)]));
  const frame=container=>({width:Math.max(600,Math.round(container.clientWidth)-36),height:320,left:54,right:20,top:20,bottom:44});
  const xScale=f=>lap=>f.left+(lap-1)/Math.max(1,model.maxLap-1)*(f.width-f.left-f.right);
  const noData=text=>`<div class="race-empty">${esc(text)}</div>`;
  function axes(f,x,y,ticks,label,format){
    return ticks.map(value=>`<line x1="${f.left}" x2="${f.width-f.right}" y1="${y(value)}" y2="${y(value)}" stroke="#2a3441"/><text x="${f.left-10}" y="${y(value)+4}" text-anchor="end">${format(value)}</text>`).join('')+xTicks().map(lap=>`<text x="${x(lap)}" y="${f.height-22}" text-anchor="${lap===1?'start':lap===model.maxLap?'end':'middle'}">${lap}</text>`).join('')+`<text x="${f.left}" y="12">${label}</text>`;
  }
  function readPositions(lap,notify=true){
    inspectLap=Math.max(1,Math.min(model.maxLap,Math.round(lap)));$('#race-progress').value=inspectLap;
    if(notify)onWeather({time:model.clock.find(p=>p.lap===inspectLap)?.time,label:`Race lap ${inspectLap} · running order`});
    $('#race-progress-label').textContent=`Race lap ${inspectLap}`;
    const rows=series().map(r=>({row:r,position:r.positionPoints.find(p=>p.lap===inspectLap)?.position})).sort((a,b)=>(a.position??Infinity)-(b.position??Infinity));
    $('.race-position-readout').innerHTML=rows.length?rows.map(({row:r,position})=>`<span><i style="background:${colors.get(r.driver.driver_number)}"></i>${esc(r.driver.name_acronym||r.driver.full_name)} <b>${position==null?'—':'P'+position}</b></span>`).join(''):'No drivers selected.';
    const line=$('.race-position-chart .race-cursor');if(line){const f=frame($('.race-position-chart'));const x=xScale(f)(inspectLap);line.setAttribute('x1',x);line.setAttribute('x2',x);}
  }
  function renderPositions(){
    const box=$('.race-position-chart');if(!box)return;
    const rows=series(),points=rows.flatMap(r=>r.positionPoints).filter(p=>p.position!=null);
    if(!points.length){box.innerHTML=noData(rows.length?'No position samples available for the selected drivers.':'Select drivers to display their positions.');readPositions(inspectLap,false);return;}
    const f=frame(box),x=xScale(f),maximum=Math.max(model.rows.length,...points.map(p=>p.position));
    const y=p=>f.top+(p-1)/Math.max(1,maximum-1)*(f.height-f.top-f.bottom);
    const ticks=[...new Set([1,...Array.from({length:Math.floor(maximum/5)},(_,i)=>(i+1)*5),maximum])];
    const critical=model.events.filter(e=>['Safety car','Virtual safety car','Red flag / suspension'].includes(e.type)&&e.raceLap!=null);
    box.innerHTML=`<svg viewBox="0 0 ${f.width} ${f.height}" width="${f.width}" height="${f.height}" role="img" aria-label="Driver positions at estimated leader lap crossings. Position one is at the top. Use the race lap slider to inspect values.">${axes(f,x,y,ticks,'Position',v=>'P'+v)}${critical.map(e=>`<line x1="${x(e.raceLap)}" x2="${x(e.raceLap)}" y1="${f.top}" y2="${f.height-f.bottom}" stroke="${e.type==='Red flag / suspension'?'#d28a80':'#b9a46d'}" stroke-dasharray="2 5" opacity=".5"><title>${esc(e.message)} · approximately race lap ${e.raceLap}</title></line>`).join('')}${rows.map(r=>`<path data-position-driver="${r.driver.driver_number}" d="${linePath(r.positionPoints,x,y,'position')}" fill="none" stroke="${colors.get(r.driver.driver_number)}" stroke-width="2" stroke-dasharray="${dashes.get(r.driver.driver_number)}"><title>${esc(r.driver.full_name)}</title></path>`).join('')}<line class="race-cursor" y1="${f.top}" y2="${f.height-f.bottom}" stroke="#e9edf4" opacity=".65"/></svg>`;
    box.querySelector('svg').onpointermove=event=>{const rect=event.currentTarget.getBoundingClientRect();const px=(event.clientX-rect.left)/rect.width*f.width;readPositions(1+(px-f.left)/(f.width-f.left-f.right)*Math.max(1,model.maxLap-1));};
    readPositions(inspectLap,false);
  }
  function chooseLap(lap,scroll=false){
    if(!lap)return;selected=lap.key;
    $('#race-detail-driver').value=String(lap.driver_number);fillLapOptions(lap.driver_number,lap.lap_number);renderDetail();
    root.querySelectorAll('.race-pace-point').forEach(point=>{point.setAttribute('r',point.dataset.lap===selected?'5':'3');});
    if(scroll)$('.race-lap-inspector').scrollIntoView({behavior:'smooth',block:'center'});
  }
  function renderPace(){
    const box=$('.race-pace-chart'),rows=series();
    const eligible=rows.flatMap(r=>pacePoints(r,ceiling).filter(p=>p.value!=null));
    const omitted=rows.flatMap(r=>r.laps).filter(l=>Number.isFinite(l.lap_duration)&&l.lap_duration>ceiling).length;
    $('.race-pace-note').textContent=`${omitted} timed laps above the selected ceiling are omitted from this chart. Choose “All lap times” to include stoppages and long laps. Gaps are not joined. Pit laps are included. Click a point to inspect it.`;
    if(!eligible.length){box.innerHTML=noData(rows.length?'No timed laps within this ceiling. Try All lap times.':'Select drivers to display lap times.');return;}
    const f=frame(box),x=xScale(f),values=eligible.map(l=>l.value),low=Math.min(...values),high=Math.max(...values),padding=Math.max(1,(high-low)*.08),min=Math.max(0,low-padding),max=high+padding;
    const y=t=>f.height-f.bottom-(t-min)/(max-min)*(f.height-f.top-f.bottom);
    const ticks=Array.from({length:5},(_,i)=>min+(max-min)*i/4);
    box.innerHTML=`<svg viewBox="0 0 ${f.width} ${f.height}" width="${f.width}" height="${f.height}" role="img" aria-label="Lap times by each driver's own lap number. Lower is faster. Use the driver and lap selectors below as a keyboard alternative.">${axes(f,x,y,ticks,'Seconds',v=>v.toFixed(max>300?0:1))}${rows.map(r=>{
      const points=pacePoints(r,ceiling).map(p=>({...p,lap:p.lap_number}));
      return `<path d="${linePath(points,x,y,'value')}" fill="none" stroke="${colors.get(r.driver.driver_number)}" stroke-dasharray="${dashes.get(r.driver.driver_number)}" stroke-width="1.7" opacity=".8"/>`+points.filter(p=>p.value!=null).map(p=>`<circle class="race-pace-point" data-lap="${p.key}" cx="${x(p.lap_number)}" cy="${y(p.value)}" r="${p.key===selected?5:3}" fill="${colors.get(r.driver.driver_number)}"><title>${esc(r.driver.full_name)} · Lap ${p.lap_number} · ${lapTime(p.lap_duration)}${p.is_pit_out_lap?' · pit out':''}</title></circle>`).join('');
    }).join('')}</svg>`;
    box.querySelectorAll('.race-pace-point').forEach(point=>{
      point.onclick=()=>chooseLap(findLap(point.dataset.lap),true);
      point.onpointerenter=()=>{const lap=findLap(point.dataset.lap);$('.race-pace-readout').textContent=`${name(lap.driver_number)} · Lap ${lap.lap_number} · ${lapTime(lap.lap_duration)}`;};
    });
  }
  function renderStrategy(){
    const box=$('.race-strategy');
    box.innerHTML=`<div class="race-strategy-inner"><div class="race-stint-axis"><span>ALL ${model.rows.length} DRIVERS</span><div>${xTicks().map(l=>`<span style="left:${(l-1)/Math.max(1,model.maxLap)*100}%">${l}</span>`).join('')}</div></div>${model.rows.map(r=>`<div class="race-stint-row"><div class="race-stint-name"><strong>${esc(r.driver.full_name)}</strong><small>${r.result?.dns?'DNS':r.result?.dnf?'DNF':r.result?.dsq?'DSQ':r.result?.position?'P'+r.result.position:'Unclassified'} · ${r.completed} laps</small></div><div class="race-stint-track">${r.stints.map((s,i)=>{
      const style=tyreStyle[s.compound]||tyreStyle.UNKNOWN;
      return `<button class="race-stint" data-stint-driver="${r.driver.driver_number}" data-stint-index="${i}" style="left:${(s.lap_start-1)/Math.max(1,model.maxLap)*100}%;width:${(s.end-s.lap_start+1)/Math.max(1,model.maxLap)*100}%;background:${style[1]};color:${style[2]}" aria-label="${esc(r.driver.full_name)}, ${esc(s.compound||'unknown')} tyres, laps ${s.lap_start} to ${s.end}${s.endInferred?', end inferred':''}" title="${esc(s.compound||'Unknown')} · Laps ${s.lap_start}–${s.end}${s.endInferred?' (end inferred)':''} · starting tyre age ${s.tyre_age_at_start??'?'} laps">${style[0]}</button>`;
    }).join('')}${r.pits.map((p,i)=>`<button class="race-pit" data-pit-driver="${r.driver.driver_number}" data-pit-index="${i}" style="left:${(p.lap_number-.5)/Math.max(1,model.maxLap)*100}%" aria-label="${esc(r.driver.full_name)}, pit lane on lap ${p.lap_number}" title="Lap ${p.lap_number}: stationary ${timeText(p.stop_duration)}, pit lane ${timeText(p.lane_duration??p.pit_duration)}">◆</button>`).join('')}${!r.stints.length?'<span class="race-stint-missing">No tyre stint records</span>':''}</div></div>`).join('')}</div>`;
    box.querySelectorAll('[data-stint-driver]').forEach(button=>button.onclick=()=>{
      const r=rowFor(button.dataset.stintDriver),s=r.stints[Number(button.dataset.stintIndex)];
      $('.race-strategy-readout').textContent=`${r.driver.full_name} · ${s.compound||'Unknown'} · laps ${s.lap_start}–${s.end}${s.endInferred?' (end inferred)':''} · tyre age at start: ${s.tyre_age_at_start??'unknown'} laps. Tyre changes do not necessarily indicate a pit stop.`;
      chooseLap(r.laps.find(l=>l.lap_number>=s.lap_start&&l.lap_number<=s.end));
    });
    box.querySelectorAll('[data-pit-driver]').forEach(button=>button.onclick=()=>{
      const r=rowFor(button.dataset.pitDriver),p=r.pits[Number(button.dataset.pitIndex)];
      $('.race-strategy-readout').textContent=`${r.driver.full_name} · Lap ${p.lap_number} · stationary stop: ${timeText(p.stop_duration)} · total pit-lane time: ${timeText(p.lane_duration??p.pit_duration)}.`;
      chooseLap(r.laps.find(l=>l.lap_number===p.lap_number));
    });
  }
  function fillLapOptions(driver,lapNumber){
    const row=rowFor(driver),select=$('#race-detail-lap');
    select.innerHTML=(row?.laps||[]).map(l=>`<option value="${l.key}">Lap ${l.lap_number} · ${lapTime(l.lap_duration)}</option>`).join('');
    const candidate=row?.laps.find(l=>l.lap_number===Number(lapNumber))||row?.laps[0];
    selected=candidate?.key;if(candidate)select.value=selected;
  }
  function renderDetail(){
    const box=$('.race-detail-content'),lap=findLap(selected);
    if(!lap){onWeather({time:NaN,label:'No lap selected'});box.innerHTML=noData('This driver has no recorded laps. Choose another driver.');return;}
    onWeather({time:lap.start,label:`${name(lap.driver_number)} · Lap ${lap.lap_number} start`});
    const row=rowFor(lap.driver_number),tyre=row.stints.find(s=>lap.lap_number>=s.lap_start&&lap.lap_number<=s.end),canOpen=lap.lap_duration>0&&Number.isFinite(lap.start);
    box.innerHTML=`<div class="race-detail-summary"><strong>${lapTime(lap.lap_duration)}</strong><span>${esc(name(lap.driver_number))} · Lap ${lap.lap_number} · ${esc(tyre?.compound||'Tyre unknown')}${lap.is_pit_out_lap?' · Pit out':''}</span></div><div class="quali-sectors">${[1,2,3].map(i=>`<div><span>SECTOR ${i}</span><strong>${timeText(lap['duration_sector_'+i])}</strong></div>`).join('')}</div><div class="quali-actions"><button class="primary" data-race-action="explore" ${canOpen?'':'disabled data-unavailable'}>Explore telemetry ↗</button><button class="secondary" data-race-action="pin" ${canOpen?'':'disabled data-unavailable'}>Set as comparison A</button><button class="secondary" data-race-action="compare" ${canOpen&&pinned&&pinned!==selected?'':'disabled data-unavailable'}>Compare A with this lap ↗</button></div><p class="quali-pinned">${pinned?`Comparison A: ${esc(name(findLap(pinned).driver_number))} · Lap ${findLap(pinned).lap_number}`:'Choose A, then select another lap or driver for comparison.'}</p>`;
    box.querySelector('[data-race-action="explore"]').onclick=()=>{if(canOpen)openLaps([lap]);};
    box.querySelector('[data-race-action="pin"]').onclick=()=>{if(canOpen){pinned=selected;renderDetail();}};
    box.querySelector('[data-race-action="compare"]').onclick=()=>{if(canOpen&&pinned&&pinned!==selected)openLaps([findLap(pinned),lap]);};
  }
  function renderEvents(){
    const events=model.events.filter(e=>eventFilter==='all'||['Safety car','Virtual safety car','Red flag / suspension','Session','Chequered flag'].includes(e.type));
    $('.race-events').innerHTML=events.length?`<table><thead><tr><th>UTC TIME</th><th>RACE LAP ≈</th><th>TYPE</th><th>RECORDED MESSAGE</th></tr></thead><tbody>${events.map(e=>`<tr><td>${new Date(e.time).toISOString().slice(11,19)}</td><td>${e.raceLap==null?'—':`<button class="race-event-jump" data-event="${e.id}" aria-label="Inspect race positions around lap ${e.raceLap}">≈ ${e.raceLap} ↗</button>`}</td><td>${esc(e.type)}</td><td>${esc(e.message)}</td></tr>`).join('')}</tbody></table>`:noData('No matching race-control events are available.');
    root.querySelectorAll('[data-event]').forEach(button=>button.onclick=()=>{readPositions(model.events.find(e=>e.id===Number(button.dataset.event)).raceLap);$('.race-position-panel').scrollIntoView({behavior:'smooth',block:'start'});});
  }
  function renderCharts(){if(!model||!$('.race-position-chart'))return;renderPositions();renderPace();}
  return {
    async load(session){
      observer?.disconnect();model=null;selected=null;pinned=null;visible=new Set();inspectLap=1;ceiling=180;eventFilter='key';warnings=[];
      if(!isRace(session)){root.innerHTML=noData('Choose a completed Grand Prix or sprint. This weekend has no saved race session yet.');return;}
      root.innerHTML='<div class="empty"><h2>Reading the race…</h2><p>Loading lap timings, positions, tyres and race-control records.</p></div>';
      const params={session_key:session.session_key};
      const drivers=await query('drivers',params),laps=await query('laps',params),results=await query('session_result',params);
      async function optional(endpoint,label){try{return await query(endpoint,params);}catch{warnings.push(`${label} unavailable. Saved files may need updating.`);return [];}}
      const positions=await optional('position','Position history'),stints=await optional('stints','Tyre stints'),pits=await optional('pit','Pit-lane records'),messages=await optional('race_control','Race-control messages');
      model=raceModel(session,drivers,laps,results,positions,stints,pits,messages);
      if(!model.rows.length||!model.maxLap){root.innerHTML=noData('No race laps are available in this data source yet.');return;}
      const teams=new Map();colors=new Map();dashes=new Map();
      model.rows.forEach((r,i)=>{const team=r.driver.team_name||r.driver.driver_number,occurrence=teams.get(team)||0;teams.set(team,occurrence+1);colors.set(r.driver.driver_number,/^[\da-f]{6}$/i.test(r.driver.team_colour||'')?'#'+r.driver.team_colour:palettes[i%palettes.length]);dashes.set(r.driver.driver_number,patterns[occurrence%patterns.length]);visible.add(r.driver.driver_number);});
      const winner=model.rows.find(r=>r.result?.position===1);
      root.innerHTML=`<div class="note">${esc(session.country_name)} · ${esc(session.session_name)} · ${model.rows.length} drivers · ${model.maxLap} laps${warnings.map(w=>'<br>'+esc(w)).join('')}</div><div class="race-summary"><div><small>WINNER</small><strong>${esc(winner?.driver.full_name||'Unavailable')}</strong></div><div><small>RECORDED PIT-LANE VISITS</small><strong>${warnings.some(w=>w.startsWith('Pit-lane'))?'Unavailable':pits.length}</strong></div><div><small>RACE CONTROL</small><strong>${model.events.length} messages</strong></div></div><div class="panel race-driver-panel"><div class="panel-heading"><div><span class="eyebrow">CHOOSE YOUR BATTLE</span><h2>Drivers on the charts</h2></div><div class="quali-actions"><button class="secondary" data-driver-set="all">All drivers</button><button class="secondary" data-driver-set="podium">First three classified</button><button class="secondary" data-driver-set="none">Clear</button></div></div><div class="race-driver-list">${model.rows.map(r=>`<label class="race-driver-choice"><input type="checkbox" data-race-driver="${r.driver.driver_number}" checked><span style="border-color:${colors.get(r.driver.driver_number)};border-bottom-style:${dashes.get(r.driver.driver_number)?'dashed':'solid'}">${esc(r.driver.name_acronym||r.driver.full_name)} #${r.driver.driver_number}</span></label>`).join('')}</div><p class="muted">All drivers are shown initially. Narrow the selection to make an individual battle easier to read. Tyre strategy always shows the full field.</p></div><div class="panel race-position-panel"><div class="panel-heading"><div><span class="eyebrow">THE RUNNING ORDER</span><h2>Position through the race</h2></div></div><p class="muted">Positions sampled at the first observed completion of each race lap. Dashed vertical lines mark safety-car and suspension messages. Final results can differ after penalties.</p><div class="race-position-chart race-chart"></div><div class="race-slider"><label for="race-progress" id="race-progress-label">Race lap 1</label><input id="race-progress" type="range" min="1" max="${model.maxLap}" value="1" aria-label="Inspect race lap"><span>Race lap →</span></div><div class="race-position-readout"></div></div><div class="panel race-pace-panel"><div class="panel-heading"><div><span class="eyebrow">THE RHYTHM OF THE RACE</span><h2>Lap-time progression</h2></div><label>LAP-TIME CEILING<select id="race-ceiling"><option value="180">180 seconds</option><option value="120">120 seconds</option><option value="Infinity">All lap times</option></select></label></div><p class="muted race-pace-note"></p><div class="race-pace-readout">Hover over a point to read its time, or use the driver and lap selectors below.</div><div class="race-pace-chart race-chart"></div><p class="muted race-axis-label">Driver’s own lap number → · Lower lap time is faster</p></div><div class="panel race-lap-inspector"><div class="panel-heading"><div><span class="eyebrow">LOOK CLOSER</span><h2>Inspect a race lap</h2></div><div class="quali-controls"><label>DRIVER<select id="race-detail-driver">${model.rows.map(r=>`<option value="${r.driver.driver_number}">${esc(r.driver.full_name)}</option>`).join('')}</select></label><label>LAP<select id="race-detail-lap"></select></label></div></div><div class="race-detail-content" aria-live="polite"></div></div><div class="panel race-strategy-panel"><div class="panel-heading"><div><span class="eyebrow">TYRES & PIT LANE</span><h2>Every driver’s strategy</h2></div></div><p class="muted">Bars show recorded tyre stints by each driver’s lap number. Diamonds mark recorded pit-lane visits. Click either for details.</p><div class="race-tyre-legend">${Object.entries(tyreStyle).map(([compound,style])=>`<span><i style="background:${style[1]}">${style[0]}</i>${compound}</span>`).join('')}<span>◆ Pit-lane visit</span></div><div class="race-strategy"></div><p class="race-strategy-readout" aria-live="polite">Select a stint or pit-lane marker. A tyre change during a red flag is not automatically counted as a pit stop.</p></div><div class="panel race-event-panel"><div class="panel-heading"><div><span class="eyebrow">WHAT CHANGED THE RACE</span><h2>Race-control timeline</h2></div><label>MESSAGES<select id="race-event-filter"><option value="key">Safety cars & session events</option><option value="all">All recorded messages</option></select></label></div><p class="muted">Times are UTC. Race-lap locations are estimated from timing crossings; select a lap to inspect the running order.</p><div class="race-events"></div></div><details class="method"><summary>How race data is aligned</summary><p>The position chart uses a common race-lap clock derived from the earliest observed completion time (or next-lap start) for each lap. It carries the latest recorded position forward to that instant, never interpolates positions and never fills from a future update. Missing crossing times break lines. Retired drivers stop at their last known completed-lap time; missing timing can make a line end early. Position changes are not automatically counted as overtakes.</p><p>Pace and tyre charts use each driver’s own lap number. A lapped driver’s lap 30 occurs at a different time from the leader’s lap 30. Race events appear alongside the position chart; they are not overlaid on those differently aligned pace and tyre charts. Pit-lane time and stationary stop time are distinct. Inferred stint ends are labelled in the detail. Long laps remain in the saved files and can be shown with All lap times.</p></details>`;
      root.querySelectorAll('[data-race-driver]').forEach(input=>input.onchange=()=>{const id=Number(input.dataset.raceDriver);input.checked?visible.add(id):visible.delete(id);renderCharts();});
      root.querySelectorAll('[data-driver-set]').forEach(button=>button.onclick=()=>{const mode=button.dataset.driverSet;visible=new Set((mode==='none'?[]:mode==='podium'?model.rows.filter(r=>r.result?.position>=1&&r.result?.position<=3):model.rows).map(r=>r.driver.driver_number));root.querySelectorAll('[data-race-driver]').forEach(input=>input.checked=visible.has(Number(input.dataset.raceDriver)));renderCharts();});
      $('#race-progress').oninput=e=>readPositions(Number(e.target.value));
      $('#race-ceiling').onchange=e=>{ceiling=Number(e.target.value);renderPace();};
      $('#race-detail-driver').onchange=e=>{fillLapOptions(Number(e.target.value));renderDetail();};
      $('#race-detail-lap').onchange=e=>{selected=e.target.value;renderDetail();};
      $('#race-event-filter').onchange=e=>{eventFilter=e.target.value;renderEvents();};
      fillLapOptions(model.rows[0].driver.driver_number);renderDetail();renderStrategy();renderEvents();renderCharts();readPositions(inspectLap);
      observer=new ResizeObserver(()=>renderCharts());observer.observe($('.race-position-panel'));
    }
  };
}
