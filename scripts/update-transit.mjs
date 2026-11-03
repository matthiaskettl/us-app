// Runs in the PUBLIC frontend repository's GitHub Actions job. No credentials needed.
import {writeFile} from 'node:fs/promises';
import {ROUTES,journeyURL,normalizeJourneys} from '../transit.js';
const routes=[];
for(const route of ROUTES){
  try{
    const response=await fetch(journeyURL('https://mobile.defas-fgi.de/beg/',route),{headers:{Accept:'application/json'},signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw new Error('Provider HTTP '+response.status);
    routes.push({...route,updatedAt:new Date().toISOString(),journeys:normalizeJourneys(await response.json())});
  }catch{
    routes.push({...route,updatedAt:null,journeys:[],error:'Journey provider unavailable. Check Bayern-Fahrplan.'});
  }
}
await writeFile(new URL('../journeys.json',import.meta.url),JSON.stringify({format:'together-journeys',version:1,provider:'DEFAS Bayern / Bayern-Fahrplan',generatedAt:new Date().toISOString(),routes})+'\n');
console.log('Generated public journey snapshot for the two fixed routes. No household data is accessed.');
