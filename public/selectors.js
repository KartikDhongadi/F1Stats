const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const normalize=value=>String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const colour=driver=>/^[\da-f]{6}$/i.test(driver?.team_colour||'')?'#'+driver.team_colour:'#9ba6b7';
const date=value=>new Date(value).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
export function createRacePicker({loadSummary,onSelect,onSeasonChange,years}){
 const dialog=document.createElement('dialog');dialog.className='selection-dialog race-selection';dialog.setAttribute('aria-labelledby','race-picker-title');
 dialog.innerHTML='<div class="selection-heading"><div><span class="eyebrow" id="picker-season-heading">CHOOSE A SEASON</span><h2 id="race-picker-title">Choose your race weekend.</h2><p>Open a weekend to explore its results, laps and strategy.</p></div><button type="button" class="secondary" data-close aria-label="Close race selector">Close ×</button></div><label class="picker-year-label">SEASON<select id="picker-year" aria-label="Race grid season"></select></label><label class="selection-search">FIND A RACE<input type="search" placeholder="Search country or circuit…" aria-label="Search race weekends"></label><p class="selection-note">Grand Prix podiums · saved results · dates in UTC</p><div class="race-card-grid"></div>';
 document.body.append(dialog);
 let weekends=[],allSessions=[],selected=null,podiums=new Map(),emptyMessage='No completed weekends available for this season.';
 const seasonSelect=dialog.querySelector('#picker-year');seasonSelect.innerHTML=years.map(year=>`<option value="${year}">${year}</option>`).join('');seasonSelect.onchange=()=>onSeasonChange(Number(seasonSelect.value));
 const search=dialog.querySelector('input'),grid=dialog.querySelector('.race-card-grid');
 function render(){
  const matches=weekends.filter(r=>normalize([r.country_name,r.circuit_short_name,r.location].join(' ')).includes(normalize(search.value)));
  grid.innerHTML=matches.map(r=>{
   const sessions=allSessions.filter(s=>s.meeting_key===r.meeting_key),gp=sessions.find(s=>s.session_name==='Race'),podium=podiums.get(r.meeting_key),active=String(r.session_key)===String(selected);
   return `<button type="button" class="race-card${active?' selected':''}" data-weekend="${r.session_key}" aria-pressed="${active}"><span class="race-card-top"><span>${esc(date(r.date_start))}</span><span>${active?'Selected ✓':gp?'Race completed':'Weekend in progress'}</span></span><strong class="race-card-name">${esc(r.country_name)}</strong><span class="race-card-circuit">Grand Prix · ${esc(r.circuit_short_name)}</span><span class="race-card-sessions">${sessions.some(s=>/Sprint|Shootout/.test(s.session_name))?'Sprint weekend · ':''}${sessions.length} available sessions</span><span class="podium-title">GRAND PRIX PODIUM</span>${gp?podium?.length?`<span class="card-podium">${[1,2,3].map(position=>{const entry=podium.find(p=>p.position===position);return `<span><b class="podium-place place-${position}">${position}</b><span>${esc(entry?.name||'Unavailable')}</span></span>`;}).join('')}</span>`:'<span class="podium-missing">Results not available in saved files</span>':'<span class="podium-missing">Grand Prix not completed / available yet</span>'}<span class="race-card-open">Explore weekend ↗</span></button>`;
  }).join('')||`<p class="selection-empty">${esc(weekends.length?'No matching weekends. Try another country or circuit.':emptyMessage)}</p>`;
  grid.querySelectorAll('[data-weekend]').forEach(button=>button.onclick=()=>{selected=button.dataset.weekend;dialog.close();onSelect(selected);});
 }
 search.oninput=render;dialog.querySelector('[data-close]').onclick=()=>dialog.close();
 return {
  reset(year,message='Loading this season…'){weekends=[];allSessions=[];selected=null;podiums.clear();search.value='';emptyMessage=message;seasonSelect.value=String(year);dialog.querySelector('#picker-season-heading').textContent=`THE ${year} SEASON`;render();},
  async load(races,sessions,current){weekends=[...races].sort((a,b)=>Date.parse(b.date_start)-Date.parse(a.date_start));allSessions=sessions;selected=current;podiums=new Map();
   render();
   try{const summary=await loadSummary();for(const weekend of summary?.weekends||[])podiums.set(weekend.meeting_key,weekend.podium||[]);}catch{}
   // Older archives still show selectable cards without downloading every session.
   render();
  },
  open(current){selected=current;search.value='';render();if(!dialog.open)dialog.showModal();search.focus();}
 };
}
let driverDialog;
export function createDriverPicker(select,getDrivers,title='Choose a driver'){
 select.hidden=true;
 const trigger=document.createElement('button');trigger.type='button';trigger.className='driver-picker-trigger';trigger.setAttribute('aria-haspopup','dialog');select.after(trigger);
 function sync(){
  const d=getDrivers().find(d=>String(d.driver_number)===select.value),option=select.selectedOptions[0];
  trigger.innerHTML=`<span class="driver-picker-colour" style="background:${colour(d)}"></span><span><strong>${esc(d?.full_name||option?.textContent||'Choose driver')}</strong><small>${d?`#${d.driver_number} · ${esc(d.team_name||'Team unavailable')}`:'No timed laps available'}</small></span><span aria-hidden="true">⌄</span>`;
  trigger.disabled=select.disabled||!select.options.length;trigger.toggleAttribute('data-unavailable',!select.options.length);trigger.setAttribute('aria-label',title+': '+(d?.full_name||option?.textContent||'No driver available'));
 }
 trigger.onclick=()=>{
  if(!driverDialog){driverDialog=document.createElement('dialog');driverDialog.className='selection-dialog driver-selection';document.body.append(driverDialog);}
  driverDialog.setAttribute('aria-labelledby','driver-picker-title');
  driverDialog.innerHTML=`<div class="selection-heading"><div><span class="eyebrow">FIND YOUR DRIVER</span><h2 id="driver-picker-title">${esc(title)}</h2></div><button class="secondary" type="button" data-close>Close ×</button></div><label class="selection-search">NAME, TEAM OR NUMBER<input type="search" placeholder="Try Norris, Ferrari or 44…" aria-label="Search drivers"></label><div class="driver-option-list"></div>`;
  const input=driverDialog.querySelector('input'),list=driverDialog.querySelector('.driver-option-list');
  function render(){
   const rows=[...select.options].map(o=>({driver:getDrivers().find(d=>String(d.driver_number)===o.value),option:o})).filter(({driver:d,option:o})=>normalize([o.textContent,d?.team_name,d?.driver_number,d?.name_acronym].join(' ')).includes(normalize(input.value)));
   list.innerHTML=rows.map(({driver:d,option:o})=>`<button type="button" class="driver-option${o.value===select.value?' selected':''}" data-value="${esc(o.value)}" aria-pressed="${o.value===select.value}"><span class="driver-picker-colour" style="background:${colour(d)}"></span><span><strong>${esc(d?.full_name||o.textContent)}</strong><small>${d?`#${d.driver_number} · ${esc(d.team_name||'Team unavailable')}`:''}</small></span><span>${o.value===select.value?'✓':'↗'}</span></button>`).join('')||'<p class="selection-empty">No matching drivers in this session.</p>';
   list.querySelectorAll('[data-value]').forEach(button=>button.onclick=()=>{select.value=button.dataset.value;sync();driverDialog.close();select.dispatchEvent(new Event('change',{bubbles:true}));});
  }
  input.oninput=render;driverDialog.querySelector('[data-close]').onclick=()=>driverDialog.close();render();driverDialog.showModal();input.focus();
 };
 const observer=new MutationObserver(sync);observer.observe(select,{childList:true,attributes:true,attributeFilter:['disabled']});select.addEventListener('change',sync);sync();
 return {sync,destroy(){observer.disconnect();select.removeEventListener('change',sync);trigger.remove();}};
}
