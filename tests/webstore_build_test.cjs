const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');

test('Web Store build is a clean extension-root package with first-upload key removed',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'rainy-cws-'));
  const out=path.join(temp,'package');
  try{
    const run=spawnSync(process.execPath,[path.join(__dirname,'../scripts/build-webstore.mjs'),out],{encoding:'utf8'});
    assert.equal(run.status,0,run.stderr||run.stdout);
    const manifestPath=path.join(out,'manifest.json');
    assert(fs.existsSync(manifestPath),'manifest.json must be at ZIP root');
    const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
    assert.equal(manifest.manifest_version,3);
    assert.equal(manifest.version,'5.7.0');
    assert.equal(Object.hasOwn(manifest,'key'),false);
    assert(fs.existsSync(path.join(out,manifest.background.service_worker)));
    assert(fs.existsSync(path.join(out,'popup.html')));
    assert(fs.existsSync(path.join(out,'owner-config.json')));
    assert.equal(fs.existsSync(path.join(out,'owner')),false);
    assert.equal(fs.existsSync(path.join(out,'server')),false);
    const files=[];
    const walk=d=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())walk(p);else files.push(p);}};
    walk(out);
    assert(files.every(p=>!/[.]pem$/i.test(p)&&!/(^|[/\\])[.]env(?:[.]|$)/i.test(p)));
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
});

test('development manifest retains its stable unpacked extension key',()=>{
  const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'../extension/manifest.json'),'utf8'));
  assert.equal(typeof manifest.key,'string');
  assert(manifest.key.length>100);
});
