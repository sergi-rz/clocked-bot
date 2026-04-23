import { SlashCommandBuilder, EmbedBuilder, MessageFlags, ChannelType } from 'discord.js';
import { getRanking }                                                    from '../db.js';
import { PREFIX, ACTIVITY, CHANNELS, periodStart, fmt }                  from '../utils.js';
import { t }                                                             from '../i18n/index.js';

const medals = ['🥇', '🥈', '🥉'];

function formatRows(rows) {
  return rows.map((r, i) => {
    const prefix = medals[i] ?? `**${i + 1}.**`;
    return `${prefix} **${r.username}** — ${fmt(r.total_minutes)} (${r.session_count} ses.)`;
  }).join('\n');
}

export const data = new SlashCommandBuilder()
  .setName(`${PREFIX}-ranking`)
  .setDescription(t.cmd.ranking.desc(ACTIVITY.toLowerCase()))
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
  const key     = interaction.options.getString('period') ?? 'global';
  const channel = interaction.options.getChannel('channel');
  const since   = periodStart(key);
  const label   = t.periods.labels[key];

  // Single channel selected or only one channel configured: simple view.
  if (channel || CHANNELS.length <= 1) {
    const rows = getRanking(since, channel?.id ?? null);

    if (!rows.length) {
      return interaction.reply({ content: t.cmd.ranking.noData(label), flags: MessageFlags.Ephemeral });
    }

    const title = channel
      ? `${t.cmd.ranking.title(ACTIVITY, label)} — #${channel.name}`
      : t.cmd.ranking.title(ACTIVITY, label);

    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle(title)
          .setDescription(formatRows(rows))
          .setColor(0x5865f2)
          .setTimestamp(),
      ],
    });
  }

  // Multiple channels, no filter: show global aggregate + one section per channel.
  const sections = [];

  const globalRows = getRanking(since);
  if (globalRows.length) {
    sections.push(`**🌐 Global**\n${formatRows(globalRows)}`);
  }

  for (const channelId of CHANNELS) {
    const ch   = interaction.client.channels.cache.get(channelId);
    const rows = getRanking(since, channelId);
    if (rows.length) {
      sections.push(`**#${ch?.name ?? channelId}**\n${formatRows(rows)}`);
    }
  }

  if (!sections.length) {
    return interaction.reply({ content: t.cmd.ranking.noData(label), flags: MessageFlags.Ephemeral });
  }

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setTitle(t.cmd.ranking.title(ACTIVITY, label))
        .setDescription(sections.join('\n\n'))
        .setColor(0x5865f2)
        .setTimestamp(),
    ],
  });
}
