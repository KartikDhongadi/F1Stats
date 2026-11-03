// Pure calculations shared by the UI and numerical regression tests.
export function lapTime(seconds){if(!Number.isFinite(seconds)||seconds<=0)return '—';return `${Math.floor(seconds/60)}:${(seconds%60).toFixed(3).padStart(6,'0')}`;}
export function prepareTelemetry(rows,lap){
 const start=Date.parse(lap.date_start),duration=Number(lap.lap_duration);
 if(!Number.isFinite(start)||!(duration>0))throw Error('This lap has no valid timing boundaries. Choose another lap.');
 const points=rows.map(r=>({...r,t:(Date.parse(r.date)-start)/1000})).filter(r=>Number.isFinite(r.t)&&Number.isFinite(r.speed)&&r.t>=0&&r.t<=duration).sort((a,b)=>a.t-b.t).filter((r,i,a)=>!i||r.t>a[i-1].t);
 if(points.length<10)throw Error('Too few telemetry samples for this lap. Please choose another lap.');
 let maxGap=0,distance=0;
 points.forEach((p,i)=>{if(i){const prev=points[i-1],dt=p.t-prev.t;maxGap=Math.max(maxGap,dt);distance+=(prev.speed+p.speed)/2/3.6*dt;}p.distance=distance;});
 if(points[0].t>1.5||duration-points.at(-1).t>1.5||maxGap>2)throw Error('This lap has incomplete telemetry or a gap longer than 2 seconds. Choose a different lap for a reliable comparison.');
 if(distance<=0)throw Error('No usable distance data for this lap.');
 points.forEach((p,i)=>{p.progress=p.distance/distance;const left=points[Math.max(0,i-2)],right=points[Math.min(points.length-1,i+2)];p.acceleration=right.t>left.t?(right.speed-left.speed)/3.6/(right.t-left.t):0;});
 return {points,distance,duration,maxGap,startOffset:points[0].t,endOffset:duration-points.at(-1).t};
}
export function interpolate(points,progress,key){
 if(progress<=points[0].progress)return points[0][key];
 if(progress>=points.at(-1).progress)return points.at(-1)[key];
 let lo=0,hi=points.length-1;while(hi-lo>1){const mid=(hi+lo)>>1;if(points[mid].progress<progress)lo=mid;else hi=mid;}
 const a=points[lo],b=points[hi],v=a[key],w=b[key];if(!Number.isFinite(v)||!Number.isFinite(w))return null;
 if(['brake','n_gear','drs'].includes(key))return v;
 return v+(w-v)*(progress-a.progress)/(b.progress-a.progress);
}
export function deltaTrace(a,b){return Array.from({length:201},(_,i)=>{const progress=i/200;return{progress,delta:interpolate(b.points,progress,'t')-interpolate(a.points,progress,'t')};});}

export function telemetryWindow(session,driver,lap){
 // URLSearchParams supplies the '=' separator; OpenF1 expects date>=value,
 // so the parameter key is 'date>', not 'date>=' (which would add two '='s).
 return {session_key:session,driver_number:driver,'date>':lap.date_start,'date<':new Date(Date.parse(lap.date_start)+lap.lap_duration*1000).toISOString()};
}
