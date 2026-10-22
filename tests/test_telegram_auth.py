import hashlib,hmac,json
from urllib.parse import urlencode
import pytest
from app.telegram_auth import TelegramAuthError,validate_init_data
def signed(token,auth_date=1700000000,user_id=123456):
    d={'auth_date':str(auth_date),'user':json.dumps({'id':user_id,'first_name':'Test'},separators=(',',':'))}
    check='\n'.join(f'{k}={v}' for k,v in sorted(d.items()))
    secret=hmac.new(b'WebAppData',token.encode(),hashlib.sha256).digest()
    d['hash']=hmac.new(secret,check.encode(),hashlib.sha256).hexdigest()
    return urlencode(d)
def test_valid(): assert validate_init_data(signed('secret'),'secret',now=1700000010)['user_id']==123456
def test_bad_token():
    with pytest.raises(TelegramAuthError): validate_init_data(signed('a'),'b',now=1700000010)
def test_expired():
    with pytest.raises(TelegramAuthError): validate_init_data(signed('a'),'a',60,now=1700001000)
def test_future_date():
    with pytest.raises(TelegramAuthError): validate_init_data(signed('a',1700000100),'a',now=1700000000)
def test_duplicate():
    with pytest.raises(TelegramAuthError): validate_init_data(signed('a')+'&auth_date=1700000000','a',now=1700000010)