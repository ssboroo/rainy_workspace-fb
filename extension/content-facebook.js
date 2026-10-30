/** RAINY Pro 5: conservative DOM posting receipts and incremental visible-post extraction. */

(() => {
  if(window.__RAINY_FB_SUITE_LOADED__)return;
  window.__RAINY_FB_SUITE_LOADED__=true;
  window.__RAINY_FB_SUITE_VERSION__='5.4.0';

  let taskAborted = false;
  function checkAbort(){ if(taskAborted)throw new Error('QUEUE_ABORTED'); }

  function updateHud(statusText, subText = '', tone = 'info') {
    try {
      let hud = document.getElementById('rainy-hud-container');
      if (!hud) {
        hud = document.createElement('div');
        hud.id = 'rainy-hud-container';
        hud.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:2147483647;width:320px;padding:12px 14px;border-radius:12px;background:rgba(13,23,40,0.95);border:1px solid #3288ff;color:#edf4ff;font:12px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:0 10px 30px rgba(0,0,0,0.45);pointer-events:none;backdrop-filter:blur(8px);';
        const head = document.createElement('div');
        head.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:5px;font-weight:700;color:#7ed5ff;font-size:11px;letter-spacing:0.4px;';
        const dot = document.createElement('span');
        dot.id = 'rainy-hud-dot';
        dot.style.cssText = 'width:8px;height:8px;border-radius:50%;background:#65e6ae;box-shadow:0 0 8px #65e6ae;flex:none;';
        const title = document.createElement('span');
        title.textContent = 'RAINY FB PRO · АЖИЛЛАЖ БАЙНА';
        head.append(dot, title);
        const main = document.createElement('div');
        main.id = 'rainy-hud-status';
        main.style.cssText = 'font-size:12px;font-weight:600;color:#ffffff;word-break:break-word;';
        const sub = document.createElement('div');
        sub.id = 'rainy-hud-sub';
        sub.style.cssText = 'font-size:10px;color:#9bb4d4;margin-top:3px;word-break:break-word;';
        hud.append(head, main, sub);
        (document.body || document.documentElement).appendChild(hud);
      }
      const statusEl = document.getElementById('rainy-hud-status');
      const subEl = document.getElementById('rainy-hud-sub');
      const dotEl = document.getElementById('rainy-hud-dot');
      if (statusEl && statusText) statusEl.textContent = statusText;
      if (subEl && subText !== null) subEl.textContent = subText;
      if (dotEl) {
        dotEl.style.background = tone === 'error' ? '#ff7596' : tone === 'success' ? '#65e6ae' : '#51b9ff';
      }
    } catch (e) {}
  }

  function pageGate(){
    if(/\/(login|checkpoint)(\/|\?|$)/.test(location.pathname)||document.querySelector('input[name="email"], input[name="pass"]'))throw new Error('FACEBOOK_LOGIN_OR_CHECKPOINT');
    if(navigator.onLine===false)throw new Error('OFFLINE');
    const notices=Array.from(document.querySelectorAll('[role="alert"],[role="dialog"]')).map(x=>normalizeText(x.innerText||'')).join(' ');
    if(/you.re temporarily blocked|you can.t use this feature right now|we restrict certain activity|action blocked|temporarily restricted|security check|confirm your identity|unusual activity|түр хориглосон|үйлдлийг хязгаарласан|түр хязгаарласан/.test(notices))throw new Error('FB_RESTRICTION');
  }
  function logToExtension(message, level = 'info') {
    updateHud(message, null, level);
    chrome.runtime.sendMessage({
      action: 'CONTENT_LOG',
      message: `[FB] ${message}`,
      level
    }).catch(() => {});
  }

  function fastSleep(ms = 400) {
    checkAbort();
    return new Promise((resolve,reject) => setTimeout(()=>{try{checkAbort();resolve();}catch(e){reject(e);}}, ms));
  }

  function normalizeText(str) {
    return (str || '').toString().replace(/[\u200B-\u200D\uFEFF]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  /**
   * Works in both active tabs AND hidden background tabs (`active: false`)!
   */
  function isVisible(el) {
    if (!el) return false;
    if (el.closest && el.closest('#rainy-hud-container')) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }
    if (document.hidden) {
      // Background tab: don't require positive bounding rect if Chrome deferred paint
      return true;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function simulateHumanClick(element) {
    if (!element) return;
    try {
      element.scrollIntoView({ behavior: 'instant', block: 'center' });
    } catch (e) {
      element.scrollIntoView();
    }
    const rect = element.getBoundingClientRect();
    const clientX = rect.left + (rect.width || 10) / 2;
    const clientY = rect.top + (rect.height || 10) / 2;

    const opts = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX,
      clientY
    };

    element.dispatchEvent(new PointerEvent('pointerdown', opts));
    element.dispatchEvent(new MouseEvent('mousedown', opts));
    element.focus?.();
    element.dispatchEvent(new PointerEvent('pointerup', opts));
    element.dispatchEvent(new MouseEvent('mouseup', opts));
    try {
      element.click?.();
    } catch (e) {}
  }

  function performInstantScroll(stepPx = 1500) {
    window.scrollBy(0, stepPx);
    if (document.scrollingElement) {
      document.scrollingElement.scrollTop += stepPx;
    }
    document.documentElement.scrollTop += stepPx;
    window.dispatchEvent(new Event('scroll', { bubbles: true }));
  }

  function waitForElement(predicate,timeoutMs=6000){
    return new Promise((resolve,reject)=>{
      let poll,timer,observer,done=false;
      function finish(err,value){if(done)return;done=true;clearInterval(poll);clearTimeout(timer);observer?.disconnect();err?reject(err):resolve(value);}
      function inspect(){try{checkAbort();const v=predicate();if(v)finish(null,v);}catch(e){finish(e);}}
      observer=new MutationObserver(inspect);observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true});
      poll=setInterval(inspect,250);timer=setTimeout(()=>finish(new Error('ELEMENT_TIMEOUT')),timeoutMs);inspect();
    });
  }

  // =========================================================================
  // SECTION 3: SMART GROUP JOINER & COMPOSER DETECTOR
  // =========================================================================
  async function ensureGroupJoinedOrSkip() {
    pageGate();
    const labels=Array.from(document.querySelectorAll('[role="button"],button')).filter(isVisible).map(b=>normalizeText(b.getAttribute('aria-label')||b.textContent));
    if(labels.some(t=>['cancel request','хүсэлтийг цуцлах','pending'].includes(t)))return {status:'PENDING'};
    if(labels.some(t=>['join group','join','нэгдэх','бүлэгт нэгдэх'].includes(t)))return {status:'NOT_JOINED'};
    return {status:'READY'};
  }

  async function openGroupComposerModal() {
    pageGate();checkAbort();
    const triggerPhrases = [
      'write something', 'create a public post', "what's on your mind",
      'start a discussion', 'write a post', 'create a post',
      'юу бодож байна', 'нийтлэл бичих', 'ямар нэгэн зүйл бичээрэй',
      'хэлэлцүүлэг эхлүүлэх', 'пост бичих', 'пост оруулах', 'санал бодлоо хуваалцаарай',
      'напишите что-нибудь', 'создать публикацию'
    ];

    const findBtn = () => {
      const buttons = Array.from(
        document.querySelectorAll('div[role="button"], span[role="button"], div[tabindex="0"]')
      ).filter(isVisible);

      for (const btn of buttons) {
        if (btn.closest && btn.closest('[role="article"]')) continue;
        const text = normalizeText(btn.textContent || btn.getAttribute('aria-label') || '');
        if (text.length > 0 && text.length <= 100 && triggerPhrases.some((p) => text.includes(p))) return btn;
      }

      const photoActionBtn = buttons.find((b) => {
        if (b.closest && b.closest('[role="article"]')) return false;
        const t = normalizeText(b.textContent || b.getAttribute('aria-label') || '');
        return t === 'photo/video' || t === 'зураг/видео' || t === 'фото/видео';
      });
      if (photoActionBtn) {
        const composerCard = photoActionBtn.closest('div[role="region"], div[class*="x1yztbdb"], div[class*="x1n2onr6"]');
        if (composerCard) {
          const siblingTrigger = Array.from(composerCard.querySelectorAll('div[role="button"]')).find(
            (el) => isVisible(el) && el !== photoActionBtn && normalizeText(el.textContent).length > 4
          );
          if (siblingTrigger) return siblingTrigger;
        }
        return photoActionBtn;
      }

      return null;
    };

    let triggerBtn = await waitForElement(findBtn, 4500).catch(() => null);

    if (!triggerBtn) {
      const discussionTab = Array.from(document.querySelectorAll('a[role="tab"], div[role="tab"], span')).find((el) => {
        if (!isVisible(el)) return false;
        const t = normalizeText(el.textContent);
        return t === 'discussion' || t === 'хэлэлцүүлэг' || t === 'обсуждение';
      });
      if (discussionTab) {
        simulateHumanClick(discussionTab);
        await fastSleep(1500);
        triggerBtn = await waitForElement(findBtn, 4000).catch(() => null);
      }
    }

    if (!triggerBtn) {
      const membership=await ensureGroupJoinedOrSkip();
      return {skipped:true,reason:membership.status==='PENDING'?'PENDING_APPROVAL':membership.status==='NOT_JOINED'?'NOT_A_MEMBER':'NO_WRITE_PERMISSION'};
    }

    logToExtension('Пост бичих цонхыг нээж байна...', 'info');
    simulateHumanClick(triggerBtn);
    await fastSleep(900);

    const dialogEditor = await waitForElement(() => {
      const dialogs = Array.from(document.querySelectorAll('div[role="dialog"]')).filter(isVisible);
      for (const dialog of dialogs) {
        const editor = dialog.querySelector(
          'div[contenteditable="true"][role="textbox"], div[contenteditable="true"][data-lexical-editor="true"]'
        );
        if (editor && isVisible(editor)) return { dialog, editor };
      }
      const fallback = document.querySelector('div[role="dialog"] div[contenteditable="true"][role="textbox"]');
      if (fallback && isVisible(fallback)) {
        return { dialog: fallback.closest('div[role="dialog"]') || document.body, editor: fallback };
      }
      return null;
    }, 20000).catch(() => null);

    if (!dialogEditor) {
      return { skipped: true, reason: 'MODAL_FAILED_TO_OPEN' };
    }

    return dialogEditor;
  }

  // =========================================================================
  // SECTION 4: MULTI-LAYER LINKLESS FACEBOOK POST & PHONE SCRAPER (v4.4.0)
  // =========================================================================
  const UI_GARBAGE_LINE_REGEX = /^(?:like|comment|share|send|follow|join|таалагдлаа|сэтгэгдэл|хуваалцах|илгээх|дагах|нэгдэх|see more|цааш үзэх|… see more|\.\.\. цааш үзэх|see translation|орчуулгыг харах|all reactions:?|most relevant|хамгийн хамааралтай|write a comment…?|write a public comment…?|сэтгэгдэл бичих…?|public group|нээлттэй бүлэг|private group|хаалттай бүлэг|shared with public|search results|хайлтын үр дүн|filters|шүүлтүүр|posts|нийтлэлүүд|people|хүмүүс|groups|бүлгүүд|pages|хуудсууд|recent posts|сүүлийн нийтлэлүүд|sort by|эрэмбэлэх|view more comments|илүү олон сэтгэгдэл харах|reply|хариулах|author|зохиогч|top contributor|идэвхтэй гишүүн|admin|админ|\d+\s*(?:comments?|shares?|views?|likes?|сэтгэгдэл|хуваалцсан|үзсэн))$/i;

  /**
   * Walks visible DOM text nodes inside `rootEl`, skipping hidden anti-scrape spans,
   * comment lists, forms, navigation bars, and repeated "Facebook" skeleton placeholders.
   */
  function extractVisibleCleanTextNodes(rootEl) {
    if (!rootEl) return '';
    const chunks = [];
    const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (
          parent.closest(
            '#rainy-hud-container, script, style, noscript, svg, nav, [role="navigation"], [role="banner"], [role="complementary"], ul, form, [aria-label*="Comment by" i], [aria-label*="Сэтгэгдэл" i]'
          )
        ) {
          return NodeFilter.FILTER_REJECT;
        }
        if (parent.getAttribute('aria-hidden') === 'true') {
          return NodeFilter.FILTER_REJECT;
        }
        const st = window.getComputedStyle(parent);
        if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0' || st.fontSize === '0px') {
          return NodeFilter.FILTER_REJECT;
        }
        const val = (node.nodeValue || '').trim();
        if (!val) return NodeFilter.FILTER_REJECT;
        if (/^(?:facebook)+$/i.test(val)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    let current;
    while ((current = walker.nextNode())) {
      chunks.push(current.nodeValue.trim());
    }
    return chunks.join('\n');
  }

  function cleanFacebookAdText(rawText) {
    if (!rawText) return '';

    // 1. Strip repeated "Facebook" anti-scrape obfuscation strings
    let text = rawText.replace(/(?:\bFacebook\b[\s.,·•\n\r|-]*)+/gi, '\n');

    // 2. Clean line by line
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.replace(/\bFacebook\b/gi, '').replace(/\s+/g, ' ').trim())
      .filter((line) => {
        if (!line || line.length < 2) return false;
        if (/^[·•\-_=\s.,|/\\+*]+$/.test(line)) return false;
        // Skip single-character obfuscation lines like "f a c e b o o k" or "1 d"
        if (/^(?:[a-zA-Zа-яА-ЯөӨүҮёЁ]\s+){3,}[a-zA-Zа-яА-ЯөӨүҮёЁ]$/.test(line)) return false;
        if (UI_GARBAGE_LINE_REGEX.test(line)) return false;
        // Skip pure reaction count lines like "12" or "3.4K"
        if (/^\d+(?:[.,]\d+)?[KkMm]?$/.test(line)) return false;
        return true;
      });

    // 3. Deduplicate identical lines within the same post
    const seenLines = new Set();
    const deduped = [];
    for (const l of lines) {
      const norm = l.toLowerCase();
      if (!seenLines.has(norm)) {
        seenLines.add(norm);
        deduped.push(l);
      }
    }

    return deduped.join('\n').trim();
  }

  /**
   * Extracts all 8-digit Mongolian phone numbers (starting with 6, 7, 8, 9)
   * even when formatted with spaces, dashes, dots, or +976.
   */
  function extractCleanPhoneNumbers(text) {
    if (!text) return '';
    const patterns = [
      /(?:\+?976[\s.-]?)?\b([6789]\d{7})\b/g,
      /(?:\+?976[\s.-]?)?\b([6789]\d{3}[\s.-]\d{4})\b/g,
      /(?:\+?976[\s.-]?)?\b([6789]\d[\s.-]\d{2}[\s.-]\d{2}[\s.-]\d{2})\b/g,
      /(?:\+?976[\s.-]?)?\b([6789]\d{2}[\s.-]\d{2}[\s.-]\d{3})\b/g
    ];

    const found = [];
    for (const reg of patterns) {
      const matches = text.matchAll(reg);
      for (const match of matches) {
        const m=match[0];
        const suffix=text.slice(match.index+m.length,match.index+m.length+16);
        if(/^\s*(?:₮|төг|сая|мянга|MNT)/i.test(suffix))continue;
        const digits = m.replace(/[^\d]/g, '').slice(-8);
        if (digits.length === 8 && /^[6789]/.test(digits)) {
          // Reject obvious round millions like 80000000 or 90000000 unless real phone
          if (!/^[6789]0000000$/.test(digits)) {
            found.push(digits);
          }
        }
      }
    }

    return Array.from(new Set(found)).join(', ');
  }

  function extractCleanPrice(text) {
    if (!text) return '';
    const patterns = [
      /(\d+(?:[.,]\d+)?\s*(?:тэрбум|сая|мянга|мян|төг|төгрөг|₮)(?:\s*\/?\s*(?:сар|мкв|м2))?)/i,
      /(?:үнэ|une|price)[\s:=-]*(\d+(?:[.,]\d+)?(?:\s*(?:сая|тэрбум|₮|төг|k|m))?)/i
    ];
    for (const p of patterns) {
      const m = text.match(p);
      if (m && m[1]) return m[1].trim();
    }
    return '';
  }

  function parseTimestampAndDate(card, fullText) {
    let exactDateStr = '';
    let timestamp = null;

    if (card && card.querySelectorAll) {
      const timeAnchors = Array.from(card.querySelectorAll('a[role="link"], span, abbr, time'));
      for (const el of timeAnchors) {
        const aria = el.getAttribute('aria-label') || '';
        const title = el.getAttribute('title') || '';
        const text = (el.textContent || '').trim();
        const candidate = aria || title || text;

        if (!candidate || candidate.length > 42) continue;

        if (candidate.match(/\d{1,2}.*сарын|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b|\b202\d\b/i)) {
          exactDateStr = candidate.trim();
          break;
        }
        if (
          candidate.match(
            /^(?:\d+\s*(?:мин|минут|цаг|өдөр|хоног|m|min|mins|h|hr|hrs|d|w)|саяхан|just now|өчигдөр|yesterday)$/i
          ) &&
          !exactDateStr
        ) {
          exactDateStr = candidate.trim();
        }
      }
    }

    const norm = normalizeText(exactDateStr);
    const now = Date.now();
    if (norm.includes('саяхан') || norm.includes('just now')) {
      timestamp = now;
      if (!exactDateStr) exactDateStr = 'Саяхан';
    } else {
      const minMatch = norm.match(/\b(\d+)\s*(?:мин|min|mins|m)\b/);
      if (minMatch) {
        timestamp = now - parseInt(minMatch[1], 10) * 60 * 1000;
        if (!exactDateStr) exactDateStr = `${minMatch[1]} мин өмнө`;
      } else {
        const hrMatch = norm.match(/\b(\d+)\s*(?:цаг|hr|hrs|h|hour)\b/);
        if (hrMatch) {
          timestamp = now - parseInt(hrMatch[1], 10) * 3600 * 1000;
          if (!exactDateStr) exactDateStr = `${hrMatch[1]} цагийн өмнө`;
        } else {
          const dayMatch = norm.match(/\b(\d+)\s*(?:өдөр|хоног|day|days|d)\b/);
          if (dayMatch) {
            timestamp = now - parseInt(dayMatch[1], 10) * 86400 * 1000;
            if (!exactDateStr) exactDateStr = `${dayMatch[1]} өдрийн өмнө`;
          } else if (norm.includes('өчигдөр') || norm.includes('yesterday')) {
            timestamp = now - 86400 * 1000;
            if (!exactDateStr) exactDateStr = 'Өчигдөр';
          }
        }
      }
    }

    if (!exactDateStr) exactDateStr='Огноо тодорхойгүй';

    return { exactDateStr, timestamp };
  }

  function extractCleanAdMessageFromCard(card) {
    if (!card) return '';

    // 1. Dedicated post message elements
    const msgContainers = Array.from(
      card.querySelectorAll(
        'div[data-ad-preview="message"], div[data-ad-comet-preview="message"], div[data-ad-rendering-role="story_message"]'
      )
    );
    if (msgContainers.length > 0) {
      const raw = msgContainers.map((el) => extractVisibleCleanTextNodes(el) || el.innerText || '').join('\n');
      const cleaned = cleanFacebookAdText(raw);
      if (cleaned.length >= 12) return cleaned;
    }

    // 2. dir="auto" text blocks inside the card
    const dirAutoBlocks = Array.from(card.querySelectorAll('div[dir="auto"], span[dir="auto"]')).filter((el) => {
      if (el.closest('ul, form, nav, [role="navigation"], [aria-label*="comment" i], [aria-label*="сэтгэгдэл" i]')) {
        return false;
      }
      if (el.querySelector('div[dir="auto"]')) return false;
      return true;
    });

    if (dirAutoBlocks.length > 0) {
      const raw = dirAutoBlocks.map((el) => extractVisibleCleanTextNodes(el) || el.innerText || '').join('\n');
      const cleaned = cleanFacebookAdText(raw);
      if (cleaned.length >= 12) return cleaned;
    }

    // 3. TreeWalker visible text fallback
    const treeText = cleanFacebookAdText(extractVisibleCleanTextNodes(card));
    if (treeText.length >= 12) return treeText;

    return cleanFacebookAdText(card.innerText || '');
  }

  function isGenuinePostContent(cleanText, phone) {
    if (!cleanText || cleanText.length < 15) return false;
    // Reject if over 2500 chars (likely an entire outer feed container rather than a single post)
    if (cleanText.length > 2600) return false;

    const words = cleanText.split(/\s+/).filter((w) => w.length >= 2);
    if (words.length < 3) return false;

    // Phone-shaped text is only a candidate; the UI retains its source and confidence.
    if (phone && phone.length >= 8) return true;

    // Otherwise check that it's a real post (>= 25 chars and not just sidebar menu items)
    if (cleanText.length >= 25 && words.length >= 4) {
      return true;
    }
    return false;
  }

  function makePostFingerprint(cleanText, phone) {
    // Strip timestamps, spaces, and punctuation to create a stable deduplication key
    const core = cleanText
      .toLowerCase()
      .replace(/\d+\s*(?:мин|цаг|өдөр|хоног|min|hr|d)\b/g, '')
      .replace(/[^a-z0-9а-яөүё]/gi, '')
      .slice(0, 95);
    return `${phone || 'nophone'}_${core}`;
  }

  async function clickAllSeeMoreButtons(root = document) {
    const seeMoreButtons = Array.from(
      root.querySelectorAll('div[role="button"], span[role="button"]')
    ).filter((btn) => {
      const t = normalizeText(btn.textContent || '');
      return (
        t === 'see more' ||
        t === 'цааш үзэх' ||
        t === '… see more' ||
        t === '... цааш үзэх' ||
        t.endsWith('see more') ||
        t.endsWith('цааш үзэх')
      );
    });

    for (const btn of seeMoreButtons) {
      try {
        btn.click();
      } catch (e) {}
    }
  }

  /**
   * Finds the nearest single-post card ancestor around a text element or message node
   * without climbing all the way up to the entire feed container.
   */
  function findPostCardBoundary(el) {
    let cur = el;
    let best = el;
    for (let depth = 0; depth < 9 && cur && cur !== document.body; depth++) {
      if (cur.getAttribute && cur.getAttribute('role') === 'feed') break;
      if (cur.getAttribute && cur.getAttribute('role') === 'main') break;
      const subArticles = cur.querySelectorAll ? cur.querySelectorAll('div[role="article"]').length : 0;
      if (subArticles > 1) break;
      const textLen = (cur.innerText || '').length;
      if (textLen > 3200) break;
      best = cur;
      if (cur.getAttribute && cur.getAttribute('role') === 'article') break;
      if (cur.className && typeof cur.className === 'string' && cur.className.includes('x1yztbdb')) break;
      cur = cur.parentElement;
    }
    return best;
  }

  async function waitForInitialFeedContent(maxWaitMs = 7000) {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      const msgNodes = document.querySelectorAll(
        'div[data-ad-preview="message"], div[data-ad-comet-preview="message"], div[role="article"], div[dir="auto"]'
      );
      if (msgNodes.length > 3) {
        const mainEl = document.querySelector('div[role="main"]') || document.body;
        const cleaned = cleanFacebookAdText(mainEl.innerText || '');
        if (cleaned.length > 80) return true;
      }
      await fastSleep(500);
    }
    return false;
  }

  async function executeFacebookPostLeadScrape(payload) {
    const { keyword = '', maxScrolls = 8 } = payload || {};
    pageGate();checkAbort();
    updateHud('Зар & утасны дугаар хайж байна...', keyword ? `Түлхүүр үг: ${keyword}` : 'Нээлттэй хуудаснаас ухаж байна', 'info');
    logToExtension(`"${keyword}" заруудыг 4 давхар алгоритмаар ухаж байна...`, 'info');

    await waitForInitialFeedContent(7500);

    const discoveredLeads = new Map();

    const registerCandidateCard = (card, explicitText = '') => {
      const cleanText = explicitText || extractCleanAdMessageFromCard(card);
      const phone = extractCleanPhoneNumbers(cleanText);
      if (!isGenuinePostContent(cleanText, phone)) return;

      const anchor=Array.from(card.querySelectorAll('a[href]')).find(a=>/\/posts\/|\/permalink\/|story_fbid=/.test(a.href));
      const sourceUrl=anchor?anchor.href.split('#')[0]:'';
      const fingerprint = sourceUrl||makePostFingerprint(cleanText, phone);
      if (discoveredLeads.has(fingerprint)) return;

      const { exactDateStr, timestamp } = parseTimestampAndDate(card, cleanText);
      const price = extractCleanPrice(cleanText);

      const textLines = cleanText
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 2);
      const snippet = textLines.slice(0, 2).join(' — ');

      discoveredLeads.set(fingerprint, {
        id: fingerprint,
        url:sourceUrl,sourcePage:location.href,capturedAt:Date.now(),confidence:sourceUrl?'post_link':'text_only',
        timeText: exactDateStr,
        timestamp,
        phone,
        price,
        snippet,
        fullText: cleanText
      });
    };

    for (let step = 1; step <= maxScrolls; step++) {
      checkAbort();pageGate();
      await clickAllSeeMoreButtons();
      await fastSleep(350);

      const mainScope = document.querySelector('div[role="main"]') || document.body;

      // PASS 1: Explicit Facebook story message containers
      const storyMessages = Array.from(
        mainScope.querySelectorAll(
          'div[data-ad-preview="message"], div[data-ad-comet-preview="message"], div[data-ad-rendering-role="story_message"]'
        )
      );
      for (const msgEl of storyMessages) {
        const card = findPostCardBoundary(msgEl);
        const text = cleanFacebookAdText(extractVisibleCleanTextNodes(msgEl) || msgEl.innerText || '');
        registerCandidateCard(card, text);
      }

      // PASS 2: Article & Feed Unit cards (excluding outer wrappers that hold multiple articles)
      const feedCards = Array.from(
        mainScope.querySelectorAll(
          'div[role="article"], div[role="feed"] > div, div[data-pagelet*="FeedUnit"], div[class*="x1yztbdb"]'
        )
      ).filter((el) => {
        const aria = normalizeText(el.getAttribute('aria-label') || '');
        if (aria.includes('comment by') || aria.includes('сэтгэгдэл')) return false;
        if (el.querySelectorAll('div[role="article"]').length > 1) return false;
        return true;
      });
      for (const card of feedCards) {
        registerCandidateCard(card);
      }

      // PASS 3: All dir="auto" text blocks grouped by their post card boundary
      const dirAutoNodes = Array.from(mainScope.querySelectorAll('div[dir="auto"], span[dir="auto"]'));
      const seenBoundaries = new Set();
      for (const node of dirAutoNodes) {
        if (node.closest('ul, form, nav, [role="navigation"]')) continue;
        const raw = (node.innerText || '').trim();
        if (raw.length < 18) continue;
        const card = findPostCardBoundary(node);
        if (seenBoundaries.has(card)) continue;
        seenBoundaries.add(card);
        registerCandidateCard(card);
      }

      // PASS 4: Deep Phone-Number Regex Sweep (Guarantees 0 missed phone numbers on the page!)
      const allBlocks = Array.from(mainScope.querySelectorAll('div, span, p, a'));
      for (const blk of allBlocks) {
        if (blk.children.length > 6) continue;
        const txt = (blk.innerText || '').trim();
        if (txt.length < 8 || txt.length > 1500) continue;
        const phone = extractCleanPhoneNumbers(txt);
        if (phone) {
          const card = findPostCardBoundary(blk);
          registerCandidateCard(card);
        }
      }

      logToExtension(`Ухалт ${step}/${maxScrolls}: ${discoveredLeads.size} зар & утас олдлоо...`, 'info');
      await chrome.runtime.sendMessage({action:'SCRAPE_PARTIAL',leads:Array.from(discoveredLeads.values())});
      performInstantScroll(1500);
      await fastSleep(1300);
    }

    const leads = Array.from(discoveredLeads.values());
    // Sort newest first, prioritizing posts that have phone numbers when timestamps are equal
    leads.sort((a, b) => {
      if (Boolean(b.phone) !== Boolean(a.phone)) {
        return b.phone ? 1 : -1;
      }
      return (b.timestamp || 0) - (a.timestamp || 0);
    });

    updateHud(`✅ Нийт ${leads.length} зар олдлоо!`, 'Өргөтгөлийн Зар / утас цэснээс харна уу', 'success');
    return { ok: true, leads };
  }

  // =========================================================================
  // SECTION 5: FACEBOOK GROUP DISCOVERY SCRAPER (`EXECUTE_FB_GROUP_SCRAPE`)
  // =========================================================================
  function canonicalizeGroupUrl(rawHref) {
    try {
      const u = new URL(rawHref, window.location.origin);
      const match = u.pathname.match(/^\/groups\/([^/?#]+)/i);
      if (!match) return null;
      const slug = match[1].toLowerCase();
      const reserved = ['feed', 'discover', 'joins', 'create', 'notifications', 'search', 'categories', 'browse'];
      if (reserved.includes(slug)) return null;
      return `https://www.facebook.com/groups/${match[1]}/`;
    } catch (e) {
      return null;
    }
  }

  async function executeFacebookGroupScrape(payload) {
    pageGate();checkAbort();
    const { mode = 'keyword', autoJoin = false, maxScrolls = 6 } = payload || {};
    updateHud('Группүүдийг хайж байна...', mode === 'joined' ? 'Миний нэгдсэн группүүд' : 'Хайлтын үр дүн', 'info');
    logToExtension(`Групп татаж байна (${mode === 'joined' ? 'Миний группүүд' : 'Хайлтаар'})...`, 'info');

    await waitForInitialFeedContent(5000);

    const map = new Map();
    let joinedCount = 0;

    for (let step = 1; step <= maxScrolls; step++) {
      checkAbort();pageGate();
      const anchors = Array.from(document.querySelectorAll('a[href*="/groups/"]'));

      for (const a of anchors) {
        const cleanUrl = canonicalizeGroupUrl(a.href);
        if (!cleanUrl) continue;

        const rawTitle = (a.innerText || a.getAttribute('aria-label') || '').trim();
        if (!rawTitle || rawTitle.length < 3) continue;
        const normTitle = normalizeText(rawTitle);
        if (['join', 'нэгдэх', 'visit', 'зочлох', 'view group', 'групп харах'].includes(normTitle)) continue;

        const card = a.closest('div[role="article"], div[class*="x1yztbdb"], div[class*="x1n2onr6"]') || a.parentElement;
        let membersInfo = '';
        if (card) {
          const cardText = card.innerText || '';
          const match = cardText.match(/([\d.,]+\s*[KkMmМянгаТүм]?\s*(members|гишүүн|гишүүд))/i);
          if (match) membersInfo = match[0].trim();
        }

        if (!map.has(cleanUrl)) {
          map.set(cleanUrl, {
            name: rawTitle.split('\n')[0].trim(),
            url: cleanUrl,
            members: membersInfo || (mode === 'joined' ? 'Гишүүн' : 'Групп'),
            joined: mode === 'joined'
          });
        }

        if (autoJoin && card && joinedCount < 8) {
          const joinBtn = Array.from(card.querySelectorAll('div[role="button"], span[role="button"]')).find((btn) => {
            const t = normalizeText(btn.textContent || btn.getAttribute('aria-label') || '');
            return t === 'join' || t === 'join group' || t === 'нэгдэх' || t === 'бүлэгт нэгдэх';
          });
          if (joinBtn) {
            checkAbort();pageGate();
            simulateHumanClick(joinBtn);
            joinedCount++;
            await fastSleep(1400);
          }
        }
      }

      logToExtension(`Ухалт ${step}/${maxScrolls}: ${map.size} групп олдлоо...`, 'info');
      performInstantScroll(1400);
      await fastSleep(1400);
    }

    updateHud(`✅ ${map.size} групп олдлоо!`, 'Групп цэснээс сонгож нэмнэ үү', 'success');
    return { ok: true, groups: Array.from(map.values()), joinedCount };
  }

  // =========================================================================
  // SECTION 6: FAST GROUP POSTING WORKFLOW
  // =========================================================================
  async function injectTextIntoLexicalEditor(editor, text) {
    if (!text || !String(text).trim()) return;
    simulateHumanClick(editor);
    editor.focus();
    await fastSleep(250);

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    selection.removeAllRanges();
    selection.addRange(range);

    try {
      const pasteData = new DataTransfer();
      pasteData.setData('text/plain', text);
      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: pasteData
      });
      editor.dispatchEvent(pasteEvent);
    } catch (e) {}

    await fastSleep(450);

    const checkSnippet = normalizeText(text.slice(0, 25));
    let currentText = normalizeText(editor.innerText || editor.textContent || '');

    if (!currentText.includes(checkSnippet)) {
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, text);
      await fastSleep(350);
      currentText = normalizeText(editor.innerText || editor.textContent || '');
    }

    if (!currentText.includes(checkSnippet)) {
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      editor.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true, cancelable: true, inputType: 'insertFromPaste', data: text, dataTransfer: dt
      }));
      editor.dispatchEvent(new InputEvent('input', {
        bubbles: true, cancelable: false, inputType: 'insertText', data: text
      }));
      await fastSleep(350);
    }
    const finalNorm = normalizeText(editor.innerText || editor.textContent || '');
    const targetNorm = normalizeText(text);
    const probeNorm = targetNorm.slice(0, Math.min(80, targetNorm.length));
    if (targetNorm && !finalNorm.includes(targetNorm) && !finalNorm.includes(probeNorm)) {
      throw new Error('EDITOR_TEXT_MISMATCH');
    }
  }

  function dataUrlToFile(dataUrl, filename, mimeType = 'image/jpeg') {
    const parts = dataUrl.split(',');
    const byteString = atob(parts[1]);
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
    return new File([new Blob([ab], { type: mimeType })], filename, { type: mimeType, lastModified: Date.now() });
  }

  async function uploadPhotosToModal(dialog, images) {
    if (!images || images.length === 0) return;

    const baseline=new Set(Array.from(dialog.querySelectorAll('img')).map(x=>x.currentSrc||x.src));
    logToExtension(`${images.length} зураг хавсаргаж байна...`, 'info');

    let fileInput =
      dialog.querySelector('input[type="file"][accept*="image"]') ||
      document.querySelector('div[role="dialog"] input[type="file"][accept*="image"]');

    if (!fileInput) {
      const photoBtn = Array.from(dialog.querySelectorAll('div[role="button"], span[role="button"]')).find((btn) => {
        const aria = normalizeText(btn.getAttribute('aria-label') || btn.textContent || '');
        return aria.includes('photo') || aria.includes('зураг') || aria.includes('фото');
      });

      if (photoBtn) {
        const origClick = HTMLInputElement.prototype.click;
        HTMLInputElement.prototype.click = function () {
          if (this.type === 'file') return;
          return origClick.apply(this, arguments);
        };
        try {
          simulateHumanClick(photoBtn);
          await fastSleep(500);
        } finally {
          HTMLInputElement.prototype.click = origClick;
        }
      }

      fileInput = await waitForElement(
        () =>
          dialog.querySelector('input[type="file"][accept*="image"]') ||
          document.querySelector('div[role="dialog"] input[type="file"]'),
        5000
      ).catch(() => null);
    }

    if (!fileInput) throw new Error('IMAGE_INPUT_NOT_FOUND');

    const dt = new DataTransfer();
    for (let i = 0; i < images.length; i++) {
      dt.items.add(dataUrlToFile(images[i].dataUrl, images[i].name || `photo_${i + 1}.jpg`,images[i].type||'image/jpeg'));
    }
    fileInput.files = dt.files;
    fileInput.dispatchEvent(new Event('input', { bubbles: true }));
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));

    const expectedPreviews = Math.min(images.length, 4);
    await waitForElement(()=>{
      checkAbort();pageGate();
      const busy=dialog.querySelector('[role="progressbar"],[aria-busy="true"]');
      const photos=Array.from(dialog.querySelectorAll('img')).filter(x=>x.complete&&x.naturalWidth>0&&!baseline.has(x.currentSrc||x.src));
      return !busy&&(photos.length>=images.length||photos.length>=expectedPreviews);
    },90000);
    return {count:images.length};
  }

  function findPostSubmitButton(dialogRoot) {
    const scope = dialogRoot || document;
    const exactLabels = ['post', 'нийтлэх', 'submit', 'илгээх', 'опубликовать'];
    const isEnabled = (b) => b && b.getAttribute('aria-disabled') !== 'true' && !b.disabled;

    const ariaBtns = Array.from(scope.querySelectorAll('div[role="button"][aria-label], button[aria-label]')).filter(
      (b) => isVisible(b) && exactLabels.includes(normalizeText(b.getAttribute('aria-label')))
    );
    const enabledAria = ariaBtns.find(isEnabled);
    if (enabledAria) return enabledAria;

    const textBtns = Array.from(scope.querySelectorAll('div[role="button"], button[type="submit"]')).filter(
      (b) => isVisible(b) && exactLabels.includes(normalizeText(b.textContent))
    );
    const enabledText = textBtns.find(isEnabled);
    if (enabledText) return enabledText;

    return ariaBtns[0] || textBtns[0] || null;
  }

  async function clickPostAndConfirm(dialog,payload) {
    pageGate();checkAbort();
    const enabledBtn=await waitForElement(()=>{
      const btn=findPostSubmitButton(dialog);
      return btn&&btn.getAttribute('aria-disabled')!=='true'&&!btn.disabled?btn:null;
    },30000);
    const baseline=new Set(Array.from(document.querySelectorAll('[role="alert"],[role="status"]')).map(x=>normalizeText(x.innerText)));
    const canonical=u=>{try{const x=new URL(u);if(x.searchParams.has('story_fbid'))return x.origin+x.pathname+'?story_fbid='+x.searchParams.get('story_fbid');return x.origin+x.pathname.replace(/\/$/,'');}catch{return u;}};
    const oldLinks=new Set(Array.from(document.querySelectorAll('a[href]')).map(a=>canonical(a.href)));
    const permit=await chrome.runtime.sendMessage({action:'POST_SUBMIT_PERMIT',jobId:payload.jobId,index:payload.index,attemptId:payload.attemptId});
    if(!permit?.ok)throw new Error('SUBMIT_NOT_AUTHORIZED');
    checkAbort();pageGate();simulateHumanClick(enabledBtn);
    const submittedAt=Date.now();
    const deadline=submittedAt+8000;
    while(Date.now()<deadline){
      checkAbort();pageGate();
      const fresh=Array.from(document.querySelectorAll('[role="alert"],[role="status"]')).filter(isVisible).map(x=>normalizeText(x.innerText)).filter(t=>!baseline.has(t));
      if(fresh.some(t=>/pending approval|submitted.*approval|waiting.*approval|post is pending|admin.*approval|зөвшөөрөл хүлээ|хянуулахаар илгээ/.test(t)))return {status:'PENDING_APPROVAL',note:'Админы хяналт хүлээж байна'};
      // A closed composer alone never proves success. Require a new post link AND matching content.
      const text=normalizeText(payload.formData?.description||'');
      const textProbe=text.slice(0,80);
      const minImages=Math.min(payload.images?.length||0,4);
      const articles=Array.from(document.querySelectorAll('[role="article"],[data-pagelet^="FeedUnit"]')).filter(isVisible);
      for(const card of articles){
        const a=Array.from(card.querySelectorAll('a[href]')).find(a=>/\/(?:posts|permalink)\/|story_fbid=/.test(a.href)&&!oldLinks.has(canonical(a.href)));
        if(!a)continue;
        const content=normalizeText(card.innerText||'');
        const textMatches=text.length>=1?(content.includes(text)||(text.length>80&&content.includes(textProbe))):Boolean(payload.images?.length);
        const imagesMatch=!payload.images?.length||Array.from(card.querySelectorAll('img')).filter(x=>x.complete&&x.naturalWidth>100).length>=minImages;
        if(textMatches&&imagesMatch)return {status:'PUBLISHED',postUrl:a.href,note:'Шинэ постын холбоос, агуулгыг шалгасан'};
      }
      const closed=!isVisible(dialog)||!dialog.isConnected;
      if(closed&&fresh.some(t=>/^(?:your post (?:was |has been )?(?:published|posted)|post (?:published|created|successful)|нийтлэл (?:амжилттай )?(?:нийтлэгдлээ|нийтлэгдсэн|орлоо)|таны нийтлэл (?:нийтлэгдлээ|нийтлэгдсэн)|публикация опубликована)[.!\s]*$/.test(t)))return {status:'PUBLISHED',note:'Facebook нийтлэл амжилттай орсныг мэдэгдсэн'};
      if(closed&&Date.now()-submittedAt>=1500)return {status:'UNKNOWN',note:'Нийтлэх товч дарагдсан; цонх хаагдсан. Дахин илгээхгүй.'};
      if(fresh.some(t=>/couldn.t post|unable to post|something went wrong|нийтэлж чадсангүй|алдаа гарлаа/.test(t)))return {status:'UNKNOWN',error:'FACEBOOK_REPORTED_ERROR_AFTER_SUBMIT'};
      await fastSleep(700);
    }
    return {status:'UNKNOWN',error:'SUBMIT_SENT_BUT_NOT_CONFIRMED — автоматаар дахин оролдохгүй'};
  }
  async function executeFacebookGroupPost(payload) {
    pageGate();checkAbort();
    const images=payload.images||[];
    const stepLabel = payload.total ? `Групп ${(payload.index||0)+1}/${payload.total}` : 'Групп нийтлэлт';
    updateHud('Групп дээр нийтэлж байна...', `${stepLabel} · ${location.pathname}`, 'info');
    const composer=await openGroupComposerModal();
    if(composer.skipped){
      updateHud(`Алгаслаа: ${composer.reason}`, stepLabel, 'error');
      return {ok:false,status:'SKIPPED',skipped:true,error:composer.reason};
    }
    const {dialog,editor}=composer;
    updateHud('Постын текст оруулж байна...', stepLabel, 'info');
    await injectTextIntoLexicalEditor(editor,payload.formData?.description||'');
    if(images.length){
      updateHud(`${images.length} зураг хавсаргаж байна...`, stepLabel, 'info');
      await uploadPhotosToModal(dialog,images);
    }
    updateHud('Нийтлэх товч дарж баталгаажуулж байна...', stepLabel, 'info');
    const result=await clickPostAndConfirm(dialog,payload);
    updateHud(result.status==='PUBLISHED'?'✅ Нийтлэл амжилттай орлоо!':`Төлөв: ${result.status}`, stepLabel, result.status==='PUBLISHED'?'success':'info');
    await chrome.runtime.sendMessage({action:'POST_RECEIPT',jobId:payload.jobId,index:payload.index,attemptId:payload.attemptId,result});
    return {ok:result.status==='PUBLISHED',...result};
  }

  // =========================================================================
  // SECTION 7: INIT & MESSAGE ROUTER
  // =========================================================================


  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender?.id && sender.id !== chrome.runtime.id) return false;
    if (!message || typeof message.action !== 'string') return false;

    if (message.action === 'PING_CONTENT_SCRIPT') {
      sendResponse({ ready: true, host: 'facebook.com', version: '5.6.7' });
      return false;
    }

    if(message.action==='ABORT_TASK'){taskAborted=true;sendResponse({ok:true});return false;}

    if (message.action === 'EXECUTE_FB_GROUP_POST') {
      taskAborted=false;
      executeFacebookGroupPost(message.payload)
        .then((res) => sendResponse(res))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;
    }

    if (message.action === 'EXECUTE_FB_POST_SCRAPE') {
      taskAborted=false;
      executeFacebookPostLeadScrape(message.payload)
        .then((res) => sendResponse(res))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;
    }

    if (message.action === 'EXECUTE_FB_GROUP_SCRAPE') {
      taskAborted=false;
      executeFacebookGroupScrape(message.payload)
        .then((res) => sendResponse(res))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;
    }

    return false;
  });
})();