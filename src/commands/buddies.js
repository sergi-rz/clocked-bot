import { SlashCommandBuilder, EmbedBuilder, MessageFlags, ChannelType } from 'discord.js';
import { getCompanions }                                                  from '../db.js';
import { PREFIX, ACTIVITY, CHANNELS, periodStart, fmt }                   from '../utils.js';
import { t }                                                              from '../i18n/index.js';

function formatRows(rows) {
  return rows.map((r, i) =>
    `**${i + 1}.** **${r.username}** — ${fmt(r.shared_minutes)} ${t.cmd.buddies.together}`
  ).join('\n');
}

export const data = new SlashCommandBuilder()
  .setName(`${PREFIX}-buddies`)
  .setDescription(t.cmd.buddies.desc(ACTIVITY.toLowerCase()))
  .addStringOption(opt =>
    opt.setName('period')
       .setDescription(t.opts.period)
       .addChoices(...t.periods.choices)
  )
  .addChannelOption(opt =>
    opt.setName('channel')
       .setDescription(t.opts.channel)
       .addChannelTypes(ChannelType.GuildVoice)
  );

export async function execute(interaction) {
  const key    = interaction.options.getString('period') ?? 'global';
  const channel = interaction.options.getChannel('channel');
  const since  = periodStart(key);
  const label  = t.periods.labels[key];
  const userId = interaction.user.id;

  // Single channel selected or only one channel configured: simple view.
  if (channel || CHANNELS.length <= 1) {
    const rows = getCompanions(userId, since, channel?.id ?? null);

    if (!rows.length) {
      return interaction.reply({ content: t.cmd.buddies.noData(label), flags: MessageFlags.Ephemeral });
    }

    const title = channel
      ? `${t.cmd.buddies.title(ACTIVITY.toLowerCase(), label)} — #${channel.name}`
      : t.cmd.buddies.title(ACTIVITY.toLowerCase(), label);

    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle(title)
          .setDescription(formatRows(rows))
          .setColor(0xfee75c)
          .setTimestamp(),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }

  // Multiple channels, no filter: show global aggregate + one section per channel.
  const sections = [];

  const globalRows = getCompanions(userId, since);
  if (globalRows.length) {
    sections.push(`**🌐 Global**\n${formatRows(globalRows)}`);
  }

  for (const channelId of CHANNELS) {
    const ch   = interaction.client.channels.cache.get(channelId);
    const rows = getCompanions(userId, since, channelId);
    if (rows.length) {
      sections.push(`**#${ch?.name ?? channelId}**\n${formatRows(rows)}`);
    }
  }

  if (!sections.length) {
    return interaction.reply({ content: t.cmd.buddies.noData(label), flags: MessageFlags.Ephemeral });
  }

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setTitle(t.cmd.buddies.title(ACTIVITY.toLowerCase(), label))
        .setDescription(sections.join('\n\n'))
        .setColor(0xfee75c)
        .setTimestamp(),
    ],
    flags: MessageFlags.Ephemeral,
  });
}
