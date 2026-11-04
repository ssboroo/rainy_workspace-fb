const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');

test('Android scaffold embeds GeckoView and targets Java 17',()=>{
  const gradle=read('mobile/android/app/build.gradle');
  const activity=read('mobile/android/app/src/main/java/studio/rainy/fbpro/MainActivity.java');
  const manifest=read('mobile/android/app/src/main/AndroidManifest.xml');
  assert.match(gradle,/org\.mozilla\.geckoview:geckoview-stable/);
  assert.match(gradle,/VERSION_17/);
  assert.match(activity,/GeckoRuntime\.create/);
  assert.match(activity,/https:\/\/m\.facebook\.com/);
  assert.match(manifest,/android\.permission\.INTERNET/);
});

test('iOS scaffold is Safari Web Extension source, not native Facebook injection',()=>{
  const manifest=JSON.parse(read('mobile/ios/SafariExtension/manifest.json'));
  const content=read('mobile/ios/SafariExtension/content.js');
  const guide=read('mobile/ios/README.md');
  assert.equal(manifest.manifest_version,3);
  assert.ok(manifest.content_scripts[0].matches.includes('https://www.facebook.com/*'));
  assert.match(content,/__RAINY_FB_MOBILE__/);
  assert.match(guide,/cannot operate inside the native Facebook app/i);
});

test('mobile docs do not misrepresent scaffolds as released apps',()=>{
  const docs=read('mobile/README.md');
  assert.match(docs,/does not yet inject the 5\.8\.0 extension/);
  assert.match(docs,/No APK, AAB, IPA/);
});
