# Discord Session Tracker

Track time spent in voice channels across your Discord community. Useful for:

- **Study / co-working servers** ("Study with me", Pomodoro rooms) where members want to see who's putting in the hours
- **Paid masterminds and accountability groups** where the organiser needs objective attendance data without relying on self-reporting
- **Remote teams** running deep-work sessions together and tracking shared focus time

Instead of relying solely on real-time WebSocket events (which can be missed if the bot goes down), it uses a **hybrid approach**: real-time events for accuracy + periodic polling for resilience.

One bot instance can serve **many Discord servers** — each guild configures itself independently through a `/setup` slash command.

## Features

- **Rankings** — global, yearly, monthly, weekly, and daily leaderboards
- **Personal stats** — total time, session count, average session, longest session, current and best streaks
- **Companions** — who you've spent the most time with, by period
- **Weekly summary** — automatically posted every Monday to each tracked channel
- **Multiple channels** — track several voice channels independently per server
- **Multi-server** — a single bot instance handles any number of guilds, each with their own config
- **Opt-out** — users can disable tracking of their sessions at any time (per server)
- **Minimum session filter** — accidental short connections don't affect stats

## Commands

| Command | Description |
|---|---|
| `/clocked-ranking [period] [channel]` | Top 10 by time (global / year / month / week / today), optionally filtered by channel |
| `/clocked-mystats [channel]` | Your personal stats and streaks |
| `/clocked-buddies [period] [channel]` | Who you've spent the most time with |
| `/clocked-optout` | Toggle tracking on/off for your account |
| `/clocked-setup` | Configure tracked channels, language, timezone, etc. (admins only) |

## Hosted version?

If you'd rather not run this on your own VPS, I'm exploring offering a hosted instance at [clocked.club](https://clocked.club). Drop me a line ([open an issue](https://github.com/sergi-rz/clocked-bot/issues) or DM on X) if that would be useful.

## Self-host setup

### 1. Create a Discord application

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications) → **New Application**
2. **Bot** section → **Add Bot** → copy the **Token**
3. Enable **Server Members Intent**
4. **OAuth2 → URL Generator** → scopes: `bot` + `applications.commands` → permissions: `View Channel` + `Send Messages`
5. Use the generated URL to invite the bot to your server(s)

### 2. Install and configure

Requires [Node.js v22+](https://nodejs.org).

```bash
git clone https://github.com/sergi-rz/clocked-bot
cd clocked-bot
npm install
cp .env.example .env
# edit .env with at least DISCORD_TOKEN and CLIENT_ID
```

### 3. Register slash commands and start

```bash
npm run deploy   # register slash commands (run once, or after command changes)
npm start
```

### 4. Configure each server

Once the bot is running and invited, an admin of each server runs:

```
/clocked-setup add channel:<#your-voice-channel>
```

That's it — sessions in that channel are now tracked. Use `/clocked-setup list` to see the current config, and `/clocked-setup config` to change language, timezone, summary hour, or activity name.

### Production (systemd)

For a long-running install, run the bot under systemd. A template unit file ships in [`deploy/clocked.service`](./deploy/clocked.service).

```bash
# 1. Pick an unprivileged user that will run the bot. If you already have a
#    shared `nodeapps` user for Node services, reuse it; otherwise create one:
#    sudo useradd --system --home-dir /opt/nodeapps --shell /usr/sbin/nologin nodeapps

# 2. Make sure the runtime user owns the install directory
sudo chown -R nodeapps:nodeapps /opt/nodeapps/clocked-bot

# 3. Install the unit file
sudo cp deploy/clocked.service /etc/systemd/system/clocked.service
#    (edit the file if your paths differ — WorkingDirectory, ExecStart, User)

# 4. Enable and start
sudo systemctl daemon-reload
sudo systemctl enable --now clocked

# 5. Check status / logs
sudo systemctl status clocked
sudo journalctl -u clocked -f
```

The unit file includes standard hardening (`NoNewPrivileges`, `ProtectSystem=strict`, `PrivateTmp`, etc.) and allows writes only to the install directory (where `sessions.db` lives).

## Configuration

Bot-level settings (env vars in `.env`):

| Variable | Required | Default | Description |
|---|---|---|---|
| `DISCORD_TOKEN` | ✅ | — | Bot token from Discord Developer Portal |
| `CLIENT_ID` | ✅ | — | Application ID |
| `POLL_INTERVAL_MS` | | `1800000` | Reconciliation poll interval in ms (30 min) |
| `MIN_SESSION_MINUTES` | | `5` | Minimum session duration to count in stats |
| `DEFAULT_ACTIVITY_NAME` | | `Deep Work` | Name shown in embeds for new guilds; also used in command descriptions |
| `DEFAULT_LOCALE` | | `es` | `es` / `en` — default for new guilds; also used in command descriptions |
| `DEFAULT_TIMEZONE` | | `Europe/Madrid` | Default timezone for new guilds |
| `DEFAULT_SUMMARY_HOUR` | | `9` | Default weekly summary hour for new guilds (0–23) |
| `DEV_GUILD_ID` | | — | Dev-only. Registers commands to one guild instantly (skips global 1h propagation) |

Per-guild settings (managed via `/clocked-setup config` from Discord):

- **Tracked channels** — one or more voice channels per server
- **Activity name** — label used in embeds
- **Locale** — `es` or `en`
- **Timezone** — any [IANA timezone](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones)
- **Summary hour** — hour (0–23) of the Monday weekly summary, in the guild's timezone

### Single-guild shortcut (optional)

If you're running the bot for just one server and don't want to use `/setup`, set these two env vars and the bot will seed its config automatically on first startup:

```
GUILD_ID=your_guild_id
VOICE_CHANNEL_IDS=channel_id_1,channel_id_2
```

Admins can still change the config from Discord after the initial seed.

## How it works

**Session tracking** uses a hybrid model:
- `voiceStateUpdate` events open and close sessions in real time
- A periodic poll (every `POLL_INTERVAL_MS`) reconciles actual channel state with the database, recovering sessions missed during bot downtime
- If a user moves between two tracked channels, the session in the first channel closes and a new one opens in the second

**Data** is stored in a local SQLite file (`sessions.db`) with these tables:
- `guild_configs` — per-server settings (channels, locale, timezone, summary hour, activity name)
- `sessions` — one row per session with `guild_id`, `started_at`, `ended_at`, `channel_id`, `duration_minutes`
- `snapshots` — raw poll results for auditing
- `opt_outs` — per-guild opt-out list

**Co-presence** is calculated at query time by joining sessions with overlapping time ranges within the same guild.

## Adding a language

Create `src/i18n/xx.js` following the same structure as `es.js` or `en.js`, then add it to the `locales` object in `src/i18n/index.js`.

## Author

Made by [@sergi_rz](https://x.com/sergi_rz)

## License

MIT
