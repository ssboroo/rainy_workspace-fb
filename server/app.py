"""RAINY licensing/payment service. Python 3.11+, SQLite, no third-party dependencies.
Wire API contract adapted from ssboroo/socialtool-store/src/lib/wire.ts.
"""
import hashlib, hmac, json, os, re, secrets, sqlite3, threading, time
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse, unquote

PLANS={'30':{'days':30,'amount':49900},'90':{'days':90,'amount':99000},'365':{'days':365,'amount':299000}}
DB_PATH=os.environ.get('DB_PATH','data/rainy.sqlite3')
API_BASE=os.environ.get('WIRE_MN_API_URL','https://api.wire.mn/v1').rstrip('/')
BOT_TOKEN=os.environ.get('TELEGRAM_BOT_TOKEN','')
ADMIN_ID=os.environ.get('TELEGRAM_ADMIN_USER_ID','')
ADMIN_CHAT=os.environ.get('TELEGRAM_ADMIN_CHAT_ID','')
TG_SECRET=os.environ.get('TELEGRAM_WEBHOOK_SECRET','')
PUBLIC_URL=os.environ.get('PUBLIC_URL','').rstrip('/')

def now():return int(time.time()*1000)
def sha(value):return hashlib.sha256(value.encode()).hexdigest()
@contextmanager
def connection():
    db=sqlite3.connect(DB_PATH,timeout=20,isolation_level=None)
    db.row_factory=sqlite3.Row
    db.execute('PRAGMA foreign_keys=ON')
    try:yield db
    finally:db.close()
@contextmanager
def transaction():
    with connection() as db:
        db.execute('BEGIN IMMEDIATE')
        try:yield db;db.commit()
        except BaseException:db.rollback();raise

def init_db():
    os.makedirs(os.path.dirname(os.path.abspath(DB_PATH)),exist_ok=True)
    with connection() as db:
        db.execute('PRAGMA journal_mode=WAL')
        db.executescript('''
        CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY,secret_hash TEXT NOT NULL,trial_expires INTEGER NOT NULL,expires INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY,device_id TEXT NOT NULL REFERENCES devices(id),plan TEXT NOT NULL,amount INTEGER NOT NULL,days INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'PENDING',intent TEXT UNIQUE,checkout TEXT,request_id TEXT NOT NULL,created INTEGER NOT NULL,paid_at INTEGER,granted_at INTEGER,manual_reference TEXT UNIQUE,UNIQUE(device_id,request_id));
        CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,created INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,action TEXT NOT NULL,order_id TEXT,actor TEXT,created INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY,payload TEXT NOT NULL,sent INTEGER NOT NULL DEFAULT 0,attempts INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL DEFAULT 0);
        ''')

def request_json(url,method='GET',data=None,headers=None):
    raw=json.dumps(data,separators=(',',':')).encode() if data is not None else None
    req=Request(url,data=raw,method=method,headers={'Content-Type':'application/json',**(headers or {})})
    try:
        with urlopen(req,timeout=15) as res:return json.load(res)
    except HTTPError as exc:
        raise ValueError('UPSTREAM_HTTP_'+str(exc.code)) from exc
    except (URLError,TimeoutError,ValueError) as exc:
        # Never include request URLs: Telegram URLs contain the bot token.
        raise ValueError('UPSTREAM_UNAVAILABLE: төлбөр/ботын холболтыг шалгана уу.') from exc

def wire(path,method='GET',data=None,key=None):
    api_key=os.environ.get('WIRE_MN_API_KEY','')
    if not api_key:raise ValueError('WIRE_MN_API_KEY тохируулаагүй байна.')
    headers={'Authorization':'Bearer '+api_key}
    if method!='GET':headers['Idempotency-Key']=key
    return request_json(API_BASE+path,method,data,headers)

