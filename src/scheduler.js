import cron             from 'node-cron';
import { EmbedBuilder } from 'discord.js';
import {
  getRankingBetween, getGuildConfig, getAllActiveGuildConfigs,
  getOpenSessions, setReminderTimestamps, setNextReminderAt,
  getPendingBirthdays, markBirthdayGreeted,
  isOptedOut, getUserStatsBetween, getCompanionsBetween,
} from './db.js';
import {
  displayFor, fmt, periodRange, nextReminderAt, REMINDER_RETRY_SECONDS,
  localDateParts, BIRTHDAY_HOUR,
} from './utils.js';

async function postSummaryToChannel(client, guildId, channelId, since, until, { t, activity }) {
  const channel = client.channels.cache.get(channelId);
  if (!channel) {
    console.error(`[scheduler] Channel not found: ${guildId}/${channelId}`);
    return;
  }

  const rows = getRankingBetween(guildId, since, until, channelId);

  if (!rows.length) {
    await channel.send(t.scheduler.quiet(activity.toLowerCase()));
    return;
  }

  const medals   = ['🥇', '🥈', '🥉'];
  const lines    = rows.map((r, i) => {
    const prefix = medals[i] ?? `**${i + 1}.**`;
    return `${prefix} **${r.username}** — ${fmt(r.total_minutes)} (${r.session_count} ses.)`;
  });

  const dateOpts  = { day: 'numeric', month: 'short' };
  const weekStart = new Date(since * 1000).toLocaleDateString(t.dateLocale, dateOpts);
  const weekEnd   = new Date((until - 1) * 1000).toLocaleDateString(t.dateLocale, dateOpts);

  const embed = new EmbedBuilder()
    .setTitle(t.scheduler.title(activity))
    .setDescription(lines.join('\n'))
    .setFooter({ text: t.scheduler.footer(weekStart, weekEnd) })
    .setColor(0xeb459e)
    .setTimestamp();

  await channel.send({ embeds: [embed] });
}

export async function postWeeklySummaryForGuild(client, guildId) {
  const cfg = getGuildConfig(guildId);
  if (!cfg || !cfg.active || !cfg.channel_ids.length) return;

  const { since, until } = periodRange('last_week');
  const display = displayFor(cfg);

  for (const channelId of cfg.channel_ids) {
    await postSummaryToChannel(client, guildId, channelId, since, until, display);
  }
  console.log(`[scheduler] Weekly summary posted for guild ${guildId}`);
}

// Re-read config each fire so changes made via /setup take effect without restart.
const tasks = new Map();

export function scheduleGuild(client, guildId) {
  const cfg = getGuildConfig(guildId);
  if (!cfg || !cfg.active) {
    unscheduleGuild(guildId);
    return;
  }

  const old = tasks.get(guildId);
  if (old) old.stop();

  const { timezone, summary_hour } = displayFor(cfg);
  // node-cron@3 swallows promise rejections from the callback (emits an
  // unhandled `task-failed` event), so wrap to surface failures in the journal.
  const task = cron.schedule(
    `0 ${summary_hour} * * 1`,
    async () => {
      try {
        await postWeeklySummaryForGuild(client, guildId);
      } catch (err) {
        console.error(`[scheduler] Weekly summary failed for guild ${guildId}:`, err);
      }
    },
    { timezone },
  );
  tasks.set(guildId, task);
  console.log(`[scheduler] Guild ${guildId} scheduled — Mondays at ${summary_hour}:00 (${timezone})`);
}

export function unscheduleGuild(guildId) {
  const task = tasks.get(guildId);
  if (task) {
    task.stop();
    tasks.delete(guildId);
    console.log(`[scheduler] Guild ${guildId} unscheduled`);
  }
}

export function startScheduler(client) {
  for (const cfg of getAllActiveGuildConfigs()) {
    scheduleGuild(client, cfg.guild_id);
  }
  startRemindersTick(client);
  startBirthdaysTick(client);
}

// ── reminders ────────────────────────────────────────────────────────────────
//
// Single global tick every 5 minutes. For each active guild with reminders
// enabled, if it's time to fire AND there's someone in a tracked channel, post
// a random phrase to that channel's chat. If no one is around, defer briefly
// instead of burning the slot — we don't want to ping an empty room, but we
// also don't want to spam-check every tick the moment a user joins.
async function postReminderToChannel(client, channelId, phrase) {
  const channel = client.channels.cache.get(channelId);
  if (!channel) {
    console.error(`[reminders] Channel not found: ${channelId}`);
    return false;
  }
  try {
    await channel.send(phrase);
    return true;
  } catch (err) {
    console.error(`[reminders] Failed to post to ${channelId}:`, err.message);
    return false;
  }
}

