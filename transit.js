import {berlinDateTime} from './core.js';
export const ROUTES=[{id:'munich',title:'München Hbf',stop:'91000100'},{id:'hospital',title:'Klinikum Ingolstadt',stop:'1500390'}];
export function normalizeJourneys(payload,now=Date.now()){
  if(!Array.isArray(payload.journeys))throw new Error('The journey provider returned an unexpected response.');
  const results=[];
  for(const journey of payload.journeys){
    if(journey.isCancelled)continue;
    const raw=journey.legs||[];if(!raw.length||raw.some(l=>l.isCancelled||(l.realtimeStatus||[]).some(s=>/CANCEL/i.test(s))))continue;
    if(raw.some(l=>/\bICE\b|Intercity.?Express/i.test([l.transportation?.number,l.transportation?.name,l.transportation?.properties?.trainType].join(' '))))continue;
    const legs=raw.map(l=>({line:l.transportation?.number||l.transportation?.name||'Walk',walking:l.transportation?.product?.class===99||/walk|fuß|fuss/i.test(l.transportation?.product?.name||''),origin:l.origin?.name||'',destination:l.destination?.name||'',departure:l.origin?.departureTimeEstimated||l.origin?.departureTimePlanned,arrival:l.destination?.arrivalTimeEstimated||l.destination?.arrivalTimePlanned,plannedDeparture:l.origin?.departureTimePlanned,platform:l.origin?.properties?.platformName||l.origin?.properties?.platform||'',realtime:!!(l.origin?.departureTimeEstimated||l.destination?.arrivalTimeEstimated),notes:(l.hints||[]).map(h=>h.content).filter(Boolean).slice(0,3)}));
    if(legs.some(l=>!Number.isFinite(Date.parse(l.departure))||!Number.isFinite(Date.parse(l.arrival))||Date.parse(l.arrival)<Date.parse(l.departure)))continue;
    if(legs.some((l,i)=>i&&Date.parse(l.departure)<Date.parse(legs[i-1].arrival)))continue;
    const departure=legs[0].departure,arrival=legs.at(-1).arrival;if(Date.parse(departure)<now)continue;
    results.push({departure,arrival,duration:Math.round((Date.parse(arrival)-Date.parse(departure))/60000),changes:journey.interchanges??Math.max(0,legs.filter(l=>!l.walking).length-1),preferred:legs.some(l=>/^RB\s*16$/i.test(l.line)),legs});
  }
  const seen=new Set();return results.sort((a,b)=>Date.parse(a.departure)-Date.parse(b.departure)||a.changes-b.changes||Date.parse(a.arrival)-Date.parse(b.arrival)).filter(j=>{const key=j.departure+j.arrival+j.legs.map(l=>l.line).join(',');if(seen.has(key))return false;seen.add(key);return true;});
}
export function journeyURL(base,route,now=new Date()){
  const url=new URL('XML_TRIP_REQUEST2',base.endsWith('/')?base:base+'/'),local=berlinDateTime(now);
  url.search=new URLSearchParams({outputFormat:'rapidJSON',coordOutputFormat:'WGS84[dd.ddddd]',language:'de',type_origin:'stop',name_origin:'80000709',type_destination:'stop',name_destination:route.stop,itdTripDateTimeDepArr:'dep',itdDate:local.slice(0,10).replace(/-/g,''),itdTime:local.slice(11).replace(':',''),useRealtime:'1',calcNumberOfTrips:'8',ptOptionsActive:'1',itOptionsActive:'1',lineRestriction:'403'}).toString();return url;
}
export function snapshotForDisplay(snapshot,now=Date.now()) {
  if(snapshot?.format!=='together-journeys'||!Array.isArray(snapshot.routes))throw new Error('Journey snapshot is not available yet.');
  return {...snapshot,routes:ROUTES.map(route=>{
    const saved=snapshot.routes.find(r=>r.id===route.id),age=now-Date.parse(saved?.updatedAt),expired=!Number.isFinite(age)||age>45*60000;
    return {...route,journeys:expired?[]:(saved.journeys||[]).filter(j=>Date.parse(j.departure)>=now),updatedAt:saved?.updatedAt||null,stale:expired||age>20*60000,error:expired?'The journey snapshot is out of date. Check Bayern-Fahrplan before leaving.':saved?.error||''};
  })};
}
export async function fetchSnapshot(){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  try{const response=await fetch(new URL('./journeys.json',import.meta.url),{cache:'no-store',credentials:'omit',signal:controller.signal});if(!response.ok)throw new Error('Journey updates are not published yet. Enable the Pages workflow in the frontend repository.');return snapshotForDisplay(await response.json());}finally{clearTimeout(timer);}
}
