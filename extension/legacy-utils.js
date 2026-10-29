async function broadcastLog(message, level = 'info') {
  const time = new Date().toLocaleTimeString('mn-MN', { hour12: false });

  try {
    const data = await chrome.storage.local.get(['logs']);
    const logs = Array.isArray(data.logs) ? data.logs : [];
    logs.push({ time, message, level });
    if (logs.length > 300) logs.shift();
    await chrome.storage.local.set({ logs });
  } catch (e) {}

  chrome.runtime.sendMessage({ action: 'LOG_EVENT', message, level, time }).catch(() => {});
}

async function setQueueStatus(status) {
  await chrome.storage.local.set({ queueStatus: status });
  chrome.runtime.sendMessage({ action: 'QUEUE_STATUS_CHANGE', status }).catch(() => {});
}

function sendDesktopNotification(title, message) {
  try {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icon128.png'),
      title,
      message
    });
  } catch (e) {}
}

// ==========================================
// 4. INDEXEDDB
// ==========================================
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_IMAGES)) {
        db.createObjectStore(STORE_IMAGES, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_TEMPLATES)) {
        db.createObjectStore(STORE_TEMPLATES, { keyPath: 'id' });
      }
    };
    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (event) => reject(event.target.error);
  });
}

async function loadSerializedImagesFromIDB() {
  try {
    const db = await openDB();
    const records = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_IMAGES, 'readonly');
      const req = tx.objectStore(STORE_IMAGES).getAll();
      req.onsuccess = () => { db.close(); resolve(req.result || []); };
      req.onerror = (e) => { db.close(); reject(e.target.error); };
    });

    records.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    return records.map((rec, i) => ({
      id: rec.id,
      index: rec.index ?? i,
      name: rec.name || `photo_${i + 1}.jpg`,
      type: rec.type || 'image/jpeg',
      size: rec.size || 0,
      dataUrl: rec.dataUrl
    }));
  } catch (e) {
    throw new Error('IMAGE_STORAGE_ERROR: '+e.message);
  }
}

// ==========================================
// 5. CLEAN TEXT & SPINTAX (NO EXTRA HASHTAGS!)
// ==========================================
function evaluateSpintax(text) {
  if (!text) return '';
  let result = text;
  const regex = /\{([^{}]+)\}/g;
  let safety = 0;
  while (regex.test(result) && safety < 20) {
    result = result.replace(regex, (_, optionsStr) => {
      const choices = optionsStr.split('|');
      return choices[Math.floor(Math.random() * choices.length)];
    });
    safety++;
  }
  return result;
}

function buildCleanGroupPostData(baseFormData) {
  const cloned = { ...baseFormData };
  cloned.description = evaluateSpintax(baseFormData.description || '');
  return cloned;
}

function getGaussianRandomInt(minMs, maxMs) {
  const samples = 4;
  let sum = 0;
  for (let i = 0; i < samples; i++) sum += Math.random();
  const normalized = sum / samples;
  return Math.floor(minMs + normalized * (maxMs - minMs));
}

async function sleepWithAbortCheck(totalMs) {
  const step = 500;
  let elapsed = 0;
  while (elapsed < totalMs) {
    if (shouldAbortQueue) throw new Error('QUEUE_ABORTED');
    await new Promise((r) => setTimeout(r, Math.min(step, totalMs - elapsed)));
    elapsed += step;
  }
}

// ==========================================
// 6. SILENT BACKGROUND TAB LIFECYCLE (`active: false`)
// ==========================================
function createAndWaitForTabComplete(url,timeoutMs=60000,silentBackground=true){
  return new Promise((resolve,reject)=>{
    let tabId=null,done=false;
    function cleanup(){clearTimeout(timer);chrome.tabs.onUpdated.removeListener(update);chrome.tabs.onRemoved.removeListener(removed);}
    function finish(err,tab){if(done)return;done=true;cleanup();err?reject(err):resolve(tab);}
    function update(id,change,tab){if(id===tabId&&change.status==='complete')finish(null,tab);}
    function removed(id){if(id===tabId)finish(new Error('TAB_CLOSED'));}
    const timer=setTimeout(()=>finish(new Error('TAB_LOAD_TIMEOUT')),timeoutMs);
    chrome.tabs.onUpdated.addListener(update);chrome.tabs.onRemoved.addListener(removed);
    chrome.tabs.create({url,active:!silentBackground},tab=>{
      if(chrome.runtime.lastError||!tab)return finish(new Error('TAB_CREATE_FAILED'));
      tabId=tab.id;activeTabId=tab.id;
      if(shouldAbortQueue){void safelyCloseTab(tab.id);return finish(new Error('QUEUE_ABORTED'));}
      if(tab.status==='complete')finish(null,tab);
    });
  });
}

