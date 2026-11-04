/* Shared, platform-neutral queue and native bridge contracts for RAINY FB Pro Mobile. */
(function(root){
  'use strict';
  const PROTOCOL_VERSION = 1;
  const ITEM_STATES = Object.freeze(['QUEUED','PREPARING','SUBMITTING','PUBLISHED','PENDING_APPROVAL','UNKNOWN','FAILED','CANCELLED']);
  const TERMINAL = new Set(['PUBLISHED','PENDING_APPROVAL','UNKNOWN','FAILED','CANCELLED']);
  const TRANSITIONS = Object.freeze({
    QUEUED: ['PREPARING','CANCELLED'],
    PREPARING: ['SUBMITTING','QUEUED','FAILED','CANCELLED'],
    SUBMITTING: ['PUBLISHED','PENDING_APPROVAL','UNKNOWN','FAILED'],
    PUBLISHED: [], PENDING_APPROVAL: [], UNKNOWN: [], FAILED: ['QUEUED'], CANCELLED: []
  });
  function transition(item,next,meta={}) {
    if(!item || !ITEM_STATES.includes(item.status) || !ITEM_STATES.includes(next)) throw new TypeError('Invalid queue item or state');
    if(!TRANSITIONS[item.status].includes(next)) throw new Error('INVALID_QUEUE_TRANSITION:'+item.status+'->'+next);
    if(next==='PUBLISHED' && meta.confirmed!==true) throw new Error('PUBLISH_RECEIPT_REQUIRED');
    if(next==='SUBMITTING' && !meta.attemptId) throw new Error('ATTEMPT_ID_REQUIRED');
    if(next==='UNKNOWN' && !meta.reason) throw new Error('UNKNOWN_REASON_REQUIRED');
    return {...item,status:next,...(meta.attemptId?{attemptId:meta.attemptId}:{}),...(meta.reason?{reason:String(meta.reason)}:{}),updatedAt:Number.isFinite(meta.now)?meta.now:Date.now()};
  }
  function recover(items) {
    if(!Array.isArray(items)) throw new TypeError('items must be an array');
    return items.map(item=>{
      if(item.status==='PREPARING') return {...item,status:'QUEUED',reason:'Interrupted before submit; safe to re-queue'};
      if(item.status==='SUBMITTING') return {...item,status:'UNKNOWN',reason:'Interrupted during submit; verify on Facebook before manual retry'};
      return {...item};
    });
  }
  function message(type,payload={},requestId) {
    if(typeof type!=='string'||!type.trim()) throw new TypeError('message type required');
    if(!payload||typeof payload!=='object'||Array.isArray(payload)) throw new TypeError('payload must be an object');
    return {protocol:PROTOCOL_VERSION,type,payload, ...(requestId?{requestId:String(requestId)}:{})};
  }
  function validateMessage(value,allowedTypes) {
    if(!value||typeof value!=='object'||Array.isArray(value)) return {ok:false,error:'INVALID_MESSAGE'};
    if(value.protocol!==PROTOCOL_VERSION) return {ok:false,error:'UNSUPPORTED_PROTOCOL'};
    if(typeof value.type!=='string'||!Array.isArray(allowedTypes)||!allowedTypes.includes(value.type)) return {ok:false,error:'UNSUPPORTED_MESSAGE_TYPE'};
    if(!value.payload||typeof value.payload!=='object'||Array.isArray(value.payload)) return {ok:false,error:'INVALID_PAYLOAD'};
    return {ok:true,value};
  }
  function fingerprint(text,groupUrl,mediaIds=[]) {
    const normalize=s=>String(s||'').normalize('NFKC').replace(/\\s+/g,' ').trim().toLocaleLowerCase();
    return [normalize(text),normalize(groupUrl),...mediaIds.map(normalize).sort()].join('|');
  }
  const api={PROTOCOL_VERSION,ITEM_STATES,TERMINAL,TRANSITIONS,transition,recover,message,validateMessage,fingerprint};
  root.RainyMobileCore=api;
  if(typeof module!=='undefined'&&module.exports) module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
