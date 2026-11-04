const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');

test('popup displays the shipped extension version, not an old marketing version',()=>{
  const html=fs.readFileSync(path.join(root,'extension/popup.html'),'utf8');
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'extension/manifest.json'),'utf8'));
  assert(html.includes('FB Pro · '+manifest.version));
});

test('unverified post status is never labeled as published',()=>{
  const js=fs.readFileSync(path.join(root,'extension/popup.js'),'utf8');
  assert(js.includes("UNKNOWN:'Баталгаажаагүй'"));
  assert(!js.includes("UNKNOWN:'Нийтлэгдсэн'"));
});

test('content script diagnostics report the current manifest version',()=>{
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'extension/manifest.json'),'utf8'));
  const js=fs.readFileSync(path.join(root,'extension/content-facebook.js'),'utf8');
  assert(js.includes("__RAINY_FB_SUITE_VERSION__='"+manifest.version+"'"));
  assert(js.includes("version: '"+manifest.version+"'"));
});

test('5.7.0 popup and side panel use responsive light workspace styles',()=>{
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'extension/manifest.json'),'utf8'));
  const css=fs.readFileSync(path.join(root,'extension/popup.css'),'utf8');
  assert.equal(manifest.version,'5.7.0');
  assert(css.includes('@media (min-width:781px)'));
  assert(css.includes('color-scheme:light'));
  assert(css.includes('grid-template-columns:minmax(0,1.1fr)'));
});

test('release workflow names the 5.7.0 web store and public packages',()=>{
  const workflow=fs.readFileSync(path.join(root,'.github/workflows/webstore-package.yml'),'utf8');
  assert(workflow.includes('rainy-fb-pro-5.7.0-webstore.zip'));
  assert(workflow.includes('rainy-fb-pro-5.7.0.zip'));
});