function navigateExistingTabAndWait(tabId, url, timeoutMs = 35000) {
  return new Promise((resolve, reject) => {
    let finished = false;

    const timer = setTimeout(() => {
      if (!finished) {
        finished = true;
        chrome.tabs.onUpdated.removeListener(listener);
        reject(new Error(`Хуудас шилжих хугацаа хэтэрлээ: ${url}`));
      }
    }, timeoutMs);

    const listener = (updatedTabId, changeInfo, tab) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        finished = true;
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve(tab);
      }
    };

    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.update(tabId, { url, active: false }, () => {
      if (chrome.runtime.lastError) {
        finished = true;
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        reject(new Error(chrome.runtime.lastError.message));
      }
    });
  });
}

async function safelyCloseTab(tabId) {
  if (!tabId) return;
  try {
    await chrome.tabs.remove(tabId);
  } catch (e) {}
  if (activeTabId === tabId) activeTabId = null;
}

async function executeTaskOnTab(tabId, actionName, taskPayload, timeoutMs = 120000) {
  let scriptReady = false,injected=false;
  for (let attempt = 1; attempt <= 14; attempt++) {
    if (shouldAbortQueue) throw new Error('QUEUE_ABORTED');
    try {
      const pingResp = await chrome.tabs.sendMessage(tabId, { action: 'PING_CONTENT_SCRIPT' });
      if (pingResp && pingResp.ready) {
        scriptReady = true;
        break;
      }
    } catch (e) {
      if(!injected&&chrome.scripting){injected=true;try{await chrome.scripting.executeScript({target:{tabId},files:['content-facebook.js']});}catch(injectError){throw new Error('CONTENT_ATTACH_FAILED: '+injectError.message);}}
    }
    await sleepWithAbortCheck(700);
  }

  if (!scriptReady) {
    throw new Error('Facebook хуудастай холбогдож чадсангүй (Дахин оролдоно уу).');
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Даалгаврын хугацаа (${Math.round(timeoutMs / 1000)}с) дууслаа.`));
    }, timeoutMs);

    chrome.tabs.sendMessage(tabId, { action: actionName, payload: taskPayload }, (response) => {
      clearTimeout(timer);
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response || { ok: false, error: 'Хариу ирсэнгүй' });
    });
  });
}

// ==========================================
// 7. SILENT POST & PHONE LEAD SCRAPER
// ==========================================
async function runFacebookPostLeadScraper(keyword, currentTabOnly = false) {
  if (isQueueRunning) {
    await broadcastLog('Өөр даалгавар ажиллаж байна.', 'warn');
    return;
  }
  isQueueRunning = true;
  shouldAbortQueue = false;
  await setQueueStatus('SCRAPING');

  let createdTab = null;
  try {
    let targetTabId = null;

    if (currentTabOnly) {
      const fbTabs = await chrome.tabs.query({ url: ['*://*.facebook.com/*'] });
      if (fbTabs.length === 0) {
        throw new Error('Нээлттэй Facebook хуудас олдсонгүй. Эхлээд Facebook нээх эсвэл түлхүүр үгээр хайна уу.');
      }
      const activeFb = fbTabs.find((t) => t.active) || fbTabs[0];
      targetTabId = activeFb.id;
      await broadcastLog(`[Lead Scraper] Нээлттэй Facebook хуудаснаас далд горимоор зар & утас ухаж байна...`, 'info');
    } else {
      const isDirectUrl = /^https?:\/\/(www\.|m\.|web\.)?facebook\.com\//i.test(keyword);
      const targetUrl = isDirectUrl
        ? keyword
        : `https://www.facebook.com/search/posts/?q=${encodeURIComponent(keyword)}`;

      await broadcastLog(`[Lead Scraper] Далд горимоор "${keyword}" зарын пост болон утасны дугаарыг ухаж байна...`, 'info');
      createdTab = await createAndWaitForTabComplete(targetUrl, 35000, true);
      targetTabId = createdTab.id;
      await sleepWithAbortCheck(700);
    }

    scrapeTabId=targetTabId;scrapeOwnsTab=!!createdTab;
    let result = await executeTaskOnTab(
      targetTabId,
      'EXECUTE_FB_POST_SCRAPE',
      { keyword: keyword || '', maxScrolls: 16 },
      180000
    );

    if (!result.ok) throw new Error(result.error || 'SCRAPE_FAILED');
    let leads = result.leads || [];

    // Fallback: if /search/posts/ returned 0 leads and we opened a search tab, automatically try /search/top/
    if (!currentTabOnly && createdTab && leads.length === 0 && !/^https?:\/\//i.test(keyword)) {
      await broadcastLog(`[Lead Scraper] Нийтлэлүүдийн ерөнхий хайлтаас (/search/top/) үргэлжлүүлэн ухаж байна...`, 'info');
      const topUrl = `https://www.facebook.com/search/top/?q=${encodeURIComponent(keyword)}`;
      await navigateExistingTabAndWait(createdTab.id, topUrl, 35000);
      await sleepWithAbortCheck(700);
      result = await executeTaskOnTab(
        createdTab.id,
        'EXECUTE_FB_POST_SCRAPE',
        { keyword, maxScrolls: 7 },
        120000
      );
      if (!result.ok) throw new Error(result.error || 'SCRAPE_FAILED');
      leads = result.leads || [];
    }

    const old = (await chrome.storage.local.get('scrapedLeads')).scrapedLeads || [];
    leads = Array.from(new Map([...old, ...leads].map(l=>[l.url || l.id,l])).values()).slice(-5000);
    await chrome.storage.local.set({ scrapedLeads: leads });
    chrome.runtime.sendMessage({ action: 'SCRAPED_LEADS_UPDATED', leads }).catch(() => {});

    const withPhoneCount = leads.filter((l) => Boolean(l.phone)).length;
    await broadcastLog(
      `✅ Зар ухаж дууслаа: Нийт ${leads.length} зарын пост (үүнээс ${withPhoneCount} утасны дугаартай) олдлоо!`,
      'success'
    );
    sendDesktopNotification('Зар & Утас Татагдлаа', `Нийт ${leads.length} зар (${withPhoneCount} утастай) татагдлаа.`);
  } catch (err) {
    await broadcastLog(`[Lead Scraper] ❌ Алдаа: ${err.message}`, 'error');
  } finally {
    if (createdTab && createdTab.id) await safelyCloseTab(createdTab.id);
    scrapeTabId=null;scrapeOwnsTab=false;
    isQueueRunning = false;
    shouldAbortQueue = false;
    await setQueueStatus('IDLE');
  }
}

