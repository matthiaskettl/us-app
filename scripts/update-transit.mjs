// Public route data only. Used by scheduled Pages and on-demand private workflows.
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ROUTES,journeyURL,normalizeJourneys} from '../transit.js';

export async function createJourneySnapshot(fetcher=globalThis.fetch){
  const routes=await Promise.all(ROUTES.map(async route=>{
    try{
      const response=await fetcher(journeyURL('https://mobile.defas-fgi.de/beg/',route),{headers:{Accept:'application/json'},signal:AbortSignal.timeout(20000)});
      if(!response.ok)throw new Error('Provider HTTP '+response.status);
      const journeys=normalizeJourneys(await response.json());
      return {...route,updatedAt:new Date().toISOString(),journeys};
    }catch{
      return {...route,updatedAt:null,journeys:[],error:'Journey provider unavailable. Check Bayern-Fahrplan.'};
    }
  }));
  return {format:'together-journeys',version:1,provider:'DEFAS Bayern / Bayern-Fahrplan',generatedAt:new Date().toISOString(),routes};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  await writeFile(new URL('../journeys.json',import.meta.url),JSON.stringify(await createJourneySnapshot())+'\n');
  console.log('Generated public journey snapshot for both directions of the two fixed routes. No household data is accessed.');
}
