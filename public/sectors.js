// Sector comparisons shared by the race lap inspector and the qualifying overview.
// Bests come from laps that were not deleted. A lap is compared with the whole session,
// not with what had been set at the moment it was driven.
const valid=value=>typeof value==='number'&&Number.isFinite(value)&&value>0;
export function sectorBests(laps){
 const session=[null,null,null],drivers=new Map();
 for(const lap of laps){
  if(lap.deleted)continue;
  let own=drivers.get(lap.driver_number);if(!own)drivers.set(lap.driver_number,own=[null,null,null]);
  for(let i=0;i<3;i++){
   const time=lap['duration_sector_'+(i+1)];if(!valid(time))continue;
   if(own[i]==null||time<own[i])own[i]=time;
   if(session[i]==null||time<session[i])session[i]=time;
  }
 }
 return {session,drivers};
}
// 'purple' = best of the session, 'green' = that driver's best of the session, '' = neither.
export function sectorClass(bests,lap,index){
 const time=lap['duration_sector_'+(index+1)];if(!valid(time))return '';
 if(bests.session[index]!=null&&time<=bests.session[index]+1e-9)return 'purple';
 const own=bests.drivers.get(lap.driver_number)?.[index];
 return own!=null&&time<=own+1e-9?'green':'';
}
// Sum of a driver's three best sectors: a what-if, not a recorded lap.
export function idealLap(bests,driver){
 const own=bests.drivers.get(driver);
 return own&&own.every(valid)?own[0]+own[1]+own[2]:null;
}
export const sectorLabel={purple:'Best of the session',green:'Driver’s best of the session'};
export function sectorBoxes(bests,lap,format){
 return [1,2,3].map(i=>{const kind=sectorClass(bests,lap,i-1);return `<div class="${kind?'sector-'+kind:''}"><span>SECTOR ${i}</span><strong>${format(lap['duration_sector_'+i])}</strong>${kind?`<small>${sectorLabel[kind]}</small>`:''}</div>`;}).join('');
}
