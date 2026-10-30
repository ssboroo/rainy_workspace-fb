/* RAINY Pro 5 — durable queue, conservative posting receipts, server licensing. */
const DB_NAME='MultiPosterDB', DB_VERSION=2, STORE_IMAGES='images',STORE_TEMPLATES='templates';
let isQueueRunning=false,shouldAbortQueue=false,activeTabId=null;
importScripts('lead-tools.js','core.js','license-engine.js','legacy-utils.js');
const SCHEDULE='RAINY_FB_ALARM',RECOVERY='RAINY_QUEUE_RECOVERY',TICK='RAINY_QUEUE_TICK';
let serial=Promise.resolve(), pumping=false, scrapeTabId=null, scrapeOwnsTab=false, queueWakeTimer=null, serverUnreachableUntil=0;
let ownerConfig={serverUrl:'',licensePublicKey:'',acceptLegacyLicenses:true,supportUrl:'https://t.me/boroobro'};
const configReady=(async()=>{try{const r=await fetch(chrome.runtime.getURL('owner-config.json'));const c=await r.json();if(typeof c.serverUrl==='string'){if(c.serverUrl&&!/^https:\/\//.test(c.serverUrl))throw new Error('OWNER_CONFIG_INVALID');ownerConfig={...ownerConfig,...c};}}catch{}return ownerConfig;})();
function atomic(fn){const p=serial.then(fn);serial=p.catch(()=>{});return p;}
async function digest(s){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(x=>x.toString(16).padStart(2,'0')).join('');}
async function api(path,body,timeoutMs=8000){
  await configReady;const serverUrl=ownerConfig.serverUrl;
  const {deviceId,deviceSecret}=await chrome.storage.local.get(['deviceId','deviceSecret']);
  if(!serverUrl)throw new Error('Төлбөрийн үйлчилгээ хараахан идэвхжээгүй. Лиценз авахын тулд админтай холбогдоно уу.');
  let res;
  try{
    res=await fetch(serverUrl.replace(/\/$/,'')+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','Authorization':`Bearer ${deviceSecret||''}`,'X-Device-ID':deviceId||''},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(timeoutMs)});
  }catch(netErr){
    serverUnreachableUntil=Date.now()+300000;
    throw new Error('Төлбөрийн сервертэй холбогдсонгүй. Интернетээ шалгаад дахин оролдоно уу.');
  }
  let data={};try{data=await res.json();}catch{}
  if(!res.ok){const error=new Error(data.error||`SERVER_${res.status}`);error.status=res.status;throw error;}return data;
}
async function enroll(){
  const {deviceId,deviceSecret}=await deviceIdentity();
  const result=await api('/v1/devices/register',{deviceId,secret:deviceSecret},3500);
  if(result.trial&&Number.isFinite(result.expiresAt)){
    const local=await chrome.storage.local.get(['trialExpiryMs','trialStartedAt']);
    const expiry=Math.min(result.expiresAt,Number.isFinite(local.trialExpiryMs)?local.trialExpiryMs:Infinity);
    await chrome.storage.local.set({trialExpiryMs:expiry,trialStartedAt:Math.min(expiry-86400000,Number.isFinite(local.trialStartedAt)?local.trialStartedAt:Infinity),trialPolicyVersion:24});
  }
  await chrome.storage.local.set({entitlement:result});return result;
}
async function localTrial(){
  const local=await chrome.storage.local.get(['trialExpiryMs','trialStartedAt','trialLastSeen','trialPolicyVersion']);
  let sync={};try{sync=await chrome.storage.sync.get(['rainyTrialExpiryMs']);}catch{}
  const candidates=[local.trialExpiryMs,sync.rainyTrialExpiryMs].filter(x=>Number.isFinite(x)&&x>0);
  const previous=candidates.length?Math.min(...candidates):null;
  const startedAt=Number.isFinite(local.trialStartedAt)?local.trialStartedAt:(previous?(local.trialPolicyVersion===24?previous-86400000:previous-3*86400000):Date.now());
  const expiry=Math.min(previous||Infinity,startedAt+86400000);
  const clockValid=!local.trialLastSeen||Date.now()>=local.trialLastSeen-300000;
  await chrome.storage.local.set({trialExpiryMs:expiry,trialStartedAt:startedAt,trialPolicyVersion:24,trialLastSeen:Math.max(Date.now(),local.trialLastSeen||0)});
  try{await chrome.storage.sync.set({rainyTrialExpiryMs:expiry});}catch{}
  const r={ok:true,valid:clockValid&&expiry>Date.now(),expiresAt:expiry,trial:true,local:true,daysLeft:Math.max(0,Math.ceil((expiry-Date.now())/86400000))};
  await chrome.storage.local.set({entitlement:r});return r;
}
let identityPromise;
async function deviceIdentity(){
  if(identityPromise)return identityPromise;
  identityPromise=(async()=>{
    await configReady;
    const local=await chrome.storage.local.get(['deviceId','deviceSecret']);
    let sync={};try{sync=await chrome.storage.sync.get(['rainyDeviceId','rainyDeviceSecret']);}catch{}
    let saved;
    if(ownerConfig.serverUrl&&chrome.cookies){
      try{
        const cookie=await chrome.cookies.get({url:ownerConfig.serverUrl,name:'rainy_device_v1'});
        if(cookie){const data=JSON.parse(decodeURIComponent(cookie.value));if(/^DEV-(?:[a-f0-9]{8}|[a-f0-9-]{36})$/i.test(data.id)&&typeof data.secret==='string'&&data.secret.length>=64)saved=data;}
      }catch{}
    }
    // A complete pair is essential: restoring only an ID causes authentication failure.
    const pair=local.deviceId&&local.deviceSecret?{id:local.deviceId,secret:local.deviceSecret}:saved||(sync.rainyDeviceId&&sync.rainyDeviceSecret?{id:sync.rainyDeviceId,secret:sync.rainyDeviceSecret}:null);
    const deviceId=pair?.id||local.deviceId||'DEV-'+crypto.randomUUID();
    const deviceSecret=pair?.secret||crypto.randomUUID()+crypto.randomUUID();
    await chrome.storage.local.set({deviceId,deviceSecret});
    // This first-party service cookie survives extension uninstall in the same profile.
    // Never read Facebook cookies or transmit Facebook credentials.
    if(ownerConfig.serverUrl&&chrome.cookies){
      try{await chrome.cookies.set({url:ownerConfig.serverUrl,name:'rainy_device_v1',value:encodeURIComponent(JSON.stringify({id:deviceId,secret:deviceSecret})),httpOnly:true,secure:true,sameSite:'no_restriction',expirationDate:Math.floor(Date.now()/1000)+400*86400});}catch{}
    }
    try{await chrome.storage.sync.set({rainyDeviceId:deviceId,rainyDeviceSecret:deviceSecret});}catch{}
    return {deviceId,deviceSecret};
  })();
  try{return await identityPromise;}finally{identityPromise=null;}
}

async function storedLicense(){
  await configReady;const {deviceId}=await deviceIdentity();
  const local=await chrome.storage.local.get(['activeLicense','signedLicense']);let sync={};try{sync=await chrome.storage.sync.get(['rainyActiveLicense']);}catch{}
  const signed=await RainyLicense.signed(local.signedLicense||local.activeLicense?.key,deviceId,ownerConfig.licensePublicKey);
  if(signed?.valid)return signed;
  if(ownerConfig.acceptLegacyLicenses){const previous=local.activeLicense||sync.rainyActiveLicense;const legacy=await RainyLicense.legacy(previous?.key,deviceId);if(legacy?.valid)return legacy;}
  return null;
}
async function entitlement(forceRemote=false){
  await configReady;
  const paid=await storedLicense();
  if(paid?.valid&&!forceRemote){
    await chrome.storage.local.set({entitlement:paid});
    return paid;
  }
  let result=null;
  if(ownerConfig.serverUrl&&(forceRemote||Date.now()>=serverUnreachableUntil)){
    try{
      await enroll();result=await api('/v1/license',undefined,3500);
      if(paid?.valid&&(!result?.valid||(result.trial&&!paid.trial)||(paid.expiresAt||0)>(result.expiresAt||0)))result=paid;
    }catch(e){
      if(e.status===401||e.status===403)throw e;
      result=paid||await atomic(localTrial);
    }
  }
  if(!result)result=paid||await atomic(localTrial);
  await chrome.storage.local.set({entitlement:result});
  if(!result?.valid)throw new Error('Trial эсвэл лицензийн хугацаа дууссан. Эрхээ сунгана уу.');
  return result;
}
async function activateKey(token){
  await configReady;const {deviceId}=await deviceIdentity();
  let r=await RainyLicense.signed(token,deviceId,ownerConfig.licensePublicKey);
  if(!r&&ownerConfig.acceptLegacyLicenses)r=await RainyLicense.legacy(token,deviceId);
  if(!r?.valid)throw new Error('Түлхүүр хүчингүй, өөр төхөөрөмжийнх эсвэл хугацаа дууссан.');
  const activeRecord={key:token,expiresAt:r.expiresAt};
  if(r.signed)await chrome.storage.local.set({signedLicense:token,activeLicense:activeRecord});
  else await chrome.storage.local.set({activeLicense:activeRecord});
  try{await chrome.storage.sync.set({rainyActiveLicense:activeRecord});}catch{}
  await chrome.storage.local.set({entitlement:r});return r;
}
function today(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ulaanbaatar',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
function isRestriction(error){return /FB_RESTRICTION|FACEBOOK_LOGIN_OR_CHECKPOINT|ACTION_BLOCKED/.test(error||'');}
async function pauseQueue(reason){return atomic(async()=>{const {job}=await chrome.storage.local.get('job');if(job?.status==='RUNNING'){job.status='PAUSED';job.pauseReason=reason;await chrome.storage.local.set({job,queueStatus:'IDLE'});}isQueueRunning=false;clearTimeout(queueWakeTimer);await chrome.alarms.clear(TICK);});}
async function scheduleTick(when=Date.now()+1000){
  clearTimeout(queueWakeTimer);await chrome.alarms.create(TICK,{when});
  // A short timer keeps 5s mode responsive while awake; the durable alarm is the fallback.
  const delay=Math.max(0,when-Date.now());if(delay<25000){queueWakeTimer=setTimeout(()=>{void pump();},delay);queueWakeTimer?.unref?.();}
}
function dataUrlToBlob(dataUrl,fallbackType='image/jpeg'){
  const parts=String(dataUrl||'').split(',');
  if(parts.length<2)throw new Error('INVALID_IMAGE_DATA_URL');
  const mimeMatch=parts[0].match(/^data:([^;]+);base64$/i);
  const mime=mimeMatch?mimeMatch[1]:fallbackType;
  const bin=atob(parts[1]);
  const bytes=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
  return new Blob([bytes],{type:mime});
}
async function stripImageMetadata(images){
  const out=[];
  for(const im of images){
    try{
      const srcBlob=dataUrlToBlob(im.dataUrl,im.type||'image/jpeg');
      const bitmap=await createImageBitmap(srcBlob);
      try{
        const canvas=new OffscreenCanvas(bitmap.width,bitmap.height);canvas.getContext('2d').drawImage(bitmap,0,0);
        const type=im.type==='image/png'?'image/png':'image/jpeg';const blob=await canvas.convertToBlob({type,quality:.92});
        const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
        out.push({...im,type,size:blob.size,dataUrl:'data:'+type+';base64,'+btoa(binary)});
      }finally{bitmap.close();}
    }catch{
      out.push(im);
    }
  }
  return out;
}
let queueGeneration=0;
async function startQueue(form,source='manual'){
  // Set the in-memory lock before any await. Storage is serialized too.
  if(isQueueRunning||pumping||scrapeTabId)throw new Error('Өөр даалгавар ажиллаж байна.');
  isQueueRunning=true;shouldAbortQueue=false;const generation=++queueGeneration;
  const checkStart=()=>{if(generation!==queueGeneration||shouldAbortQueue)throw new Error('QUEUE_ABORTED');};
  try{
    await entitlement(false);checkStart();
    const {job}=await chrome.storage.local.get('job');
    if(job&&['RUNNING','PAUSED','STOPPING'].includes(job.status))throw new Error('Хадгалсан queue байна. Үргэлжлүүлэх эсвэл зогсооно уу.');
    const groups=[...new Set((form?.fbGroupUrls||[]).map(RainyCore.groupUrl).filter(Boolean))];
    if(!groups.length)throw new Error('Зөв группийн холбоос оруулна уу.');
    if(form?.shuffleGroupsOrder)for(let i=groups.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[groups[i],groups[j]]=[groups[j],groups[i]];}
    let images=await loadSerializedImagesFromIDB();if(form?.stripMetadata!==false)images=await stripImageMetadata(images);
    const cleanDescription=String(form?.description||'').slice(0,20000);
    if(!cleanDescription.trim()&&!images.length)throw new Error('Текст эсвэл зураг оруулна уу.');
    const contentHash=await digest(JSON.stringify({description:cleanDescription,images:images.map(x=>x.dataUrl)}));
    const items=[];for(const url of groups)items.push({url,key:await digest(url+contentHash),status:'QUEUED'});
    const safeForm={...form,description:cleanDescription,fbGroupUrls:groups,minDelaySec:Math.max(1.5,Number(form?.minDelaySec)||30),dailyLimit:Math.max(1,Math.min(100,Number(form?.dailyLimit)||30)),breakEvery:Math.max(1,Math.min(30,Number(form?.breakEvery)||10)),breakMinutes:Math.max(1,Math.min(60,Number(form?.breakMinutes)||5))};
    const next={id:crypto.randomUUID(),createdAt:Date.now(),status:'RUNNING',source,form:safeForm,items,tabId:null,updatedAt:Date.now()};
    // Snapshot media so editing the next draft cannot alter this run.
    await atomic(async()=>{checkStart();await chrome.storage.local.set({job:next,jobImages:images,queueStatus:'RUNNING'});});
    await scheduleTick();void pump();return {ok:true};
  }catch(e){if(generation===queueGeneration)isQueueRunning=false;throw e;}
}
async function saveItem(jobId,index,change){return atomic(async()=>{
  const {job,postLedger={}}=await chrome.storage.local.get(['job','postLedger']);
  if(!job||job.id!==jobId)return null;
  const item=job.items[index];if(!item)return job;
  Object.assign(item,change);job.updatedAt=Date.now();
  if(['SUBMITTING','PUBLISHED','PENDING_APPROVAL','UNKNOWN'].includes(item.status))postLedger[item.key]={status:item.status,at:Date.now(),jobId,url:item.url,postUrl:item.postUrl||''};
  const terminal=job.items.every(i=>!['QUEUED','PREPARING','SUBMITTING'].includes(i.status));
  if(terminal&&job.status==='RUNNING')job.status='COMPLETED';
  await chrome.storage.local.set({job,postLedger,queueStatus:job.status==='RUNNING'?'RUNNING':'IDLE'});return job;
});}
async function pump(){
  if(pumping)return;pumping=true;
  let ownedTab=null;
  try{
    let {job,jobImages=[],postLedger={}}=await chrome.storage.local.get(['job','jobImages','postLedger']);
    if(!job||job.status!=='RUNNING'){isQueueRunning=false;return;}
    if(job.items.some(x=>['PREPARING','SUBMITTING'].includes(x.status)))return;
    if(job.nextAt>Date.now()){await scheduleTick(job.nextAt);return;}
    isQueueRunning=true;shouldAbortQueue=false;
    const index=job.items.findIndex(i=>i.status==='QUEUED');
    if(index<0){await atomic(async()=>{const {job:j}=await chrome.storage.local.get('job');if(j?.id===job.id){j.status='COMPLETED';await chrome.storage.local.set({job:j,queueStatus:'IDLE'});}});return;}
    const stats=(await chrome.storage.local.get('dailyStats')).dailyStats;
    if(stats?.day===today()&&stats.posts>=Math.max(1,Number(job.form?.dailyLimit)||30)){await pauseQueue('Өдрийн илгээх хязгаарт хүрсэн.');return;}
    const item=job.items[index];const windowMinutes=job.source==='schedule'?job.form.repeatWindowMinutes||20:1440;
    if(RainyCore.blocked(postLedger[item.key],windowMinutes)){
      await saveItem(job.id,index,{status:'DUPLICATE_BLOCKED',error:'Өмнөх нийтлэл баталгаажсан эсвэл тодорхойгүй байна.'});await scheduleTick();return;
    }
    try{
      await entitlement(false);
    }catch(licErr){
      await pauseQueue(licErr.message);
      await broadcastLog(licErr.message,'error');
      return;
    }
    // Persist PREPARING before navigation; an interruption is never automatically retried.
    await saveItem(job.id,index,{status:'PREPARING',startedAt:Date.now(),attemptId:crypto.randomUUID()});
    await broadcastLog(`Групп ${index+1}/${job.items.length}: ${item.url}`);
    // Open visibly (active: true) so the user immediately sees the working Facebook tab.
    const tab=await createAndWaitForTabComplete(item.url,35000,false);ownedTab=tab.id;
    job=await atomic(async()=>{const s=(await chrome.storage.local.get('job')).job;if(s?.id!==job.id||s.status!=='RUNNING')throw new Error('QUEUE_ABORTED');s.tabId=tab.id;await chrome.storage.local.set({job:s});return s;});
    let receiptTimer;const receiptDone=new Promise(resolve=>{receiptTimer=setInterval(async()=>{try{const current=(await chrome.storage.local.get('job')).job;const row=current?.id===job.id?current.items[index]:null;if(row&&row.attemptId===job.items[index].attemptId&&['PUBLISHED','PENDING_APPROVAL','UNKNOWN','CANCELLED'].includes(row.status))resolve({ok:true,...row});}catch{}},500);});
    let result;try{result=await Promise.race([receiptDone,executeTaskOnTab(tab.id,'EXECUTE_FB_GROUP_POST',{jobId:job.id,index,total:job.items.length,attemptId:job.items[index].attemptId,formData:buildCleanGroupPostData(job.form),images:jobImages},120000)]);}finally{clearInterval(receiptTimer);}
    if(isRestriction(result.error))await pauseQueue('Facebook хязгаарлалт/checkpoint илэрлээ. Facebook дээр асуудлаа шийдээд үргэлжлүүлнэ үү.');
    const latest=(await chrome.storage.local.get('job')).job;
    if(latest?.id===job.id&&['PREPARING','SUBMITTING'].includes(latest.items[index].status)){
      const fallbackStatus=latest.items[index].status==='SUBMITTING'?'UNKNOWN':(result.skipped?'SKIPPED':(result.error==='QUEUE_ABORTED'||shouldAbortQueue?'CANCELLED':'FAILED'));
      await saveItem(job.id,index,{status:result.status||fallbackStatus,error:result.error||'',postUrl:result.postUrl||''});
    }

  }catch(e){
    await atomic(async()=>{
      const {job,postLedger={}}=await chrome.storage.local.get(['job','postLedger']);if(!job)return;
      const item=job.items.find(x=>['PREPARING','SUBMITTING'].includes(x.status));
      if(item){const wasSubmitted=item.status==='SUBMITTING';item.status=wasSubmitted?'UNKNOWN':(e.message==='QUEUE_ABORTED'||shouldAbortQueue)?'CANCELLED':'FAILED';item.error=e.message;if(wasSubmitted)postLedger[item.key]={status:'UNKNOWN',at:Date.now(),jobId:job.id,url:item.url};}
      await chrome.storage.local.set({job,postLedger});
    });
    if(isRestriction(e.message))await pauseQueue('Facebook хязгаарлалт илэрсэн тул зогслоо.');
    await broadcastLog(e.message,'error');
  }finally{
    if(ownedTab)await safelyCloseTab(ownedTab);
    pumping=false;
    await atomic(async()=>{
      const {job}=await chrome.storage.local.get('job');if(!job)return;
      job.tabId=null;
      if(job.status==='RUNNING'&&!job.items.some(i=>['QUEUED','PREPARING','SUBMITTING'].includes(i.status)))job.status='COMPLETED';
      const finished=job.items.filter(i=>!['QUEUED','PREPARING','SUBMITTING','DUPLICATE_BLOCKED'].includes(i.status));
      if(job.status==='RUNNING'&&finished.slice(-3).length===3&&finished.slice(-3).every(i=>i.status==='FAILED')){job.status='PAUSED';job.pauseReason='3 дараалсан алдаа/баталгаажаагүй оролдлого. Шалгасны дараа үргэлжлүүлнэ үү.';}
      if(job.status==='RUNNING'){
        let delay=Math.max(1500,Number(job.form.minDelaySec||30)*1000);
        const every=Math.max(1,Number(job.form.breakEvery)||10);
        if(finished.length&&finished.length%every===0)delay=Math.max(delay,(Number(job.form.breakMinutes)||5)*60000);
        job.nextAt=Date.now()+delay;
      }
      isQueueRunning=job.status==='RUNNING';await chrome.storage.local.set({job,queueStatus:isQueueRunning?'RUNNING':'IDLE'});
      if(isQueueRunning)await scheduleTick(job.nextAt);
      else if(job.status==='COMPLETED'){
        const count=s=>job.items.filter(i=>i.status===s).length;
        await broadcastLog(`Дууслаа: нийтлэгдсэн ${count('PUBLISHED')}, хүлээгдсэн ${count('PENDING_APPROVAL')}, баталгаажаагүй ${count('UNKNOWN')}, алдаатай ${count('FAILED')}, алгассан ${count('SKIPPED')}, давхардлыг хаасан ${count('DUPLICATE_BLOCKED')}, зогсоосон ${count('CANCELLED')}.`);
      }
    });
  }
}
async function stopQueue(){
  ++queueGeneration;shouldAbortQueue=true;
  const tabId=await atomic(async()=>{
    const {job,postLedger={}}=await chrome.storage.local.get(['job','postLedger']);if(!job)return activeTabId;
    job.status='CANCELLED';
    for(const i of job.items){if(i.status==='SUBMITTING'){i.status='UNKNOWN';postLedger[i.key]={status:'UNKNOWN',at:Date.now(),jobId:job.id,url:i.url};}else if(['PREPARING','QUEUED'].includes(i.status))i.status='CANCELLED';}
    await chrome.storage.local.set({job,postLedger,queueStatus:'IDLE'});return job.tabId||activeTabId;
  });
  const cancelTab=scrapeTabId||tabId;
  if(cancelTab){try{await chrome.tabs.sendMessage(cancelTab,{action:'ABORT_TASK'});}catch{}if(!scrapeTabId||scrapeOwnsTab)await safelyCloseTab(cancelTab);}
  clearTimeout(queueWakeTimer);await chrome.alarms.clear(TICK);if(!scrapeTabId)isQueueRunning=false;return {ok:true};
}
async function submitPermit(m,sender){return atomic(async()=>{
  const {job,postLedger={}}=await chrome.storage.local.get(['job','postLedger']);
  const i=job?.items[m.index];
  if(job?.id!==m.jobId||job.status!=='RUNNING'||job.tabId!==sender.tab?.id||i?.attemptId!==m.attemptId||i.status!=='PREPARING')return {ok:false};
  const prev=(await chrome.storage.local.get('dailyStats')).dailyStats;const dailyStats=prev?.day===today()?prev:{day:today(),posts:0};
  if(dailyStats.posts>=Math.max(1,Number(job.form?.dailyLimit)||30))return {ok:false};
  i.status='SUBMITTING';i.submittedAt=Date.now();job.updatedAt=Date.now();postLedger[i.key]={status:'SUBMITTING',at:Date.now(),jobId:job.id,url:i.url};
  dailyStats.posts++;await chrome.storage.local.set({job,postLedger,dailyStats});return {ok:true};
});}
async function receipt(m,sender){return atomic(async()=>{
  const {job,postLedger={}}=await chrome.storage.local.get(['job','postLedger']);const i=job?.items[m.index];
  if(job?.id!==m.jobId||i?.attemptId!==m.attemptId||job.tabId!==sender.tab?.id||!['SUBMITTING','UNKNOWN'].includes(i.status))return {ok:false};
  const r=m.result;if(!['PUBLISHED','PENDING_APPROVAL','UNKNOWN'].includes(r?.status))return {ok:false};
  Object.assign(i,{status:r.status,error:String(r.error||'').slice(0,1000),postUrl:r.postUrl||'',note:r.note||''});
  postLedger[i.key]={status:i.status,at:Date.now(),jobId:job.id,url:i.url,postUrl:i.postUrl};job.updatedAt=Date.now();
  await chrome.storage.local.set({job,postLedger});return {ok:true};
});}
async function configureSchedule(c){
  if(!c?.enabled){await chrome.alarms.clear(SCHEDULE);await chrome.storage.local.set({scheduleConfig:{enabled:false}});return {ok:true};}
  for(const t of [c.activeStartHour,c.activeEndHour])if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(t||''))throw new Error('Цаг буруу байна.');
  new Intl.DateTimeFormat('en',{timeZone:c.timeZone||'Asia/Ulaanbaatar'});
  if(c.type==='once'){
    const when=new Date(c.dateTime).getTime();if(!Number.isFinite(when)||when<=Date.now())throw new Error('Ирээдүйн цаг сонгоно уу.');
    c.nextAt=when;await chrome.alarms.create(SCHEDULE,{when});
  }else{
    const n=Number(c.intervalMinutes||Number(c.intervalHours)*60);if(!RainyCore.INTERVALS.includes(n))throw new Error('Давтамж буруу байна.');
    c.intervalMinutes=n;c.nextAt=Date.now()+n*60000;await chrome.alarms.create(SCHEDULE,{when:c.nextAt,periodInMinutes:n});
  }
  await chrome.storage.local.set({scheduleConfig:c});return {ok:true};
}
async function recoverQueue(){
  return atomic(async()=>{
    const {job,postLedger={}}=await chrome.storage.local.get(['job','postLedger']);
    if(!job||!['RUNNING','STOPPING'].includes(job.status))return;
    if(!job.items.some(i=>['PREPARING','SUBMITTING'].includes(i.status))){isQueueRunning=true;await scheduleTick(Math.max(Date.now()+1000,job.nextAt||0));return;}
    const oldTab=job.tabId;RainyCore.recover(job);
    for(const i of job.items.filter(i=>i.status==='UNKNOWN'))postLedger[i.key]={status:'UNKNOWN',at:Date.now(),jobId:job.id,url:i.url};
    await chrome.storage.local.set({job,postLedger,queueStatus:'IDLE'});isQueueRunning=false;
    if(oldTab)await safelyCloseTab(oldTab);
  });
}
const ready=(async()=>{
  await configReady;
  await deviceIdentity();
  // Disable old polling; legacy tokens are never transmitted by this version.
  // Legacy credentials are never used. Preserve them until the owner migrates settings.
  // Existing license state must survive upgrades and every worker wake.
  await chrome.alarms.clear('RAINY_TG_POLL_ALARM').catch(()=>{});
  await chrome.storage.local.set({queueStatus:'IDLE'});
  await chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'}).catch(()=>{});
  await recoverQueue();await chrome.alarms.create(RECOVERY,{periodInMinutes:1});
  const {scheduleConfig:c}=await chrome.storage.local.get('scheduleConfig');
  if(c?.enabled&&!(await chrome.alarms.get(SCHEDULE))){
    if(c.type!=='once'||new Date(c.dateTime).getTime()>Date.now())await configureSchedule(c);
  }
})();
chrome.runtime.onInstalled.addListener(()=>{void ready;});
chrome.runtime.onStartup.addListener(()=>{void ready;});
chrome.alarms.onAlarm.addListener(alarm=>{void ready.then(async()=>{
  if(alarm.name===TICK)return pump();
  if(alarm.name===RECOVERY){
    if(!pumping){const {job}=await chrome.storage.local.get('job');if(job?.status==='RUNNING')return pump();}return;
  }
  if(alarm.name!==SCHEDULE)return;
  const {scheduleConfig:c,savedFormData:f,job}=await chrome.storage.local.get(['scheduleConfig','savedFormData','job']);
  if(!c?.enabled||!f)return;
  if(c.type==='once'&&!RainyCore.activeHours(c.activeStartHour,c.activeEndHour,new Date(),c.timeZone)){
    await broadcastLog('Нэг удаагийн хуваарь ажлын цагаас гадуур: алгаслаа.','warn');await configureSchedule({enabled:false});return;
  }
  if(c.type==='once')await configureSchedule({enabled:false});
  else {c.nextAt=Date.now()+c.intervalMinutes*60000;await chrome.storage.local.set({scheduleConfig:c});}
  if(!RainyCore.activeHours(c.activeStartHour,c.activeEndHour,new Date(),c.timeZone))return;
  if(isQueueRunning||['PAUSED','RUNNING'].includes(job?.status)){await broadcastLog('Хуваарийн ээлжийг алгаслаа: өмнөх queue дуусаагүй.','warn');return;}
  await startQueue({...f,repeatWindowMinutes:c.intervalMinutes||1440},'schedule');
}).catch(e=>broadcastLog(e.message,'error'));});
chrome.runtime.onMessage.addListener((m,sender,sendResponse)=>{
  if(sender.id!==chrome.runtime.id||!m||typeof m.action!=='string')return false;
  const internal=!!sender.url?.startsWith(chrome.runtime.getURL(''));
  const contentActions=['CONTENT_LOG','POST_SUBMIT_PERMIT','POST_RECEIPT','SCRAPE_PARTIAL'];
  if(!internal){
    if(!contentActions.includes(m.action)){sendResponse({ok:false,error:'FORBIDDEN'});return false;}
    const rawOrigin=sender.url||sender.tab?.url||'';
    if(rawOrigin){try{const u=new URL(rawOrigin);if(u.protocol!=='https:'||!/(^|\.)facebook\.com$/i.test(u.hostname)){sendResponse({ok:false,error:'FORBIDDEN'});return false;}}catch{sendResponse({ok:false,error:'FORBIDDEN'});return false;}}
  }
  ready.then(async()=>{
    switch(m.action){
      case 'START_AUTOMATION_QUEUE':return startQueue(m.payload||{});
      case 'STOP_AUTOMATION_QUEUE':return stopQueue();
      case 'RESUME_QUEUE':{
        if(isQueueRunning||pumping)throw new Error('Queue ажиллаж байна.');await entitlement(false);
        await atomic(async()=>{const {job}=await chrome.storage.local.get('job');if(job?.status!=='PAUSED')throw new Error('Үргэлжлүүлэх queue алга.');job.status='RUNNING';job.pauseReason='';job.updatedAt=Date.now();await chrome.storage.local.set({job,queueStatus:'RUNNING'});});
        isQueueRunning=true;await scheduleTick();void pump();return {ok:true};}
      case 'RETRY_SAFE_FAILURES':{
        const {job}=await chrome.storage.local.get('job');
        if(!job||['RUNNING','PAUSED'].includes(job.status))throw new Error('Эхлээд queue-г дуусгах эсвэл зогсооно уу.');
        const urls=job.items.filter(i=>i.status==='FAILED'&&!i.submittedAt).map(i=>i.url);
        if(!urls.length)throw new Error('Илгээгээгүй, дахин оролдож болох алдаа алга. UNKNOWN пост давтагдахгүй.');
        return startQueue({...job.form,fbGroupUrls:urls});}
      case 'POST_SUBMIT_PERMIT':return submitPermit(m,sender);
      case 'POST_RECEIPT':return receipt(m,sender);
      case 'SCRAPE_PARTIAL':{
        if(sender.tab?.id!==scrapeTabId)return {ok:false};
        return atomic(async()=>{const old=(await chrome.storage.local.get('scrapedLeads')).scrapedLeads||[];
          const leads=RainyLeads.merge([...old,...(Array.isArray(m.leads)?m.leads:[])]);
          await chrome.storage.local.set({scrapedLeads:leads});return {ok:true};});}
      case 'CHECK_FACEBOOK_CONNECTION':{
        const tabs=await chrome.tabs.query({url:['https://*.facebook.com/*']});
        if(!tabs.length)return {ok:true,message:'Facebook tab олдсонгүй. Facebook-д нэвтэрч нээнэ үү.'};
        const tab=tabs.find(t=>t.active)||tabs[0];
        try{await executeTaskOnTab(tab.id,'PING_CONTENT_SCRIPT',{},10000);return {ok:true,message:'Facebook холболт бэлэн. Пост, scrape, групп хайлт эхлүүлэх боломжтой.'};}
        catch(e){return {ok:true,message:'Facebook tab-аа refresh хийгээд дахин шалгана уу. '+e.message};}}
      case 'CONTENT_LOG':await broadcastLog(String(m.message).slice(0,1000),m.level||'info');return {ok:true};
      case 'CONFIGURE_SCHEDULE':return configureSchedule(m.scheduleConfig);
      case 'CANCEL_SCHEDULE':return configureSchedule({enabled:false});
      case 'SCRAPE_FB_POST_LEADS':await entitlement(false);if((await chrome.storage.local.get('job')).job?.status==='RUNNING')throw new Error('Queue-г эхлээд дуусгах эсвэл зогсооно уу.');if(isQueueRunning||pumping||scrapeTabId)throw new Error('Өөр даалгавар ажиллаж байна.');void runFacebookPostLeadScraper(m.keyword,Boolean(m.currentTabOnly));return {ok:true};
      case 'SCRAPE_FB_GROUPS':await entitlement(false);if((await chrome.storage.local.get('job')).job?.status==='RUNNING')throw new Error('Queue-г эхлээд дуусгах эсвэл зогсооно уу.');if(isQueueRunning||pumping||scrapeTabId)throw new Error('Өөр даалгавар ажиллаж байна.');void runFacebookGroupScraper({mode:m.mode,keyword:m.keyword,autoJoin:Boolean(m.autoJoin)});return {ok:true};
      case 'ACTIVATE_LICENSE_KEY':return activateKey(String(m.key||'').trim());
      case 'GET_SERVICE_STATUS':await configReady;return {ok:true,paymentsAvailable:!!ownerConfig.serverUrl,supportUrl:ownerConfig.supportUrl};
      case 'PURGE_LEGACY_TOKENS':await chrome.storage.local.remove(['tgBotToken','tgChatId']);await chrome.storage.sync.remove(['rainyTgBotToken','rainyTgChatId']);return {ok:true};
      case 'GET_LICENSE':return entitlement(false);
      case 'CREATE_ORDER':await enroll();return api('/v1/orders',{plan:m.plan,requestId:m.requestId});
      case 'CHECK_ORDER':return api('/v1/orders/'+encodeURIComponent(m.orderId));
      default:throw new Error('UNKNOWN_ACTION');
    }
  }).then(sendResponse).catch(e=>sendResponse({ok:false,error:e.message}));return true;
});

// Chrome handles the action's user gesture directly; no async message loses it.
function enableSidebar(){return chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true}).catch(console.error);}
void enableSidebar();
chrome.runtime.onInstalled.addListener(()=>{void enableSidebar();});
chrome.runtime.onStartup.addListener(()=>{void enableSidebar();});
chrome.action.onClicked.addListener(tab=>{if(tab.windowId!==undefined)void chrome.sidePanel.open({windowId:tab.windowId}).catch(console.error);});
