const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'extension/manifest.json'),'utf8'));
const downloadPage=fs.readFileSync(path.join(root,'public/download/index.html'),'utf8');
const storeListing=fs.readFileSync(path.join(root,'CHROME-WEB-STORE-LISTING-MN.md'),'utf8');
const readme=fs.readFileSync(path.join(root,'README-MN.md'),'utf8');

test('public download page links to the current extension release',()=>{
  const currentZip=`rainy-fb-pro-${manifest.version}.zip`;
  assert(downloadPage.includes(`/downloads/${currentZip}`),'download page must link to the manifest version');
  assert(downloadPage.includes(manifest.version),'download page must display the current version');
  assert(!/5\.6\.7/.test(downloadPage),'download page must not advertise the previous release');
});

test('public product copy describes the broader Facebook audience',()=>{
  for(const audience of ['жижиг бизнес','онлайн худалдаа','контент бүтээгч']) {
    assert(storeListing.toLowerCase().includes(audience),`Store listing should mention ${audience}`);
    assert(readme.toLowerCase().includes(audience),`README should mention ${audience}`);
  }
  assert(storeListing.includes('Facebook-ийн хязгаарлалтыг тойрохгүй'));
});

test('manual installation instructions explain ZIP extraction and update limitations',()=>{
  assert(downloadPage.includes('Extract All'));
  assert(downloadPage.includes('chrome://extensions'));
  assert(downloadPage.includes('автомат шинэчлэлтийг авахгүй'));
});


test('README release metadata and package builder stay aligned with the manifest',()=>{
  const builder=fs.readFileSync(path.join(root,'scripts/build-webstore.mjs'),'utf8');
  assert.equal(readme.split('\n')[0],`# RAINY FB Pro ${manifest.version}`);
  assert(!readme.includes('5.6.8'),'README must not retain stale 5.6.8 release instructions');
  assert(!builder.includes("manifest.version!=='5.7.0'"),'package builder must accept the manifest version instead of a hard-coded release');
});
