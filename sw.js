const VERSION='together-c1f47ae06ba28f1e';
const SHELL=['./','./index.html','./style.css','./app.js','./core.js','./store.js','./crypto.js','./household.js','./files.js','./images.js','./scanner.js','./github.js','./transit.js','./config.js','./manifest.webmanifest','./icons/icon.svg','./icons/icon-192.png','./icons/icon-512.png','./icons/maskable-512.png'];
const CACHE=VERSION+':'+self.registration.scope;
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)));});
self.addEventListener('message',event=>{if(event.data==='SKIP_WAITING')self.skipWaiting();});
self.addEventListener('activate',event=>{event.waitUntil((async()=>{for(const key of await caches.keys())if(key.startsWith('together-')&&key.endsWith(':'+self.registration.scope)&&key!==CACHE)await caches.delete(key);await self.clients.claim();})());});
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url),scope=new URL(self.registration.scope);
  if(request.method!=='GET'||url.origin!==scope.origin||!url.pathname.startsWith(scope.pathname)||request.headers.has('Authorization'))return;
  const path=url.pathname.slice(scope.pathname.length);
  if(!SHELL.some(s=>s.slice(2)===path)&&request.mode!=='navigate')return;
  // Only versioned public app-shell assets enter this cache. Never API data or maps.
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    const cached=await cache.match(request.mode==='navigate'?new URL('./index.html',scope).href:request,{ignoreSearch:true});
    if(cached)return cached;
    return fetch(request);
  })());
});
