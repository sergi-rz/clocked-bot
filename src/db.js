import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('sessions.db');

// MIN_SESSION_MINUTES is read once at startup and interpolated directly into SQL
// rather than passed as a query parameter, since it never changes while the bot runs.
const MIN = Number(process.env.MIN_SESSION_MINUTES ?? 5);

// WAL (Write-Ahead Logging) allows reads and writes to happen concurrently without
// blocking each other — important because polling and real-time events can fire at the same time.
db.exec('PRAGMA journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS snapshots (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    captured_at INTEGER NOT NULL,  -- Unix timestamp of the poll
    user_id     TEXT NOT NULL,
    username    TEXT NOT NULL,
    channel_id  TEXT NOT NULL DEFAULT ''
  );

  -- Each row represents one continuous stay in a voice channel.
  -- While the user is still connected, ended_at is NULL (open session).
  -- duration_minutes is calculated and stored when the session closes.
  CREATE TABLE IF NOT EXISTS sessions (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id          TEXT NOT NULL,
    username         TEXT NOT NULL,
    channel_id       TEXT NOT NULL DEFAULT '',
    started_at       INTEGER NOT NULL,  -- Unix timestamp
    ended_at         INTEGER,           -- NULL while session is active
    duration_minutes INTEGER
  );

  -- Users who have opted out are stored here. Their historical data is kept
  -- but excluded from all rankings and stats queries.
  CREATE TABLE IF NOT EXISTS opt_outs (
    user_id      TEXT PRIMARY KEY,
    opted_out_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_user    ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_channel ON sessions(channel_id);
  -- Partial index: only indexes the rows we care about for open-session lookups.
  CREATE INDEX IF NOT EXISTS idx_sessions_open    ON sessions(ended_at) WHERE ended_at IS NULL;
  CREATE INDEX IF NOT EXISTS idx_snapshots_user   ON snapshots(user_id, captured_at);
`);

// ── helpers ───────────────────────────────────────────────────────────────────

function ts() { return Math.floor(Date.now() / 1000); }

// SQL expression to calculate the running duration of an open session in minutes.
const NOW_SQL = `CAST(strftime('%s','now') AS INTEGER)`;

// ── session management ────────────────────────────────────────────────────────

// Check for an existing open session before inserting — prevents duplicates
// if both the real-time event and the reconciliation poll fire close together.
const _hasOpen = db.prepare(
  `SELECT 1 FROM sessions WHERE user_id = ? AND channel_id = ? AND ended_at IS NULL LIMIT 1`
);
const _open = db.prepare(
  `INSERT INTO sessions (user_id, username, channel_id, started_at) VALUES (?, ?, ?, ?)`
);
// Calculates duration at close time so we don't have to recompute it on every read.
// Minimum 1 minute to avoid zero-duration sessions from rounding.
const _close = db.prepare(`
  UPDATE sessions
  SET ended_at = ?,
      duration_minutes = MAX(1, ROUND((? - started_at) / 60.0))
  WHERE user_id = ? AND channel_id = ? AND ended_at IS NULL
`);
const _getOpen = db.prepare(`SELECT * FROM sessions WHERE ended_at IS NULL`);
const _getOpenByChannel = db.prepare(
  `SELECT * FROM sessions WHERE ended_at IS NULL AND channel_id = ?`
);
const _snap = db.prepare(
  `INSERT INTO snapshots (captured_at, user_id, username, channel_id) VALUES (?, ?, ?, ?)`
);

// Returns false if a session was already open (idempotent — safe to call twice).
export function openUserSession(userId, username, channelId, at = ts()) {
  if (_hasOpen.get(userId, channelId)) return false;
  _open.run(userId, username, channelId, at);
  return true;
}

export function closeUserSession(userId, channelId, at = ts()) {
  _close.run(at, at, userId, channelId);
}

export function saveSnapshot(userId, username, channelId, at = ts()) {
  _snap.run(at, userId, username, channelId);
}

// Pass a channelId to get only open sessions for that channel (used by the poller).
// Pass null to get all open sessions across channels (used by opt-out cleanup).
export function getOpenSessions(channelId = null) {
  return channelId ? _getOpenByChannel.all(channelId) : _getOpen.all();
}

// ── opt-out ───────────────────────────────────────────────────────────────────

const _isOptedOut   = db.prepare(`SELECT 1 FROM opt_outs WHERE user_id = ?`);
const _addOptOut    = db.prepare(`INSERT OR IGNORE INTO opt_outs (user_id, opted_out_at) VALUES (?, ?)`);
const _removeOptOut = db.prepare(`DELETE FROM opt_outs WHERE user_id = ?`);

export function isOptedOut(userId) {
  return !!_isOptedOut.get(userId);
}

// Toggles opt-out status. When opting out, any open sessions are closed immediately
// so no ghost session keeps accumulating time after the user has opted out.
export function toggleOptOut(userId) {
  if (isOptedOut(userId)) {
    _removeOptOut.run(userId);
    return false; // tracking re-enabled
  } else {
    _addOptOut.run(userId, ts());
    getOpenSessions().filter(s => s.user_id === userId)
      .forEach(s => closeUserSession(userId, s.channel_id));
    return true; // tracking disabled
  }
}

// ── rankings ──────────────────────────────────────────────────────────────────

function openDuration() {
  return `MAX(1, ROUND((${NOW_SQL} - started_at) / 60.0))`;
}

// Rankings use UNION ALL to include both closed sessions and the estimated duration
// of any currently open sessions, so users actively in the channel appear with
// their live time rather than being missing from the leaderboard.
function rankingSQL(channelFilter, timeFilter) {
  return `
    SELECT username, COUNT(*) AS session_count, SUM(duration_minutes) AS total_minutes
    FROM (
      SELECT user_id, username, duration_minutes FROM sessions
      WHERE ended_at IS NOT NULL AND duration_minutes >= ${MIN}
        ${timeFilter ? `AND ${timeFilter}` : ''}
        ${channelFilter ? `AND ${channelFilter}` : ''}
      UNION ALL
      SELECT user_id, username, ${openDuration()} FROM sessions
      WHERE ended_at IS NULL
        ${timeFilter ? `AND ${timeFilter}` : ''}
        ${channelFilter ? `AND ${channelFilter}` : ''}
    )
    WHERE user_id NOT IN (SELECT user_id FROM opt_outs)
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
  FROM sessions WHERE ended_at IS NOT NULL AND duration_minutes >= ${MIN}
    AND started_at >= ? AND started_at < ?
    AND user_id NOT IN (SELECT user_id FROM opt_outs)
  GROUP BY user_id ORDER BY total_minutes DESC LIMIT 10
`);
const _rankBetweenCh = db.prepare(`
  SELECT username, COUNT(*) AS session_count, SUM(duration_minutes) AS total_minutes
  FROM sessions WHERE ended_at IS NOT NULL AND duration_minutes >= ${MIN}
    AND started_at >= ? AND started_at < ?
    AND channel_id = ?
    AND user_id NOT IN (SELECT user_id FROM opt_outs)
  GROUP BY user_id ORDER BY total_minutes DESC LIMIT 10
`);

export function getRanking(since = 0, channelId = null) {
  if (channelId) {
    return since === 0
      ? _rankAllCh.all(channelId, channelId)
      : _rankFromCh.all(since, channelId, since, channelId);
  }
  // Pass since twice: once for closed sessions, once for open sessions in the UNION ALL.
  return since === 0 ? _rankAll.all() : _rankFrom.all(since, since);
}

export function getRankingBetween(since, until, channelId = null) {
  return channelId
    ? _rankBetweenCh.all(since, until, channelId)
    : _rankBetween.all(since, until);
}

// ── user stats ────────────────────────────────────────────────────────────────

// Same UNION ALL pattern as rankings: closed sessions + live estimate of open session.
function statsSQL(channelFilter) {
  return `
    SELECT
      COUNT(*)                           AS session_count,
      COALESCE(SUM(duration_minutes), 0) AS total_minutes,
      ROUND(AVG(duration_minutes))       AS avg_minutes,
      MAX(duration_minutes)              AS longest_session
    FROM (
      SELECT duration_minutes FROM sessions
      WHERE user_id = ? AND ended_at IS NOT NULL AND duration_minutes >= ${MIN}
        ${channelFilter ? `AND ${channelFilter}` : ''}
      UNION ALL
      SELECT ${openDuration()} FROM sessions
      WHERE user_id = ? AND ended_at IS NULL
        ${channelFilter ? `AND ${channelFilter}` : ''}
    )
  `;
}

const _stats   = db.prepare(statsSQL(null));
const _statsCh = db.prepare(statsSQL('channel_id = ?'));

export function getUserStats(userId, channelId = null) {
  if (channelId) return _statsCh.get(userId, channelId, userId, channelId);
  return _stats.get(userId, userId);
}

// ── streaks ───────────────────────────────────────────────────────────────────

const _days   = db.prepare(`
  SELECT DISTINCT date(started_at, 'unixepoch', 'localtime') AS day
  FROM sessions
  WHERE user_id = ? AND ended_at IS NOT NULL AND duration_minutes >= ${MIN}
  ORDER BY day
`);
const _daysCh = db.prepare(`
  SELECT DISTINCT date(started_at, 'unixepoch', 'localtime') AS day
  FROM sessions
  WHERE user_id = ? AND channel_id = ? AND ended_at IS NOT NULL AND duration_minutes >= ${MIN}
  ORDER BY day
`);

export function getUserDays(userId, channelId = null) {
  const rows = channelId ? _daysCh.all(userId, channelId) : _days.all(userId);
  return rows.map(r => r.day);
}

// ── co-presence ───────────────────────────────────────────────────────────────

// Self-join on sessions: for each pair of sessions that overlap in time,
// calculate the shared minutes as the intersection of their time ranges.
// MIN(ended) - MAX(started) gives the overlap duration for each pair,
// and SUM aggregates it across all session combinations.
function compSQL(channelFilter, timeFilter) {
  return `
    SELECT
      s2.user_id,
      s2.username,
      SUM((MIN(s1.ended_at, s2.ended_at) - MAX(s1.started_at, s2.started_at)) / 60) AS shared_minutes
    FROM sessions s1
    JOIN sessions s2
      ON  s2.user_id    != s1.user_id
      AND s2.started_at  < s1.ended_at   -- s2 started before s1 ended
      AND s2.ended_at    > s1.started_at  -- s2 ended after s1 started
      AND s2.ended_at   IS NOT NULL
      AND s2.duration_minutes >= ${MIN}
      AND s2.user_id NOT IN (SELECT user_id FROM opt_outs)
      ${channelFilter ? `AND s2.${channelFilter}` : ''}
    WHERE s1.user_id = ? AND s1.ended_at IS NOT NULL AND s1.duration_minutes >= ${MIN}
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

export function getCompanions(userId, since = 0, channelId = null) {
  if (channelId) {
    return since === 0
      ? _compAllCh.all(channelId, userId, channelId)
      : _compFromCh.all(channelId, userId, since, channelId);
  }
  return since === 0 ? _compAll.all(userId) : _compFrom.all(userId, since);
}

export default db;
