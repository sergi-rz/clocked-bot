import { SlashCommandBuilder, EmbedBuilder, MessageFlags, ChannelType } from 'discord.js';
import { getCompanions, getCompanionsBetween, getGuildConfig }           from '../db.js';
import { PREFIX, periodRange, fmt, displayFor }                          from '../utils.js';
import { getT, DEFAULT_LOCALE }                                          from '../i18n/index.js';

const medals = ['🥇', '🥈', '🥉'];

const bootT        = getT(DEFAULT_LOCALE);
const bootActivity = process.env.DEFAULT_ACTIVITY_NAME ?? process.env.ACTIVITY_NAME ?? 'Deep Work';

function formatRows(rows, together) {
  return rows.map((r, i) => {
    const prefix = medals[i] ?? `**${i + 1}.**`;
    return `${prefix} **${r.username}** — ${fmt(r.shared_minutes)} ${together}`;
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

export const data = new SlashCommandBuilder()
  .setName(`${PREFIX}-buddies`)
  .setDescription(bootT.cmd.buddies.desc(bootActivity.toLowerCase()))
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

  const key     = interaction.options.getString('period') ?? 'global';
  const channel = interaction.options.getChannel('channel');
  const limit   = interaction.options.getInteger('limit') ?? 10;
  const isPublic = interaction.options.getBoolean('public') ?? false;
  const { since, until } = periodRange(key);
  const label   = t.periods.labels[key];
  const userId  = interaction.user.id;
  const together = t.cmd.buddies.together;
  const replyFlags = isPublic ? undefined : MessageFlags.Ephemeral;

  const buddies = (channelId) => until !== null
    ? getCompanionsBetween(interaction.guildId, userId, since, until, channelId, limit)
    : getCompanions(interaction.guildId, userId, since, channelId, limit);

  if (channel || channels.length <= 1) {
    const rows = buddies(channel?.id ?? null);

    if (!rows.length) {
      return interaction.reply({ content: t.cmd.buddies.noData(label), flags: MessageFlags.Ephemeral });
    }

    const title = channel
      ? `${t.cmd.buddies.title(activity.toLowerCase(), label)} — #${channel.name}`
      : t.cmd.buddies.title(activity.toLowerCase(), label);

    const thumb = await leaderAvatar(interaction.guild, rows[0].user_id);
    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(formatRows(rows, together))
      .setColor(0xfee75c)
      .setTimestamp();
    if (thumb) embed.setThumbnail(thumb);

    return interaction.reply({ embeds: [embed], flags: replyFlags });
  }

  // Multiple channels, no filter: show global aggregate + one section per channel.
  const sections = [];

  const globalRows = buddies(null);
  if (globalRows.length) {
    sections.push(`**🌐 Global**\n${formatRows(globalRows, together)}`);
  }

  for (const channelId of channels) {
    const ch   = interaction.client.channels.cache.get(channelId);
    const rows = buddies(channelId);
    if (rows.length) {
      sections.push(`**#${ch?.name ?? channelId}**\n${formatRows(rows, together)}`);
    }
  }

  if (!sections.length) {
    return interaction.reply({ content: t.cmd.buddies.noData(label), flags: MessageFlags.Ephemeral });
  }

  const thumb = await leaderAvatar(interaction.guild, globalRows[0]?.user_id);
  const embed = new EmbedBuilder()
    .setTitle(t.cmd.buddies.title(activity.toLowerCase(), label))
    .setDescription(sections.join('\n\n'))
    .setColor(0xfee75c)
    .setTimestamp();
  if (thumb) embed.setThumbnail(thumb);

  await interaction.reply({ embeds: [embed], flags: replyFlags });
}
