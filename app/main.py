import asyncio
import json
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated
from fastapi import Depends, FastAPI, Header, HTTPException, Query
from aiogram import Bot, Dispatcher, Router
from aiogram.filters import CommandStart
from aiogram.types import Message, InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo, MenuButtonWebApp
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from app.config import get_settings
from app.db import connect, init_db
from app.telegram_auth import TelegramAuthError, validate_init_data

BASE = Path(__file__).resolve().parent
settings = get_settings()
bot_router = Router()

@bot_router.message(CommandStart())
async def start_command(message: Message):
    if not settings.webapp_url.startswith("https://"):
        await message.answer("Мини-приложение пока не настроено. Администратор должен указать HTTPS WEBAPP_URL.")
        return
    keyboard = InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text="🚀 Открыть WoonSupport", web_app=WebAppInfo(url=settings.webapp_url))
    ]])
    await message.answer(
        "👋 Добро пожаловать в WoonSupport!\n\n"
        "Здесь можно подать апелляцию на бан и следить за её статусом.",
        reply_markup=keyboard,
    )

@asynccontextmanager
async def lifespan(_app):
    init_db(settings.database_path)
    bot = None
    polling_task = None
    if settings.bot_token and settings.webapp_url.startswith("https://"):
        bot = Bot(token=settings.bot_token)
        dp = Dispatcher()
        dp.include_router(bot_router)
        try:
            await bot.set_chat_menu_button(
                menu_button=MenuButtonWebApp(
                    text="WoonSupport",
                    web_app=WebAppInfo(url=settings.webapp_url),
                )
            )
        except Exception:
            # The /start inline button remains available if Telegram rejects the menu-button update.
            pass
        polling_task = asyncio.create_task(dp.start_polling(bot))
    try:
        yield
    finally:
        if polling_task:
            polling_task.cancel()
            try:
                await polling_task
            except asyncio.CancelledError:
                pass
        if bot:
            await bot.session.close()
app = FastAPI(title='WoonSupport Mini App API', version='0.1.0', lifespan=lifespan)
app.mount('/static', StaticFiles(directory=BASE / 'static'), name='static')
@app.get('/')
def index(): return FileResponse(BASE / 'static' / 'index.html')
@app.get('/health')
def health(): return {'status':'ok'}

def current_user(x_telegram_init_data: Annotated[str | None, Header()] = None):
    if not settings.bot_token: raise HTTPException(503, 'Telegram authentication is not configured')
    if not x_telegram_init_data: raise HTTPException(401, 'Open this app inside Telegram')
    try: return validate_init_data(x_telegram_init_data, settings.bot_token, settings.initdata_max_age_seconds)
    except TelegramAuthError as exc: raise HTTPException(401, str(exc)) from exc
User = Annotated[dict, Depends(current_user)]
def role_for(user_id):
    if user_id in settings.admin_ids: return 'admin'
    if user_id in settings.moderator_ids: return 'moderator'
    return 'player'
def require_staff(user):
    role = role_for(user['user_id'])
    if role not in ('admin','moderator'): raise HTTPException(403, 'Moderator access required')
    return role

class AppealCreate(BaseModel):
    minecraft_nickname: str = Field(min_length=2, max_length=32, pattern=r'^[A-Za-z0-9_]+$')
    ban_reason: str = Field(min_length=2, max_length=500)
    appeal_text: str = Field(min_length=10, max_length=5000)
    evidence: list[str] = Field(default_factory=list, max_length=10)
class AppealDecision(BaseModel):
    status: str = Field(pattern=r'^(in_review|approved|rejected|need_info)$')
    moderator_note: str = Field(default='', max_length=2000)

