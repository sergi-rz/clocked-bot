import cron             from 'node-cron';
import { EmbedBuilder } from 'discord.js';
import { getRankingBetween } from './db.js';
import { ACTIVITY, CHANNELS, fmt } from './utils.js';
import { t }             from './i18n/index.js';

// Returns the Unix timestamps for the start and end of last week (Monday 00:00 → Sunday 23:59:59).
// When called on Monday, thisMonday is today, so lastMonday is exactly 7 days ago.
function lastWeekRange() {
  const now = new Date();

  // Find Monday of the current week at midnight.
  const thisMonday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  thisMonday.setDate(thisMonday.getDate() - ((thisMonday.getDay() + 6) % 7));

  // Last week started 7 days before this Monday.
  const lastMonday = new Date(thisMonday);
  lastMonday.setDate(thisMonday.getDate() - 7);

  return {
    since: Math.floor(lastMonday.getTime() / 1000),
    until: Math.floor(thisMonday.getTime() / 1000), // exclusive upper bound
  };
}

// Posts the weekly summary for a single channel to that channel's text chat.
// Each tracked channel gets its own independent summary.
async function postSummaryToChannel(client, channelId, since, until) {
  const channel = client.channels.cache.get(channelId);
  if (!channel) {
    console.error(`[scheduler] Channel not found: ${channelId}`);
    return;
  }

  const rows = getRankingBetween(since, until, channelId);

  if (!rows.length) {
    await channel.send(t.scheduler.quiet(ACTIVITY.toLowerCase()));
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
    .setTitle(t.scheduler.title(ACTIVITY))
    .setDescription(lines.join('\n'))
    .setFooter({ text: t.scheduler.footer(weekStart, weekEnd) })
    .setColor(0xeb459e)
    .setTimestamp();

  await channel.send({ embeds: [embed] });
}

export async function postWeeklySummary(client) {
  const { since, until } = lastWeekRange();
  for (const channelId of CHANNELS) {
    await postSummaryToChannel(client, channelId, since, until);
  }
  console.log('[scheduler] Weekly summary posted.');
}

export function startScheduler(client) {
  const hour     = process.env.SUMMARY_HOUR ?? '9';
  const timezone = process.env.TIMEZONE     ?? 'Europe/Madrid';
  cron.schedule(`0 ${hour} * * 1`, () => postWeeklySummary(client), { timezone });
  console.log(`[scheduler] Weekly summary scheduled — Mondays at ${hour}:00 (${timezone})`);
}
