const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const finite=value=>typeof value==='number'&&Number.isFinite(value);
export function prepareWeather(rows){return rows.filter(r=>r&&Number.isFinite(Date.parse(r.date))).map(r=>({...r,time:Date.parse(r.date)})).sort((a,b)=>a.time-b.time);}
// Never substitute a future observation or silently carry old weather across a gap.
export function weatherAt(rows,time){
 if(!finite(time))return {reading:null,age:null,stale:false};
 let lo=0,hi=rows.length;
 while(lo<hi){const mid=(lo+hi)>>1;if(rows[mid].time<=time)lo=mid+1;else hi=mid;}
 const reading=rows[lo-1]??null,age=reading?(time-reading.time)/1000:null;
 return {reading,age,stale:age!=null&&age>180};
}
const clock=time=>new Date(time).toISOString().slice(11,19)+' UTC';
const value=(number,unit)=>finite(number)?`${number.toFixed(1)}${unit}`:'—';
export function weatherCard(rows,{time,label}){
 const {reading,age,stale}=weatherAt(rows,time),r=stale?null:reading;
 const rain=r?.rainfall===1?'Rain reported':r?.rainfall===0?'No rain reported':'Rain unknown';
 const wind=finite(r?.wind_speed)&&r.wind_speed>=0?value(r.wind_speed*3.6,' km/h'):'—';
 const direction=finite(r?.wind_direction)&&r.wind_direction>=0&&r.wind_direction<360?['N','NE','E','SE','S','SW','W','NW'][Math.round(r.wind_direction/45)%8]:null;
 const metric=(name,text)=>`<div><dt>${name}</dt><dd>${esc(text)}</dd></div>`;
 return `<section class="weather-card${stale?' weather-stale':''}" aria-label="${esc(label)} weather"><h3>${esc(label)}</h3><p class="weather-rain${r?.rainfall===1?' is-raining':''}"><span aria-hidden="true">${r?.rainfall===1?'☂':'◌'}</span> ${rain}</p><dl class="weather-values">${metric('Track',value(r?.track_temperature,'°C'))}${metric('Air',value(r?.air_temperature,'°C'))}${metric('Wind',wind)}${metric('Humidity',finite(r?.humidity)&&r.humidity>=0&&r.humidity<=100?value(r.humidity,'%'):'—')}</dl><p class="weather-extra">${direction?`Wind direction ${direction} · `:''}Pressure ${finite(r?.pressure)&&r.pressure>0?value(r.pressure,' mbar'):'—'}</p><p class="weather-stamp">${reading?`${stale?'Stale reading · ':''}${clock(reading.time)}<br>${Math.round(age)}s before selection${stale?' · conditions unavailable':''}`:'No weather reading available at this time.'}</p></section>`;
}
export function renderWeather(root,rows,contexts){root.innerHTML='<div class="weather-heading"><span class="eyebrow">TRACK CONDITIONS</span><span class="weather-tag">HISTORICAL</span></div>'+contexts.map(context=>weatherCard(rows,context)).join('')+'<p class="weather-footnote">Conditions follow your selection. Rain reports do not indicate track wetness.</p>';}
