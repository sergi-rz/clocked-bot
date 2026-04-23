# Discord Session Tracker

A Discord bot that tracks time spent in voice channels. Requires a server (VPS or similar) running 24/7 to store the SQLite database and keep the process alive. Instead of relying solely on real-time WebSocket events (which can be missed if the bot goes down), it uses a **hybrid approach**: real-time events for accuracy + periodic polling for resilience.

## Features

- **Rankings** — global, yearly, monthly, weekly, and daily leaderboards
- **Personal stats** — total time, session count, average session, longest session, current and best streaks
- **Companions** — who you've spent the most time with, by period
- **Weekly summary** — automatically posted every Monday to each tracked channel
- **Multiple channels** — track several voice channels independently, each with its own stats
- **Opt-out** — any user can disable tracking of their sessions at any time
- **Minimum session filter** — accidental short connections don't affect stats

## Commands

| Command | Description |
|---|---|
| `/{PREFIX}-ranking [period] [channel]` | Top 10 by time (global / year / month / week / today), optionally filtered by channel |
| `/{PREFIX}-mystats [channel]` | Your personal stats and streaks |
| `/{PREFIX}-buddies [period] [channel]` | Who you've spent the most time with |
| `/{PREFIX}-optout` | Toggle tracking on/off for your account |

## Setup

### 1. Create a Discord application

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications) → **New Application**
2. **Bot** section → **Add Bot** → copy the **Token**
3. Enable **Server Members Intent**
4. **OAuth2 → URL Generator** → scopes: `bot` + `applications.commands` → permissions: `View Channel` + `Send Messages`
5. Use the generated URL to invite the bot to your server

### 2. Install and configure

Requires [Node.js v22+](https://nodejs.org).

```bash
git clone https://github.com/sergi-rz/discord-sessions-tracker
cd discord-sessions-tracker
npm install
cp .env.example .env
# edit .env with your values
```

### 3. Register slash commands and start

```bash
npm run deploy   # register slash commands (run once, or after command changes)
npm start
```

For production, use a process manager like [pm2](https://pm2.keymetrics.io/):

```bash
npm install -g pm2
pm2 start src/index.js --name discord-session-tracker
pm2 save
pm2 startup
```

## Configuration

All configuration is done via environment variables in `.env`:

| Variable | Required | Default | Description |
|---|---|---|---|
| `DISCORD_TOKEN` | ✅ | — | Bot token from Discord Developer Portal |
| `CLIENT_ID` | ✅ | — | Application ID |
| `GUILD_ID` | ✅ | — | Your Discord server ID |
| `VOICE_CHANNEL_IDS` | ✅ | — | Comma-separated list of voice channel IDs to track (e.g. `id1,id2`) |
| `COMMAND_PREFIX` | | `deepwork` | Slash command prefix |
| `ACTIVITY_NAME` | | `Deep Work` | Activity name shown in messages and embeds |
| `LOCALE` | | `es` | Language (`es` / `en`) |
| `TIMEZONE` | | `Europe/Madrid` | Timezone for the weekly summary |
| `SUMMARY_HOUR` | | `9` | Hour of the Monday weekly summary (0–23) |
| `POLL_INTERVAL_MS` | | `1800000` | Polling interval in ms (default: 30 min) |
| `MIN_SESSION_MINUTES` | | `5` | Minimum session duration to count in stats |

> The legacy `VOICE_CHANNEL_ID` (single value) is still supported for backwards compatibility.

## How it works

**Session tracking** uses a hybrid model:
- `voiceStateUpdate` events open and close sessions in real time
- A periodic poll (every `POLL_INTERVAL_MS`) reconciles the actual channel state with the database, recovering sessions missed during bot downtime
- If a user moves between two tracked channels, the session in the first channel closes and a new one opens in the second

**Data** is stored in a local SQLite file (`sessions.db`) with two tables:
- `sessions` — one row per session with `started_at`, `ended_at`, `channel_id`, and `duration_minutes`
- `snapshots` — raw poll results for auditing

**Co-presence** is calculated at query time by joining sessions with overlapping time ranges.

## Adding a language

Create `src/i18n/xx.js` following the same structure as `es.js` or `en.js`, then add it to the `locales` object in `src/i18n/index.js`.

## Author

Made by [@sergi_rz](https://x.com/sergi_rz)

## License

MIT
