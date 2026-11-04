const api = globalThis.browser || chrome;
const workspace = 'https://workspace.rainy.studio';
const facebookHosts = new Set(['www.facebook.com', 'm.facebook.com', 'facebook.com']);
const active = new Map();
const scheduling = new Set();

function groupUrl(value) {
  try {
    const url = new URL(value);
    const group = url.pathname.match(/^\/groups\/([\w.-]+)\/?$/);
    if (url.protocol === 'https:' && facebookHosts.has(url.hostname) && !url.port && group) {
      return 'https://www.facebook.com/groups/' + group[1] + '/';
    }
  } catch {}
  return '';
}

async function handle(message, sender) {
  const {action, jobId} = message;
  if (sender.frameId !== 0 || sender.tab?.id == null) return {ok: false};
  const source = new URL(sender.url || sender.tab.url);
  if (action === 'RAINY_MOBILE_STAGE') {
    if (source.origin !== workspace || source.pathname !== '/mobile/') return {ok: false};
    const requested = message.urls ?? [message.url];
    if (!Array.isArray(requested) || requested.length > 20) return {ok: false};
    const destinations = [...new Set(requested.map(groupUrl))];
    const [destination, ...remaining] = destinations;
    const scheduleId = message.scheduleId;
    if (scheduleId && (typeof scheduleId !== 'string' || scheduleId.length > 160)) return {ok: false};
    const {text, image} = message;
    if (!destination || destinations.includes('') || typeof text !== 'string' || !text.trim() || text.length > 63206 ||
        typeof image !== 'string' || image.length > 7000000 ||
        (image && !/^data:image\/(?:jpeg|png|webp|gif);base64,[a-z0-9+/=]+$/i.test(image))) {
      return {ok: false, error: 'Группын холбоос, постын текст, зургийн форматаа шалгана уу.'};
    }
    const scheduleKey = scheduleId && 'mobile-schedule:' + scheduleId;
    if (scheduleKey && scheduling.has(scheduleKey)) return {ok: false};
    if (scheduleKey) scheduling.add(scheduleKey);
    try {
      const records = await api.storage.local.get(null);
      if (scheduleKey && records[scheduleKey]) return {ok: false, duplicate: true};
      const expired = Object.keys(records).filter(key =>
        (key.startsWith('mobile:') || key.startsWith('mobile-schedule:')) && records[key].expires < Date.now());
      if (expired.length) await api.storage.local.remove(expired);
      const id = crypto.randomUUID();
      const values = {['mobile:' + id]: {
        tab: sender.tab.id, destination, remaining, text, image, index: 0, total: destinations.length,
        automatic: Boolean(scheduleKey), expires: Date.now() + 10 * 60000
      }};
      if (scheduleKey) values[scheduleKey] = {expires: Date.now() + 86400000};
      await api.storage.local.set(values);
      return {ok: true, url: destination + '#rainy-mobile=' + id + (scheduleKey ? ':auto' : '')};
    } finally {
      if (scheduleKey) scheduling.delete(scheduleKey);
    }
  }

  if (!/^[a-f0-9-]{36}$/i.test(jobId || '') || !groupUrl(source.href)) return {ok: false};
  if (action === 'POST_RECEIPT') {
    return {ok: active.get(jobId)?.tab === sender.tab.id};
  }
  const key = 'mobile:' + jobId;
  const job = (await api.storage.local.get(key))[key];
  if (!job || job.tab !== sender.tab.id || job.expires < Date.now() ||
      groupUrl(source.href) !== job.destination) return {ok: false};
  if (action === 'POST_SUBMIT_PERMIT') {
    const attempt = active.get(jobId);
    if (!attempt || attempt.permitted || jobId !== message.attemptId || message.index !== job.index) return {ok: false};
    attempt.permitted = true;
    await api.storage.local.remove(key);
    return {ok: true};
  }
  if (action !== 'RAINY_MOBILE_RUN' || active.has(jobId) || Boolean(message.automatic) !== Boolean(job.automatic)) return {ok: false};
  active.set(jobId, {tab: sender.tab.id, permitted: false});
  try {
    const imageType = job.image.split(';', 1)[0].slice(5);
    const images = job.image ? [{
      dataUrl: job.image, type: imageType, name: 'photo.' + imageType.slice(6).replace('jpeg', 'jpg')
    }] : [];
    const result = await api.tabs.sendMessage(sender.tab.id, {
      action: 'EXECUTE_FB_GROUP_POST',
      payload: {jobId, attemptId: jobId, index: job.index, total: job.total,
        formData: {description: job.text}, images}
    }, {frameId: 0});
    if (result?.status === 'PUBLISHED' && active.get(jobId)?.permitted && job.remaining?.length) {
      const [destination, ...remaining] = job.remaining;
      const id = crypto.randomUUID();
      await api.storage.local.set({['mobile:' + id]: {
        ...job, destination, remaining, automatic: true, index: job.index + 1, expires: Date.now() + 10 * 60000
      }});
      return {ok: true, result, next: destination + '#rainy-mobile=' + id + ':auto'};
    }
    return {ok: true, result};
  } catch {
    return {ok: true, result: {status: 'UNKNOWN'}};
  } finally {
    active.delete(jobId);
    await api.storage.local.remove(key);
  }
}

api.runtime.onMessage.addListener((message, sender, reply) => {
  if (!['RAINY_MOBILE_STAGE', 'RAINY_MOBILE_RUN', 'POST_SUBMIT_PERMIT', 'POST_RECEIPT'].includes(message?.action)) return false;
  handle(message, sender).then(reply, () => reply({ok: false}));
  return true;
});