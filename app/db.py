import sqlite3

SCHEMA = '''
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS appeals (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 telegram_user_id INTEGER NOT NULL, username TEXT,
 minecraft_nickname TEXT NOT NULL, ban_reason TEXT NOT NULL, appeal_text TEXT NOT NULL,
 evidence_json TEXT NOT NULL DEFAULT '[]',
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','in_review','approved','rejected','need_info')),
 assigned_moderator_id INTEGER, moderator_note TEXT,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE INDEX IF NOT EXISTS idx_appeals_user ON appeals(telegram_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_appeals_status ON appeals(status, created_at DESC);
CREATE TABLE IF NOT EXISTS audit_log (
 id INTEGER PRIMARY KEY AUTOINCREMENT, actor_telegram_id INTEGER NOT NULL, action TEXT NOT NULL,
 appeal_id INTEGER, details_json TEXT NOT NULL DEFAULT '{}',
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 FOREIGN KEY(appeal_id) REFERENCES appeals(id) ON DELETE SET NULL);
'''
def connect(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path, timeout=10)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA foreign_keys=ON')
    db.execute('PRAGMA busy_timeout=10000')
    return db
def init_db(path):
    with connect(path) as db: db.executescript(SCHEMA)