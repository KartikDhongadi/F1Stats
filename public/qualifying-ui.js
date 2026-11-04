import {qualifyingModel, isQualifying} from './qualifying.js';
import {lapTime} from './telemetry.js';
const esc = value => String(value ?? '—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const seconds = value => typeof value === 'number' && value > 0 ? value.toFixed(3)+' s' : '—';
export function createQualifyingView(root, {query, openLaps}) {
  let model, selected, pinned, phase='all', includeUntimed=false, observer;
  const findLap = key => model?.rows.flatMap(r=>r.attempts).find(l=>l.key===key);
  const driverName = number => model.rows.find(r=>r.driver.driver_number===number)?.driver.full_name || `Driver ${number}`;
  function visible(lap) {return (phase==='all' || (phase==='unknown'?lap.phase==null:lap.phase===Number(phase))) && (includeUntimed || lap.timed);}
  function detail() {
    const lap=findLap(selected), box=root.querySelector('.quali-detail');
    if(!box)return;
    if(!lap){box.innerHTML='<h3>Select any lap on the timeline</h3><p>Every session driver is listed, including drivers without a timed lap.</p>';return;}
    box.innerHTML=`<div class="quali-detail-head"><div><span class="eyebrow">SELECTED ATTEMPT</span><h2>${esc(driverName(lap.driver_number))} · Lap ${lap.lap_number}</h2><p>${lap.phase?model.prefix+lap.phase:'Phase unconfirmed'} · ${lap.deleted?'Deleted':lap.is_pit_out_lap?'Pit-out lap':lap.best?'Official phase-best lap':lap.timed?'Timed lap':'No complete lap time'}</p></div><strong class="quali-time">${lapTime(lap.lap_duration)}</strong></div><div class="quali-sectors">${[1,2,3].map(i=>`<div><span>SECTOR ${i}</span><strong>${seconds(lap['duration_sector_'+i])}</strong></div>`).join('')}</div>${lap.deletionMessage?`<p class="quali-deletion">Race control: ${esc(lap.deletionMessage)}</p>`:''}<div class="quali-actions"><button class="primary" data-action="explore" ${!lap.timed||!Number.isFinite(lap.start)?'disabled data-unavailable':''}>Explore this lap ↗</button><button class="secondary" data-action="pin" ${!lap.timed||!Number.isFinite(lap.start)?'disabled data-unavailable':''}>Set as comparison A</button><button class="secondary" data-action="compare" ${!pinned||pinned===selected||!lap.timed||!Number.isFinite(lap.start)?'disabled data-unavailable':''}>Compare A with this lap ↗</button></div><p class="quali-pinned">${pinned?`Comparison A: ${esc(driverName(findLap(pinned).driver_number))} · Lap ${findLap(pinned).lap_number}. Select another lap, then compare.`:'Select a lap as A, then pick another driver’s lap to compare.'}</p>`;
    box.querySelector('[data-action="explore"]').onclick=()=>{if(lap.timed&&Number.isFinite(lap.start))openLaps([lap]);};
    box.querySelector('[data-action="pin"]').onclick=()=>{pinned=selected;detail();};
    box.querySelector('[data-action="compare"]').onclick=()=>{if(pinned&&pinned!==selected&&lap.timed&&Number.isFinite(lap.start))openLaps([findLap(pinned),lap]);};
    root.querySelectorAll('[data-lap]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.lap===selected)));
  }
  function timeline() {
    if(!model)return;
    const container=root.querySelector('.quali-timeline');
    if(!container)return;
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
      const height=Math.max(46,ends.length*33+12);
      const noTime=laps.length-positioned.length;
      return `<div class="quali-lane" style="min-height:${height}px"><div class="quali-driver"><strong>${esc(row.driver.full_name)}</strong><small>#${row.driver.driver_number} · ${esc(row.driver.team_name || 'Team unavailable')}</small></div><div class="quali-track" style="height:${height}px">${boundaries.map(w=>`<span class="quali-boundary" style="left:${x(w.start)}px" title="${model.prefix+w.phase} started"></span>`).join('')}${marks.map(({lap:l,left,lane})=>`<button type="button" class="quali-lap ${l.deleted?'deleted':l.best?'best':!l.timed?'untimed':''}" data-lap="${l.key}" style="left:${left}px;top:${lane*33+6}px" aria-pressed="${l.key===selected}" aria-label="${esc(row.driver.full_name)}, lap ${l.lap_number}, ${l.phase?model.prefix+l.phase:'phase unconfirmed'}, ${lapTime(l.lap_duration)}${l.deleted?', deleted':''}" title="${l.phase?model.prefix+l.phase:'Unconfirmed phase'} · ${lapTime(l.lap_duration)}${l.deleted?' · deleted':''}">${l.deleted?'×':l.lap_number}</button>`).join('')}${!marks.length?'<span class="quali-no-laps">No attempts with timestamps in this selection</span>':''}</div></div>${noTime?`<div class="quali-unplaced">${esc(row.driver.full_name)} · missing start time: ${laps.filter(l=>!Number.isFinite(l.start)).map(l=>`<button class="secondary" data-lap="${l.key}">Lap ${l.lap_number} · ${lapTime(l.lap_duration)}</button>`).join('')}</div>`:''}`;
    }).join('')}</div>`;
    container.querySelectorAll('[data-lap]').forEach(button=>button.onclick=()=>{selected=button.dataset.lap;detail();});
    root.querySelector('.quali-phase-labels').textContent=boundaries.map(w=>`${model.prefix+w.phase} starts ${((w.start-model.first)/60000).toFixed(1)} min`).join(' · ')||'Phase boundaries are not confirmed in the available race-control records.';
  }
  function heatmap() {
    const fastest=[0,1,2].map(i=>Math.min(...model.rows.map(r=>r.best[i]).filter(v=>v!=null)));
    const slowest=[0,1,2].map(i=>Math.max(...model.rows.map(r=>r.best[i]).filter(v=>v!=null)));
    return `<div class="quali-table-wrap"><table class="quali-table"><thead><tr><th>POS</th><th>DRIVER</th>${[1,2,3].map(i=>`<th>${model.prefix+i} BEST</th>`).join('')}<th>${model.prefix}1 → LAST TIME</th></tr></thead><tbody>${model.rows.map(r=>{
      const last=r.best.findLast(v=>v!=null),delta=r.best[0]!=null&&r.best.slice(1).some(v=>v!=null)?last-r.best[0]:null;
      return `<tr><td>${r.result?.position??'—'}</td><td>${esc(r.driver.full_name)}${r.result?.dsq?' · DSQ':r.result?.dns?' · DNS':''}</td>${r.best.map((t,i)=>{const alpha=t==null?0:.08+.22*(1-(t-fastest[i])/Math.max(.001,slowest[i]-fastest[i]));return `<td style="background:rgba(198,244,107,${alpha})">${t==null?'<span class="quali-missing">No time</span>':`${lapTime(t)}<small>${Math.abs(t-fastest[i])<.0001?'Phase fastest':`+${(t-fastest[i]).toFixed(3)} s`}</small>`}</td>`;}).join('')}<td>${delta==null?'—':`${delta>0?'+':''}${delta.toFixed(3)} s`}</td></tr>`;
    }).join('')}</tbody></table></div>`;
  }
  return {
    async load(session) {
      observer?.disconnect(); model=null; selected=null; pinned=null; phase='all';includeUntimed=false;
      if(!isQualifying(session)){root.innerHTML='<div class="empty"><h2>Choose a qualifying session</h2><p>Select Qualifying or Sprint Qualifying above. The timeline includes every driver in that session.</p></div>';return;}
      root.innerHTML='<div class="empty"><h2>Reading the whole session…</h2><p>Loading timings, results and race-control records.</p></div>';
      const params={session_key:session.session_key};
      // Serial requests also respect the existing optional online client's pacing.
      const drivers=await query('drivers',params),laps=await query('laps',params),results=await query('session_result',params);
      let messages=[],warning='';
      try{messages=await query('race_control',params);}catch(e){warning='Race-control records are unavailable. Lap phases and deletion status may be unconfirmed.';}
      model=qualifyingModel(session,drivers,laps,results,messages);
      if(!model.rows.length){root.innerHTML='<div class="empty"><h2>No driver records available</h2><p>Reload data after this session has been downloaded.</p></div>';return;}
      selected=model.rows.flatMap(r=>r.attempts).find(l=>l.best)?.key || model.rows.flatMap(r=>r.attempts).find(l=>l.timed)?.key;
      const unknown=model.rows.flatMap(r=>r.attempts).filter(l=>l.phase==null).length;
      root.innerHTML=`<div class="note">${model.rows.length} drivers · ${laps.length} recorded laps · ${esc(session.country_name)} ${esc(session.session_name)}${warning?`<br>${esc(warning)}`:''}</div><div class="panel quali-detail" aria-live="polite"></div><div class="panel quali-timeline-panel"><div class="panel-heading"><div><span class="eyebrow">EVERY DRIVER · EVERY ATTEMPT</span><h2>Qualifying timeline</h2></div><div class="quali-controls"><label>PHASE<select id="quali-phase"><option value="all">Whole session</option>${[1,2,3].map(i=>`<option value="${i}">${model.prefix+i}</option>`).join('')}<option value="unknown">Unconfirmed phase (${unknown})</option></select></label><label class="mode"><input type="checkbox" id="quali-untimed"> Include untimed laps</label></div></div><p class="muted">Numbers are lap numbers. Select any attempt. All drivers remain visible when filtering phases.</p><div class="quali-phase-labels muted"></div><div class="quali-timeline"></div><div class="quali-legend"><span>● Timed lap</span><span class="a">■ Official phase-best lap</span><span class="quali-deletion">× Deleted lap</span><span>○ Untimed lap</span><span>Dashed lines: confirmed phase starts · Time axis: elapsed minutes</span></div></div><div class="panel"><div class="panel-heading"><div><span class="eyebrow">OFFICIAL SESSION RESULTS</span><h2>${model.prefix}1 / ${model.prefix}2 / ${model.prefix}3 performance</h2></div></div><p class="muted">Each column compares drivers within that phase. “No time” means no recorded result; it does not necessarily mean elimination. Negative improvement means faster.</p>${heatmap()}</div><details class="method"><summary>Timing, phases and deleted laps</summary><p>Phase-best values come from the provider’s final result array. Timeline phases use explicit qualifying_phase labels, or lap start times within confirmed session start/finish events. Restarts remain in the same phase. Laps started before the chequered flag stay in that phase even if they finish later. Unconfirmed phases are kept separately.</p><p>Deleted/reinstated status is applied only when a race-control message identifies both driver and lap. All timed laps, including slow, pit-out or deleted attempts, can be inspected. Missing timestamps are listed separately. This view does not infer eliminations or tyre-adjusted pace.</p></details>`;
      root.querySelector('#quali-phase').onchange=e=>{phase=e.target.value;timeline();};
      root.querySelector('#quali-untimed').onchange=e=>{includeUntimed=e.target.checked;timeline();};
      timeline(); detail();
      observer=new ResizeObserver(()=>timeline());observer.observe(root.querySelector('.quali-timeline'));
    }
  };
}