// ==========================================
// 8. SILENT FACEBOOK GROUP SCRAPER
// ==========================================
async function runFacebookGroupScraper({ mode, keyword, autoJoin }) {
  if (isQueueRunning) {
    await broadcastLog('Өөр даалгавар ажиллаж байна.', 'warn');
    return;
  }
  isQueueRunning = true;
  shouldAbortQueue = false;
  await setQueueStatus('SCRAPING');

  const targetUrl =
    mode === 'joined'
      ? 'https://www.facebook.com/groups/joins/'
      : `https://www.facebook.com/search/groups/?q=${encodeURIComponent(keyword)}`;

  let tab = null;
  try {
    await broadcastLog(`[Group Scraper] Далд горимоор группүүдийг хайж байна...`, 'info');
    tab = await createAndWaitForTabComplete(targetUrl, 35000, true);
    await sleepWithAbortCheck(700);

    scrapeTabId=tab.id;scrapeOwnsTab=true;
    const result = await executeTaskOnTab(
      tab.id,
      'EXECUTE_FB_GROUP_SCRAPE',
      { mode, keyword, autoJoin, maxScrolls: 6 },
      90000
    );

    if(!result.ok)throw new Error(result.error||'SCRAPE_FAILED');
    const groups = result.groups || [];
    await chrome.storage.local.set({ scrapedGroups: groups });
    chrome.runtime.sendMessage({ action: 'SCRAPED_GROUPS_UPDATED', groups }).catch(() => {});

    await broadcastLog(`✅ Групп хайлт дууслаа: ${groups.length} групп олдлоо!`, 'success');
  } catch (err) {
    await broadcastLog(`[Group Scraper] ❌ Алдаа: ${err.message}`, 'error');
  } finally {
    if (tab && tab.id) await safelyCloseTab(tab.id);
    scrapeTabId=null;scrapeOwnsTab=false;
    isQueueRunning = false;
    shouldAbortQueue = false;
    await setQueueStatus('IDLE');
  }
}

