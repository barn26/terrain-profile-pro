/* Service worker: офлайн-оболонка + кеш карт. Змінюйте VER, щоб примусово оновити кеш. */
const VER="tpp-v3", SHELL="shell-"+VER, LIBS="libs-v1", TILES="tiles-v1", MAX_TILES=3000;
const SHELL_FILES=["./","./index.html","./nogps.js","./drone.js","./manifest.webmanifest","./icon-192.png","./icon-512.png"];
const L="https://unpkg.com/leaflet@1.9.4/dist/";
const LIB_FILES=[L+"leaflet.css",L+"leaflet.js",L+"images/marker-icon.png",L+"images/marker-icon-2x.png",L+"images/marker-shadow.png",L+"images/layers.png",L+"images/layers-2x.png"];
const TILE_RE=/(tile\.openstreetmap\.org|arcgisonline\.com|basemaps\.cartocdn\.com|opentopomap\.org)/;
let puts=0;

self.addEventListener("install",e=>{
  e.waitUntil((async()=>{
    const c=await caches.open(SHELL);
    await Promise.all(SHELL_FILES.map(u=>c.add(u).catch(()=>{})));
    const l=await caches.open(LIBS);
    await Promise.all(LIB_FILES.map(u=>fetch(u,{mode:"cors"}).then(r=>r.ok&&l.put(u,r)).catch(()=>{})));
    self.skipWaiting();
  })());
});
self.addEventListener("activate",e=>{
  e.waitUntil((async()=>{
    for(const k of await caches.keys()) if(k.startsWith("shell-")&&k!==SHELL) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function trim(c){
  const k=await c.keys();
  if(k.length>MAX_TILES) for(let i=0;i<k.length-MAX_TILES+100;i++) await c.delete(k[i]);
}
async function tile(req){
  const c=await caches.open(TILES), hit=await c.match(req.url);
  if(hit) return hit;
  try{
    const r=await fetch(req.url,{mode:"cors",credentials:"omit"});
    if(r.ok){ c.put(req.url,r.clone()); if(++puts%50===0) trim(c); }
    return r;
  }catch(e){
    try{ return await fetch(req.url,{mode:"no-cors",credentials:"omit"}); }catch(x){ return Response.error(); }
  }
}
async function netFirst(req){
  const c=await caches.open(SHELL);
  try{
    const r=await Promise.race([fetch(req),new Promise((_,j)=>setTimeout(j,4000))]);
    if(r&&r.ok) c.put(req,r.clone());
    return r;
  }catch(e){
    return (await c.match(req,{ignoreSearch:true}))||(await c.match("./index.html"))||Response.error();
  }
}
async function cacheFirst(req,name){
  const c=await caches.open(name), hit=await c.match(req.url);
  if(hit) return hit;
  const r=await fetch(req.url,{mode:"cors"});
  if(r.ok) c.put(req.url,r.clone());
  return r;
}
self.addEventListener("fetch",e=>{
  const req=e.request;
  if(req.method!=="GET") return;
  const u=new URL(req.url);
  if(u.origin===location.origin) return e.respondWith(netFirst(req));
  if(u.hostname==="unpkg.com") return e.respondWith(cacheFirst(req,LIBS).catch(()=>Response.error()));
  if(TILE_RE.test(u.hostname)) return e.respondWith(tile(req));
  /* API (висоти, Overpass, Nominatim) — тільки мережа, не кешуємо */
});
