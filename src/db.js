import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('sessions.db');

// MIN_SESSION_MINUTES is read once at startup and interpolated directly into SQL
// rather than passed as a query parameter, since it never changes while the bot runs.
const MIN = Number(process.env.MIN_SESSION_MINUTES ?? 5);

// WAL (Write-Ahead Logging) allows reads and writes to happen concurrently without
// blocking each other — important because polling and real-time events can fire at the same time.
db.exec('PRAGMA journal_mode = WAL');

db.exec(`
  -- Per-guild runtime configuration. Channels, locale, timezone, etc. live here
  -- rather than in env vars so the bot can serve many guilds from a single instance.
  CREATE TABLE IF NOT EXISTS guild_configs (
    guild_id      TEXT PRIMARY KEY,
    channel_ids   TEXT    NOT NULL DEFAULT '[]',  -- JSON array of voice channel IDs
    activity_name TEXT,
    locale        TEXT,
    timezone      TEXT,
    summary_hour  INTEGER,
    active        INTEGER NOT NULL DEFAULT 1,
    created_at    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS snapshots (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id    TEXT    NOT NULL,
    captured_at INTEGER NOT NULL,
    user_id     TEXT    NOT NULL,
    username    TEXT    NOT NULL,
    channel_id  TEXT    NOT NULL
  );

  -- Each row represents one continuous stay in a voice channel.
  -- While the user is still connected, ended_at is NULL (open session).
  -- duration_minutes is calculated and stored when the session closes.
  CREATE TABLE IF NOT EXISTS sessions (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id         TEXT    NOT NULL,
    user_id          TEXT    NOT NULL,
    username         TEXT    NOT NULL,
    channel_id       TEXT    NOT NULL,
    started_at       INTEGER NOT NULL,
    ended_at         INTEGER,
    duration_minutes INTEGER
  );

  -- Opt-out is per-guild: a user can participate in one server and not in another.
  CREATE TABLE IF NOT EXISTS opt_outs (
    guild_id     TEXT    NOT NULL,
    user_id      TEXT    NOT NULL,
    opted_out_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id)
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_guild_user    ON sessions(guild_id, user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_guild_channel ON sessions(guild_id, channel_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_open          ON sessions(ended_at) WHERE ended_at IS NULL;
  CREATE INDEX IF NOT EXISTS idx_snapshots_guild_user   ON snapshots(guild_id, user_id, captured_at);
`);

// ── helpers ───────────────────────────────────────────────────────────────────

function ts() { return Math.floor(Date.now() / 1000); }

const NOW_SQL = `CAST(strftime('%s','now') AS INTEGER)`;

// ── guild config ──────────────────────────────────────────────────────────────

const _getGuildConfig = db.prepare(`SELECT * FROM guild_configs WHERE guild_id = ?`);
const _allActiveGuildConfigs = db.prepare(`SELECT * FROM guild_configs WHERE active = 1`);
const _insertGuildConfig = db.prepare(`
  INSERT INTO guild_configs (guild_id, channel_ids, activity_name, locale, timezone, summary_hour, active, created_at)
  VALUES (?, ?, ?, ?, ?, ?, 1, ?)
  ON CONFLICT(guild_id) DO NOTHING
`);
const _setGuildChannels  = db.prepare(`UPDATE guild_configs SET channel_ids = ? WHERE guild_id = ?`);
const _setGuildField     = {
  activity_name: db.prepare(`UPDATE guild_configs SET activity_name = ? WHERE guild_id = ?`),
  locale:        db.prepare(`UPDATE guild_configs SET locale = ?        WHERE guild_id = ?`),
  timezone:      db.prepare(`UPDATE guild_configs SET timezone = ?      WHERE guild_id = ?`),
  summary_hour:  db.prepare(`UPDATE guild_configs SET summary_hour = ?  WHERE guild_id = ?`),
  active:        db.prepare(`UPDATE guild_configs SET active = ?        WHERE guild_id = ?`),
};

