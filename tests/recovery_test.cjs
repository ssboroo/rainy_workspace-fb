const {test}=require('node:test');
const assert=require('node:assert/strict');
const core=require('../extension/core.js');

test('worker restart requeues an attempt that never received submit permission',()=>{
  const job={status:'RUNNING',tabId:12,items:[
    {status:'PREPARING',url:'https://www.facebook.com/groups/a/'},
    {status:'QUEUED',url:'https://www.facebook.com/groups/b/'}
  ]};
  const recovered=core.recover(job);
  assert.equal(recovered.items[0].status,'QUEUED');
  assert.equal(recovered.items[1].status,'QUEUED');
  assert.equal(recovered.status,'RUNNING');
  assert.equal(recovered.tabId,null);
});

test('worker restart records an in-flight submit as unknown and continues only remaining items',()=>{
  const job={status:'RUNNING',tabId:12,items:[
    {status:'SUBMITTING',url:'https://www.facebook.com/groups/a/'},
    {status:'QUEUED',url:'https://www.facebook.com/groups/b/'}
  ]};
  const recovered=core.recover(job);
  assert.equal(recovered.items[0].status,'UNKNOWN');
  assert.match(recovered.items[0].error,/not retried/i);
  assert.equal(recovered.items[1].status,'QUEUED');
  assert.equal(recovered.status,'RUNNING');
  assert.equal(recovered.tabId,null);
});

test('worker restart completes a queue when only terminal and unknown items remain',()=>{
  const job={status:'RUNNING',tabId:12,items:[
    {status:'SUBMITTING',url:'a'},
    {status:'PUBLISHED',url:'b'}
  ]};
  const recovered=core.recover(job);
  assert.equal(recovered.items[0].status,'UNKNOWN');
  assert.equal(recovered.status,'COMPLETED');
});


test('stale PREPARING attempt is safe to recover after worker interruption',()=>{
  const now=1_000_000;
  assert.equal(core.staleAttempt({status:'PREPARING',startedAt:now-180001},now),true);
  assert.equal(core.staleAttempt({status:'PREPARING',startedAt:now-179999},now),false);
  const job={status:'RUNNING',items:[{status:'PREPARING',startedAt:now-180001}]};
  const recovered=core.recover(job);
  assert.equal(recovered.items[0].status,'QUEUED');
});

test('stale SUBMITTING attempt is marked unknown and never retried',()=>{
  const now=2_000_000;
  assert.equal(core.staleAttempt({status:'SUBMITTING',submittedAt:now-180001},now),true);
  const job={status:'RUNNING',items:[{status:'SUBMITTING',submittedAt:now-180001,url:'group'}]};
  const recovered=core.recover(job);
  assert.equal(recovered.items[0].status,'UNKNOWN');
  assert.match(recovered.items[0].error,/not retried automatically/i);
});

test('missing attempt timestamp is treated as stale rather than hanging forever',()=>{
  assert.equal(core.staleAttempt({status:'PREPARING'}),true);
  assert.equal(core.staleAttempt({status:'QUEUED'}),false);
});
