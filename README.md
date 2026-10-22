# WoonTime Mini App

Telegram Mini App starter for Minecraft ban appeals, built with FastAPI, aiogram, and SQLite.

## Included
- WoonTime-branded responsive Mini App with a pink / dark graphite visual theme
- Server-side Telegram Web App initData verification
- Player appeal submission (nickname, ban date, reason, explanation, evidence links) and history
- One active appeal per player at a time
- Role-protected moderator decisions and admin statistics
- SQLite schema with a safe migration for the optional ban-date field and an audit log
- Automated API and Telegram-auth tests

## Local run
1. Copy .env.example to .env and set BOT_TOKEN.
2. Install: pip install -r requirements.txt
3. Run: uvicorn app.main:app --host 0.0.0.0 --port 8000
4. Check /health.

## Deployment
Use the port assigned by the hosting panel and bind to 0.0.0.0. Configure an HTTPS domain and persistent DATA_DIR on Bothost. Set ADMIN_IDS and MODERATOR_IDS as comma-separated numeric Telegram IDs.

## Security and scope
Never commit .env, tokens, private IDs, or real application data. The API trusts only validated Telegram initData, not a user ID supplied by the browser. This project does not perform RCON actions or automatic unbans. Automated backups are intentionally excluded. The Mini App uses its own SQLite database; it does not automatically share or migrate records from the separate WoonTime bot database.