function hydrateConfig(row) {
  if (!row) return null;
  return { ...row, channel_ids: JSON.parse(row.channel_ids || '[]') };
}

export function getGuildConfig(guildId) {
  return hydrateConfig(_getGuildConfig.get(guildId));
}

export function getAllActiveGuildConfigs() {
  return _allActiveGuildConfigs.all().map(hydrateConfig);
}

// Create a config row if none exists. Used both by the self-hosted env-var seed
// (on startup) and by /setup when the admin first registers a channel.
export function ensureGuildConfig(guildId, defaults = {}) {
  _insertGuildConfig.run(
    guildId,
    JSON.stringify(defaults.channel_ids ?? []),
    defaults.activity_name ?? null,
    defaults.locale        ?? null,
    defaults.timezone      ?? null,
    defaults.summary_hour  ?? null,
    ts(),
  );
  return getGuildConfig(guildId);
}

export function setGuildChannels(guildId, channelIds) {
  _setGuildChannels.run(JSON.stringify(channelIds), guildId);
}

export function updateGuildField(guildId, field, value) {
  const stmt = _setGuildField[field];
  if (!stmt) throw new Error(`Unknown guild field: ${field}`);
  stmt.run(value, guildId);
}

// ── session management ────────────────────────────────────────────────────────

// Check for an existing open session before inserting — prevents duplicates
// if both the real-time event and the reconciliation poll fire close together.
const _hasOpen = db.prepare(
  `SELECT 1 FROM sessions WHERE guild_id = ? AND user_id = ? AND channel_id = ? AND ended_at IS NULL LIMIT 1`
);
const _open = db.prepare(
  `INSERT INTO sessions (guild_id, user_id, username, channel_id, started_at) VALUES (?, ?, ?, ?, ?)`
);
const _close = db.prepare(`
  UPDATE sessions
  SET ended_at = ?,
      duration_minutes = MAX(1, ROUND((? - started_at) / 60.0))
  WHERE guild_id = ? AND user_id = ? AND channel_id = ? AND ended_at IS NULL
`);
const _getOpenByGuild        = db.prepare(`SELECT * FROM sessions WHERE ended_at IS NULL AND guild_id = ?`);
const _getOpenByGuildChannel = db.prepare(
  `SELECT * FROM sessions WHERE ended_at IS NULL AND guild_id = ? AND channel_id = ?`
);
const _snap = db.prepare(
  `INSERT INTO snapshots (guild_id, captured_at, user_id, username, channel_id) VALUES (?, ?, ?, ?, ?)`
);

export function openUserSession(guildId, userId, username, channelId, at = ts()) {
  if (_hasOpen.get(guildId, userId, channelId)) return false;
  _open.run(guildId, userId, username, channelId, at);
  return true;
}

export function closeUserSession(guildId, userId, channelId, at = ts()) {
  _close.run(at, at, guildId, userId, channelId);
}

export function saveSnapshot(guildId, userId, username, channelId, at = ts()) {
  _snap.run(guildId, at, userId, username, channelId);
}

// Scoped to one guild. Pass channelId to narrow further (used by the poller per-channel).
export function getOpenSessions(guildId, channelId = null) {
  return channelId
    ? _getOpenByGuildChannel.all(guildId, channelId)
    : _getOpenByGuild.all(guildId);
}

// ── opt-out ───────────────────────────────────────────────────────────────────

const _isOptedOut   = db.prepare(`SELECT 1 FROM opt_outs WHERE guild_id = ? AND user_id = ?`);
const _addOptOut    = db.prepare(`INSERT OR IGNORE INTO opt_outs (guild_id, user_id, opted_out_at) VALUES (?, ?, ?)`);
const _removeOptOut = db.prepare(`DELETE FROM opt_outs WHERE guild_id = ? AND user_id = ?`);

export function isOptedOut(guildId, userId) {
  return !!_isOptedOut.get(guildId, userId);
}

