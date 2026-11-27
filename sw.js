/* ابوجبل سات - service worker v36
   القاعدة: صفحة HTML عمرها ما تيجي من الكاش لو النت شغال.
   كاش بس للملفات الثابتة وللعرض وقت انقطاع النت. */
const CACHE='abujabal-sat-v42';
const ASSETS=['./','index.html','manifest.webmanifest','version.json','version.js','icon-192.png','icon-512.png','apple-touch-icon.png','hero.jpg','lab.js?v=25','satdb.json','vendor/sql-wasm.js?v=1','vendor/sql-wasm.wasm?v=1'];

self.addEventListener('install',e=>{
  e.waitUntil((async()=>{
    const c=await caches.open(CACHE);
    await Promise.all(ASSETS.map(async u=>{
      try{ const r=await fetch(new Request(u,{cache:'reload'})); if(r && r.ok) await c.put(u,r); }catch(err){}
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate',e=>{
  e.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message',e=>{ if(e.data==='skip-waiting') self.skipWaiting(); });

self.addEventListener('fetch',e=>{
  const req=e.request;
  if(req.method!=='GET') return;
  const url=new URL(req.url);
  if(url.origin!==self.location.origin) return;

  if(req.mode==='navigate'){
    e.respondWith((async()=>{
      try{
        const res=await fetch(req,{cache:'no-store'});
        if(res && res.ok){ const copy=res.clone(); caches.open(CACHE).then(c=>c.put('index.html',copy)); }
        return res;
      }catch(err){
        const hit=await caches.match('index.html');
        return hit || new Response('<h1>مفيش نت</h1><p>افتح البرنامج والنت شغال عشان يحمّل آخر نسخة.</p>',{headers:{'Content-Type':'text/html; charset=utf-8'}});
      }
    })());
    return;
  }

  e.respondWith((async()=>{
    try{
      const res=await fetch(req,{cache:'no-store'});
      if(res && res.ok){ const copy=res.clone(); caches.open(CACHE).then(c=>c.put(req,copy)); }
      return res;
    }catch(err){
      const hit=await caches.match(req);
      if(hit) return hit;
      return new Response('',{status:504,statusText:'offline'});
    }
  })());
});
