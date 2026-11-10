import {lapDeletionStates} from './qualifying.js';
import {normalizeStints} from './race.js';
import {lapTime} from './telemetry.js';
export const cleanLapHelp='Clean means a timed lap with a start timestamp, no recorded deletion, and no recorded or inferred pit-in/pit-out. Traffic, flags, fuel and missing records are not assessed.';
export function lapChoices(laps,stints=[],pits=[],messages=[]){
 const deletions=lapDeletionStates(messages),tyres=new Map();
 for(const id of new Set(laps.map(l=>l.driver_number))){const last=Math.max(0,...laps.filter(l=>l.driver_number===id).map(l=>l.lap_number));tyres.set(id,normalizeStints(stints.filter(s=>s.driver_number===id),last));}
 return laps.map(lap=>{
  const next=laps.find(l=>l.driver_number===lap.driver_number&&l.lap_number===lap.lap_number+1);
  const pitIn=pits.some(p=>p.driver_number===lap.driver_number&&p.lap_number===lap.lap_number);
  const inferredPitIn=!pitIn&&next?.is_pit_out_lap===true;
  const deleted=deletions.get(`${lap.driver_number}:${lap.lap_number}`)?.deleted??false;
  const tyre=tyres.get(lap.driver_number)?.find(s=>lap.lap_number>=s.lap_start&&lap.lap_number<=s.end)?.compound;
  const timed=typeof lap.lap_duration==='number'&&lap.lap_duration>0&&Number.isFinite(Date.parse(lap.date_start));
  return {...lap,tyre,pitIn,inferredPitIn,deleted,clean:timed&&!lap.is_pit_out_lap&&!pitIn&&!inferredPitIn&&!deleted};
 }).sort((a,b)=>a.lap_number-b.lap_number);
}
export const fastestClean=laps=>laps.filter(l=>l.clean).reduce((best,lap)=>!best||lap.lap_duration<best.lap_duration?lap:best,null);
export const lapLabel=lap=>`Lap ${lap.lap_number} · ${lapTime(lap.lap_duration)} · ${lap.tyre||'Tyre unknown'}${lap.is_pit_out_lap?' · Pit out':''}${lap.pitIn?' · Pit in':lap.inferredPitIn?' · Pit in (inferred)':''}${lap.deleted?' · Deleted':''}`;
export function createLapTools(select,{getLaps,value=lap=>String(lap.lap_number)}){
 const label=select.parentElement,wrapper=document.createElement('div');wrapper.className='lap-choice-control';label.replaceWith(wrapper);wrapper.append(label);
 const tools=document.createElement('div');tools.className='lap-shortcuts';tools.innerHTML='<button type="button" class="secondary" data-step="-1" aria-label="Previous available lap">← Previous</button><button type="button" class="secondary" data-fastest title="'+cleanLapHelp+'">Fastest clean lap</button><button type="button" class="secondary" data-step="1" aria-label="Next available lap">Next →</button>';
 const caption=document.createElement('p');caption.className='lap-choice-caption';wrapper.append(tools,caption);
 function sync(){
  const rows=getLaps(),allowed=new Set([...select.options].map(o=>o.value)),best=fastestClean(rows.filter(l=>allowed.has(value(l)))),index=select.selectedIndex;
  for(const button of tools.querySelectorAll('button')){
   const unavailable=button.hasAttribute('data-fastest')?!best:index<0||(button.dataset.step==='-1'?index===0:index===select.options.length-1);
   button.toggleAttribute('data-unavailable',unavailable);button.disabled=select.disabled||unavailable;
  }
  const selected=rows.find(l=>value(l)===select.value);
  caption.textContent=selected?`${selected.tyre||'Tyre unknown'}${selected.is_pit_out_lap?' · Pit out':''}${selected.pitIn?' · Pit in':selected.inferredPitIn?' · Pit in (inferred)':''}${selected.deleted?' · Deleted':''}${best?'':' · No clean lap available'}`:'No lap selected';
  caption.title=cleanLapHelp;
 }
 for(const button of tools.querySelectorAll('[data-step]'))button.onclick=()=>{const next=select.selectedIndex+Number(button.dataset.step);if(next>=0&&next<select.options.length){select.selectedIndex=next;select.dispatchEvent(new Event('change',{bubbles:true}));sync();}};
 tools.querySelector('[data-fastest]').onclick=()=>{const allowed=new Set([...select.options].map(o=>o.value)),best=fastestClean(getLaps().filter(l=>allowed.has(value(l))));if(best){select.value=value(best);select.dispatchEvent(new Event('change',{bubbles:true}));sync();}};
 const observer=new MutationObserver(sync);observer.observe(select,{childList:true,attributes:true,attributeFilter:['disabled']});select.addEventListener('change',sync);sync();
 return {sync,destroy(){observer.disconnect();select.removeEventListener('change',sync);wrapper.replaceWith(label);}};
}