// Toggles opt-out status for a user within a guild. When opting out, any open
// sessions in this guild are closed immediately so no ghost session keeps
// accumulating time after the user has opted out.
export function toggleOptOut(guildId, userId) {
  if (isOptedOut(guildId, userId)) {
    _removeOptOut.run(guildId, userId);
    return false; // tracking re-enabled
  } else {
    _addOptOut.run(guildId, userId, ts());
    getOpenSessions(guildId).filter(s => s.user_id === userId)
      .forEach(s => closeUserSession(guildId, userId, s.channel_id));
    return true; // tracking disabled
  }
}

// ── rankings ──────────────────────────────────────────────────────────────────

function openDuration() {
  return `MAX(1, ROUND((${NOW_SQL} - started_at) / 60.0))`;
}

function rankingSQL(channelFilter, timeFilter) {
  return `
    SELECT username, COUNT(*) AS session_count, SUM(duration_minutes) AS total_minutes
    FROM (
      SELECT user_id, username, duration_minutes FROM sessions
      WHERE guild_id = ? AND ended_at IS NOT NULL AND duration_minutes >= ${MIN}
        ${timeFilter ? `AND ${timeFilter}` : ''}
        ${channelFilter ? `AND ${channelFilter}` : ''}
      UNION ALL
      SELECT user_id, username, ${openDuration()} FROM sessions
      WHERE guild_id = ? AND ended_at IS NULL
        ${timeFilter ? `AND ${timeFilter}` : ''}
        ${channelFilter ? `AND ${channelFilter}` : ''}
    )
    WHERE user_id NOT IN (SELECT user_id FROM opt_outs WHERE guild_id = ?)
    GROUP BY user_id ORDER BY total_minutes DESC LIMIT 10
  `;
}

const _rankAll    = db.prepare(rankingSQL(null, null));
const _rankAllCh  = db.prepare(rankingSQL('channel_id = ?', null));
const _rankFrom   = db.prepare(rankingSQL(null, 'started_at >= ?'));
const _rankFromCh = db.prepare(rankingSQL('channel_id = ?', 'started_at >= ?'));

// Weekly summary uses a strict time window (Mon–Sun), so it doesn't include
// the current open session — that belongs to this week, not last week.
const _rankBetween   = db.prepare(`
  SELECT username, COUNT(*) AS session_count, SUM(duration_minutes) AS total_minutes
  FROM sessions WHERE guild_id = ? AND ended_at IS NOT NULL AND duration_minutes >= ${MIN}
    AND started_at >= ? AND started_at < ?
    AND user_id NOT IN (SELECT user_id FROM opt_outs WHERE guild_id = ?)
  GROUP BY user_id ORDER BY total_minutes DESC LIMIT 10
`);
const _rankBetweenCh = db.prepare(`
  SELECT username, COUNT(*) AS session_count, SUM(duration_minutes) AS total_minutes
  FROM sessions WHERE guild_id = ? AND ended_at IS NOT NULL AND duration_minutes >= ${MIN}
    AND started_at >= ? AND started_at < ?
    AND channel_id = ?
    AND user_id NOT IN (SELECT user_id FROM opt_outs WHERE guild_id = ?)
  GROUP BY user_id ORDER BY total_minutes DESC LIMIT 10
`);

export function getRanking(guildId, since = 0, channelId = null) {
  if (channelId) {
    return since === 0
      ? _rankAllCh.all(guildId, channelId, guildId, channelId, guildId)
      : _rankFromCh.all(guildId, since, channelId, guildId, since, channelId, guildId);
  }
  return since === 0
    ? _rankAll.all(guildId, guildId, guildId)
    : _rankFrom.all(guildId, since, guildId, since, guildId);
}

export function getRankingBetween(guildId, since, until, channelId = null) {
  return channelId
    ? _rankBetweenCh.all(guildId, since, until, channelId, guildId)
    : _rankBetween.all(guildId, since, until, guildId);
}

// ── user stats ────────────────────────────────────────────────────────────────

