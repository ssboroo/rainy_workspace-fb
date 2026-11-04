const {test}=require('node:test');
const assert=require('node:assert/strict');
const core=require('../mobile/shared/core.js');

test('only valid queue transitions are accepted',()=>{
  const queued={id:'a',status:'QUEUED'};
  assert.equal(core.transition(queued,'PREPARING',{now:10}).status,'PREPARING');
  assert.throws(()=>core.transition(queued,'PUBLISHED',{confirmed:true}),/INVALID_QUEUE_TRANSITION/);
  assert.throws(()=>core.transition({status:'SUBMITTING'},'PUBLISHED'),/PUBLISH_RECEIPT_REQUIRED/);
});

test('submit requires an attempt id and publish requires a positive receipt',()=>{
  assert.throws(()=>core.transition({status:'PREPARING'},'SUBMITTING'),/ATTEMPT_ID_REQUIRED/);
  const submitting=core.transition({status:'PREPARING'},'SUBMITTING',{attemptId:'attempt-1',now:20});
  assert.equal(submitting.attemptId,'attempt-1');
  assert.equal(core.transition(submitting,'PUBLISHED',{confirmed:true,now:30}).status,'PUBLISHED');
});

test('recovery requeues pre-submit work but never retries an uncertain submit',()=>{
  const recovered=core.recover([{status:'PREPARING'},{status:'SUBMITTING'},{status:'PUBLISHED'}]);
  assert.deepEqual(recovered.map(x=>x.status),['QUEUED','UNKNOWN','PUBLISHED']);
});

test('bridge rejects unknown protocol versions and message types',()=>{
  const msg=core.message('QUEUE_START',{jobId:'j'},'req-1');
  assert.equal(core.validateMessage(msg,['QUEUE_START']).ok,true);
  assert.equal(core.validateMessage({...msg,protocol:99},['QUEUE_START']).error,'UNSUPPORTED_PROTOCOL');
  assert.equal(core.validateMessage(msg,['QUEUE_STOP']).error,'UNSUPPORTED_MESSAGE_TYPE');
});

test('duplicate fingerprint is stable across whitespace and media ordering',()=>{
  assert.equal(core.fingerprint('Hello  WORLD','https://facebook.com/groups/a',['b','a']),core.fingerprint(' hello world ','https://facebook.com/groups/a',['a','b']));
});

test('terminal queue states cannot be silently reopened',()=>{
  for(const state of ['PUBLISHED','PENDING_APPROVAL','UNKNOWN','CANCELLED']) {
    assert.throws(()=>core.transition({status:state},'QUEUED'),/INVALID_QUEUE_TRANSITION/);
  }
});