@app.get('/api/me')
def me(user: User): return {'user_id':user['user_id'], 'telegram_user':user['user'], 'role':role_for(user['user_id'])}
@app.get('/api/appeals')
def list_appeals(user: User, status: str | None = Query(default=None)):
    role = role_for(user['user_id'])
    with connect(settings.database_path) as db:
        if role in ('admin','moderator'):
            if status and status not in ('pending','in_review','approved','rejected','need_info'): raise HTTPException(400, 'Unknown status')
            if status: rows = db.execute('SELECT * FROM appeals WHERE status=? ORDER BY created_at DESC LIMIT 200',(status,)).fetchall()
            else: rows = db.execute('SELECT * FROM appeals ORDER BY created_at DESC LIMIT 200').fetchall()
        else:
            rows = db.execute('SELECT * FROM appeals WHERE telegram_user_id=? ORDER BY created_at DESC LIMIT 100',(user['user_id'],)).fetchall()
    return {'items':[dict(row) for row in rows]}
@app.post('/api/appeals', status_code=201)
def create_appeal(payload: AppealCreate, user: User):
    evidence=[]
    for item in payload.evidence:
        if not item.startswith('https://') or len(item)>1000: raise HTTPException(422, 'Evidence must use HTTPS links')
        evidence.append(item)
    with connect(settings.database_path) as db:
        cur=db.execute('INSERT INTO appeals (telegram_user_id,username,minecraft_nickname,ban_reason,appeal_text,evidence_json) VALUES (?,?,?,?,?,?)',
            (user['user_id'],user['user'].get('username'),payload.minecraft_nickname,payload.ban_reason.strip(),payload.appeal_text.strip(),json.dumps(evidence)))
        appeal_id=cur.lastrowid
        db.execute('INSERT INTO audit_log (actor_telegram_id,action,appeal_id) VALUES (?,?,?)',(user['user_id'],'appeal_created',appeal_id))
    return {'id':appeal_id,'status':'pending'}
@app.get('/api/moderation/appeals')
def moderation_appeals(user: User, status: str | None = None, q: str | None = None):
    require_staff(user)
    if status and status not in ('pending','in_review','approved','rejected','need_info'): raise HTTPException(400,'Unknown status')
    clauses=[]; params=[]
    if status: clauses.append('status=?'); params.append(status)
    if q: clauses.append('(minecraft_nickname LIKE ? OR CAST(id AS TEXT)=?)'); params.extend(['%'+q[:64]+'%',q[:20]])
    where=' WHERE '+' AND '.join(clauses) if clauses else ''
    with connect(settings.database_path) as db: rows=db.execute('SELECT * FROM appeals'+where+' ORDER BY created_at DESC LIMIT 200',params).fetchall()
    return {'items':[dict(row) for row in rows]}
@app.patch('/api/moderation/appeals/{appeal_id}')
def decide_appeal(appeal_id: int, payload: AppealDecision, user: User):
    require_staff(user)
    with connect(settings.database_path) as db:
        if not db.execute('SELECT id FROM appeals WHERE id=?',(appeal_id,)).fetchone(): raise HTTPException(404,'Appeal not found')
        db.execute("UPDATE appeals SET status=?,moderator_note=?,assigned_moderator_id=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?",(payload.status,payload.moderator_note.strip(),user['user_id'],appeal_id))
        db.execute('INSERT INTO audit_log (actor_telegram_id,action,appeal_id,details_json) VALUES (?,?,?,?)',(user['user_id'],'appeal_status_changed',appeal_id,json.dumps({'status':payload.status})))
    return {'id':appeal_id,'status':payload.status}
@app.get('/api/admin/stats')
def admin_stats(user: User):
    if role_for(user['user_id'])!='admin': raise HTTPException(403,'Admin access required')
    with connect(settings.database_path) as db:
        counts=db.execute('SELECT status,COUNT(*) AS count FROM appeals GROUP BY status').fetchall()
        total=db.execute('SELECT COUNT(*) FROM appeals').fetchone()[0]
        log=db.execute('SELECT id,actor_telegram_id,action,appeal_id,created_at FROM audit_log ORDER BY id DESC LIMIT 50').fetchall()
    return {'total':total,'by_status':{r['status']:r['count'] for r in counts},'recent_audit_log':[dict(r) for r in log]}