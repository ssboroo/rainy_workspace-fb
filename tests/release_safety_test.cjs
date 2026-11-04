const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');

function read(relativePath){
  return fs.readFileSync(path.join(root,relativePath),'utf8');
}
function manifest(){
  return JSON.parse(read('extension/manifest.json'));
}

test('popup displays the shipped extension version, not an old marketing version',()=>{
  const html=read('extension/popup.html');
  assert(html.includes('FB Pro · '+manifest().version));
  assert(html.includes('Workspace '+manifest().version));
});

test('unverified post status is never labeled as published',()=>{
  const js=read('extension/popup.js');
  assert(js.includes("UNKNOWN:'Баталгаажаагүй'"));
  assert(!js.includes("UNKNOWN:'Нийтлэгдсэн'"));
});

test('content script diagnostics report the current manifest version',()=>{
  const version=manifest().version;
  const js=read('extension/content-facebook.js');
  assert(js.includes("__RAINY_FB_SUITE_VERSION__='"+version+"'"));
  assert(js.includes("version: '"+version+"'"));
});

test('popup and side panel retain the supported compact workspace layout',()=>{
  const css=read('extension/popup.css');
  assert(css.includes('html{width:780px;height:590px'));
  assert(css.includes('grid-template-columns:minmax(0,1fr) minmax(0,1fr)'));
  assert(css.includes('.view.active{display:flex'));
});

test('release workflow builds versioned Web Store and public download packages',()=>{
  const workflow=read('.github/workflows/webstore-package.yml');
  assert(workflow.includes("VERSION=$(node -p \"require('./extension/manifest.json').version\")"));
  assert(workflow.includes('rainy-fb-pro-${VERSION}-webstore.zip'));
  assert(workflow.includes('rainy-fb-pro-${VERSION}.zip'));
  assert(workflow.includes('actions/upload-artifact@v4'));
});


test('website download links resolve to a ZIP copied into the static site root',()=>{
  const workflow=read('.github/workflows/webstore-package.yml');
  assert.match(workflow,/cp .*dist\/rainy-fb-pro-\$\{VERSION\}-webstore\.zip.*downloads\/rainy-fb-pro-\$\{VERSION\}\.zip/);
  assert.match(workflow,/git add .*public\/downloads.*downloads/);
  const html=read('index.html');
  assert(html.includes('downloads/rainy-fb-pro-'+manifest().version+'.zip'));
});

test('README installation guide points to the current website and package',()=>{
  const docs=read('README.md');
  const version=manifest().version;
  assert(docs.includes('https://workspace.rainy.studio/'));
  assert(docs.includes('rainy-fb-pro-'+version+'.zip'));
  assert(!/5\\.2/.test(docs));
});
