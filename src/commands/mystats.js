import { SlashCommandBuilder, EmbedBuilder, MessageFlags, ChannelType } from 'discord.js';
import { getUserStats, getUserStatsBetween, getUserDays, isOptedOut, getGuildConfig } from '../db.js';
import { PREFIX, fmt, computeStreaks, displayFor, periodRange }                        from '../utils.js';
import { getT, DEFAULT_LOCALE }                                                        from '../i18n/index.js';

const bootT        = getT(DEFAULT_LOCALE);
const bootActivity = process.env.DEFAULT_ACTIVITY_NAME ?? process.env.ACTIVITY_NAME ?? 'Deep Work';

export const data = new SlashCommandBuilder()
  .setName(`${PREFIX}-mystats`)
  .setDescription(bootT.cmd.mystats.desc(bootActivity.toLowerCase()))
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
  .addBooleanOption(opt =>
    opt.setName('public')
       .setDescription(bootT.opts.public)
  );

export async function execute(interaction) {
  const cfg       = getGuildConfig(interaction.guildId);
  const { t, activity } = displayFor(cfg);
  const userId    = interaction.user.id;
  const channel   = interaction.options.getChannel('channel');
  const key       = interaction.options.getString('period') ?? 'global';
  const isPublic  = interaction.options.getBoolean('public') ?? false;
  const { since, until } = periodRange(key);
  const label     = t.periods.labels[key];
  const replyFlags = isPublic ? undefined : MessageFlags.Ephemeral;

  if (isOptedOut(interaction.guildId, userId)) {
    return interaction.reply({ content: t.cmd.mystats.optedOut(PREFIX), flags: MessageFlags.Ephemeral });
  }

  const stats = until !== null
    ? getUserStatsBetween(interaction.guildId, userId, since, until, channel?.id ?? null)
    : getUserStats(interaction.guildId, userId, channel?.id ?? null, since);

  if (!stats?.session_count) {
    return interaction.reply({ content: t.cmd.mystats.noData, flags: MessageFlags.Ephemeral });
  }

  const m = t.cmd.mystats;
  const title = channel
    ? `${m.title(activity.toLowerCase(), interaction.user.username)} — #${channel.name}`
    : m.title(activity.toLowerCase(), interaction.user.username);

  const fields = [
    { name: m.fTotal,    value: fmt(stats.total_minutes),   inline: true },
    { name: m.fSessions, value: `${stats.session_count}`,   inline: true },
    { name: m.fAvg,      value: fmt(stats.avg_minutes),     inline: true },
    { name: m.fLongest,  value: fmt(stats.longest_session), inline: true },
  ];

  // Streaks are a lifetime metric — only meaningful for the unfiltered global view.
  if (key === 'global') {
    const days              = getUserDays(interaction.guildId, userId, channel?.id ?? null);
    const { current, best } = computeStreaks(days);
    fields.push(
      { name: m.fStreak,     value: `${current} ${m.days}`, inline: true },
      { name: m.fBestStreak, value: `${best} ${m.days}`,    inline: true },
    );
  }

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setThumbnail(interaction.user.displayAvatarURL({ size: 256 }))
    .addFields(...fields)
    .setFooter({ text: label })
    .setColor(0x57f287)
    .setTimestamp();

  await interaction.reply({ embeds: [embed], flags: replyFlags });
}
