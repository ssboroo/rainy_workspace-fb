const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'extension/manifest.json'),'utf8'));
const downloadPage=fs.readFileSync(path.join(root,'public/download/index.html'),'utf8');
const storeListing=fs.readFileSync(path.join(root,'CHROME-WEB-STORE-LISTING-MN.md'),'utf8');
const readme=fs.readFileSync(path.join(root,'README-MN.md'),'utf8');
const homepage=fs.readFileSync(path.join(root,'index.html'),'utf8');
const installScript=fs.readFileSync(path.join(root,'app.js'),'utf8');
const builder=fs.readFileSync(path.join(root,'scripts/build-webstore.mjs'),'utf8');

test('public download page links to the current extension release',()=>{
  const currentZip=`rainy-fb-pro-${manifest.version}.zip`;
  assert(downloadPage.includes(`/downloads/${currentZip}`));
  assert(downloadPage.includes(manifest.version));
  assert(!/5\\.6\\.7/.test(downloadPage));
});

test('public product copy describes the broader Facebook audience',()=>{
  for(const audience of ['жижиг бизнес','онлайн худалдаа','контент бүтээгч']) {
    assert(storeListing.toLowerCase().includes(audience));
    assert(readme.toLowerCase().includes(audience));
  }
  assert(storeListing.includes('Facebook-ийн хязгаарлалтыг тойрохгүй'));
});

test('manual installation instructions explain ZIP extraction and update limitations',()=>{
  assert(downloadPage.includes('Extract All'));
  assert(downloadPage.includes('chrome://extensions'));
  assert(downloadPage.includes('автомат шинэчлэлтийг авахгүй'));
});

test('release documentation matches the manifest version',()=>{
  assert.equal(readme.split('\\n')[0],`# RAINY FB Pro ${manifest.version}`);
  assert(downloadPage.includes(`rainy-fb-pro-${manifest.version}.zip`));
  assert(downloadPage.includes(`RAINY FB Pro ${manifest.version}`));
  assert.equal((readme.match(/^# RAINY FB Pro /gm)||[]).length,1,'README must have exactly one release heading');
});

test('homepage and interactive install links match the manifest release',()=>{
  const zip=`rainy-fb-pro-${manifest.version}.zip`;
  assert(homepage.includes(`downloads/${zip}`));
  assert(installScript.includes(`downloads/${zip}`));
  assert(!/rainy-fb-pro-5\\.[0-7]\\.zip/.test(homepage+installScript));
});

test('package builder validates the manifest version instead of hard-coding it',()=>{
  assert(!builder.includes("manifest.version!=='5.7.0'"));
  assert(builder.includes('MAJOR.MINOR.PATCH'));
});