def telegram(method,data):
    if not BOT_TOKEN:raise ValueError('TELEGRAM_BOT_TOKEN тохируулаагүй байна.')
    result=request_json('https://api.telegram.org/bot'+BOT_TOKEN+'/'+method,'POST',data)
    if not result.get('ok'):raise ValueError('TELEGRAM_REQUEST_FAILED')
    return result

def enqueue(db,key,text,buttons=None):
    payload={'chat_id':ADMIN_CHAT,'text':text,'disable_web_page_preview':True}
    if buttons:payload['reply_markup']={'inline_keyboard':buttons}
    db.execute('INSERT OR IGNORE INTO outbox(id,payload) VALUES(?,?)',(key,json.dumps(payload,ensure_ascii=False)))

def entitlement(device):
    expires=max(device['expires'],device['trial_expires'])
    return {'ok':True,'valid':expires>now(),'expiresAt':expires,'trial':device['expires']<=now(),'deviceId':device['id'],'daysLeft':max(0,(expires-now()+86399999)//86400000)}

def register(device_id,secret):
    if not re.fullmatch(r'DEV-(?:[a-fA-F0-9]{8}|[a-fA-F0-9-]{36})',device_id) or not isinstance(secret,str) or not 64<=len(secret)<=160:raise ValueError('DEVICE_INVALID')
    with transaction() as db:
        row=db.execute('SELECT * FROM devices WHERE id=?',(device_id,)).fetchone()
        if row and not hmac.compare_digest(row['secret_hash'],sha(secret)):raise PermissionError('DEVICE_AUTH_FAILED')
        if not row:
            db.execute('INSERT INTO devices(id,secret_hash,trial_expires,created) VALUES(?,?,?,?)',(device_id,sha(secret),now()+3*86400000,now()))
            row=db.execute('SELECT * FROM devices WHERE id=?',(device_id,)).fetchone()
        return entitlement(row)

def authenticate(device_id,secret):
    with connection() as db:row=db.execute('SELECT * FROM devices WHERE id=?',(device_id,)).fetchone()
    if not row or not hmac.compare_digest(row['secret_hash'],sha(secret)):raise PermissionError('DEVICE_AUTH_FAILED')
    return row

def order_public(row):
    return {'ok':True,'id':row['id'],'plan':row['plan'],'amount':row['amount'],'days':row['days'],'status':row['status'],'checkoutUrl':row['checkout'],'activated':bool(row['granted_at'])}

order_locks={};locks_guard=threading.Lock()
def create_order(device_id,plan,request_id):
    if plan not in PLANS or not re.fullmatch(r'[a-zA-Z0-9-]{16,80}',request_id):raise ValueError('ORDER_INVALID')
    with transaction() as db:
        row=db.execute('SELECT * FROM orders WHERE device_id=? AND request_id=?',(device_id,request_id)).fetchone()
        if row and row['plan']!=plan:raise ValueError('IDEMPOTENCY_CONFLICT')
        if not row:
            recent=db.execute('SELECT COUNT(*) FROM orders WHERE device_id=? AND created>?',(device_id,now()-3600000)).fetchone()[0]
            if recent>=10:raise ValueError('Хэт олон захиалга. Одоо байгаа захиалгаа шалгана уу.')
            oid='R'+secrets.token_hex(10);p=PLANS[plan]
            db.execute('INSERT INTO orders(id,device_id,plan,amount,days,request_id,created) VALUES(?,?,?,?,?,?,?)',(oid,device_id,plan,p['amount'],p['days'],request_id,now()))
            row=db.execute('SELECT * FROM orders WHERE id=?',(oid,)).fetchone()
    with locks_guard:lock=order_locks.setdefault(row['id'],threading.Lock())
    with lock:
        with connection() as db:row=db.execute('SELECT * FROM orders WHERE id=?',(row['id'],)).fetchone()
        if row['checkout'] or row['status']!='PENDING':return order_public(row)
        if not row['intent']:
            ops=[x.strip() for x in os.environ.get('WIRE_MN_ALLOWED_OPERATORS','').split(',') if x.strip() and x.strip()!='sandbox']
            body={'amount':row['amount'],'currency':'MNT','description':'RAINY '+row['id'],'metadata':{'order_id':row['id']}}
            if ops:body['allowed_operators']=ops
            pi=wire('/payment_intents','POST',body,'rainy-pi-'+row['id'])
            if not pi.get('id','').startswith('pi_') or pi.get('amount')!=row['amount'] or pi.get('currency')!='MNT':raise ValueError('PAYMENT_INTENT_MISMATCH')
            with transaction() as db:db.execute('UPDATE orders SET intent=? WHERE id=?',(pi['id'],row['id']))
            with connection() as db:row=db.execute('SELECT * FROM orders WHERE id=?',(row['id'],)).fetchone()
        checkout=wire('/checkout/sessions','POST',{'payment_intent':row['intent']},'rainy-cs-'+row['id'])
        url=checkout.get('url','');parsed=urlparse(url)
        if parsed.scheme!='https' or parsed.hostname!='pay.wire.mn':raise ValueError('CHECKOUT_URL_INVALID')
        with transaction() as db:
            db.execute('UPDATE orders SET checkout=? WHERE id=?',(url,row['id']))
            enqueue(db,'order-'+row['id'],f"🛒 RAINY шинэ захиалга\n{row['id']}\n{row['days']} хоног — {row['amount']:,} ₮\n{device_id}",[[{'text':'Төлбөр шалгаж идэвхжүүлэх','callback_data':'activate:'+row['id']} ]])
            row=db.execute('SELECT * FROM orders WHERE id=?',(row['id'],)).fetchone()
        return order_public(row)

def mark_paid(order_id,pi):
    with transaction() as db:
        row=db.execute('SELECT * FROM orders WHERE id=?',(order_id,)).fetchone()
        if not row:raise ValueError('ORDER_NOT_FOUND')
        if pi.get('id')!=row['intent'] or pi.get('status')!='succeeded' or type(pi.get('amount')) is not int or pi['amount']!=row['amount'] or pi.get('currency')!='MNT':raise ValueError('PAYMENT_NOT_CONFIRMED_OR_MISMATCH')
        if row['status']=='PENDING':
            db.execute("UPDATE orders SET status='PAID',paid_at=? WHERE id=?",(now(),order_id))
            enqueue(db,'paid-'+order_id,f"✅ Wire.mn төлбөр баталгаажлаа\n{order_id}\n{row['amount']:,} ₮ · {row['days']} хоног",[[{'text':f"{row['days']} хоногийн эрх идэвхжүүлэх",'callback_data':'activate:'+order_id}]])
        return dict(db.execute('SELECT * FROM orders WHERE id=?',(order_id,)).fetchone())

def check_order(order_id):
    with connection() as db:row=db.execute('SELECT * FROM orders WHERE id=?',(order_id,)).fetchone()
    if not row:raise ValueError('ORDER_NOT_FOUND')
    if row['status']=='PENDING' and row['intent']:
        pi=wire('/payment_intents/'+row['intent'])
        if pi.get('status')=='succeeded':return mark_paid(order_id,pi)
        if pi.get('status')=='canceled':
            with transaction() as db:db.execute("UPDATE orders SET status='EXPIRED' WHERE id=? AND status='PENDING'",(order_id,))
            row=dict(row);row['status']='EXPIRED'
    return dict(row)

def activate(order_id,actor,manual_reference=None):
    with transaction() as db:
        order=db.execute('SELECT * FROM orders WHERE id=?',(order_id,)).fetchone()
        if not order:raise ValueError('ORDER_NOT_FOUND')
        if order['granted_at']:return False
        if manual_reference:
            if os.environ.get('ALLOW_MANUAL_PAYMENT','false').lower()!='true':raise ValueError('MANUAL_PAYMENT_DISABLED')
            if not re.fullmatch(r'[a-zA-Z0-9:_-]{6,100}',manual_reference):raise ValueError('TRANSACTION_REFERENCE_REQUIRED')
            db.execute("UPDATE orders SET status='PAID',paid_at=?,manual_reference=? WHERE id=?",(now(),manual_reference,order_id))
        elif order['status']!='PAID':raise ValueError('PAYMENT_NOT_CONFIRMED')
        dev=db.execute('SELECT * FROM devices WHERE id=?',(order['device_id'],)).fetchone()
        expiry=max(now(),dev['expires'])+order['days']*86400000
        db.execute('UPDATE devices SET expires=? WHERE id=?',(expiry,dev['id']))
        db.execute("UPDATE orders SET status='ACTIVE',granted_at=? WHERE id=?",(now(),order_id))
        db.execute('INSERT INTO audit(action,order_id,actor,created) VALUES(?,?,?,?)',('manual_activate' if manual_reference else 'activate',order_id,actor,now()))
        enqueue(db,'active-'+order_id,f"👑 Эрх идэвхжлээ\n{order_id}\n{dev['id']}\n{order['days']} хоног · {order['amount']:,} ₮")
        return True

def verify_wire(raw,header,secret=None,clock=None):
    secret=secret if secret is not None else os.environ.get('WIRE_MN_WEBHOOK_SECRET','')
    if not secret:return False
    parts=[x.strip() for x in header.split(',')];ts=[x[2:] for x in parts if x.startswith('t=')]
    if len(ts)!=1 or not ts[0].isdigit():return False
    if abs((clock if clock is not None else time.time())-int(ts[0]))>300:return False
    expected=hmac.new(secret.encode(),ts[0].encode()+b'.'+raw,hashlib.sha256).hexdigest()
    return any(re.fullmatch(r'[a-fA-F0-9]{64}',p[3:]) and hmac.compare_digest(expected,p[3:].lower()) for p in parts if p.startswith('v1='))

def wire_webhook(raw,header):
    if not verify_wire(raw,header):raise PermissionError('BAD_WIRE_SIGNATURE')
    event=json.loads(raw)
    if event.get('type')!='payment_intent.succeeded':return {'ok':True}
    eid=event.get('id');intent=(event.get('data')or{}).get('id')
    if not isinstance(eid,str) or not eid.startswith('evt_'):raise ValueError('EVENT_INVALID')
    with connection() as db:
        if db.execute('SELECT 1 FROM events WHERE id=?',(eid,)).fetchone():return {'ok':True}
        order=db.execute('SELECT * FROM orders WHERE intent=?',(intent,)).fetchone()
    # Existing Wire project may also send storefront events to this endpoint.
    if not order:return {'ok':True}
    pi=wire('/payment_intents/'+intent);mark_paid(order['id'],pi)
    with transaction() as db:db.execute('INSERT OR IGNORE INTO events VALUES(?,?)',(eid,now()))
    return {'ok':True}

def telegram_webhook(update):
    cb=update.get('callback_query');msg=update.get('message') or (cb or {}).get('message') or {}
    actor=(cb or msg).get('from',{}).get('id')
    if str(actor)!=ADMIN_ID or str(msg.get('chat',{}).get('id'))!=ADMIN_CHAT:raise PermissionError('ADMIN_ONLY')
    uid='tg-'+str(update.get('update_id'))
    with connection() as db:
        if db.execute('SELECT 1 FROM events WHERE id=?',(uid,)).fetchone():return {'ok':True}
    text=(msg.get('text') or '').strip();answer=''
    if cb:
        data=cb.get('data','')
        if data.startswith('activate:'):
            oid=data.split(':',1)[1];order=check_order(oid)
            if order['status'] not in ('PAID','ACTIVE'):answer='Төлбөр хараахан баталгаажаагүй.'
            else:answer='Эрх идэвхжлээ.' if activate(oid,str(actor)) else 'Өмнө нь идэвхжсэн байна.'
        else:answer='Танихгүй үйлдэл.'
    elif text.startswith('/manual '):
        parts=text.split()
        if len(parts)!=3:raise ValueError('/manual ORDER_ID БАНКНЫ_ГҮЙЛГЭЭНИЙ_ID')
        # Explicit admin instruction: they have independently verified the Facebook/bank notification.
        answer='Гараар баталгаажуулж идэвхжүүллээ.' if activate(parts[1],str(actor),parts[2]) else 'Өмнө нь идэвхжсэн.'
    elif text.startswith('/check ') or text.startswith('/activate '):
        oid=text.split(maxsplit=1)[1];order=check_order(oid)
        if text.startswith('/activate '):answer='Эрх идэвхжлээ.' if activate(oid,str(actor)) else 'Өмнө нь идэвхжсэн.'
        else:answer=f"{oid}: {order['status']} · {order['amount']:,} ₮"
    elif text.startswith('/orders'):
        with connection() as db:rows=db.execute('SELECT * FROM orders ORDER BY created DESC LIMIT 15').fetchall()
        answer='\n'.join(f"{r['id']} · {r['amount']:,} ₮ · {r['status']}" for r in rows) or 'Захиалга алга.'
    else:answer='RAINY Pro\n/orders — захиалгууд\n/check ORDER_ID\n/activate ORDER_ID — Wire шалгаад идэвхжүүлэх\n/manual ORDER_ID ГҮЙЛГЭЭНИЙ_ID — төлбөрийг өөрөө шалгасны дараа гараар идэвхжүүлэх'
    with transaction() as db:
        enqueue(db,uid,answer);db.execute('INSERT OR IGNORE INTO events VALUES(?,?)',(uid,now()))
    # Acknowledge callback through the same durable outbox (no token in client).
    if cb:
        with transaction() as db:
            db.execute('INSERT OR IGNORE INTO outbox(id,payload) VALUES(?,?)',(uid+'-ack',json.dumps({'_method':'answerCallbackQuery','callback_query_id':cb['id'],'text':answer[:180]})))
    return {'ok':True}

def flush_outbox():
    if not BOT_TOKEN or not ADMIN_CHAT:return
    with connection() as db:rows=db.execute('SELECT * FROM outbox WHERE sent=0 AND next_at<=? ORDER BY rowid LIMIT 20',(now(),)).fetchall()
    for row in rows:
        payload=json.loads(row['payload']);method=payload.pop('_method','sendMessage')
        try:
            telegram(method,payload)
            with transaction() as db:db.execute('UPDATE outbox SET sent=1 WHERE id=?',(row['id'],))
        except ValueError:
            with transaction() as db:db.execute('UPDATE outbox SET attempts=attempts+1,next_at=? WHERE id=?',(now()+min(300000,5000*2**min(row['attempts'],6)),row['id']))

def reconcile_pending():
    if not os.environ.get('WIRE_MN_API_KEY'):return
    with connection() as db:rows=db.execute("SELECT id FROM orders WHERE status='PENDING' AND intent IS NOT NULL AND created>? ORDER BY created DESC LIMIT 20",(now()-86400000,)).fetchall()
    for row in rows:
        try:check_order(row['id'])
        except ValueError:pass

def worker():
    ticks=0
    while True:
        try:
            flush_outbox();ticks+=1
            if ticks%6==0:reconcile_pending()
        except Exception:print('Outbox retry pending',flush=True)
        time.sleep(5)

class Handler(BaseHTTPRequestHandler):
    def setup(self):
        super().setup();self.connection.settimeout(20)
    def log_message(self,fmt,*args):pass
    def reply(self,code,data):
        body=json.dumps(data,ensure_ascii=False).encode();self.send_response(code)
        self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Content-Length',str(len(body)))
        self.send_header('Cache-Control','no-store');self.send_header('X-Content-Type-Options','nosniff');self.end_headers();self.wfile.write(body)
    def do_GET(self):self.handle_api()
    def do_POST(self):self.handle_api()
    def handle_api(self):
        try:
            path=urlparse(self.path).path;length=int(self.headers.get('Content-Length','0'))
            if length>262144:return self.reply(413,{'error':'BODY_TOO_LARGE'})
            raw=self.rfile.read(length) if length else b'{}'
            if path=='/health':return self.reply(200,{'ok':True})
            if path=='/webhooks/wire' and self.command=='POST':return self.reply(200,wire_webhook(raw,self.headers.get('WirePayment-Signature','')))
            if path=='/webhooks/telegram' and self.command=='POST':
                if not TG_SECRET or not hmac.compare_digest(TG_SECRET,self.headers.get('X-Telegram-Bot-Api-Secret-Token','')):raise PermissionError('BAD_TELEGRAM_SECRET')
                return self.reply(200,telegram_webhook(json.loads(raw)))
            data=json.loads(raw);device_id=self.headers.get('X-Device-ID','');secret=self.headers.get('Authorization','').removeprefix('Bearer ')
            if path=='/v1/devices/register' and self.command=='POST':
                if device_id!=data.get('deviceId') or secret!=data.get('secret'):raise PermissionError('DEVICE_AUTH_FAILED')
                return self.reply(200,register(data.get('deviceId',''),data.get('secret','')))
            device=authenticate(device_id,secret)
            if path=='/v1/payment-service' and self.command=='GET':
                wire('/payment_intents?limit=1')
                return self.reply(200,{'ok':True,'wireConnected':True,'telegramConfigured':bool(BOT_TOKEN and ADMIN_CHAT and ADMIN_ID),'prices':PLANS})
            if path=='/v1/license' and self.command=='GET':return self.reply(200,entitlement(device))
            if path=='/v1/orders' and self.command=='POST':return self.reply(200,create_order(device_id,str(data.get('plan')),data.get('requestId','')))
            if path.startswith('/v1/orders/') and self.command=='GET':
                oid=unquote(path.rsplit('/',1)[1])
                with connection() as db:row=db.execute('SELECT * FROM orders WHERE id=? AND device_id=?',(oid,device_id)).fetchone()
                if not row:return self.reply(404,{'error':'ORDER_NOT_FOUND'})
                return self.reply(200,order_public(check_order(oid)))
            return self.reply(404,{'error':'NOT_FOUND'})
        except PermissionError as e:self.reply(403,{'error':str(e)})
        except (ValueError,TypeError,sqlite3.IntegrityError) as e:self.reply(400,{'error':str(e) if not isinstance(e,sqlite3.IntegrityError) else 'Гүйлгээний дугаар өмнө ашиглагдсан эсвэл өгөгдөл зөрсөн.'})
        except Exception:self.reply(500,{'error':'SERVER_ERROR'})

if __name__=='__main__':
    init_db();threading.Thread(target=worker,daemon=True).start()
    if os.environ.get('REGISTER_TELEGRAM_WEBHOOK')=='true':
        if not PUBLIC_URL.startswith('https://') or not TG_SECRET or not ADMIN_ID or not ADMIN_CHAT:raise SystemExit('PUBLIC_URL, Telegram webhook secret, admin user/chat IDs required')
        info=telegram('getWebhookInfo',{}).get('result',{})
        if not info.get('url') or info.get('url')==PUBLIC_URL+'/webhooks/telegram':
            telegram('setWebhook',{'url':PUBLIC_URL+'/webhooks/telegram','secret_token':TG_SECRET,'allowed_updates':['message','callback_query']})
        else:print('Existing Telegram webhook preserved; route updates to this service to enable bot activation.',flush=True)
    ThreadingHTTPServer(('0.0.0.0',int(os.environ.get('PORT','8080'))),Handler).serve_forever()
