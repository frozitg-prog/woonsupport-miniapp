import hashlib,hmac,json,time
from urllib.parse import urlencode
from fastapi.testclient import TestClient
from app import main
def signed(token,uid,auth_date=None):
    if auth_date is None: auth_date=int(time.time())
    d={'auth_date':str(auth_date),'user':json.dumps({'id':uid,'first_name':'Test'},separators=(',',':'))}
    check='\n'.join(f'{k}={v}' for k,v in sorted(d.items()))
    secret=hmac.new(b'WebAppData',token.encode(),hashlib.sha256).digest()
    d['hash']=hmac.new(secret,check.encode(),hashlib.sha256).hexdigest()
    return urlencode(d)
def setup(monkeypatch,tmp_path,admins=frozenset(),mods=frozenset()):
    s=main.settings.__class__('test-token',admins,mods,tmp_path,'',86400,'127.0.0.1',8000)
    monkeypatch.setattr(main,'settings',s)
def test_health():
    with TestClient(main.app) as c: assert c.get('/health').json()=={'status':'ok'}
def test_auth_required(monkeypatch,tmp_path):
    setup(monkeypatch,tmp_path)
    with TestClient(main.app) as c:
        assert c.get('/api/me').status_code==401
        assert c.get('/api/me',headers={'X-Telegram-Init-Data':signed('test-token',55)}).status_code==200
def test_player_denied_staff_routes(monkeypatch,tmp_path):
    setup(monkeypatch,tmp_path)
    with TestClient(main.app) as c:
        h={'X-Telegram-Init-Data':signed('test-token',55)}
        assert c.get('/api/moderation/appeals',headers=h).status_code==403
        assert c.get('/api/admin/stats',headers=h).status_code==403
def test_create_and_list_own_appeal(monkeypatch,tmp_path):
    setup(monkeypatch,tmp_path)
    with TestClient(main.app) as c:
        h={'X-Telegram-Init-Data':signed('test-token',55)}
        r=c.post('/api/appeals',headers=h,json={'minecraft_nickname':'Example_123','ban_date':'12 октября','ban_reason':'Suspicious activity','appeal_text':'Please review the circumstances carefully.'})
        assert r.status_code==201
        rows=c.get('/api/appeals',headers=h).json()['items']
        assert len(rows)==1 and rows[0]['telegram_user_id']==55
        assert rows[0]['ban_date']=='12 октября'
        duplicate=c.post('/api/appeals',headers=h,json={'minecraft_nickname':'Example_123','ban_reason':'Another reason','appeal_text':'Please review this second appeal carefully.'})
        assert duplicate.status_code==409