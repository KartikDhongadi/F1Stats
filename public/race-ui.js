import {lapChoices,lapLabel,createLapTools} from './lap-selection.js';
import {createDriverPicker} from './selectors.js';
import {isRace, raceModel, pacePoints, linePath, gapPoints, raceHighlights, wetBands, stintPace} from './race.js';
import {describeEvent, aidOffBands, trackLimitCounts} from './race-events.js';
import {sectorBests, sectorBoxes, idealLap} from './sectors.js';
import {lapTime} from './telemetry.js';
const esc=value=>String(value??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const tyreStyle={SOFT:['S','#f37e7e','#281113'],MEDIUM:['M','#efcf6f','#2b230f'],HARD:['H','#e0e5ed','#222933'],INTERMEDIATE:['I','#6fb6f0','#0f2236'],WET:['W','#4a7fd6','#0c1a33'],UNKNOWN:['?','#9ca5b3','#202630']};
const palettes=['#c6f46b','#79bcff','#ffa17a','#b7a0ff','#70d6bf','#ed8bd0'];
const patterns=['','7 4','2 3','10 3 2 3'];
const TABS=[['story','Story'],['pace','Pace'],['strategy','Strategy'],['events','Events']];
const CRITICAL=['Safety car','Virtual safety car','Red flag / suspension'];
const titleCase=text=>String(text).toLowerCase().replace(/(^|[\s'-])(\p{L})/gu,(m,a,b)=>a+b.toUpperCase());
const surname=driver=>{const parts=String(driver?.full_name||'').trim().split(/\s+/);return parts.length>1?titleCase(parts.slice(1).join(' ')):parts[0]?titleCase(parts[0]):`Car ${driver?.driver_number??'?'}`;};
const fullName=driver=>{const parts=String(driver?.full_name||'').trim().split(/\s+/);return parts.length>1?parts[0]+' '+titleCase(parts.slice(1).join(' ')):driver?.full_name||`Driver ${driver?.driver_number??'?'}`;};
const timeText=seconds=>typeof seconds==='number'&&Number.isFinite(seconds)?seconds.toFixed(3)+' s':'Unavailable';
const short=seconds=>typeof seconds==='number'&&Number.isFinite(seconds)?seconds.toFixed(1)+' s':'—';
const positive=value=>typeof value==='number'&&Number.isFinite(value)&&value>0;
const median=values=>{const v=[...values].sort((a,b)=>a-b),m=v.length>>1;return v.length?(v.length%2?v[m]:(v[m-1]+v[m])/2):null;};
const place=position=>position?'P'+position:'—';

export function createRaceView(root,{query,openLaps,onWeather=()=>{},setRail=()=>null,setHeading=()=>{},showResults=()=>{}}) {
  let detailPicker,detailLapTools,tab='story';
  let model,visible=new Set(),selected,pinned,focus=null,hover=null,gapCeiling=60,bests=null,inspectLap=1,ceiling=180,observer,colors=new Map(),dashes=new Map(),warnings=[];
  let highlights,wet=[],entries=[],eventFilter='key',eventDriver='',showOriginal=false,pitsAvailable=true,frameRequest=0;
  const $=selector=>root.querySelector(selector);
  const rowFor=id=>model.rows.find(r=>r.driver.driver_number===Number(id));
  const findLap=key=>model.rows.flatMap(r=>r.laps).find(l=>l.key===key);
  const name=id=>fullName(rowFor(id)?.driver||{driver_number:id});
  const last=id=>surname(rowFor(id)?.driver||{driver_number:id});
  const series=()=>model.rows.filter(r=>visible.has(r.driver.driver_number));
  const xTicks=()=>Array.from(new Set([1,...Array.from({length:5},(_,i)=>Math.round((model.maxLap-1)*(i+1)/5)+1)]));
  const frame=container=>({width:Math.max(600,Math.round(container.clientWidth)),height:320,left:54,right:20,top:20,bottom:40});
  const xScale=f=>lap=>f.left+(lap-1)/Math.max(1,model.maxLap-1)*(f.width-f.left-f.right);
  const lapAt=(f,event)=>{const rect=event.currentTarget.getBoundingClientRect(),px=(event.clientX-rect.left)/rect.width*f.width;return Math.max(1,Math.min(model.maxLap,Math.round(1+(px-f.left)/(f.width-f.left-f.right)*Math.max(1,model.maxLap-1))));};
  const noData=text=>`<div class="race-empty">${esc(text)}</div>`;
  const bestLap=row=>row.laps.filter(l=>positive(l.lap_duration)&&!l.deleted&&Number.isFinite(l.start)).reduce((b,l)=>!b||l.lap_duration<b.lap_duration?l:b,null);
  const statusOf=row=>row.result?.dsq?'DSQ':row.result?.dns?'DNS':row.result?.dnf?'DNF':row.result?.position?'P'+row.result.position:'—';

  // ---- Highlighting: restyles drawn elements only; it never changes or hides data.
  const activeDriver=()=>{const id=hover??focus;return id!=null&&visible.has(id)?id:null;};
  function applyHighlight(){
    if(!model)return;
    const active=activeDriver();
    root.querySelectorAll('[data-hl-driver]').forEach(node=>{const id=Number(node.dataset.hlDriver);node.classList.toggle('is-dim',active!=null&&id!==active);node.classList.toggle('is-focus',active!=null&&id===active);});
    if(active!=null)root.querySelectorAll(`.race-lines [data-hl-driver="${active}"]`).forEach(node=>node.parentNode.append(node));
    const select=$('#race-focus');if(!select)return;
    select.value=focus==null?'':String(focus);
    root.querySelectorAll('[data-focus-action]').forEach(button=>{const off=focus==null;button.toggleAttribute('data-unavailable',off);button.disabled=off;});
    $('.race-focus-note').textContent=focus==null?'Hover a line or a driver to highlight them on every chart. Click a line, or choose a driver here, to keep the highlight.':`${name(focus)} stays highlighted. Click the line again or use Clear highlight to release it.`;
  }
  function setHover(id){if(hover===id)return;hover=id;applyHighlight();}
  function syncChips(){root.querySelectorAll('[data-chip-driver]').forEach(chip=>chip.setAttribute('aria-pressed',String(visible.has(Number(chip.dataset.chipDriver)))));}
  function setFocus(id){
    focus=id;hover=null;
    if(id!=null&&!visible.has(id)){visible.add(id);syncChips();renderActive();}
    applyHighlight();renderRail();
    if(tab==='strategy')renderStrategy();
  }
  function wireHighlight(box){
    box.querySelectorAll('.race-hit').forEach(path=>{const id=Number(path.dataset.hitDriver);path.onpointerenter=()=>setHover(id);path.onpointerleave=()=>setHover(null);path.onclick=()=>setFocus(focus===id?null:id);});
  }
  // ---- Chart tooltip that follows the cursor.
  function tip(box,f,x,y,html){
    const node=box.querySelector('.chart-tip');if(!node)return;
    if(!html){node.hidden=true;return;}
    node.hidden=false;node.innerHTML=html;
    const left=x/f.width*100;
    node.style.left=left<62?`calc(${left}% + 14px)`:'auto';node.style.right=left<62?'auto':`calc(${100-left}% + 14px)`;
    node.style.top=`${Math.max(2,Math.min(70,y/f.height*100-8))}%`;
  }
  const tipRow=(label,value,colour)=>`<div class="tip-row"><span${colour?` style="color:${colour}"`:''}>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
  function axes(f,x,y,ticks,format){
    return ticks.map(value=>`<line x1="${f.left}" x2="${f.width-f.right}" y1="${y(value)}" y2="${y(value)}" stroke="#1f262f"/><text x="${f.left-10}" y="${y(value)+4}" text-anchor="end">${format(value)}</text>`).join('')+xTicks().map(lap=>`<text x="${x(lap)}" y="${f.height-16}" text-anchor="${lap===1?'start':lap===model.maxLap?'end':'middle'}">${lap}</text>`).join('');
  }
  const bandsSvg=(f,x)=>wet.map(b=>`<rect x="${x(b.from)-3}" y="${f.top}" width="${Math.max(6,x(b.to)-x(b.from)+6)}" height="${f.height-f.top-f.bottom}" fill="#79bcff" opacity=".07"/><text class="band-label" x="${x(b.from)+4}" y="${f.top+12}">WET TYRES</text>`).join('');
  const criticalSvg=(f,x)=>model.events.filter(e=>CRITICAL.includes(e.type)&&e.raceLap!=null).map(e=>`<line x1="${x(e.raceLap)}" x2="${x(e.raceLap)}" y1="${f.top}" y2="${f.height-f.bottom}" stroke="${e.type==='Red flag / suspension'?'#d28a80':'#b9a46d'}" stroke-dasharray="2 5" opacity=".6"><title>${esc(e.message)} · approximately race lap ${e.raceLap}</title></line>`).join('');

  // ---- Story: running order
  function readPositions(lap,notify=true){
    inspectLap=Math.max(1,Math.min(model.maxLap,Math.round(lap)));
    const slider=$('#race-progress');if(slider)slider.value=inspectLap;
    if(notify)onWeather({time:model.clock.find(p=>p.lap===inspectLap)?.time,label:`Race lap ${inspectLap} · running order`});
    const label=$('#race-progress-label');if(label)label.textContent=`Race lap ${inspectLap}`;
    const rows=series().map(r=>({row:r,position:r.positionPoints.find(p=>p.lap===inspectLap)?.position})).sort((a,b)=>(a.position??Infinity)-(b.position??Infinity));
    const readout=$('.race-position-readout');
    if(readout)readout.innerHTML=rows.length?rows.map(({row:r,position})=>`<span data-hl-driver="${r.driver.driver_number}" class="${activeDriver()==null?'':activeDriver()===r.driver.driver_number?'is-focus':'is-dim'}"><i style="background:${colors.get(r.driver.driver_number)}"></i>${esc(r.driver.name_acronym||last(r.driver.driver_number))} <b>${position==null?'—':'P'+position}</b></span>`).join(''):'No drivers selected.';
    const box=$('.race-position-chart'),line=box?.querySelector('.race-cursor');
    if(line){const f=frame(box),x=xScale(f)(inspectLap);line.setAttribute('x1',x);line.setAttribute('x2',x);}
  }
  function renderPositions(){
    const box=$('.race-position-chart');if(!box)return;
    const rows=series(),points=rows.flatMap(r=>r.positionPoints).filter(p=>p.position!=null);
    if(!points.length){box.innerHTML=noData(rows.length?'No position samples available for the selected drivers.':'Select drivers to display their positions.');readPositions(inspectLap,false);return;}
    const f=frame(box),x=xScale(f),maximum=Math.max(model.rows.length,...points.map(p=>p.position));
    const y=p=>f.top+(p-1)/Math.max(1,maximum-1)*(f.height-f.top-f.bottom);
    const ticks=[...new Set([1,...Array.from({length:Math.floor(maximum/5)},(_,i)=>(i+1)*5),maximum])];
    box.innerHTML=`<div class="chart-wrap"><svg viewBox="0 0 ${f.width} ${f.height}" width="${f.width}" height="${f.height}" role="img" aria-label="Driver positions at estimated leader lap crossings. Position one is at the top. Use the race lap slider to inspect values.">${bandsSvg(f,x)}${axes(f,x,y,ticks,v=>'P'+v)}${criticalSvg(f,x)}<g class="race-lines">${rows.map(r=>`<path data-hl-driver="${r.driver.driver_number}" d="${linePath(r.positionPoints,x,y,'position')}" fill="none" stroke="${colors.get(r.driver.driver_number)}" stroke-width="2" stroke-dasharray="${dashes.get(r.driver.driver_number)}"/>`).join('')}</g><g class="race-hits">${rows.map(r=>`<path class="race-hit" data-hit-driver="${r.driver.driver_number}" d="${linePath(r.positionPoints,x,y,'position')}" fill="none" stroke="transparent" stroke-width="14"><title>${esc(fullName(r.driver))} · click to keep highlighted</title></path>`).join('')}</g><line class="race-cursor" y1="${f.top}" y2="${f.height-f.bottom}" stroke="#e9edf4" opacity=".6" stroke-dasharray="3 4"/></svg><div class="chart-tip" hidden></div></div>`;
    const svg=box.querySelector('svg');
    svg.onpointermove=event=>{
      const lap=lapAt(f,event);readPositions(lap);
      const active=activeDriver(),order=series().map(r=>({r,p:r.positionPoints[lap-1]?.position})).filter(o=>o.p!=null).sort((a,b)=>a.p-b.p);
      const shown=active!=null?order.filter(o=>o.r.driver.driver_number===active):order.slice(0,3);
      const extra=active!=null&&shown.length?tipRow('Started',place(rowFor(active).grid))+tipRow('Finished',statusOf(rowFor(active))):'';
      tip(box,f,x(lap),shown.length?y(shown[0].p):f.top,`<span class="tip-head">RACE LAP ${lap}</span>${shown.map(o=>tipRow(last(o.r.driver.driver_number),'P'+o.p,colors.get(o.r.driver.driver_number))).join('')||tipRow('No position recorded','—')}${extra}`);
    };
    svg.onpointerleave=()=>tip(box,f,0,0,'');
    wireHighlight(box);readPositions(inspectLap,false);applyHighlight();
  }
  function renderGap(){
    const box=$('.race-gap-chart');if(!box)return;
    const rows=series(),drawn=rows.map(r=>({r,points:gapPoints(r,model.clock,gapCeiling)}));
    const all=drawn.flatMap(d=>d.points),values=all.map(p=>p.value).filter(v=>v!=null),hidden=all.filter(p=>p.gap!=null&&p.value==null).length;
    $('.race-gap-note').textContent=`Seconds after the first car each driver completed the same race lap. Lines moving up are closing on the leader. ${hidden?`${hidden} points above the limit are not drawn. `:''}Lines break where timing is missing.`;
    if(!values.length){box.innerHTML=noData(rows.length?'No gaps within this limit. Try a larger limit.':'Select drivers to display their gaps.');return;}
    const f=frame(box),x=xScale(f),max=Math.max(1,Math.max(...values)*1.05);
    const y=gap=>f.top+gap/max*(f.height-f.top-f.bottom);
    const ticks=Array.from({length:5},(_,i)=>max*i/4);
    box.innerHTML=`<div class="chart-wrap"><svg viewBox="0 0 ${f.width} ${f.height}" width="${f.width}" height="${f.height}" role="img" aria-label="Gap to the leader in seconds at each race lap. The leader is at the top. Use the highlight control to follow one driver.">${bandsSvg(f,x)}${axes(f,x,y,ticks,v=>'+'+v.toFixed(max<20?1:0)+'s')}${criticalSvg(f,x)}<g class="race-lines">${drawn.map(({r,points})=>`<path data-hl-driver="${r.driver.driver_number}" d="${linePath(points,x,y,'value')}" fill="none" stroke="${colors.get(r.driver.driver_number)}" stroke-width="2" stroke-dasharray="${dashes.get(r.driver.driver_number)}"/>`).join('')}</g><g class="race-hits">${drawn.map(({r,points})=>`<path class="race-hit" data-hit-driver="${r.driver.driver_number}" d="${linePath(points,x,y,'value')}" fill="none" stroke="transparent" stroke-width="14"><title>${esc(fullName(r.driver))} · click to keep highlighted</title></path>`).join('')}</g><line class="race-cursor" y1="${f.top}" y2="${f.height-f.bottom}" stroke="#e9edf4" opacity="0" stroke-dasharray="3 4"/></svg><div class="chart-tip" hidden></div></div>`;
    const svg=box.querySelector('svg'),cursor=svg.querySelector('.race-cursor');
    svg.onpointermove=event=>{
      const lap=lapAt(f,event),active=activeDriver();cursor.setAttribute('x1',x(lap));cursor.setAttribute('x2',x(lap));cursor.setAttribute('opacity','.6');
      const at=drawn.map(d=>({r:d.r,p:d.points[lap-1]})).filter(o=>o.p?.gap!=null).sort((a,b)=>a.p.gap-b.p.gap);
      const shown=active!=null?at.filter(o=>o.r.driver.driver_number===active):at.slice(0,3);
      const text=g=>g<.0005?'Leading':'+'+g.toFixed(3)+' s';
      tip(box,f,x(lap),shown.length?y(Math.min(shown[0].p.gap,max)):f.top,`<span class="tip-head">RACE LAP ${lap}</span>${shown.map(o=>tipRow(last(o.r.driver.driver_number),text(o.p.gap),colors.get(o.r.driver.driver_number))).join('')||tipRow('No timing for this lap','—')}`);
    };
    svg.onpointerleave=()=>{tip(box,f,0,0,'');cursor.setAttribute('opacity','0');};
    wireHighlight(box);applyHighlight();
  }

  // ---- Pace
  function chooseLap(lap,scroll=false){
    if(!lap)return;selected=lap.key;
    $('#race-detail-driver').value=String(lap.driver_number);fillLapOptions(lap.driver_number,lap.lap_number);
    if(tab!=='pace')switchTab('pace');else renderDetail();
    root.querySelectorAll('.race-pace-point').forEach(point=>point.setAttribute('r',point.dataset.lap===selected?'5':'3'));
    if(scroll)$('.race-lap-inspector').scrollIntoView({behavior:'smooth',block:'center'});
  }
  function renderPace(){
    const box=$('.race-pace-chart');if(!box)return;
    const rows=series();
    const eligible=rows.flatMap(r=>pacePoints(r,ceiling).filter(p=>p.value!=null));
    const omitted=rows.flatMap(r=>r.laps).filter(l=>Number.isFinite(l.lap_duration)&&l.lap_duration>ceiling).length;
    $('.race-pace-note').textContent=`${omitted?`${omitted} slow laps (stoppages, pit laps) are above the limit and hidden. `:''}Lower is faster. Each driver’s own lap number. Click a point to inspect the lap.`;
    if(!eligible.length){box.innerHTML=noData(rows.length?'No timed laps within this limit. Try Show all.':'Select drivers to display lap times.');return;}
    const f=frame(box),x=xScale(f),values=eligible.map(l=>l.value),low=Math.min(...values),high=Math.max(...values),padding=Math.max(1,(high-low)*.08),min=Math.max(0,low-padding),max=high+padding;
    const y=t=>f.height-f.bottom-(t-min)/(max-min)*(f.height-f.top-f.bottom);
    const ticks=Array.from({length:5},(_,i)=>min+(max-min)*i/4);
    const drawn=rows.map(r=>({r,points:pacePoints(r,ceiling).map(p=>({...p,lap:p.lap_number}))}));
    const active=activeDriver();
    const pits=active==null?'':(rowFor(active)?.pits||[]).map(p=>`<path d="M${x(p.lap_number)},${f.height-f.bottom-1} l-5,-9 h10 z" fill="#e9c46a"><title>${esc(name(active))} pit lane · lap ${p.lap_number}</title></path>`).join('');
    box.innerHTML=`<div class="chart-wrap"><svg viewBox="0 0 ${f.width} ${f.height}" width="${f.width}" height="${f.height}" role="img" aria-label="Lap times by each driver's own lap number. Lower is faster. Use the lap inspector below as a keyboard alternative.">${axes(f,x,y,ticks,v=>lapTime(v).replace(/\.\d+$/,''))}<g class="race-lines">${drawn.map(({r,points})=>`<path data-hl-driver="${r.driver.driver_number}" d="${linePath(points,x,y,'value')}" fill="none" stroke="${colors.get(r.driver.driver_number)}" stroke-dasharray="${dashes.get(r.driver.driver_number)}" stroke-width="1.7" opacity=".85"/>`).join('')}</g><g class="race-hits">${drawn.map(({r,points})=>`<path class="race-hit" data-hit-driver="${r.driver.driver_number}" d="${linePath(points,x,y,'value')}" fill="none" stroke="transparent" stroke-width="12"><title>${esc(fullName(r.driver))} · click to keep highlighted</title></path>`).join('')}</g><g class="race-points">${drawn.map(({r,points})=>points.filter(p=>p.value!=null).map(p=>`<circle class="race-pace-point" data-hl-driver="${r.driver.driver_number}" data-lap="${p.key}" cx="${x(p.lap_number)}" cy="${y(p.value)}" r="${p.key===selected?5:3}" fill="${colors.get(r.driver.driver_number)}"></circle>`).join('')).join('')}</g>${pits}</svg><div class="chart-tip" hidden></div></div>`;
    box.querySelectorAll('.race-pace-point').forEach(point=>{
      point.onclick=()=>chooseLap(findLap(point.dataset.lap),true);
      point.onpointerenter=()=>{
        const lap=findLap(point.dataset.lap),row=rowFor(lap.driver_number),tyre=row.stints.find(s=>lap.lap_number>=s.lap_start&&lap.lap_number<=s.end);
        setHover(lap.driver_number);
        tip(box,f,Number(point.getAttribute('cx')),Number(point.getAttribute('cy')),`<span class="tip-head">${esc(last(lap.driver_number).toUpperCase())} · LAP ${lap.lap_number}</span><strong class="tip-big">${lapTime(lap.lap_duration)}</strong>${tipRow('Tyre',titleCase(tyre?.compound||'Unknown'))}${lap.is_pit_out_lap?tipRow('Pit out','✓'):''}${lap.pitIn?tipRow('Pit in','✓'):lap.inferredPitIn?tipRow('Pit in (inferred)','✓'):''}${lap.deleted?tipRow('Deleted','✓'):''}<span class="tip-hint">Click to inspect</span>`);
      };
      point.onpointerleave=()=>{setHover(null);tip(box,f,0,0,'');};
    });
    wireHighlight(box);applyHighlight();
  }
  function fillLapOptions(driver,lapNumber){
    const row=rowFor(driver),select=$('#race-detail-lap');
    select.innerHTML=(row?.laps||[]).map(l=>`<option value="${l.key}">${esc(lapLabel(l))}</option>`).join('');
    const candidate=row?.laps.find(l=>l.lap_number===Number(lapNumber))||row?.laps[0];
    selected=candidate?.key;if(candidate)select.value=selected;
  }
  function renderDetail(){
    detailPicker?.sync();detailLapTools?.sync();
    const box=$('.race-detail-content'),lap=findLap(selected);
    if(!lap){if(tab==='pace')onWeather({time:NaN,label:'No lap selected'});box.innerHTML=noData('This driver has no recorded laps. Choose another driver.');return;}
    if(tab==='pace')onWeather({time:lap.start,label:`${name(lap.driver_number)} · Lap ${lap.lap_number} start`});
    const row=rowFor(lap.driver_number),tyre=row.stints.find(s=>lap.lap_number>=s.lap_start&&lap.lap_number<=s.end),canOpen=lap.lap_duration>0&&Number.isFinite(lap.start);
    const ideal=idealLap(bests,lap.driver_number);
    const tags=[`<span class="tag tyre-${(tyre?.compound||'unknown').toLowerCase()}">${esc(titleCase(tyre?.compound||'Tyre unknown'))}</span>`,lap.clean?'<span class="tag">Clean lap</span>':'',lap.is_pit_out_lap?'<span class="tag">Pit out</span>':'',lap.pitIn?'<span class="tag">Pit in</span>':lap.inferredPitIn?'<span class="tag">Pit in (inferred)</span>':'',lap.deleted?'<span class="tag tag-warn">Deleted</span>':'',ideal?`<span class="tag" title="Sum of this driver’s three best sectors in the race. A what-if, not a recorded lap.">Ideal lap ${lapTime(ideal)}</span>`:''].join('');
    const trap=(label,value)=>`<div><span>${label}</span><strong>${positive(value)?Math.round(value)+' km/h':'—'}</strong></div>`;
    box.innerHTML=`<div class="race-detail-summary"><div><span class="eyebrow-muted">${esc(name(lap.driver_number))} · LAP ${lap.lap_number} OF ${row.completed||model.maxLap}</span><strong>${lapTime(lap.lap_duration)}</strong></div><div class="tags">${tags}</div></div><div class="quali-sectors">${sectorBoxes(bests,lap,timeText)}</div><div class="speed-traps">${trap('INTERMEDIATE 1',lap.i1_speed)}${trap('INTERMEDIATE 2',lap.i2_speed)}${trap('SPEED TRAP',lap.st_speed)}</div><div class="quali-actions"><button class="primary" data-race-action="explore" ${canOpen?'':'disabled data-unavailable'}>Open telemetry ↗</button><button class="secondary" data-race-action="pin" ${canOpen?'':'disabled data-unavailable'}>Set as comparison A</button><button class="secondary" data-race-action="compare" ${canOpen&&pinned&&pinned!==selected?'':'disabled data-unavailable'}>Compare A with this lap ↗</button></div><p class="small-note">${pinned?`Comparison A: ${esc(name(findLap(pinned).driver_number))} · Lap ${findLap(pinned).lap_number}. `:'Set a lap as A, then choose another lap or driver to compare. '}Purple: fastest of the race. Green: this driver’s fastest.</p>`;
    box.querySelector('[data-race-action="explore"]').onclick=()=>{if(canOpen)openLaps([lap]);};
    box.querySelector('[data-race-action="pin"]').onclick=()=>{if(canOpen){pinned=selected;renderDetail();}};
    box.querySelector('[data-race-action="compare"]').onclick=()=>{if(canOpen&&pinned&&pinned!==selected)openLaps([findLap(pinned),lap]);};
  }
  function renderStintPace(){
    const box=$('.race-stint-pace');if(!box)return;
    const rows=series().flatMap(r=>stintPace(r).map(s=>({r,s})));
    box.innerHTML=rows.length?`<div class="table-scroll"><table class="compact-table"><thead><tr><th scope="col">DRIVER</th><th scope="col">TYRE</th><th scope="col">LAPS</th><th scope="col">TYPICAL LAP</th><th scope="col">BEST</th><th scope="col">LAPS COUNTED</th></tr></thead><tbody>${rows.map(({r,s})=>`<tr data-hl-driver="${r.driver.driver_number}"><td><span class="team-line" style="background:${colors.get(r.driver.driver_number)}"></span>${esc(last(r.driver.driver_number))}</td><td><span class="tag tyre-${(s.compound||'unknown').toLowerCase()}">${esc(titleCase(s.compound||'Unknown'))}</span></td><td>${s.lap_start}–${s.end}${s.endInferred?' <small>(end inferred)</small>':''}</td><td>${s.median?lapTime(s.median):'—'}</td><td>${s.best?lapTime(s.best):'—'}</td><td>${s.count}</td></tr>`).join('')}</tbody></table></div>`:noData('Select drivers on the Story tab to compare stint pace.');
    applyHighlight();
  }

  // ---- Strategy
  function renderStrategy(){
    const box=$('.race-strategy');if(!box)return;
    box.innerHTML=`<div class="race-strategy-inner"><div class="race-stint-axis"><span>ALL ${model.rows.length} DRIVERS</span><div>${xTicks().map(l=>`<span style="left:${(l-1)/Math.max(1,model.maxLap)*100}%">${l}</span>`).join('')}</div></div>${model.rows.map(r=>`<div class="race-stint-row${focus===r.driver.driver_number?' is-focus-row':''}"><div class="race-stint-name"><span class="team-line" style="background:${colors.get(r.driver.driver_number)}"></span><span><strong>${esc(last(r.driver.driver_number))}</strong><small>${statusOf(r)} · ${r.completed} laps · ${r.pits.length} stop${r.pits.length===1?'':'s'}</small></span></div><div class="race-stint-track">${r.stints.map((s,i)=>{
      const style=tyreStyle[s.compound]||tyreStyle.UNKNOWN;
      return `<button class="race-stint" data-stint-driver="${r.driver.driver_number}" data-stint-index="${i}" style="left:${(s.lap_start-1)/Math.max(1,model.maxLap)*100}%;width:calc(${(s.end-s.lap_start+1)/Math.max(1,model.maxLap)*100}% - 2px);background:${style[1]};color:${style[2]}" aria-label="${esc(fullName(r.driver))}, ${esc(s.compound||'unknown')} tyres, laps ${s.lap_start} to ${s.end}${s.endInferred?', end inferred':''}" title="${esc(titleCase(s.compound||'Unknown'))} · Laps ${s.lap_start}–${s.end}${s.endInferred?' (end inferred)':''} · starting tyre age ${s.tyre_age_at_start??'?'} laps">${s.end-s.lap_start>1?style[0]:''}</button>`;
    }).join('')}${r.pits.map((p,i)=>`<button class="race-pit${positive(p.stop_duration)&&p.stop_duration<2.5?' is-quick':''}" data-pit-driver="${r.driver.driver_number}" data-pit-index="${i}" style="left:${(p.lap_number-.5)/Math.max(1,model.maxLap)*100}%" aria-label="${esc(fullName(r.driver))}, pit lane on lap ${p.lap_number}" title="Lap ${p.lap_number}: stationary ${timeText(p.stop_duration)}, pit lane ${timeText(p.lane_duration??p.pit_duration)}"></button>`).join('')}${!r.stints.length?'<span class="race-stint-missing">No tyre stint records</span>':''}</div></div>`).join('')}</div>`;
    box.querySelectorAll('[data-stint-driver]').forEach(button=>button.onclick=()=>{
      const r=rowFor(button.dataset.stintDriver),s=r.stints[Number(button.dataset.stintIndex)];
      $('.race-strategy-readout').textContent=`${fullName(r.driver)} · ${titleCase(s.compound||'Unknown')} · laps ${s.lap_start}–${s.end}${s.endInferred?' (end inferred)':''} · tyre age at start: ${s.tyre_age_at_start??'unknown'} laps. Tyre changes do not necessarily indicate a pit stop.`;
    });
    box.querySelectorAll('[data-pit-driver]').forEach(button=>button.onclick=()=>{
      const r=rowFor(button.dataset.pitDriver),p=r.pits[Number(button.dataset.pitIndex)];
      $('.race-strategy-readout').textContent=`${fullName(r.driver)} · lap ${p.lap_number} · stationary: ${timeText(p.stop_duration)} · total pit-lane time: ${timeText(p.lane_duration??p.pit_duration)}.`;
      chooseLap(r.laps.find(l=>l.lap_number===p.lap_number));
    });
  }
  function strategySide(){
    const stops=model.rows.flatMap(r=>r.pits.map(p=>({r,p}))).filter(o=>positive(o.p.stop_duration)).sort((a,b)=>a.p.stop_duration-b.p.stop_duration);
    const total=model.rows.reduce((n,r)=>n+r.pits.length,0);
    const top=stops.slice(0,10),max=top.length?top[top.length-1].p.stop_duration:1;
    const ranking=top.length?top.map(({r,p},i)=>`<div class="rank-row"><span class="rank-pos">${i+1}</span><span class="team-line" style="background:${colors.get(r.driver.driver_number)}"></span><span>${esc(last(r.driver.driver_number))} <small>L${p.lap_number}</small></span><span class="bar"><span style="width:${p.stop_duration/max*100}%"></span></span><strong>${p.stop_duration.toFixed(1)} s</strong></div>`).join(''):noData('No stationary times recorded.');
    const teams=new Map();for(const {r,p} of stops){const team=r.driver.team_name||'Unknown team';teams.set(team,[...(teams.get(team)||[]),p.stop_duration]);}
    const teamRows=[...teams.entries()].map(([team,times])=>({team,m:median(times),n:times.length})).sort((a,b)=>a.m-b.m).map(t=>`<div class="list-row"><span>${esc(t.team)}</span><span>${t.m.toFixed(1)} s <small>· ${t.n} stop${t.n===1?'':'s'}</small></span></div>`).join('');
    return `<div class="panel"><div class="panel-heading"><div><span class="eyebrow">PIT CREWS</span><h2>Fastest stops</h2></div></div><div class="panel-body">${ranking}<p class="small-note">Stationary time only. ${total-stops.length} of ${total} recorded visits have no stationary time.</p></div></div><div class="panel"><div class="panel-heading"><div><span class="eyebrow">BY TEAM</span><h2>Typical stationary time</h2></div></div><div class="panel-body">${teamRows||noData('No stationary times recorded.')}<p class="small-note">Median of each team’s recorded stationary times.</p></div></div>`;
  }
  function strategyCards(){
    const stops=model.rows.flatMap(r=>r.pits.map(p=>({r,p}))).filter(o=>positive(o.p.stop_duration)).sort((a,b)=>a.p.stop_duration-b.p.stop_duration);
    const classified=model.rows.filter(r=>positive(r.result?.position));
    const counts=new Map();for(const r of classified)counts.set(r.pits.length,(counts.get(r.pits.length)||0)+1);
    const common=[...counts.entries()].sort((a,b)=>b[1]-a[1])[0];
    const compounds=[...new Set(model.rows.flatMap(r=>r.stints.map(s=>s.compound).filter(Boolean)))];
    const card=(k,v,c)=>`<div class="stat"><small>${k}</small><strong>${esc(v)}</strong><span>${esc(c)}</span></div>`;
    return `<div class="stats">${card('PIT-LANE VISITS',pitsAvailable?model.rows.reduce((n,r)=>n+r.pits.length,0):'Unavailable','All drivers, recorded visits')}${card('MOST COMMON STRATEGY',pitsAvailable&&common?`${common[0]} stop${common[0]===1?'':'s'}`:'—',pitsAvailable&&common?`${common[1]} of ${classified.length} classified drivers`:'Pit records unavailable')}${card('FASTEST STOP',stops[0]?stops[0].p.stop_duration.toFixed(1)+' s':'—',stops[0]?`${fullName(stops[0].r.driver)} · lap ${stops[0].p.lap_number}`:'No stationary times')}${card('COMPOUNDS USED',compounds.length||'—',compounds.map(titleCase).join(', ')||'No stint records')}</div>`;
  }

  // ---- Events
  const EVENT_FILTERS=[['key','Key moments',e=>e.key],['stewards','Penalties & stewards',e=>['penalty','stewards'].includes(e.kind)],['flags','Flags',e=>['safety','flag','yellow','blue'].includes(e.kind)],['limits','Track limits',e=>e.kind==='limits'],['all','Everything',()=>true]];
  const kindLabel={penalty:'PENALTY',stewards:'STEWARDS',race:'RACE',safety:'SAFETY',flag:'FLAG',yellow:'YELLOW',limits:'TRACK LIMITS',blue:'BLUE FLAG',other:'NOTICE'};
  function renderEvents(){
    const box=$('.race-events');if(!box)return;
    const test=EVENT_FILTERS.find(f=>f[0]===eventFilter)[2];
    const list=entries.filter(e=>test(e)&&(!eventDriver||e.drivers.includes(Number(eventDriver))));
    root.querySelectorAll('[data-event-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.eventFilter===eventFilter)));
    box.innerHTML=list.length?`<ol class="event-list">${list.map(e=>`<li class="event-item kind-${e.kind}"><div class="event-when">${e.lap!=null?`<button type="button" class="event-lap" data-event-lap="${e.lap}" aria-label="Show the running order around lap ${e.lap}">Lap ${e.lap}</button>`:'<span>—</span>'}<small>${new Date(e.time).toISOString().slice(11,16)} UTC</small></div><span class="event-dot" aria-hidden="true"></span><div><div class="event-title"><span class="event-kind">${kindLabel[e.kind]}</span><strong>${esc(e.title)}</strong>${e.drivers.filter(n=>rowFor(n)).map(n=>`<span class="event-driver"><i style="background:${colors.get(n)}"></i>${esc(rowFor(n).driver.name_acronym||last(n))}</span>`).join('')}</div>${e.detail?`<p>${esc(e.detail)}${e.local&&['penalty','stewards'].includes(e.kind)?` · incident at ${e.local} local time`:''}</p>`:''}${showOriginal?`<p class="event-original">${esc(e.original)}</p>`:''}</div></li>`).join('')}</ol>`:noData('No race-control messages match this filter.');
    box.querySelectorAll('[data-event-lap]').forEach(button=>button.onclick=()=>jumpToLap(Number(button.dataset.eventLap)));
  }
  function jumpToLap(lap){readPositions(Math.min(model.maxLap,Math.max(1,lap)),false);switchTab('story');$('.race-position-panel').scrollIntoView({behavior:'smooth',block:'start'});}
  function ribbon(){
    const aid=aidOffBands(entries,model.maxLap),byLap=new Map();
    for(const e of entries)if(Number.isInteger(e.lap))byLap.set(e.lap,[...(byLap.get(e.lap)||[]),e]);
    const cells=Array.from({length:model.maxLap},(_,i)=>{
      const lap=i+1,list=byLap.get(lap)||[],kinds=new Set(list.map(e=>e.kind));
      const red=list.some(e=>e.kind==='safety'&&e.title==='Red flag'),safety=list.some(e=>e.kind==='safety'&&e.title!=='Red flag');
      const penalty=list.some(e=>e.kind==='penalty'&&!e.title.startsWith('Penalty served'));
      const off=aid.some(b=>lap>=b.from&&lap<=b.to),wetLap=wet.some(b=>lap>=b.from&&lap<=b.to);
      const parts=[off?'overtake aid off':'',wetLap?'most on wet tyres':'',kinds.has('yellow')?'yellow flag':'',safety?'safety car':'',red?'red flag':'',penalty?'penalty decision':''].filter(Boolean);
      return `<button type="button" class="ribbon-cell${off?' is-off':''}${wetLap?' is-wet':''}${red?' is-red':safety?' is-sc':''}" data-ribbon-lap="${lap}" aria-label="Lap ${lap}${parts.length?': '+parts.join(', '):''}" title="Lap ${lap}${parts.length?' · '+parts.join(' · '):''}">${penalty?'<i class="ribbon-penalty"></i>':''}${kinds.has('yellow')?'<i class="ribbon-yellow"></i>':''}</button>`;
    }).join('');
    const label=aid.length?(entries.some(e=>/^DRS/.test(e.original.toUpperCase()))?'DRS off':'Overtake mode off'):'';
    return `<div class="ribbon">${cells}</div><div class="ribbon-axis"><span>Lap 1</span><span>Lap ${Math.round(model.maxLap/2)}</span><span>Lap ${model.maxLap}</span></div><div class="legend-row">${label?`<span><i class="lg lg-off"></i>${label}</span>`:''}${wet.length?'<span><i class="lg lg-wet"></i>Most on wet tyres</span>':''}<span><i class="lg lg-yellow"></i>Yellow flag</span><span><i class="lg lg-sc"></i>Safety car</span><span><i class="lg lg-red"></i>Red flag</span><span><i class="lg lg-penalty"></i>Penalty decision</span></div><p class="small-note">Click a lap to see the running order at that point.</p>`;
  }

  // ---- Side column
  function renderRail(){
    if(!model)return;
    if(tab==='story'){
      const winner=model.rows.find(r=>r.result?.position===1)||model.rows[0];
      const row=rowFor(focus)||winner,id=row.driver.driver_number,best=bestLap(row);
      const other=row===winner?model.rows.find(r=>r.result?.position===2):winner,otherBest=other&&bestLap(other);
      const tyres=row.stints.map(s=>{const st=tyreStyle[s.compound]||tyreStyle.UNKNOWN;return `<span title="${esc(titleCase(s.compound||'Unknown'))} · laps ${s.lap_start}–${s.end}" style="flex:${s.end-s.lap_start+1} 1 0;background:${st[1]}"></span>`;}).join('');
      const stops=row.pits.map(p=>`<div class="list-row"><span>Lap ${p.lap_number}</span><span>${short(p.lane_duration??p.pit_duration)} lane · <strong>${short(p.stop_duration)}</strong></span></div>`).join('');
      const top=model.rows.filter(r=>positive(r.result?.position)).slice(0,10);
      const el=setRail(`<section class="rail-card"><span class="eyebrow-muted">${focus==null?'RACE WINNER':'DRIVER IN FOCUS'}</span><div class="focus-head"><span class="team-bar" style="background:${colors.get(id)}"></span><div><strong>${esc(fullName(row.driver))}</strong><small>${esc(row.driver.team_name||'Team unavailable')} · #${id}</small></div></div><div class="mini-stats"><div><small>STARTED</small><strong>${place(row.grid)}</strong></div><div><small>FINISHED</small><strong>${statusOf(row)}</strong></div><div><small>BEST LAP</small><strong>${best?lapTime(best.lap_duration):'—'}</strong></div><div><small>PIT VISITS</small><strong>${pitsAvailable?row.pits.length:'—'}</strong></div></div>${tyres?`<small class="eyebrow-muted">TYRES</small><div class="tyre-bar">${tyres}</div><p class="small-note">${row.stints.map(s=>titleCase(s.compound||'Unknown')).join(' → ')}</p>`:''}${stops?`<small class="eyebrow-muted">PIT LANE · STATIONARY</small>${stops}`:''}<div class="rail-actions">${best?'<button type="button" class="primary" data-rail="best">Explore best lap ↗</button>':''}${best&&otherBest?`<button type="button" class="secondary" data-rail="compare">Compare with ${esc(last(other.driver.driver_number))}’s best</button>`:''}</div><p class="small-note">Started is the first recorded position. Highlight another driver to change this card.</p></section><section class="rail-card"><div class="rail-head"><span class="eyebrow-muted">CLASSIFICATION · TOP 10</span><button type="button" class="link-button" data-rail="results">All results →</button></div>${top.map(r=>{const d=positive(r.grid)?r.grid-r.result.position:null;return `<button type="button" class="class-row${focus===r.driver.driver_number?' is-current':''}" data-rail-driver="${r.driver.driver_number}"><span class="pos">${r.result.position}</span><span class="team-line" style="background:${colors.get(r.driver.driver_number)}"></span><span class="nm">${esc(last(r.driver.driver_number))}</span><span class="delta ${d>0?'up':d<0?'down':''}">${d==null?'':d>0?'+'+d:d<0?String(d):'='}</span><span class="gap">${r.result.position===1?'Winner':typeof r.result.gap_to_leader==='number'?'+'+r.result.gap_to_leader.toFixed(3):esc(r.result.gap_to_leader??'')}</span></button>`;}).join('')}<p class="small-note">± places against first recorded position. Click a driver to highlight them.</p></section>`);
      if(!el)return;
      el.querySelector('[data-rail="best"]')?.addEventListener('click',()=>openLaps([best]));
      el.querySelector('[data-rail="compare"]')?.addEventListener('click',()=>openLaps([best,otherBest]));
      el.querySelector('[data-rail="results"]')?.addEventListener('click',()=>showResults());
      el.querySelectorAll('[data-rail-driver]').forEach(b=>b.addEventListener('click',()=>setFocus(Number(b.dataset.railDriver)===focus?null:Number(b.dataset.railDriver))));
    }else if(tab==='events'){
      const given=entries.filter(e=>e.kind==='penalty'&&!e.title.startsWith('Penalty served')).length;
      const after=entries.filter(e=>e.title.startsWith('Investigation after')).length;
      const yellowLaps=new Set(entries.filter(e=>e.kind==='yellow'&&e.lap!=null).map(e=>e.lap)).size;
      const blue=entries.filter(e=>e.kind==='blue').length;
      const sc=entries.filter(e=>e.kind==='safety'&&/deployed$/.test(e.title)).length;
      const red=entries.filter(e=>e.kind==='safety'&&e.title==='Red flag').length;
      const limits=trackLimitCounts(entries);
      const row=(k,v)=>`<div class="list-row"><span>${k}</span><strong>${v}</strong></div>`;
      setRail(`<section class="rail-card"><span class="eyebrow-muted">IN NUMBERS</span>${row('Penalties given',given)}${row('Investigations after the race',after)}${row('Laps with a yellow flag',yellowLaps)}${row('Safety-car deployments',sc)}${row('Red flags',red)}${row('Blue flags',blue)}<p class="small-note">Counted from recorded race-control messages.</p></section><section class="rail-card"><span class="eyebrow-muted">TRACK LIMITS · TIMES DELETED</span>${limits.length?limits.slice(0,8).map(([n,c])=>`<div class="list-row"><span><span class="team-line" style="background:${colors.get(n)||'#9ca5b3'}"></span>${esc(rowFor(n)?fullName(rowFor(n).driver):'Car '+n)}</span><strong>${c}</strong></div>`).join(''):'<p class="small-note">No deleted lap times recorded.</p>'}${limits.length?`<p class="small-note">${limits.reduce((n,[,c])=>n+c,0)} lap times deleted in the race.</p>`:''}</section>`);
    }else setRail('');
  }

  // ---- Tabs
  function renderActive(){
    if(!model)return;
    if(tab==='story'){renderPositions();renderGap();}
    else if(tab==='pace'){renderPace();renderStintPace();}
  }
  function switchTab(next){
    tab=next;
    root.querySelectorAll('[data-race-tab]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.raceTab===tab)));
    root.querySelectorAll('[data-tab-panel]').forEach(p=>p.hidden=p.dataset.tabPanel!==tab);
    renderActive();renderRail();
    if(tab==='pace')renderDetail();
    else if(tab==='strategy')renderStrategy();
    else if(tab==='events')renderEvents();
    if(tab!=='pace')onWeather({time:model.clock.find(p=>p.lap===inspectLap)?.time,label:`Race lap ${inspectLap} · running order`});
  }
  // Re-draw charts only when the available width changes; height changes from re-drawing are ignored.
  let lastWidth=0;
  function scheduleCharts(){const width=root.clientWidth;if(width===lastWidth)return;lastWidth=width;cancelAnimationFrame(frameRequest);frameRequest=requestAnimationFrame(renderActive);}

  function headline(session){
    const winner=model.rows.find(r=>r.result?.position===1),second=model.rows.find(r=>r.result?.position===2);
    const sprint=session.session_name!=='Race';
    const location=session.location||session.circuit_short_name||session.country_name;
    const parts=[];
    if(winner&&second&&typeof second.result.gap_to_leader==='number')parts.push(`${fullName(winner.driver)} won by ${second.result.gap_to_leader.toFixed(3)} s.`);
    else if(winner)parts.push(`${fullName(winner.driver)} won.`);
    if(highlights.gain&&highlights.gain.places>=3)parts.push(`${fullName(highlights.gain.row.driver)} gained ${highlights.gain.places} places (P${highlights.gain.row.grid} → P${highlights.gain.row.result.position}).`);
    const startWet=wet.some(b=>b.from===1),endWet=wet.some(b=>b.to===model.maxLap);
    if(startWet||endWet)parts.push(`Most of the field ${startWet&&endWet?'started and finished':startWet?'started':'finished'} on intermediate or wet tyres.`);
    const date=new Date(session.date_start).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
    setHeading(`${String(session.country_name||'').toUpperCase()} · ${sprint?'SPRINT':'RACE'} · ${date.toUpperCase()} · ${model.maxLap} LAPS`,winner?`${surname(winner.driver)} wins ${sprint?'the sprint':'in '+location}`:`${session.country_name} ${session.session_name}`,parts.join(' ')||'Positions, pace, strategy and race control for the whole field.');
  }

  return {
    async load(session){
      observer?.disconnect();detailLapTools?.destroy();detailLapTools=null;detailPicker?.destroy();detailPicker=null;model=null;selected=null;pinned=null;visible=new Set();focus=null;hover=null;gapCeiling=60;bests=null;inspectLap=1;ceiling=180;eventFilter='key';eventDriver='';showOriginal=false;warnings=[];pitsAvailable=true;
      setRail('');
      if(!isRace(session)){root.innerHTML=noData('Choose a completed Grand Prix or sprint. This weekend has no saved race session yet.');return;}
      root.innerHTML='<div class="empty"><h2>Reading the race…</h2><p>Loading lap timings, positions, tyres and race-control records.</p></div>';
      const params={session_key:session.session_key};
      const drivers=await query('drivers',params),laps=await query('laps',params),results=await query('session_result',params);
      async function optional(endpoint,label){try{return await query(endpoint,params);}catch(e){if(e?.superseded)throw e;warnings.push(`${label} unavailable. Saved files may need updating.`);return [];}}
      const positions=await optional('position','Position history'),stints=await optional('stints','Tyre stints'),pits=await optional('pit','Pit-lane records'),messages=await optional('race_control','Race-control messages');
      pitsAvailable=!warnings.some(w=>w.startsWith('Pit-lane'));
      model=raceModel(session,drivers,lapChoices(laps,stints,pits,messages),results,positions,stints,pits,messages);
      if(!model.rows.length||!model.maxLap){root.innerHTML=noData('No race laps are available in this data source yet.');return;}
      const teams=new Map();colors=new Map();dashes=new Map();
      model.rows.forEach((r,i)=>{const team=r.driver.team_name||r.driver.driver_number,occurrence=teams.get(team)||0;teams.set(team,occurrence+1);colors.set(r.driver.driver_number,/^[\da-f]{6}$/i.test(r.driver.team_colour||'')?'#'+r.driver.team_colour:palettes[i%palettes.length]);dashes.set(r.driver.driver_number,patterns[occurrence%patterns.length]);visible.add(r.driver.driver_number);});
      bests=sectorBests(model.rows.flatMap(r=>r.laps));highlights=raceHighlights(model);wet=wetBands(model.rows,model.maxLap);
      entries=model.events.map(e=>({...describeEvent(e,n=>last(n)),id:e.id,time:e.time,lap:Number.isInteger(e.lap_number)&&e.lap_number>=1?Math.min(e.lap_number,model.maxLap):e.raceLap}));
      headline(session);
      const hl=highlights;
      const card=(title,value,caption,attrs,colour)=>`<button type="button" class="race-highlight" ${attrs||'disabled data-unavailable'}><small>${title}</small><strong>${esc(value)}</strong><span class="hl-who">${colour?`<i style="background:${colour}"></i>`:''}${esc(caption[0])}</span><span>${esc(caption[1])}</span></button>`;
      const highlightsHtml=`<div class="race-highlights">${
        card('FASTEST LAP',hl.fastest?lapTime(hl.fastest.lap.lap_duration):'Unavailable',hl.fastest?[fullName(hl.fastest.row.driver),`Lap ${hl.fastest.lap.lap_number} · inspect ↗`]:['No timed laps recorded',''],hl.fastest?`data-highlight-lap="${hl.fastest.lap.key}"`:'',hl.fastest&&colors.get(hl.fastest.row.driver.driver_number))}${
        card('MOST PLACES GAINED',hl.gain?`+${hl.gain.places}`:'Unavailable',hl.gain?[fullName(hl.gain.row.driver),`P${hl.gain.row.grid} → P${hl.gain.row.result.position}${hl.gain.ties?` · ${hl.gain.ties} other${hl.gain.ties===1?'':'s'} level`:''} · highlight ↗`]:['No driver finished ahead of their first recorded position',''],hl.gain?`data-highlight-driver="${hl.gain.row.driver.driver_number}"`:'',hl.gain&&colors.get(hl.gain.row.driver.driver_number))}${
        card('FASTEST PIT STOP',hl.stop?`${hl.stop.pit.stop_duration.toFixed(1)} s`:'Unavailable',hl.stop?[fullName(hl.stop.row.driver),`Lap ${hl.stop.pit.lap_number} · stationary time · inspect ↗`]:['No stationary times recorded',''],hl.stop?`data-highlight-lap="${hl.stop.row.driver.driver_number}:${hl.stop.pit.lap_number}"`:'',hl.stop&&colors.get(hl.stop.row.driver.driver_number))}${
        card('TOP SPEED TRAP',hl.trap?`${hl.trap.lap.st_speed} km/h`:'Unavailable',hl.trap?[fullName(hl.trap.row.driver),`Lap ${hl.trap.lap.lap_number} · inspect ↗`]:['No speed-trap readings recorded',''],hl.trap?`data-highlight-lap="${hl.trap.lap.key}"`:'',hl.trap&&colors.get(hl.trap.row.driver.driver_number))}</div>`;
      const teamGroups=[...new Set(model.rows.map(r=>r.driver.team_name||'Unknown team'))].map(team=>{const members=model.rows.filter(r=>(r.driver.team_name||'Unknown team')===team);return `<div class="team-group"><span class="team-bar" style="background:${colors.get(members[0].driver.driver_number)}"></span><button type="button" class="team-name" data-team="${esc(team)}" title="Show or hide both ${esc(team)} drivers">${esc(team)}</button>${members.map(r=>`<button type="button" class="driver-chip" data-chip-driver="${r.driver.driver_number}" data-hl-driver="${r.driver.driver_number}" aria-pressed="true" title="${esc(fullName(r.driver))} · #${r.driver.driver_number}"><i style="background:${colors.get(r.driver.driver_number)}"></i>${esc(r.driver.name_acronym||last(r.driver.driver_number))}</button>`).join('')}</div>`;}).join('');
      const counts=Object.fromEntries(EVENT_FILTERS.map(([k,,t])=>[k,entries.filter(t).length]));
      const eventDrivers=[...new Set(entries.flatMap(e=>e.drivers))].filter(n=>rowFor(n)).sort((a,b)=>last(a).localeCompare(last(b)));
      root.innerHTML=`${warnings.length?`<div class="note">${warnings.map(esc).join('<br>')}</div>`:''}<div class="race-tabs" role="tablist" aria-label="Race sections">${TABS.map(([k,l])=>`<button type="button" role="tab" data-race-tab="${k}" aria-selected="${k===tab}">${l}</button>`).join('')}</div>
<div data-tab-panel="story" ${tab==='story'?'':'hidden'}>${highlightsHtml}
<div class="panel race-driver-panel"><div class="panel-heading"><div><span class="eyebrow">CHOOSE YOUR BATTLE</span><h2>Drivers on the charts</h2></div><div class="chip-row"><button type="button" class="chip" data-driver-set="all">All ${model.rows.length}</button><button type="button" class="chip" data-driver-set="top10">Top 10</button><button type="button" class="chip" data-driver-set="podium">Podium</button><button type="button" class="chip" data-driver-set="none">None</button></div></div><div class="panel-body"><div class="team-groups">${teamGroups}</div><div class="race-focus-bar"><label>HIGHLIGHT<select id="race-focus"><option value="">No driver highlighted</option>${model.rows.map(r=>`<option value="${r.driver.driver_number}">${esc(fullName(r.driver))}</option>`).join('')}</select></label><button type="button" class="secondary" data-focus-action="only">Only this driver</button><button type="button" class="secondary" data-focus-action="teammate">Add teammate</button><button type="button" class="secondary" data-focus-action="clear">Clear highlight</button></div><p class="small-note race-focus-note" aria-live="polite"></p><p class="small-note">Click a driver to show or hide them, or a team name for both drivers. Highlighting changes emphasis only; every driver stays available.</p></div></div>
<div class="panel race-position-panel"><div class="panel-heading"><div><span class="eyebrow">THE RUNNING ORDER</span><h2>Position through the race</h2></div></div><div class="race-position-chart race-chart"></div><div class="race-slider"><label for="race-progress" id="race-progress-label">Race lap 1</label><input id="race-progress" type="range" min="1" max="${model.maxLap}" value="1" aria-label="Inspect race lap"><span>Race lap →</span></div><div class="race-position-readout"></div><p class="small-note panel-foot">Positions at the first observed completion of each race lap. ${wet.length?'Blue bands: most of the field on intermediate or wet tyres. ':''}Dashed lines: safety cars and suspensions. Final results can differ after penalties.</p></div>
<div class="panel race-gap-panel"><div class="panel-heading"><div><span class="eyebrow">WHO IS CATCHING WHOM</span><h2>Gap to the leader</h2></div><label>SHOW GAPS UP TO<select id="race-gap-ceiling"><option value="30">30 seconds</option><option value="60" selected>60 seconds</option><option value="120">120 seconds</option><option value="Infinity">All gaps</option></select></label></div><div class="race-gap-chart race-chart"></div><p class="small-note panel-foot race-gap-note"></p></div>
<details class="method"><summary>How race data is aligned</summary><p>The position chart uses a common race-lap clock derived from the earliest observed completion time (or next-lap start) for each lap. It carries the latest recorded position forward to that instant, never interpolates positions and never fills from a future update. Missing crossing times break lines. Retired drivers stop at their last known completed-lap time. Position changes are not counted as overtakes.</p><p>The gap chart measures, for each race lap, how long after the first car each driver completed that same lap. A lapped driver’s gap therefore exceeds a lap time. Wet-tyre bands come from recorded stints: laps where more than half of the drivers with a stint record were on intermediate or wet tyres. Most places gained compares the first recorded position with the classified finish.</p></details></div>
<div data-tab-panel="pace" ${tab==='pace'?'':'hidden'}>
<div class="panel race-pace-panel"><div class="panel-heading"><div><span class="eyebrow">THE RHYTHM OF THE RACE</span><h2>Lap-time progression</h2></div><label>HIDE LAPS SLOWER THAN<select id="race-ceiling"><option value="180">3:00</option><option value="120">2:00</option><option value="100">1:40</option><option value="Infinity">Show all</option></select></label></div><div class="race-pace-chart race-chart"></div><p class="small-note panel-foot race-pace-note"></p></div>
<div class="panel race-lap-inspector"><div class="panel-heading"><div><span class="eyebrow">LOOK CLOSER</span><h2>Lap inspector</h2></div><div class="quali-controls"><label>DRIVER<select id="race-detail-driver">${model.rows.map(r=>`<option value="${r.driver.driver_number}">${esc(fullName(r.driver))}</option>`).join('')}</select></label><label>LAP<select id="race-detail-lap"></select></label></div></div><div class="race-detail-content panel-body" aria-live="polite"></div></div>
<div class="panel"><div class="panel-heading"><div><span class="eyebrow">STINT PACE</span><h2>How quick was each stint?</h2></div></div><div class="race-stint-pace panel-body"></div><p class="small-note panel-foot">Typical lap is the stint’s median, leaving out its first and last lap, pit-in and pit-out laps and deleted laps. Fuel and traffic are not accounted for. Shows the drivers selected on the Story tab.</p></div></div>
<div data-tab-panel="strategy" ${tab==='strategy'?'':'hidden'}>${strategyCards()}<div class="two-col"><div class="panel race-strategy-panel"><div class="panel-heading"><div><span class="eyebrow">TYRES & PIT LANE</span><h2>Every driver’s strategy</h2></div></div><div class="race-tyre-legend">${Object.entries(tyreStyle).map(([compound,style])=>`<span><i style="background:${style[1]}"></i>${titleCase(compound)}</span>`).join('')}<span><i class="pit-key"></i>Pit-lane visit</span><span><i class="pit-key is-quick"></i>Under 2.5 s stationary</span></div><div class="race-strategy"></div><p class="race-strategy-readout small-note panel-foot" aria-live="polite">Bars use each driver’s own lap numbers. Select a stint or pit marker for details. A tyre change during a stoppage is not counted as a pit stop.</p></div><div class="side-stack">${strategySide()}</div></div></div>
<div data-tab-panel="events" ${tab==='events'?'':'hidden'}><div class="panel"><div class="panel-heading"><div><span class="eyebrow">THE RACE AT A GLANCE</span><h2>${model.maxLap} laps, one strip</h2></div></div><div class="panel-body">${ribbon()}</div></div>
<div class="panel"><div class="panel-heading"><div><span class="eyebrow">WHAT CHANGED THE RACE</span><h2>Race-control timeline</h2></div></div><div class="panel-body"><div class="chip-row">${EVENT_FILTERS.map(([k,l])=>`<button type="button" class="chip" data-event-filter="${k}" aria-pressed="${k===eventFilter}">${l} · ${counts[k]}</button>`).join('')}<label class="inline-label">ABOUT<select id="race-event-driver"><option value="">All drivers</option>${eventDrivers.map(n=>`<option value="${n}">${esc(fullName(rowFor(n).driver))}</option>`).join('')}</select></label><label class="mode"><input type="checkbox" id="race-event-original"> Show original wording</label></div><p class="small-note">Messages are rewritten in plain language from the recorded text. Key moments hide blue flags and routine notices. Times are UTC; race-lap locations come from the record or are estimated from timing.</p><div class="race-events"></div></div></div></div>`;
      root.querySelectorAll('[data-race-tab]').forEach(b=>b.onclick=()=>switchTab(b.dataset.raceTab));
      root.querySelectorAll('[data-chip-driver]').forEach(chip=>{const id=Number(chip.dataset.chipDriver);chip.onclick=()=>{visible.has(id)?visible.delete(id):visible.add(id);syncChips();renderActive();applyHighlight();};chip.onpointerenter=()=>{if(visible.has(id))setHover(id);};chip.onpointerleave=()=>setHover(null);});
      root.querySelectorAll('[data-team]').forEach(button=>button.onclick=()=>{const members=model.rows.filter(r=>(r.driver.team_name||'Unknown team')===button.dataset.team).map(r=>r.driver.driver_number);const allOn=members.every(n=>visible.has(n));members.forEach(n=>allOn?visible.delete(n):visible.add(n));syncChips();renderActive();applyHighlight();});
      root.querySelectorAll('[data-driver-set]').forEach(button=>button.onclick=()=>{const mode=button.dataset.driverSet;const classified=model.rows.filter(r=>positive(r.result?.position));visible=new Set((mode==='none'?[]:mode==='podium'?classified.filter(r=>r.result.position<=3):mode==='top10'?classified.filter(r=>r.result.position<=10):model.rows).map(r=>r.driver.driver_number));syncChips();renderActive();applyHighlight();});
      $('#race-focus').onchange=e=>setFocus(e.target.value===''?null:Number(e.target.value));
      root.querySelectorAll('[data-focus-action]').forEach(button=>button.onclick=()=>{
        const action=button.dataset.focusAction;
        if(action==='clear'){setFocus(null);return;}
        if(focus==null)return;
        const team=rowFor(focus)?.driver.team_name;
        if(action==='only')visible=new Set([focus]);
        else{visible.add(focus);if(team)model.rows.filter(r=>r.driver.team_name===team).forEach(r=>visible.add(r.driver.driver_number));}
        syncChips();renderActive();applyHighlight();
      });
      $('#race-progress').oninput=e=>readPositions(Number(e.target.value));
      $('#race-ceiling').onchange=e=>{ceiling=Number(e.target.value);renderPace();};
      $('#race-gap-ceiling').onchange=e=>{gapCeiling=Number(e.target.value);renderGap();};
      root.querySelectorAll('[data-highlight-lap]').forEach(button=>button.onclick=()=>chooseLap(findLap(button.dataset.highlightLap),true));
      root.querySelectorAll('[data-highlight-driver]').forEach(button=>button.onclick=()=>{setFocus(Number(button.dataset.highlightDriver));$('.race-position-panel').scrollIntoView({behavior:'smooth',block:'start'});});
      $('#race-detail-driver').onchange=e=>{fillLapOptions(Number(e.target.value));renderDetail();};
      $('#race-detail-lap').onchange=e=>{selected=e.target.value;renderDetail();};
      root.querySelectorAll('[data-event-filter]').forEach(b=>b.onclick=()=>{eventFilter=b.dataset.eventFilter;renderEvents();});
      $('#race-event-driver').onchange=e=>{eventDriver=e.target.value;renderEvents();};
      $('#race-event-original').onchange=e=>{showOriginal=e.target.checked;renderEvents();};
      root.querySelectorAll('[data-ribbon-lap]').forEach(b=>b.onclick=()=>jumpToLap(Number(b.dataset.ribbonLap)));
      detailPicker=createDriverPicker($('#race-detail-driver'),()=>model.rows.map(r=>r.driver),'Choose a driver to inspect');
      detailLapTools=createLapTools($('#race-detail-lap'),{getLaps:()=>rowFor($('#race-detail-driver').value)?.laps||[],value:lap=>lap.key});
      const startRow=model.rows.find(r=>r.result?.position===1)||model.rows[0];
      $('#race-detail-driver').value=String(startRow.driver.driver_number);
      fillLapOptions(startRow.driver.driver_number,bestLap(startRow)?.lap_number);
      switchTab(tab);readPositions(inspectLap,false);applyHighlight();
      lastWidth=root.clientWidth;observer=new ResizeObserver(scheduleCharts);observer.observe(root);
    }
  };
}
