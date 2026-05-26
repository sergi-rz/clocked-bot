import cron             from 'node-cron';
import { EmbedBuilder } from 'discord.js';
import {
  getRankingBetween, getGuildConfig, getAllActiveGuildConfigs,
  getOpenSessions, setReminderTimestamps, setNextReminderAt,
} from './db.js';
import { displayFor, fmt, periodRange, nextReminderAt, REMINDER_RETRY_SECONDS } from './utils.js';

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
