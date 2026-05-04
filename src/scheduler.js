import cron             from 'node-cron';
import { EmbedBuilder } from 'discord.js';
import { getRankingBetween, getGuildConfig, getAllActiveGuildConfigs } from './db.js';
import { displayFor, fmt, periodRange } from './utils.js';

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
}
