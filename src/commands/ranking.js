import { SlashCommandBuilder, EmbedBuilder, MessageFlags, ChannelType } from 'discord.js';
import { getRanking, getGuildConfig }                                    from '../db.js';
import { PREFIX, periodStart, fmt, displayFor }                          from '../utils.js';
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
  );

export async function execute(interaction) {
  const cfg = getGuildConfig(interaction.guildId);
  const { t, activity } = displayFor(cfg);
  const channels = cfg?.channel_ids ?? [];

  const key      = interaction.options.getString('period') ?? 'global';
  const channel  = interaction.options.getChannel('channel');
  const limit    = interaction.options.getInteger('limit') ?? 10;
  const since    = periodStart(key);
  const label    = t.periods.labels[key];

  if (channel || channels.length <= 1) {
    const rows = getRanking(interaction.guildId, since, channel?.id ?? null, limit);

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

    return interaction.reply({ embeds: [embed] });
  }

  // Multiple channels, no filter: show global aggregate + one section per channel.
  const sections = [];

  const globalRows = getRanking(interaction.guildId, since, null, limit);
  if (globalRows.length) {
    sections.push(`**🌐 Global**\n${formatRows(globalRows)}`);
  }

  for (const channelId of channels) {
    const ch   = interaction.client.channels.cache.get(channelId);
    const rows = getRanking(interaction.guildId, since, channelId, limit);
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

  await interaction.reply({ embeds: [embed] });
}
