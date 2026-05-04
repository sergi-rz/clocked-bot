import { SlashCommandBuilder, EmbedBuilder, MessageFlags, ChannelType } from 'discord.js';
import { getRanking, getRankingBetween, getGuildConfig }                 from '../db.js';
import { PREFIX, periodRange, fmt, displayFor }                          from '../utils.js';
import { getT, DEFAULT_LOCALE }                                          from '../i18n/index.js';

const medals = ['🥇', '🥈', '🥉'];

function formatRows(rows) {
  return rows.map((r, i) => {
    const prefix = medals[i] ?? `**${i + 1}.**`;
    return `${prefix} **${r.username}** — ${fmt(r.total_minutes)} (${r.session_count} ses.)`;
  }).join('\n');
}

async function leaderAvatar(guild, userId) {
  if (!guild || !userId) return null;
  try {
    const member = await guild.members.fetch(userId);
    return member.displayAvatarURL({ size: 256 });
  } catch {
    return null;
  }
}

// Slash commands are registered once globally, so their names and descriptions
// are taken from DEFAULT_LOCALE + DEFAULT_ACTIVITY_NAME. The per-guild locale and
// activity name only apply at execution time (in the embed contents).
const bootT        = getT(DEFAULT_LOCALE);
const bootActivity = process.env.DEFAULT_ACTIVITY_NAME ?? process.env.ACTIVITY_NAME ?? 'Deep Work';

export const data = new SlashCommandBuilder()
  .setName(`${PREFIX}-ranking`)
  .setDescription(bootT.cmd.ranking.desc(bootActivity.toLowerCase()))
  .setDMPermission(false)
  .addStringOption(opt =>
    opt.setName('period')
       .setDescription(bootT.opts.period)
       .addChoices(...bootT.periods.choices)
  )
  .addChannelOption(opt =>
    opt.setName('channel')
       .setDescription(bootT.opts.channel)
       .addChannelTypes(ChannelType.GuildVoice)
  )
  .addIntegerOption(opt =>
    opt.setName('limit')
       .setDescription(bootT.opts.limit)
       .setMinValue(3)
       .setMaxValue(25)
  )
  .addBooleanOption(opt =>
    opt.setName('public')
       .setDescription(bootT.opts.public)
  );

export async function execute(interaction) {
  const cfg = getGuildConfig(interaction.guildId);
  const { t, activity } = displayFor(cfg);
  const channels = cfg?.channel_ids ?? [];

  const key      = interaction.options.getString('period') ?? 'global';
  const channel  = interaction.options.getChannel('channel');
  const limit    = interaction.options.getInteger('limit') ?? 10;
  const isPublic = interaction.options.getBoolean('public') ?? true;
  const { since, until } = periodRange(key);
  const label    = t.periods.labels[key];
  const replyFlags = isPublic ? undefined : MessageFlags.Ephemeral;

  // Closed periods (last_week / last_month) use a strict window over completed
  // sessions only; open periods include the live estimate of currently-open ones.
  const rank = (channelId) => until !== null
    ? getRankingBetween(interaction.guildId, since, until, channelId, limit)
    : getRanking(interaction.guildId, since, channelId, limit);

  if (channel || channels.length <= 1) {
    const rows = rank(channel?.id ?? null);

    if (!rows.length) {
      return interaction.reply({ content: t.cmd.ranking.noData(label), flags: MessageFlags.Ephemeral });
    }

    const title = channel
      ? `${t.cmd.ranking.title(activity, label)} — #${channel.name}`
      : t.cmd.ranking.title(activity, label);

    const thumb = await leaderAvatar(interaction.guild, rows[0].user_id);
    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(formatRows(rows))
      .setColor(0x5865f2)
      .setTimestamp();
    if (thumb) embed.setThumbnail(thumb);

    return interaction.reply({ embeds: [embed], flags: replyFlags });
  }

  // Multiple channels, no filter: show global aggregate + one section per channel.
  const sections = [];

  const globalRows = rank(null);
  if (globalRows.length) {
    sections.push(`**🌐 Global**\n${formatRows(globalRows)}`);
  }

  for (const channelId of channels) {
    const ch   = interaction.client.channels.cache.get(channelId);
    const rows = rank(channelId);
    if (rows.length) {
      sections.push(`**#${ch?.name ?? channelId}**\n${formatRows(rows)}`);
    }
  }

  if (!sections.length) {
    return interaction.reply({ content: t.cmd.ranking.noData(label), flags: MessageFlags.Ephemeral });
  }

  const thumb = await leaderAvatar(interaction.guild, globalRows[0]?.user_id);
  const embed = new EmbedBuilder()
    .setTitle(t.cmd.ranking.title(activity, label))
    .setDescription(sections.join('\n\n'))
    .setColor(0x5865f2)
    .setTimestamp();
  if (thumb) embed.setThumbnail(thumb);

  await interaction.reply({ embeds: [embed], flags: replyFlags });
}
