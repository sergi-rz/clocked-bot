import { SlashCommandBuilder, EmbedBuilder, MessageFlags, ChannelType } from 'discord.js';
import { getUserStats, getUserDays, isOptedOut, getGuildConfig }         from '../db.js';
import { PREFIX, fmt, computeStreaks, displayFor }                        from '../utils.js';
import { getT, DEFAULT_LOCALE }                                           from '../i18n/index.js';

const bootT        = getT(DEFAULT_LOCALE);
const bootActivity = process.env.DEFAULT_ACTIVITY_NAME ?? process.env.ACTIVITY_NAME ?? 'Deep Work';

export const data = new SlashCommandBuilder()
  .setName(`${PREFIX}-mystats`)
  .setDescription(bootT.cmd.mystats.desc(bootActivity.toLowerCase()))
  .setDMPermission(false)
  .addChannelOption(opt =>
    opt.setName('channel')
       .setDescription(bootT.opts.channel)
       .addChannelTypes(ChannelType.GuildVoice)
  );

export async function execute(interaction) {
  const cfg       = getGuildConfig(interaction.guildId);
  const { t, activity } = displayFor(cfg);
  const userId    = interaction.user.id;
  const channel   = interaction.options.getChannel('channel');

  if (isOptedOut(interaction.guildId, userId)) {
    return interaction.reply({ content: t.cmd.mystats.optedOut(PREFIX), flags: MessageFlags.Ephemeral });
  }

  const stats = getUserStats(interaction.guildId, userId, channel?.id ?? null);

  if (!stats?.session_count) {
    return interaction.reply({ content: t.cmd.mystats.noData, flags: MessageFlags.Ephemeral });
  }

  const days              = getUserDays(interaction.guildId, userId, channel?.id ?? null);
  const { current, best } = computeStreaks(days);
  const m                 = t.cmd.mystats;

  const title = channel
    ? `${m.title(activity.toLowerCase(), interaction.user.username)} — #${channel.name}`
    : m.title(activity.toLowerCase(), interaction.user.username);

  const embed = new EmbedBuilder()
    .setTitle(title)
    .addFields(
      { name: m.fTotal,      value: fmt(stats.total_minutes),   inline: true },
      { name: m.fSessions,   value: `${stats.session_count}`,   inline: true },
      { name: m.fAvg,        value: fmt(stats.avg_minutes),     inline: true },
      { name: m.fLongest,    value: fmt(stats.longest_session), inline: true },
      { name: m.fStreak,     value: `${current} ${m.days}`,     inline: true },
      { name: m.fBestStreak, value: `${best} ${m.days}`,        inline: true },
    )
    .setColor(0x57f287)
    .setTimestamp();

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
