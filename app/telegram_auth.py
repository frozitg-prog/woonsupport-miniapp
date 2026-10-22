import hashlib, hmac, json, time
from urllib.parse import parse_qsl

class TelegramAuthError(ValueError): pass

def validate_init_data(init_data, bot_token, max_age_seconds=86400, now=None):
    if not init_data or not bot_token: raise TelegramAuthError('Authentication is not configured')
    if len(init_data) > 16384: raise TelegramAuthError('initData too large')
    try: pairs = parse_qsl(init_data, keep_blank_values=True, strict_parsing=True)
    except ValueError as exc: raise TelegramAuthError('Malformed initData') from exc
    data = dict(pairs)
    if len(data) != len(pairs): raise TelegramAuthError('Duplicate fields')
    received = data.pop('hash', None)
    if not received: raise TelegramAuthError('Missing hash')
    check = '\n'.join(f'{k}={v}' for k,v in sorted(data.items()))
    secret = hmac.new(b'WebAppData', bot_token.encode(), hashlib.sha256).digest()
    expected = hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, received): raise TelegramAuthError('Invalid Telegram signature')
    try: auth_date = int(data['auth_date'])
    except (KeyError, ValueError) as exc: raise TelegramAuthError('Invalid auth_date') from exc
    current = int(time.time()) if now is None else now
    if auth_date > current + 30: raise TelegramAuthError('auth_date is in the future')
    if current - auth_date > max_age_seconds: raise TelegramAuthError('initData expired')
    try: user = json.loads(data['user']); user_id = int(user['id'])
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc: raise TelegramAuthError('Invalid user') from exc
    if user_id <= 0: raise TelegramAuthError('Invalid user ID')
    return {'user': user, 'user_id': user_id, 'auth_date': auth_date}