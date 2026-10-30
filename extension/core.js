/* Pure queue/schedule rules, shared with the executable tests. */
(function(root){
  const INTERVALS = [20,30,60,120,240,360,720,1440];
  const RESERVED_GROUPS = ['feed','joins','discover','search','create','notifications','browse','categories'];
  function groupUrl(raw) {
    try {
      const s = String(raw ?? '').trim();
      if (!s) return null;
      const normalized = /^(?:(?:www|m|web)\.)?facebook\.com\/groups\//i.test(s) ? `https://${s}` : s;
      const u = new URL(normalized);
      const m = u.pathname.match(/^\/groups\/([^/?#]+)/i);
      if (!/^https?:$/.test(u.protocol) || !/(^|\.)facebook\.com$/i.test(u.hostname) || !m) return null;
      const slug = decodeURIComponent(m[1]).trim().toLowerCase();
      if (!slug || RESERVED_GROUPS.includes(slug) || /[<>"'\s]/.test(slug)) return null;
      return `https://www.facebook.com/groups/${slug}/`;
    } catch {
      return null;
    }
  }
  function activeHours(start='00:00',end='00:00',date=new Date(),zone='Asia/Ulaanbaatar') {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(end)) return false;
    try {
      const d = date instanceof Date ? date : new Date(date);
      if (Number.isNaN(d.getTime())) return false;
      const p = new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(d);
      const n = Number(p.find(x=>x.type==='hour').value)*60 + Number(p.find(x=>x.type==='minute').value);
      const minutes = s => Number(s.slice(0,2))*60 + Number(s.slice(3));
      const a = minutes(start), b = minutes(end);
      return a===b || (a<b ? n>=a && n<b : n>=a || n<b);
    } catch {
      return false;
    }
  }
  function blocked(record,windowMinutes,now=Date.now()) {
    if (!record) return false;
    if (['SUBMITTING','UNKNOWN','PENDING_APPROVAL'].includes(record.status)) return true;
    return record.status==='PUBLISHED' && now - Number(record.at || 0) < (Number(windowMinutes) || 0) * 60000;
  }
  function recover(job) {
    if (!job || !['RUNNING','STOPPING'].includes(job.status)) return job;
    job.items = (Array.isArray(job.items) ? job.items : []).map(i =>
      ['PREPARING','SUBMITTING'].includes(i.status)
        ? {...i, status:'UNKNOWN', error:'WORKER_INTERRUPTED — автоматаар дахин нийтлэхгүй'}
        : i
    );
    job.status = 'PAUSED';
    job.tabId = null;
    return job;
  }
  const api = {INTERVALS,groupUrl,activeHours,blocked,recover};
  root.RainyCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