function statsSQL(channelFilter) {
  return `
    SELECT
      COUNT(*)                           AS session_count,
      COALESCE(SUM(duration_minutes), 0) AS total_minutes,
      ROUND(AVG(duration_minutes))       AS avg_minutes,
      MAX(duration_minutes)              AS longest_session
    FROM (
      SELECT duration_minutes FROM sessions
      WHERE guild_id = ? AND user_id = ? AND ended_at IS NOT NULL AND duration_minutes >= ${MIN}
        ${channelFilter ? `AND ${channelFilter}` : ''}
      UNION ALL
      SELECT ${openDuration()} FROM sessions
      WHERE guild_id = ? AND user_id = ? AND ended_at IS NULL
        ${channelFilter ? `AND ${channelFilter}` : ''}
    )
  `;
}

const _stats   = db.prepare(statsSQL(null));
const _statsCh = db.prepare(statsSQL('channel_id = ?'));

export function getUserStats(guildId, userId, channelId = null) {
  if (channelId) return _statsCh.get(guildId, userId, channelId, guildId, userId, channelId);
  return _stats.get(guildId, userId, guildId, userId);
}

// ── streaks ───────────────────────────────────────────────────────────────────

const _days   = db.prepare(`
  SELECT DISTINCT date(started_at, 'unixepoch', 'localtime') AS day
  FROM sessions
  WHERE guild_id = ? AND user_id = ? AND ended_at IS NOT NULL AND duration_minutes >= ${MIN}
  ORDER BY day
`);
const _daysCh = db.prepare(`
  SELECT DISTINCT date(started_at, 'unixepoch', 'localtime') AS day
  FROM sessions
  WHERE guild_id = ? AND user_id = ? AND channel_id = ? AND ended_at IS NOT NULL AND duration_minutes >= ${MIN}
  ORDER BY day
`);

export function getUserDays(guildId, userId, channelId = null) {
  const rows = channelId ? _daysCh.all(guildId, userId, channelId) : _days.all(guildId, userId);
  return rows.map(r => r.day);
}

// ── co-presence ───────────────────────────────────────────────────────────────

function compSQL(channelFilter, timeFilter) {
  return `
    SELECT
      s2.user_id,
      s2.username,
      SUM((MIN(s1.ended_at, s2.ended_at) - MAX(s1.started_at, s2.started_at)) / 60) AS shared_minutes
    FROM sessions s1
    JOIN sessions s2
      ON  s2.guild_id    = s1.guild_id
      AND s2.user_id    != s1.user_id
      AND s2.started_at  < s1.ended_at
      AND s2.ended_at    > s1.started_at
      AND s2.ended_at   IS NOT NULL
      AND s2.duration_minutes >= ${MIN}
      AND s2.user_id NOT IN (SELECT user_id FROM opt_outs WHERE guild_id = s2.guild_id)
      ${channelFilter ? `AND s2.${channelFilter}` : ''}
    WHERE s1.guild_id = ? AND s1.user_id = ? AND s1.ended_at IS NOT NULL AND s1.duration_minutes >= ${MIN}
      ${timeFilter ? `AND s1.${timeFilter}` : ''}
      ${channelFilter ? `AND s1.${channelFilter}` : ''}
    GROUP BY s2.user_id
    ORDER BY shared_minutes DESC
    LIMIT 10
  `;
}

const _compAll    = db.prepare(compSQL(null, null));
const _compAllCh  = db.prepare(compSQL('channel_id = ?', null));
const _compFrom   = db.prepare(compSQL(null, 'started_at >= ?'));
const _compFromCh = db.prepare(compSQL('channel_id = ?', 'started_at >= ?'));

export function getCompanions(guildId, userId, since = 0, channelId = null) {
  if (channelId) {
    return since === 0
      ? _compAllCh.all(channelId, guildId, userId, channelId)
      : _compFromCh.all(channelId, guildId, userId, since, channelId);
  }
  return since === 0
    ? _compAll.all(guildId, userId)
    : _compFrom.all(guildId, userId, since);
}

export default db;
