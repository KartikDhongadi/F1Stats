export const isRace = session => ['Race', 'Sprint', 'Sprint Race'].includes(session?.session_name);
const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
const stamp = value => value ? Date.parse(value) : NaN;

// Position is an event stream, not a value to interpolate between observations.
export function positionAt(observations, time) {
  let low=0, high=observations.length;
  while(low<high){const middle=(low+high)>>1;if(observations[middle].time<=time)low=middle+1;else high=middle;}
  return low ? observations[low-1].position : null;
}

// The first observed completion of lap N approximates the leader's lap-N crossing.
// A following lap's start supplies a crossing even when its preceding duration is missing.
export function raceClock(laps, maxLap) {
  const crossings=new Map();
  function offer(lap,time){if(Number.isInteger(lap)&&lap>=1&&lap<=maxLap&&Number.isFinite(time))crossings.set(lap,Math.min(crossings.get(lap)??Infinity,time));}
  for(const lap of laps){const start=stamp(lap.date_start);if(!Number.isFinite(start))continue;offer(lap.lap_number-1,start);if(positive(lap.lap_duration))offer(lap.lap_number,start+lap.lap_duration*1000);}
  let previous=-Infinity;
  return Array.from({length:maxLap},(_,i)=>{const time=crossings.get(i+1);if(!Number.isFinite(time)||time<=previous)return {lap:i+1,time:null};previous=time;return {lap:i+1,time};});
}
export function eventRaceLap(time, clock, start, end) {
  if(!Number.isFinite(time)||time<start||time>end)return null;
  return clock.find(point=>point.time!=null&&point.time>=time)?.lap??null;
}
export function eventType(event) {
  const message=(event.message||'').toUpperCase();
  if(event.flag==='RED'||message==='SESSION ABORTED')return 'Red flag / suspension';
  if(event.category==='SafetyCar'||/\bVSC\b|\bSAFETY CAR\b/.test(message))return /\bVSC\b|VIRTUAL/.test(message)?'Virtual safety car':'Safety car';
  if(event.category==='SessionStatus')return 'Session';
  if(['YELLOW','DOUBLE YELLOW'].includes(event.flag))return 'Yellow flag';
  if(event.flag==='CHEQUERED')return 'Chequered flag';
  return 'Race control';
}
export function normalizeStints(stints, lastLap) {
  return [...stints].filter(s=>Number.isInteger(s.lap_start)&&s.lap_start>=1).sort((a,b)=>a.lap_start-b.lap_start).map((s,i,all)=>{
    const explicit=Number.isInteger(s.lap_end)&&s.lap_end>=s.lap_start;
    const end=explicit?s.lap_end:(all[i+1]?.lap_start-1||lastLap);
    return {...s,end:Math.min(end,lastLap),endInferred:!explicit};
  }).filter(s=>Number.isFinite(s.end)&&s.end>=s.lap_start);
}
export function raceModel(session, drivers, laps, results, positions, stints, pits, messages) {
  const validLaps=laps.filter(l=>Number.isInteger(l.lap_number)&&l.lap_number>=1);
  const maxLap=Math.max(0,...validLaps.map(l=>l.lap_number),...results.map(r=>Number.isInteger(r.number_of_laps)?r.number_of_laps:0));
  const clock=raceClock(validLaps,maxLap);
  const starts=validLaps.filter(l=>l.lap_number===1&&Number.isFinite(stamp(l.date_start))).map(l=>stamp(l.date_start));
  const allStarts=validLaps.map(l=>stamp(l.date_start)).filter(Number.isFinite);
  const start=starts.length?Math.min(...starts):allStarts.length?Math.min(...allStarts):stamp(session.date_start);
  const ends=validLaps.filter(l=>Number.isFinite(stamp(l.date_start))&&positive(l.lap_duration)).map(l=>stamp(l.date_start)+l.lap_duration*1000);
  const end=ends.length?Math.max(...ends):stamp(session.date_end);
  const ids=[...new Set([...drivers,...validLaps,...results,...stints,...positions,...pits].map(r=>r.driver_number).filter(n=>Number.isInteger(n)))];
  const rows=ids.map(id=>{
    const driver=drivers.find(d=>d.driver_number===id)||{driver_number:id,full_name:`Driver ${id}`};
    const result=results.find(r=>r.driver_number===id);
    const driverLaps=validLaps.filter(l=>l.driver_number===id).sort((a,b)=>a.lap_number-b.lap_number).map(l=>({...l,key:`${id}:${l.lap_number}`,start:stamp(l.date_start),end:Number.isFinite(stamp(l.date_start))&&positive(l.lap_duration)?stamp(l.date_start)+l.lap_duration*1000:null}));
    const samples=positions.filter(p=>p.driver_number===id&&positive(p.position)&&Number.isFinite(stamp(p.date))).map(p=>({...p,time:stamp(p.date)})).sort((a,b)=>a.time-b.time);
    const completed=Number.isInteger(result?.number_of_laps)?result.number_of_laps:Math.max(0,...driverLaps.map(l=>l.lap_number));
    const lastKnownEnd=Math.max(-Infinity,...driverLaps.filter(l=>l.lap_number<=completed&&l.end!=null).map(l=>l.end));
    const positionPoints=clock.map(point=>({lap:point.lap,time:point.time,position:point.time==null||result?.dns||(result?.dnf&&point.time>lastKnownEnd)?null:positionAt(samples,point.time)}));
    return {driver,result,laps:driverLaps,positionPoints,completed,stints:normalizeStints(stints.filter(s=>s.driver_number===id),completed),pits:pits.filter(p=>p.driver_number===id&&Number.isInteger(p.lap_number)&&p.lap_number>=1&&p.lap_number<=maxLap)};
  }).sort((a,b)=>(a.result?.position??Infinity)-(b.result?.position??Infinity)||a.driver.driver_number-b.driver.driver_number);
  const seen=new Set();
  const events=messages.filter(e=>stamp(e.date)>=start&&stamp(e.date)<=end).sort((a,b)=>stamp(a.date)-stamp(b.date)).filter(e=>{
    const key=[e.date,e.message,e.driver_number,e.sector].join('|');if(seen.has(key))return false;seen.add(key);return true;
  }).map((e,i)=>({...e,id:i,time:stamp(e.date),raceLap:eventRaceLap(stamp(e.date),clock,start,end),type:eventType(e)}));
  return {session,rows,maxLap,clock,start,end,events};
}
export function pacePoints(row, ceiling=Infinity) {
  return row.laps.map(lap=>({...lap,value:positive(lap.lap_duration)&&lap.lap_duration<=ceiling?lap.lap_duration:null}));
}
export function linePath(points, x, y, valueKey) {
  let previous=null;
  return points.map(point=>{
    const value=point[valueKey];if(value==null||!Number.isFinite(value)){previous=null;return '';}
    const command=previous!=null&&point.lap-previous===1?'L':'M';previous=point.lap;
    return `${command}${x(point.lap).toFixed(2)},${y(value).toFixed(2)}`;
  }).join(' ');
}
