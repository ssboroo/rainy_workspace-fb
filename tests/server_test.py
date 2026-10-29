import concurrent.futures, hashlib, hmac, importlib.util, json, os, tempfile, time, unittest
from unittest.mock import patch
from pathlib import Path
spec=importlib.util.spec_from_file_location('app',Path(__file__).parents[1]/'server/app.py');app=importlib.util.module_from_spec(spec);spec.loader.exec_module(app)

class Payments(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();app.DB_PATH=self.tmp.name+'/test.sqlite';app.init_db()
        self.dev='DEV-11111111-2222-3333-4444-555555555555';self.secret='a'*72
        app.register(self.dev,self.secret)
        self.calls=[]
    def tearDown(self):self.tmp.cleanup()
    def wire(self,path,method='GET',data=None,key=None):
        self.calls.append((path,method,data,key))
        if path=='/payment_intents':return {'id':'pi_test','amount':data['amount'],'currency':'MNT','status':'requires_payment_method'}
        if path=='/checkout/sessions':return {'url':'https://pay.wire.mn/c/test'}
        return {'id':'pi_test','amount':49900,'currency':'MNT','status':'succeeded'}
    def order(self):
        with patch.object(app,'wire',self.wire):return app.create_order(self.dev,'30','request-123456789012345')
    def test_plan_prices(self):self.assertEqual([app.PLANS[k]['amount'] for k in ['30','90','365']],[49900,99000,299000])
    def test_trial_not_reset(self):
        a=app.register(self.dev,self.secret);b=app.register(self.dev,self.secret);self.assertEqual(a['expiresAt'],b['expiresAt'])
    def test_device_auth(self):
        with self.assertRaises(PermissionError):app.authenticate(self.dev,'wrong')
    def test_order_retry_stable(self):
        a=self.order();b=self.order();self.assertEqual(a['id'],b['id']);self.assertEqual(len(self.calls),2)
    def test_concurrent_creation(self):
        with patch.object(app,'wire',self.wire):
            with concurrent.futures.ThreadPoolExecutor(4) as ex:rows=list(ex.map(lambda _:app.create_order(self.dev,'30','same-request-123456'),range(4)))
        self.assertEqual(len({r['id'] for r in rows}),1);self.assertEqual(len(self.calls),2)
    def test_idempotency_conflict(self):
        self.order()
        with self.assertRaises(ValueError):app.create_order(self.dev,'90','request-123456789012345')
    def test_mismatch_not_paid(self):
        o=self.order()
        for pi in [{'id':'pi_other','status':'succeeded','amount':49900,'currency':'MNT'},{'id':'pi_test','status':'succeeded','amount':49901,'currency':'MNT'},{'id':'pi_test','status':'succeeded','amount':49900,'currency':'USD'}]:
            with self.assertRaises(ValueError):app.mark_paid(o['id'],pi)
        with app.connection() as db:self.assertEqual(db.execute('SELECT status FROM orders').fetchone()[0],'PENDING')
    def test_unpaid_cannot_activate(self):
        o=self.order()
        with self.assertRaises(ValueError):app.activate(o['id'],'admin')
    def test_concurrent_activation_once(self):
        o=self.order()
        with patch.object(app,'wire',self.wire):app.check_order(o['id'])
        with concurrent.futures.ThreadPoolExecutor(8) as ex:r=list(ex.map(lambda _:app.activate(o['id'],'admin'),range(8)))
        self.assertEqual(sum(r),1)
        with app.connection() as db:
            expires=db.execute('SELECT expires FROM devices').fetchone()[0]
            self.assertAlmostEqual((expires-app.now())/86400000,30,places=3)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM outbox WHERE id LIKE 'active-%'").fetchone()[0],1)
    def test_signature_raw_stale_replay(self):
        t=int(time.time());raw=b'{"type":"test"}';sig=hmac.new(b'secret',str(t).encode()+b'.'+raw,hashlib.sha256).hexdigest();header=f't={t},v1={sig}'
        self.assertTrue(app.verify_wire(raw,header,'secret'));self.assertFalse(app.verify_wire(raw+b' ',header,'secret'))
        self.assertFalse(app.verify_wire(raw,header,'secret',clock=t+301));self.assertFalse(app.verify_wire(raw,header+',t='+str(t),'secret'))
    def test_webhook_retry_notification_once(self):
        o=self.order();event={'id':'evt_test','type':'payment_intent.succeeded','data':{'id':'pi_test'}};raw=json.dumps(event).encode()
        with patch.object(app,'verify_wire',return_value=True),patch.object(app,'wire',self.wire):
            app.wire_webhook(raw,'');app.wire_webhook(raw,'')
        with app.connection() as db:self.assertEqual(db.execute("SELECT COUNT(*) FROM outbox WHERE id LIKE 'paid-%'").fetchone()[0],1)
    def test_outbox_retries_failed_delivery(self):
        o=self.order()
        with patch.object(app,'BOT_TOKEN','test'),patch.object(app,'ADMIN_CHAT','1'),patch.object(app,'telegram',side_effect=ValueError('offline')):app.flush_outbox()
        with app.connection() as db:self.assertEqual(db.execute('SELECT sent FROM outbox').fetchone()[0],0)
    def test_telegram_admin_auth(self):
        with patch.object(app,'ADMIN_ID','100'),patch.object(app,'ADMIN_CHAT','100'):
            with self.assertRaises(PermissionError):app.telegram_webhook({'update_id':1,'message':{'from':{'id':999},'chat':{'id':100},'text':'/orders'}})
    def test_manual_gate(self):
        o=self.order()
        with patch.dict(os.environ,{'ALLOW_MANUAL_PAYMENT':'false'}):
            with self.assertRaises(ValueError):app.activate(o['id'],'admin','BANK-123456')
    def test_manual_activation_audited(self):
        o=self.order()
        with patch.dict(os.environ,{'ALLOW_MANUAL_PAYMENT':'true'}):self.assertTrue(app.activate(o['id'],'admin','BANK-123456'))
        with app.connection() as db:self.assertEqual(db.execute('SELECT action FROM audit').fetchone()[0],'manual_activate')
    def test_late_webhook_after_manual_no_double_grant(self):
        o=self.order()
        with patch.dict(os.environ,{'ALLOW_MANUAL_PAYMENT':'true'}):app.activate(o['id'],'admin','BANK-123456')
        with patch.object(app,'wire',self.wire):app.check_order(o['id'])
        self.assertFalse(app.activate(o['id'],'admin'))
    def test_admin_device_grant_once(self):
        buttons=app.device_buttons(self.dev);token=buttons[0][0]['callback_data'].split(':')[1]
        app.grant_device(token,'90','owner')
        with app.connection() as db:first=db.execute('SELECT expires FROM devices WHERE id=?',(self.dev,)).fetchone()['expires']
        app.grant_device(token,'365','owner')
        with app.connection() as db:second=db.execute('SELECT expires FROM devices WHERE id=?',(self.dev,)).fetchone()['expires']
        self.assertEqual(first,second);self.assertGreater(first,app.now()+89*86400000)
    def test_admin_device_grant_invalid_plan_and_expired(self):
        token=app.device_buttons(self.dev)[0][0]['callback_data'].split(':')[1]
        with self.assertRaises(ValueError):app.grant_device(token,'10000','owner')
        with app.transaction() as db:db.execute('UPDATE admin_grants SET created=0 WHERE token=?',(token,))
        with self.assertRaises(ValueError):app.grant_device(token,'30','owner')
if __name__=='__main__':unittest.main(verbosity=2)
