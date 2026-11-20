import {qualifyingModel, isQualifying} from './qualifying.js';
import {lapTime} from './telemetry.js';
import {sectorBests, sectorBoxes, idealLap} from './sectors.js';
const esc = value => String(value ?? '—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const seconds = value => typeof value === 'number' && value > 0 ? value.toFixed(3)+' s' : '—';
const titleCase = text => String(text).toLowerCase().replace(/(^|[\s'-])(\p{L})/gu,(m,a,b)=>a+b.toUpperCase());
const surname = driver => {const parts=String(driver?.full_name||'').trim().split(/\s+/);return parts.length>1?titleCase(parts.slice(1).join(' ')):titleCase(parts[0]||`Car ${driver?.driver_number}`);};
const fullName = driver => {const parts=String(driver?.full_name||'').trim().split(/\s+/);return parts.length>1?parts[0]+' '+titleCase(parts.slice(1).join(' ')):driver?.full_name||`Driver ${driver?.driver_number}`;};
const colour = driver => /^[\da-f]{6}$/i.test(driver?.team_colour||'')?'#'+driver.team_colour:'#9ca5b3';

export function createQualifyingView(root, {query, openLaps, onWeather=()=>{}, setRail=()=>null, setHeading=()=>{}}) {
  let model, selected, pinned, phase='all', includeUntimed=false, observer, bests, lastWidth=0;
  const findLap = key => model?.rows.flatMap(r=>r.attempts).find(l=>l.key===key);
  const rowOf = number => model.rows.find(r=>r.driver.driver_number===number);
  const driverName = number => fullName(rowOf(number)?.driver||{driver_number:number});
  function visible(lap) {return (phase==='all' || (phase==='unknown'?lap.phase==null:lap.phase===Number(phase))) && (includeUntimed || lap.timed);}
  function detail() {
    const lap=findLap(selected);
    root.querySelectorAll('[data-lap]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.lap===selected)));
    if(!lap){onWeather({time:model.first,label:'Qualifying · session start'});setRail('<section class="rail-card"><span class="eyebrow-muted">SELECTED ATTEMPT</span><p class="small-note">Select any lap on the timeline. Every session driver is listed, including drivers without a timed lap.</p></section>');return;}
    onWeather({time:lap.start,label:`${driverName(lap.driver_number)} · Lap ${lap.lap_number} start`});
    const canOpen=lap.timed&&Number.isFinite(lap.start),row=rowOf(lap.driver_number);
    const status=lap.deleted?'Deleted':lap.is_pit_out_lap?'Pit-out lap':lap.best?'Official phase-best lap':lap.timed?'Timed lap':'No complete lap time';
    const el=setRail(`<section class="rail-card"><span class="eyebrow-muted">SELECTED ATTEMPT · ${lap.phase?model.prefix+lap.phase:'PHASE UNCONFIRMED'}</span><div class="focus-head"><span class="team-bar" style="background:${colour(row?.driver)}"></span><div><strong>${esc(driverName(lap.driver_number))}</strong><small>Lap ${lap.lap_number} · ${status}</small></div></div><strong class="rail-time">${lapTime(lap.lap_duration)}</strong><div class="quali-sectors stacked">${sectorBoxes(bests,lap,seconds)}</div>${lap.deletionMessage?`<p class="quali-deletion">Race control: ${esc(lap.deletionMessage)}</p>`:''}<div class="rail-actions"><button class="primary" data-action="explore" ${canOpen?'':'disabled data-unavailable'}>Explore this lap ↗</button><button class="secondary" data-action="pin" ${canOpen?'':'disabled data-unavailable'}>Set as comparison A</button><button class="secondary" data-action="compare" ${!pinned||pinned===selected||!canOpen?'disabled data-unavailable':''}>Compare A with this lap ↗</button></div><p class="small-note">${pinned?`Comparison A: ${esc(driverName(findLap(pinned).driver_number))} · Lap ${findLap(pinned).lap_number}. Select another lap, then compare.`:'Set a lap as A, then pick another lap to compare.'} Purple: fastest of the session. Green: this driver’s fastest.</p></section>`);
    if(!el)return;
    el.querySelector('[data-action="explore"]').onclick=()=>{if(canOpen)openLaps([lap]);};
    el.querySelector('[data-action="pin"]').onclick=()=>{pinned=selected;detail();};
    el.querySelector('[data-action="compare"]').onclick=()=>{if(pinned&&pinned!==selected&&canOpen)openLaps([findLap(pinned),lap]);};
  }
  function timeline() {
    if(!model)return;
    const container=root.querySelector('.quali-timeline');
    if(!container)return;
    root.querySelectorAll('[data-phase]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.phase===String(phase))));
    const range = model.windows.find(w=>w.phase===Number(phase));
    let from=range?.start ?? model.first;
    // Include finishing laps that started before the chequered flag.
    let to=range ? Math.max(range.end || range.start,...model.rows.flatMap(r=>r.attempts).filter(l=>visible(l)&&Number.isFinite(l.start)).map(l=>l.start+(l.timed?l.lap_duration*1000:0))) : model.last;
    if(!Number.isFinite(from)||!Number.isFinite(to)||to<=from){from=0;to=60000;}
    const trackWidth=Math.max(500,container.clientWidth-200), span=to-from;
    const x=t=>Math.max(0,Math.min(trackWidth-34,(t-from)/span*(trackWidth-34)));
    const boundaries=model.windows.filter(w=>w.start>=from&&w.start<=to);
    const ticks=Array.from({length:5},(_,i)=>`<span style="left:${i*25}%">${((from-model.first+span*i/4)/60000).toFixed(0)}m</span>`).join('');
    container.innerHTML=`<div class="quali-timeline-inner" style="--track-width:${trackWidth}px"><div class="quali-axis"><span>ALL ${model.rows.length} DRIVERS</span><div>${ticks}</div></div>${model.rows.map(row=>{
      const laps=row.attempts.filter(visible), positioned=laps.filter(l=>Number.isFinite(l.start));
      const ends=[];
      const marks=positioned.map(l=>{const left=x(l.start);let lane=ends.findIndex(end=>end+4<=left);if(lane<0)lane=ends.length;ends[lane]=left+30;return {lap:l,left,lane};});
      const height=Math.max(42,ends.length*33+10);
      const noTime=laps.length-positioned.length;
      return `<div class="quali-lane" style="min-height:${height}px"><div class="quali-driver"><span class="team-line" style="background:${colour(row.driver)}"></span><span><strong>${esc(surname(row.driver))}</strong><small>${row.result?.position?'P'+row.result.position+' · ':''}#${row.driver.driver_number}</small></span></div><div class="quali-track" style="height:${height}px">${boundaries.map(w=>`<span class="quali-boundary" style="left:${x(w.start)}px" title="${model.prefix+w.phase} started"></span>`).join('')}${marks.map(({lap:l,left,lane})=>`<button type="button" class="quali-lap ${l.deleted?'deleted':l.best?'best':!l.timed?'untimed':''}" data-lap="${l.key}" style="left:${left}px;top:${lane*33+6}px" aria-pressed="${l.key===selected}" aria-label="${esc(fullName(row.driver))}, lap ${l.lap_number}, ${l.phase?model.prefix+l.phase:'phase unconfirmed'}, ${lapTime(l.lap_duration)}${l.deleted?', deleted':''}" title="Lap ${l.lap_number} · ${l.phase?model.prefix+l.phase:'Unconfirmed phase'} · ${lapTime(l.lap_duration)}${l.deleted?' · deleted':''}">${l.deleted?'×':l.lap_number}</button>`).join('')}${!marks.length?'<span class="quali-no-laps">No attempts with timestamps in this selection</span>':''}</div></div>${noTime?`<div class="quali-unplaced">${esc(fullName(row.driver))} · missing start time: ${laps.filter(l=>!Number.isFinite(l.start)).map(l=>`<button class="secondary" data-lap="${l.key}">Lap ${l.lap_number} · ${lapTime(l.lap_duration)}</button>`).join('')}</div>`:''}`;
    }).join('')}</div>`;
    container.querySelectorAll('[data-lap]').forEach(button=>button.onclick=()=>{selected=button.dataset.lap;detail();});
    root.querySelector('.quali-phase-labels').textContent=boundaries.map(w=>`${model.prefix+w.phase} starts ${((w.start-model.first)/60000).toFixed(1)} min`).join(' · ')||'Phase boundaries are not confirmed in the available race-control records.';
  }
  function resultsTable() {
    const fastest=[0,1,2].map(i=>{const v=model.rows.map(r=>r.best[i]).filter(v=>v!=null);return v.length?Math.min(...v):null;});
    const pole=model.rows.find(r=>r.result?.position===1);
    const poleTime=pole?pole.best.findLast(v=>v!=null):null;
    let previous=null,html='';
    for(const r of model.rows){
      for(const phaseIndex of [2,1]){
        if(previous&&r.result?.position&&previous.best[phaseIndex]!=null&&r.best[phaseIndex]==null)
          html+=`<tr class="cut-row"><td colspan="10"><span>${model.prefix}${phaseIndex+1} cut-off</span></td></tr>`;
      }
      const ideal=idealLap(bests,r.driver.driver_number),own=r.best.filter(v=>v!=null),best=own.length?Math.min(...own):null;
      const drv=bests.drivers.get(r.driver.driver_number)||[null,null,null];
      html+=`<tr><td>${r.result?.position??'—'}</td><td><span class="team-line" style="background:${colour(r.driver)}"></span><strong>${esc(surname(r.driver))}</strong>${r.result?.dsq?' <small>DSQ</small>':r.result?.dns?' <small>DNS</small>':''}</td>${r.best.map((t,i)=>`<td class="${t!=null&&fastest[i]!=null&&Math.abs(t-fastest[i])<.0001?'is-purple':''}">${t==null?'<span class="quali-missing">—</span>':`${lapTime(t)}<small>${Math.abs(t-fastest[i])<.0001?'Phase fastest':`+${(t-fastest[i]).toFixed(3)}`}</small>`}</td>`).join('')}<td class="num">${r===pole?'Pole':best!=null&&poleTime!=null?`+${(best-poleTime).toFixed(3)}`:'—'}</td>${drv.map((t,i)=>`<td class="num ${t!=null&&bests.session[i]!=null&&t<=bests.session[i]+1e-9?'is-purple':'is-muted'}">${t!=null?t.toFixed(3):'—'}</td>`).join('')}<td class="num">${ideal==null?'<span class="quali-missing">Incomplete</span>':`${lapTime(ideal)}${best!=null&&best-ideal>0.0005?`<small class="is-gain">−${(best-ideal).toFixed(3)} possible</small>`:''}`}</td></tr>`;
      previous=r;
    }
    return `<div class="table-scroll"><table class="quali-table"><thead><tr><th scope="col">POS</th><th scope="col">DRIVER</th>${[1,2,3].map(i=>`<th scope="col">${model.prefix+i}</th>`).join('')}<th scope="col" class="num">GAP</th><th scope="col" class="num">BEST S1</th><th scope="col" class="num">BEST S2</th><th scope="col" class="num">BEST S3</th><th scope="col" class="num">IDEAL LAP</th></tr></thead><tbody>${html}</tbody></table></div>`;
  }
  return {
    async load(session) {
      observer?.disconnect(); model=null; selected=null; pinned=null; phase='all';includeUntimed=false;setRail('');
      if(!isQualifying(session)){root.innerHTML='<div class="empty"><h2>Choose a qualifying session</h2><p>Select Qualifying or Sprint Qualifying above. The timeline includes every driver in that session.</p></div>';return;}
      root.innerHTML='<div class="empty"><h2>Reading the whole session…</h2><p>Loading timings, results and race-control records.</p></div>';
      const params={session_key:session.session_key};
      // Serial requests also respect the existing optional online client's pacing.
      const drivers=await query('drivers',params),laps=await query('laps',params),results=await query('session_result',params);
      let messages=[],warning='';
      try{messages=await query('race_control',params);}catch(e){if(e?.superseded)throw e;warning='Race-control records are unavailable. Lap phases and deletion status may be unconfirmed.';}
      model=qualifyingModel(session,drivers,laps,results,messages);
      bests=sectorBests(model.rows.flatMap(r=>r.attempts));
      if(!model.rows.length){root.innerHTML='<div class="empty"><h2>No driver records available</h2><p>Reload data after this session has been downloaded.</p></div>';return;}
      // Open on the final confirmed phase; every driver stays listed whichever phase is shown.
      const lastPhase=Math.max(0,...model.windows.map(w=>w.phase));phase=lastPhase?String(lastPhase):'all';
      const pole=model.rows.find(r=>r.result?.position===1),second=model.rows.find(r=>r.result?.position===2);
      const index=pole?pole.best.findLastIndex(v=>v!=null):-1;
      const margin=pole&&second&&index>=0&&second.best[index]!=null?second.best[index]-pole.best[index]:null;
      const sprint=/Sprint|Shootout/i.test(session.session_name);
      const date=new Date(session.date_start).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
      setHeading(`${String(session.country_name||'').toUpperCase()} · ${sprint?'SPRINT QUALIFYING':'QUALIFYING'} · ${date.toUpperCase()}`,pole?`${surname(pole.driver)} on ${sprint?'sprint ':''}pole${margin!=null?` by ${margin.toFixed(3)} s`:''}`:`${session.country_name} ${session.session_name}`,pole&&second?`${fullName(pole.driver)} beat ${fullName(second.driver)}${index>=0?` in ${model.prefix}${index+1}`:''}. Every driver and every attempt is below.`:'Every driver and every attempt is below.');
      selected=(pole&&pole.attempts.find(l=>l.best&&l.phase===index+1)?.key)||model.rows.flatMap(r=>r.attempts).find(l=>l.best)?.key||model.rows.flatMap(r=>r.attempts).find(l=>l.timed)?.key;
      const unknown=model.rows.flatMap(r=>r.attempts).filter(l=>l.phase==null).length;
      root.innerHTML=`${warning?`<div class="note">${esc(warning)}</div>`:''}<div class="panel quali-timeline-panel"><div class="panel-heading"><div><span class="eyebrow">EVERY DRIVER · EVERY ATTEMPT</span><h2>Qualifying timeline</h2></div><div class="chip-row">${[1,2,3].map(i=>`<button type="button" class="chip" data-phase="${i}">${model.prefix+i}</button>`).join('')}<button type="button" class="chip" data-phase="all">Whole session</button>${unknown?`<button type="button" class="chip" data-phase="unknown">Unconfirmed · ${unknown}</button>`:''}<label class="mode"><input type="checkbox" id="quali-untimed"> Include untimed laps</label></div></div><div class="panel-body"><p class="small-note quali-phase-labels"></p><div class="quali-timeline"></div></div><div class="quali-legend"><span><i class="lg lg-lap"></i>Timed lap</span><span><i class="lg lg-best"></i>Official phase-best lap</span><span><i class="lg lg-del"></i>Deleted lap</span><span><i class="lg lg-untimed"></i>Untimed lap</span><span>Numbers are lap numbers · dashed lines: confirmed phase starts · axis: elapsed minutes</span></div></div><div class="panel"><div class="panel-heading"><div><span class="eyebrow">OFFICIAL RESULTS</span><h2>Every driver, every phase</h2></div></div>${resultsTable()}<p class="small-note panel-foot">Purple: fastest of the session. Small figures under phase times compare with that phase’s fastest. Cut-off lines follow the recorded results. Gap compares each driver’s best phase time with the pole lap. Ideal lap adds each driver’s three best sectors from laps that were not deleted; it is a what-if, not a recorded lap.</p></div><details class="method"><summary>Timing, phases and deleted laps</summary><p>Phase-best values come from the provider’s final result array. Timeline phases use explicit qualifying_phase labels, or lap start times within confirmed session start/finish events. Restarts remain in the same phase. Laps started before the chequered flag stay in that phase even if they finish later. Unconfirmed phases are kept separately.</p><p>Deleted/reinstated status is applied only when a race-control message identifies both driver and lap. All timed laps, including slow, pit-out or deleted attempts, can be inspected. Missing timestamps are listed separately. This view does not infer eliminations or tyre-adjusted pace.</p></details>`;
      root.querySelectorAll('[data-phase]').forEach(b=>b.onclick=()=>{phase=b.dataset.phase;timeline();});
      root.querySelector('#quali-untimed').onchange=e=>{includeUntimed=e.target.checked;timeline();};
      timeline(); detail();
      const box=root.querySelector('.quali-timeline');lastWidth=box.clientWidth;
      observer=new ResizeObserver(()=>{if(box.clientWidth!==lastWidth){lastWidth=box.clientWidth;timeline();}});observer.observe(box);
    }
  };
}
