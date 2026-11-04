const CACHE_PREFIX='rainy-mobile-shell-';
const CACHE=CACHE_PREFIX+'v5';
const shellUrl=new URL('./',self.registration.scope);
const assets=[
 './index.html','./style.css','./app.js','./manifest.webmanifest','../icon.svg',
 '../preview/popup.febbbdc539c1.css','../preview/preview.95331cb2431d.css','../preview/icon48.png'
].map(path=>new URL(path,shellUrl).href);

self.addEventListener('install',event=>{
 event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(assets)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
 event.waitUntil(caches.keys().then(keys=>Promise.all(
  keys.filter(key=>key.startsWith(CACHE_PREFIX)&&key!==CACHE).map(key=>caches.delete(key))
 )).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
 if(event.request.method!=='GET')return;
 const url=new URL(event.request.url);
 if(event.request.mode==='navigate'&&url.origin===shellUrl.origin&&
    [shellUrl.pathname,shellUrl.pathname+'index.html'].includes(url.pathname)){
  event.respondWith(fetch(event.request).catch(()=>caches.open(CACHE).then(cache=>cache.match(assets[0]))));
 }else if(assets.includes(url.href)){
  event.respondWith(caches.open(CACHE).then(async cache=>await cache.match(event.request)||fetch(event.request)));
 }
});