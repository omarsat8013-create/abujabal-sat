const CACHE='abujabal-sat-v13';
const ASSETS=['./','index.html','manifest.webmanifest','sw.js','icon-192.png','icon-512.png','apple-touch-icon.png','hero.jpg','lab.js?v=12','satdb.json','vendor/sql-wasm.js?v=1','vendor/sql-wasm.wasm?v=1'];
self.addEventListener('install',e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET') return;
  e.respondWith(
    caches.match(e.request).then(hit=>hit||fetch(e.request).then(res=>{
      if(res.ok&&(e.request.url.startsWith(self.location.origin)||e.request.url.includes('fonts.g'))){
        const copy=res.clone();
        caches.open(CACHE).then(c=>c.put(e.request,copy));
      }
      return res;
    }).catch(()=>{
      if(e.request.mode==='navigate') return caches.match('index.html');
    }))
  );
});
