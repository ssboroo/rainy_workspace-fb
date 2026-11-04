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