async function tickReminders(client) {
  const now = Math.floor(Date.now() / 1000);

  for (const cfg of getAllActiveGuildConfigs()) {
    if (!cfg.reminders_enabled) continue;
    if (!cfg.channel_ids.length) continue;
    if (cfg.next_reminder_at && now < cfg.next_reminder_at) continue;

    const open = getOpenSessions(cfg.guild_id);
    if (!open.length) {
      // Nobody is connected. Defer the next check so we don't re-evaluate
      // every 5 minutes while the server is quiet, and so a user who joins
      // doesn't immediately trigger a reminder the second they connect.
      setNextReminderAt(cfg.guild_id, now + REMINDER_RETRY_SECONDS);
      continue;
    }

    const occupiedChannels = new Set(open.map(s => s.channel_id));
    const targets = cfg.channel_ids.filter(id => occupiedChannels.has(id));
    if (!targets.length) {
      setNextReminderAt(cfg.guild_id, now + REMINDER_RETRY_SECONDS);
      continue;
    }

    const { t } = displayFor(cfg);
    const phrase = t.reminders[Math.floor(Math.random() * t.reminders.length)];

    let posted = false;
    for (const channelId of targets) {
      // eslint-disable-next-line no-await-in-loop -- sequential is fine; ≤ a handful of channels per guild
      const ok = await postReminderToChannel(client, channelId, phrase);
      posted = posted || ok;
    }

    if (posted) {
      const next = nextReminderAt(now);
      setReminderTimestamps(cfg.guild_id, now, next);
      console.log(`[reminders] Fired for guild ${cfg.guild_id}; next at ${new Date(next * 1000).toISOString()}`);
    } else {
      setNextReminderAt(cfg.guild_id, now + REMINDER_RETRY_SECONDS);
    }
  }
}

export function startRemindersTick(client) {
  // Every 5 minutes. The actual cadence per guild is enforced by next_reminder_at,
  // not by the cron interval — this just decides how often we check.
  cron.schedule('*/5 * * * *', async () => {
    try {
      await tickReminders(client);
    } catch (err) {
      console.error('[reminders] Tick failed:', err);
    }
  });
  console.log('[reminders] Tick started (every 5 min)');
}

// ── birthdays ───────────────────────────────────────────────────────────────
//
// Single global tick every 15 minutes. For each active guild, once the local
// time (guild timezone) reaches BIRTHDAY_HOUR, greet everyone whose birthday is
// today and who hasn't been greeted this year. last_greeted_year makes it safe
// to tick repeatedly and to restart the bot mid-day: a missed 9:00 still fires
// on the next tick, and nobody is greeted twice.

// Personal touch: what the user did in the 365 days before today (a full year,
// whatever the date). Returns null when there's nothing worth saying or the user
// opted out of tracking.
const YEAR_SECONDS = 365 * 86_400;

function birthdayStatsLine(guildId, userId, { t, activity }) {
  if (isOptedOut(guildId, userId)) return null;

  const until = Math.floor(Date.now() / 1000);
  const since = until - YEAR_SECONDS;
  const stats = getUserStatsBetween(guildId, userId, since, until);
  if (!stats?.session_count) return null;

  const [buddy] = getCompanionsBetween(guildId, userId, since, until, null, 1);
  const line = t.birthdays.stats(fmt(stats.total_minutes), stats.session_count, activity);
  return buddy?.shared_minutes > 0
    ? `${line} ${t.birthdays.buddy(`<@${buddy.user_id}>`, fmt(buddy.shared_minutes))}`
    : line;
}

async function greetBirthday(client, cfg, channelId, row, display) {
  const { t } = display;
  const channel = client.channels.cache.get(channelId);
  if (!channel) {
    console.error(`[birthdays] Channel not found: ${cfg.guild_id}/${channelId}`);
    return false;
  }

  // Skip (and mark) users who already left the server — no point pinging a ghost.
  const guild = client.guilds.cache.get(cfg.guild_id);
  const member = await guild?.members.fetch(row.user_id).catch(() => null);
  if (!member) {
    console.log(`[birthdays] ${row.user_id} is no longer in guild ${cfg.guild_id}; skipping`);
    return true;
  }

  const phrases = t.birthdays.phrases;
  const phrase  = phrases[Math.floor(Math.random() * phrases.length)](`<@${row.user_id}>`);
  const stats   = birthdayStatsLine(cfg.guild_id, row.user_id, display);
  const content = stats ? `${phrase}\n${stats}` : phrase;
  try {
    // Only the birthday person is pinged; the buddy mention renders but stays silent.
    await channel.send({ content, allowedMentions: { users: [row.user_id] } });
    return true;
  } catch (err) {
    console.error(`[birthdays] Failed to post to ${channelId}:`, err.message);
    return false;
  }
}

export async function tickBirthdays(client) {
  for (const cfg of getAllActiveGuildConfigs()) {
    const channelId = cfg.birthday_channel_id ?? cfg.channel_ids[0];
    if (!channelId) continue;

    const display = displayFor(cfg);
    const { year, month, day, hour } = localDateParts(display.timezone);
    if (hour < BIRTHDAY_HOUR) continue;

    for (const row of getPendingBirthdays(cfg.guild_id, year, month, day)) {
      // eslint-disable-next-line no-await-in-loop -- sequential is fine; ≤ a handful per day
      const ok = await greetBirthday(client, cfg, channelId, row, display);
      if (ok) {
        markBirthdayGreeted(cfg.guild_id, row.user_id, year);
        console.log(`[birthdays] Greeted ${row.user_id} in guild ${cfg.guild_id}`);
      }
    }
  }
}

export function startBirthdaysTick(client) {
  cron.schedule('*/15 * * * *', async () => {
    try {
      await tickBirthdays(client);
    } catch (err) {
      console.error('[birthdays] Tick failed:', err);
    }
  });
  console.log(`[birthdays] Tick started (every 15 min, greets from ${BIRTHDAY_HOUR}:00 local)`);
}
