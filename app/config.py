import os
from dataclasses import dataclass
from pathlib import Path
from dotenv import load_dotenv
load_dotenv()

def parse_ids(raw):
    result = set()
    for item in (raw or '').split(','):
        item = item.strip()
        if item:
            try: value = int(item)
            except ValueError as exc: raise ValueError('ID lists must contain integers') from exc
            if value <= 0: raise ValueError('IDs must be positive integers')
            result.add(value)
    return frozenset(result)

@dataclass(frozen=True)
class Settings:
    bot_token: str
    admin_ids: frozenset
    moderator_ids: frozenset
    data_dir: Path
    webapp_url: str
    initdata_max_age_seconds: int
    host: str
    port: int
    @property
    def database_path(self): return self.data_dir / 'woonsupport.sqlite3'

def get_settings():
    age = int(os.getenv('TELEGRAM_INITDATA_MAX_AGE_SECONDS', '86400'))
    port = int(os.getenv('PORT', '8000'))
    if not 60 <= age <= 604800: raise ValueError('Invalid initData max age')
    if not 1 <= port <= 65535: raise ValueError('Invalid port')
    return Settings(os.getenv('BOT_TOKEN', '').strip(), parse_ids(os.getenv('ADMIN_IDS')),
        parse_ids(os.getenv('MODERATOR_IDS')), Path(os.getenv('DATA_DIR', './data')),
        os.getenv('WEBAPP_URL', '').strip(), age, os.getenv('HOST', '0.0.0.0'), port)