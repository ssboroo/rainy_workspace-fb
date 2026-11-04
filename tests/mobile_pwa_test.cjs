const fs=require('fs');const path=require('path');const assert=require('assert');
const root=path.join(__dirname,'..','public','mobile');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const js=fs.readFileSync(path.join(root,'app.js'),'utf8');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.webmanifest'),'utf8'));
assert.match(html,/name="viewport"/);
assert.match(html,/manifest\.webmanifest/);
assert.match(html,/app\.js/);
assert.equal(manifest.display,'standalone');
assert.ok(manifest.icons.length>=1);
for(const feature of ['posts','groups','schedule','templates','export']) assert.ok(js.includes(feature),feature+' feature missing');
assert.doesNotThrow(()=>new (require('node:vm').Script)(js));
assert.match(js,/indexedDB/);
assert.match(js,/serviceWorker/);
console.log('Mobile PWA release checks passed');
const preview=fs.readFileSync(path.join(root,'..','preview','index.html'),'utf8');
const navLabels=page=>Array.from(page.match(/<nav\b[^>]*>(.*?)<\/nav>/s)[1].matchAll(/<\/svg><span>([^<]+)<\/span>/g),match=>match[1]);
assert.deepEqual(navLabels(html),navLabels(preview));
for(const [,id] of html.matchAll(/data-tab="([^"]+)"/g)){
 assert.match(html,new RegExp('<section id="'+id+'"'));
}
const sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');
for(const [,asset] of html.matchAll(/(?:href|src)="(\.\.\/preview\/[^"]+)"/g)){
 assert.ok(fs.existsSync(path.join(root,asset)),asset);
 assert.ok(sw.includes(asset),asset+' missing from offline cache');
}