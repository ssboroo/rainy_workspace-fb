const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');

test('Android scaffold embeds GeckoView and targets Java 17',()=>{
  const gradle=read('mobile/android/app/build.gradle');
  const activity=read('mobile/android/app/src/main/java/studio/rainy/fbpro/MainActivity.java');
  const manifest=read('mobile/android/app/src/main/AndroidManifest.xml');
  assert.match(gradle,/org\.mozilla\.geckoview:geckoview/);
  assert.match(gradle,/VERSION_17/);
  assert.match(activity,/GeckoRuntime\.create/);
  assert.match(activity,/https:\/\/workspace\.rainy\.studio\/mobile\//);
  assert.match(activity,/ensureBuiltIn/);
  assert.match(gradle,/extension\/content-facebook\.js/);
  assert.match(manifest,/android\.permission\.INTERNET/);
});

test('iOS scaffold bridges Safari browser APIs for the shared Facebook content script',()=>{
  const manifest=JSON.parse(read('mobile/ios/SafariExtension/manifest.json'));
  const content=read('mobile/ios/SafariExtension/content.js');
  const bridge=read('mobile/ios/SafariExtension/workspace.js');
  const compat=read('mobile/ios/SafariExtension/browser-compat.js');
  const guide=read('mobile/ios/README.md');
  assert.equal(manifest.manifest_version,3);
  assert.equal(manifest.background.service_worker,'background.js');
  assert.ok(manifest.permissions.includes('tabs'));
  assert.ok(manifest.content_scripts[0].matches.includes('https://www.facebook.com/*'));
  assert.ok(manifest.content_scripts[0].js.indexOf('browser-compat.js') < manifest.content_scripts[0].js.indexOf('content-facebook.js'));
  assert.ok(manifest.content_scripts[1].matches.includes('https://workspace.rainy.studio/mobile/*'));
  assert.match(compat,/globalThis\.chrome/);
  assert.match(content,/__RAINY_FB_MOBILE__/);
  assert.match(bridge,/RAINY_MOBILE_STAGE/);
  assert.match(guide,/cannot operate inside the native Facebook app/i);
});

test('mobile workspace layout fits narrow iPhone viewports',()=>{
  const css=read('public/mobile/style.css');
  const html=read('public/mobile/index.html');
  assert.match(html,/width=device-width/);
  assert.match(css,/100dvh/);
  assert.match(css,/min-width: 0/);
  assert.match(css,/height:auto!important/);
  assert.match(css,/overflow-y:auto!important/);
  assert.match(css,/.actions\{display:grid!important/);
  assert.match(css,/.item-actions\{display:grid!important/);
  assert.match(css,/@media\(max-width:350px\)/);
  assert.match(css,/env\(safe-area-inset-bottom\)/);
});

test('mobile docs do not misrepresent scaffolds as released apps',()=>{
  const docs=read('mobile/README.md');
  assert.match(docs,/awaiting physical-device validation/);
  assert.match(docs,/No APK, AAB, IPA/);
});

test('mobile posting binds the payload to the group and grants a single submit permit',async()=>{
  const vm=require('node:vm');
  const records={};
  const id='12345678-1234-1234-1234-123456789012';
  const workspace={url:'https://workspace.rainy.studio/mobile/',frameId:0,tab:{id:10}};
  const facebook={url:'https://www.facebook.com/groups/test/',frameId:0,tab:{id:10}};
  let currentPage=facebook;
  let listener,submissions=0,nextId=0,resultStatus='UNKNOWN';
  const send=(message,sender)=>new Promise(resolve=>listener(message,sender,resolve));
  const browser={
    runtime:{onMessage:{addListener:callback=>{listener=callback;}}},
    storage:{local:{
      get:async key=>key===null?{...records}:{[key]:records[key]},
      set:async values=>Object.assign(records,values),
      remove:async key=>{delete records[key];}
    }},
    tabs:{sendMessage:async (tab,message)=>{
      assert.equal(tab,10);
      assert.equal(message.payload.formData.description,'Sample');
      const {jobId,attemptId,index}=message.payload;
      const permit={action:'POST_SUBMIT_PERMIT',jobId,attemptId,index};
      const attempts=await Promise.all([send(permit,currentPage),send(permit,currentPage)]);
      assert.equal(attempts.filter(result=>result.ok).length,1);
      submissions++;
      return {status:resultStatus};
    }}
  };
  vm.runInNewContext(read('mobile/ios/SafariExtension/background.js'),{
    browser,URL,crypto:{randomUUID:()=>String(Number(id.slice(0,8))+nextId++)+id.slice(8)}
  });
  const stage={action:'RAINY_MOBILE_STAGE',url:facebook.url,text:'Sample',image:''};
  assert.equal((await send(stage,{...workspace,url:'https://other.test/mobile/'})).ok,false);
  assert.equal((await send(stage,workspace)).url,facebook.url+'#rainy-mobile='+id);
  const run={action:'RAINY_MOBILE_RUN',jobId:id};
  assert.equal((await send(run,{...facebook,tab:{id:11}})).ok,false);
  assert.equal((await send(run,{...facebook,url:'https://www.facebook.com/groups/other/'})).ok,false);
  assert.equal((await send(run,facebook)).result.status,'UNKNOWN');
  assert.equal((await send(run,facebook)).ok,false);
  assert.equal(submissions,1);

  const scheduled={...stage,urls:[facebook.url,'https://m.facebook.com/groups/next/'],scheduleId:'post:date'};
  const staged=await send(scheduled,workspace);
  assert.equal((await send(scheduled,workspace)).duplicate,true);
  const firstJobId=new URL(staged.url).hash.slice('#rainy-mobile='.length,-':auto'.length);
  assert.equal((await send({...run,jobId:firstJobId},facebook)).ok,false);
  resultStatus='PUBLISHED';
  const first=await send({...run,jobId:firstJobId,automatic:true},facebook);
  assert.match(first.next,/^https:\/\/www\.facebook\.com\/groups\/next\/#rainy-mobile=.*:auto$/);
  const nextJobId=new URL(first.next).hash.slice('#rainy-mobile='.length,-':auto'.length);
  resultStatus='UNKNOWN';
  currentPage={...facebook,url:first.next};
  const next=await send({...run,jobId:nextJobId,automatic:true},{...facebook,url:first.next});
  assert.equal(next.result.status,'UNKNOWN');
  assert.equal(next.next,undefined);
  assert.equal(submissions,3);
});
