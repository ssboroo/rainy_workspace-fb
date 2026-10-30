/* Shared, deterministic search and deduplication helpers. */
(function(root){
 const norm=s=>String(s||'').normalize('NFKC').toLocaleLowerCase('mn').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
 function urlKey(raw){try{const u=new URL(raw);if(!/(^|\.)facebook\.com$/.test(u.hostname))return '';u.hostname='www.facebook.com';const story=u.searchParams.get('story_fbid');return story?u.origin+u.pathname+'?story_fbid='+story:u.origin+u.pathname.replace(/\/$/,'');}catch{return '';}}
 function merge(rows){const out=new Map();for(const row of (Array.isArray(rows)?rows:[])){if(!row||typeof row!=='object')continue;const text=norm(row.fullText||row.snippet),key=urlKey(row.url)||text;if(!key)continue;const prev=out.get(key);if(!prev)out.set(key,row);else out.set(key,{...prev,...row,fullText:(prev.fullText||'').length>(row.fullText||'').length?prev.fullText:row.fullText,phone:row.phone||prev.phone,url:row.url||prev.url});}return [...out.values()].slice(-5000);}
 function filter(rows,{term='',phoneOnly=false,newest=true}={}){const tokens=norm(term).split(' ').filter(Boolean);return merge(rows).filter(l=>(!phoneOnly||l.phone)&&tokens.every(t=>norm([l.fullText,l.snippet,l.phone,l.price].join(' ')).includes(t))).sort((a,b)=>newest?(Number(b.timestamp)||Number(b.capturedAt)||0)-(Number(a.timestamp)||Number(a.capturedAt)||0):(Number(a.timestamp)||Number(a.capturedAt)||0)-(Number(b.timestamp)||Number(b.capturedAt)||0));}
 const api={norm,urlKey,merge,filter};root.RainyLeads=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
