const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const express = require('express');
const Database = require('better-sqlite3');
const { Telegraf, Markup } = require('telegraf');

const PORT = Number(process.env.PORT || 8000);
const HOST = process.env.HOST || '0.0.0.0';
const TOKEN = process.env.BOT_TOKEN || '';
const WEBAPP_URL = process.env.WEBAPP_URL || '';
const MAX_AGE = Number(process.env.TELEGRAM_INITDATA_MAX_AGE_SECONDS || 86400);
const ADMINS = new Set((process.env.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean));
const MODS = new Set((process.env.MODERATOR_IDS || '').split(',').map(s => s.trim()).filter(Boolean));
const dataDir = path.resolve(process.env.DATA_DIR || './data');
fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, 'woontime.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(\`
CREATE TABLE IF NOT EXISTS appeals (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 telegram_user_id TEXT NOT NULL, username TEXT,
 minecraft_nickname TEXT NOT NULL, ban_date TEXT NOT NULL DEFAULT '',
 ban_reason TEXT NOT NULL, appeal_text TEXT NOT NULL, evidence_json TEXT NOT NULL DEFAULT '[]',
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','in_review','approved','rejected','need_info')),
 assigned_moderator_id TEXT, moderator_note TEXT,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_appeals_user ON appeals(telegram_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_appeals_status ON appeals(status, created_at DESC);
CREATE TABLE IF NOT EXISTS audit_log (
 id INTEGER PRIMARY KEY AUTOINCREMENT, actor_telegram_id TEXT NOT NULL, action TEXT NOT NULL,
 appeal_id INTEGER, details_json TEXT NOT NULL DEFAULT '{}',
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 FOREIGN KEY(appeal_id) REFERENCES appeals(id) ON DELETE SET NULL
); \`);
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));
const staticDir = path.join(__dirname, 'app', 'static');
app.use('/static', express.static(staticDir));
app.get('/', (_req, res) => res.sendFile(path.join(staticDir, 'index.html')));
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

function roleFor(id) {
  id = String(id);
  if (ADMINS.has(id)) return 'admin';
  if (MODS.has(id)) return 'moderator';
  return 'player';
}
function validateInitData(initData) {
  if (!TOKEN) throw Object.assign(new Error('Telegram authentication is not configured'), { status: 503 });
  if (!initData) throw Object.assign(new Error('Open this app inside Telegram'), { status: 401 });
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  const authDate = Number(params.get('auth_date'));
  if (!hash || !Number.isFinite(authDate)) throw Object.assign(new Error('Invalid Telegram initData'), { status: 401 });
  const now = Math.floor(Date.now() / 1000);
  if (authDate > now + 60 || now - authDate > MAX_AGE) throw Object.assign(new Error('Telegram session expired. Reopen the app.'), { status: 401 });
  const check = [...params.entries()].filter(([key]) => key !== 'hash').sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => key + '=' + value).join('\\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  const expected = crypto.createHmac('sha256', secret).update(check).digest('hex');
  const supplied = Buffer.from(hash, 'hex');
  const calculated = Buffer.from(expected, 'hex');
  if (supplied.length !== calculated.length || !crypto.timingSafeEqual(supplied, calculated)) throw Object.assign(new Error('Telegram authentication failed'), { status: 401 });
  let user;
  try { user = JSON.parse(params.get('user') || 'null'); } catch { user = null; }
  if (!user || user.id == null) throw Object.assign(new Error('Telegram user data is missing'), { status: 401 });
  return { user_id: String(user.id), user };
}
app.use('/api', (req, res, next) => {
  try { req.tgUser = validateInitData(req.get('X-Telegram-Init-Data')); next(); }
  catch (e) { res.status(e.status || 401).json({ detail: e.message || 'Unauthorized' }); }
});
function staff(req, res, next) {
  if (!['admin', 'moderator'].includes(roleFor(req.tgUser.user_id))) return res.status(403).json({ detail: 'Moderator access required' });
  next();
}
const statuses = new Set(['pending', 'in_review', 'approved', 'rejected', 'need_info']);
const audit = db.prepare('INSERT INTO audit_log (actor_telegram_id, action, appeal_id, details_json) VALUES (?, ?, ?, ?)');
app.get('/api/me', (req, res) => res.json({ user_id: req.tgUser.user_id, telegram_user: req.tgUser.user, role: roleFor(req.tgUser.user_id) }));
app.get('/api/appeals', (req, res) => {
  const role = roleFor(req.tgUser.user_id), status = req.query.status;
  if (['admin', 'moderator'].includes(role)) {
    if (status && !statuses.has(status)) return res.status(400).json({ detail: 'Unknown status' });
    const items = status ? db.prepare('SELECT * FROM appeals WHERE status=? ORDER BY created_at DESC LIMIT 200').all(status) : db.prepare('SELECT * FROM appeals ORDER BY created_at DESC LIMIT 200').all();
    return res.json({ items });
  }
  res.json({ items: db.prepare('SELECT * FROM appeals WHERE telegram_user_id=? ORDER BY created_at DESC LIMIT 100').all(req.tgUser.user_id) });
});
app.post('/api/appeals', (req, res) => {
  const b = req.body || {};
  const nickname = typeof b.minecraft_nickname === 'string' ? b.minecraft_nickname.trim() : '';
  const banDate = typeof b.ban_date === 'string' ? b.ban_date.trim() : '';
  const reason = typeof b.ban_reason === 'string' ? b.ban_reason.trim() : '';
  const appeal = typeof b.appeal_text === 'string' ? b.appeal_text.trim() : '';
  const links = Array.isArray(b.evidence) ? b.evidence : [];
  if (!/^[A-Za-z0-9_]{2,32}$/.test(nickname)) return res.status(422).json({ detail: 'Ник должен содержать 2–32 латинских символа, цифры или _' });
  if (banDate.length > 80 || reason.length < 2 || reason.length > 500 || appeal.length < 10 || appeal.length > 5000 || links.length > 10) return res.status(422).json({ detail: 'Проверьте поля формы и их длину' });
  if (links.some(x => typeof x !== 'string' || !x.startsWith('https://') || x.length > 1000)) return res.status(422).json({ detail: 'Доказательства должны быть HTTPS-ссылками' });
  const userId = req.tgUser.user_id;
  const active = db.prepare("SELECT id FROM appeals WHERE telegram_user_id=? AND status IN ('pending','in_review','need_info') LIMIT 1").get(userId);
  if (active) return res.status(409).json({ detail: 'У вас уже есть активная заявка #' + active.id + '. Дождитесь решения команды.' });
  const transaction = db.transaction(() => {
    const result = db.prepare('INSERT INTO appeals (telegram_user_id, username, minecraft_nickname, ban_date, ban_reason, appeal_text, evidence_json) VALUES (?, ?, ?, ?, ?, ?, ?)').run(userId, req.tgUser.user.username || null, nickname, banDate, reason, appeal, JSON.stringify(links));
    audit.run(userId, 'appeal_created', result.lastInsertRowid, '{}');
    return Number(result.lastInsertRowid);
  });
  res.status(201).json({ id: transaction(), status: 'pending' });
});
app.get('/api/moderation/appeals', staff, (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : '';
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 64) : '';
  if (status && !statuses.has(status)) return res.status(400).json({ detail: 'Unknown status' });
  let sql = 'SELECT * FROM appeals', args = [], conditions = [];
  if (status) { conditions.push('status=?'); args.push(status); }
  if (q) { conditions.push('(minecraft_nickname LIKE ? OR CAST(id AS TEXT)=?)'); args.push('%' + q + '%', q.slice(0, 20)); }
  if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
  res.json({ items: db.prepare(sql + ' ORDER BY created_at DESC LIMIT 200').all(...args) });
});
app.patch('/api/moderation/appeals/:id', staff, (req, res) => {
  const id = Number(req.params.id), b = req.body || {};
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ detail: 'Invalid appeal ID' });
  if (!statuses.has(b.status) || typeof (b.moderator_note || '') !== 'string' || (b.moderator_note || '').length > 2000) return res.status(422).json({ detail: 'Invalid status or moderator note' });
  if (!db.prepare('SELECT id FROM appeals WHERE id=?').get(id)) return res.status(404).json({ detail: 'Appeal not found' });
  const transaction = db.transaction(() => {
    db.prepare("UPDATE appeals SET status=?, moderator_note=?, assigned_moderator_id=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(b.status, (b.moderator_note || '').trim(), req.tgUser.user_id, id);
    audit.run(req.tgUser.user_id, 'appeal_status_changed', id, JSON.stringify({ status: b.status }));
  });
  transaction();
  res.json({ id, status: b.status });
});
app.get('/api/admin/stats', (req, res) => {
  if (roleFor(req.tgUser.user_id) !== 'admin') return res.status(403).json({ detail: 'Admin access required' });
  const counts = db.prepare('SELECT status, COUNT(*) AS count FROM appeals GROUP BY status').all();
  const total = db.prepare('SELECT COUNT(*) AS count FROM appeals').get().count;
  const recent_audit_log = db.prepare('SELECT id, actor_telegram_id, action, appeal_id, created_at FROM audit_log ORDER BY id DESC LIMIT 50').all();
  res.json({ total, by_status: Object.fromEntries(counts.map(x => [x.status, x.count])), recent_audit_log });
});
app.use((err, _req, res, _next) => {
  console.error('Request error:', err);
  res.status(500).json({ detail: 'Internal server error' });
});

let bot;
if (TOKEN) {
  bot = new Telegraf(TOKEN);
  bot.start(ctx => {
    if (!WEBAPP_URL.startsWith('https://')) return ctx.reply('Мини-приложение пока не настроено. Укажите HTTPS WEBAPP_URL.');
    return ctx.reply('👋 Добро пожаловать в WoonTime!\\n\\nЗдесь можно подать апелляцию на бан и следить за её статусом.',
      Markup.inlineKeyboard([Markup.button.webApp('🚀 Открыть WoonTime', WEBAPP_URL)]));
  });
  bot.catch(err => console.error('Telegram bot error:', err));
}
async function start() {
  const server = app.listen(PORT, HOST, () => console.log('WoonTime Node server listening on ' + HOST + ':' + PORT));
  if (bot) {
    try {
      if (WEBAPP_URL.startsWith('https://')) await bot.telegram.setChatMenuButton({ menu_button: { type: 'web_app', text: 'WoonTime', web_app: { url: WEBAPP_URL } } });
    } catch (e) { console.error('Could not set Telegram menu button:', e.message); }
    try { await bot.launch(); console.log('Telegram bot polling started'); }
    catch (e) { console.error('Telegram bot failed to start:', e.message); }
  } else console.warn('BOT_TOKEN is not set; Telegram bot polling is disabled.');
  const shutdown = () => {
    if (bot) { try { bot.stop('SIGTERM'); } catch {} }
    server.close(() => { db.close(); process.exit(0); });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
start().catch(err => { console.error(err); process.exit(1); });
