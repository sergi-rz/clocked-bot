import { SlashCommandBuilder, EmbedBuilder, MessageFlags, ChannelType } from 'discord.js';
import { getUserStats, getUserDays, isOptedOut }                         from '../db.js';
import { PREFIX, ACTIVITY, fmt, computeStreaks }                          from '../utils.js';
import { t }                                                              from '../i18n/index.js';

export const data = new SlashCommandBuilder()
  .setName(`${PREFIX}-mystats`)
  .setDescription(t.cmd.mystats.desc(ACTIVITY.toLowerCase()))
  .addChannelOption(opt =>
    opt.setName('channel')
       .setDescription(t.opts.channel)
       .addChannelTypes(ChannelType.GuildVoice)
  );

export async function execute(interaction) {
  const userId  = interaction.user.id;
  const channel = interaction.options.getChannel('channel');

  if (isOptedOut(userId)) {
    return interaction.reply({ content: t.cmd.mystats.optedOut(PREFIX), flags: MessageFlags.Ephemeral });
  }

  const stats = getUserStats(userId, channel?.id ?? null);

  if (!stats?.session_count) {
    return interaction.reply({ content: t.cmd.mystats.noData, flags: MessageFlags.Ephemeral });
  }

  const days              = getUserDays(userId, channel?.id ?? null);
  const { current, best } = computeStreaks(days);
  const m                 = t.cmd.mystats;

  const title = channel
    ? `${m.title(ACTIVITY.toLowerCase(), interaction.user.username)} — #${channel.name}`
    : m.title(ACTIVITY.toLowerCase(), interaction.user.username);

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
