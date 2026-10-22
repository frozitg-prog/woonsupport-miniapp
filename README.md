# WoonTime Mini App

Telegram Mini App for Minecraft ban appeals, powered by **Node.js**, Express, Telegraf and SQLite. The current pink / dark graphite WoonTime design remains in `app/static/`.

## Features
- Telegram Web App initData HMAC validation on the server
- Player appeal submission and appeal history
- Optional ban date and HTTPS evidence links
- One active appeal per Telegram account at a time
- Role-protected moderation queue and decisions
- Admin statistics and audit log
- Telegram `/start` button and menu button to open the Mini App
- Health endpoint at `/health`

## Run locally
1. Use Node.js 20 or newer.
2. Copy `.env.example` to `.env` and set `BOT_TOKEN`, `WEBAPP_URL`, `ADMIN_IDS`, and `MODERATOR_IDS`.
3. Run `npm install`.
4. Run `npm start`.
5. Check `/health`.

Set `DATA_DIR` to a persistent directory on the host. Configure the Mini App URL as HTTPS. The server automatically binds to the host-provided `PORT`.

## Important
- Keep real tokens and private IDs out of GitHub. Never commit `.env`.
- Telegram authentication is verified server-side; the API does not trust a user ID sent by the browser.
- This project does not execute RCON commands or automatically unban players.
- The Mini App uses its own SQLite database; it does not automatically import or share records from the separate main WoonTime bot database.
- The active deployment entry point is `server.js`, started with `npm start`.
