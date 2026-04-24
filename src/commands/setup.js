import {
  SlashCommandBuilder, EmbedBuilder, MessageFlags,
  ChannelType, PermissionFlagsBits,
} from 'discord.js';
import {
  ensureGuildConfig, getGuildConfig, setGuildChannels, updateGuildField,
} from '../db.js';
import { PREFIX, DEFAULTS, displayFor } from '../utils.js';
import { scheduleGuild }                from '../scheduler.js';
import { getT, DEFAULT_LOCALE }         from '../i18n/index.js';

const bootT = getT(DEFAULT_LOCALE);

export const data = new SlashCommandBuilder()
  .setName(`${PREFIX}-setup`)
  .setDescription(bootT.cmd.setup.desc)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false)
  .addSubcommand(sc =>
    sc.setName('add')
      .setDescription(bootT.cmd.setup.subAdd)
      .addChannelOption(o =>
        o.setName('channel')
         .setDescription(bootT.cmd.setup.optChannel)
         .addChannelTypes(ChannelType.GuildVoice)
         .setRequired(true))
  )
  .addSubcommand(sc =>
    sc.setName('remove')
      .setDescription(bootT.cmd.setup.subRemove)
      .addChannelOption(o =>
        o.setName('channel')
         .setDescription(bootT.cmd.setup.optChannel)
         .addChannelTypes(ChannelType.GuildVoice)
         .setRequired(true))
  )
  .addSubcommand(sc =>
    sc.setName('list')
      .setDescription(bootT.cmd.setup.subList)
  )
  .addSubcommand(sc =>
    sc.setName('config')
      .setDescription(bootT.cmd.setup.subConfig)
      .addStringOption(o =>
        o.setName('activity_name').setDescription(bootT.cmd.setup.optActivityName).setMaxLength(32))
      .addStringOption(o =>
        o.setName('locale').setDescription(bootT.cmd.setup.optLocale)
         .addChoices({ name: 'Español', value: 'es' }, { name: 'English', value: 'en' }))
      .addStringOption(o =>
        o.setName('timezone').setDescription(bootT.cmd.setup.optTimezone))
      .addIntegerOption(o =>
        o.setName('summary_hour').setDescription(bootT.cmd.setup.optSummaryHour)
         .setMinValue(0).setMaxValue(23))
  );

function isValidTimezone(tz) {
  try { new Intl.DateTimeFormat(undefined, { timeZone: tz }); return true; }
  catch { return false; }
}

// Create the config row the first time /setup is used. After this, the guild
// is fully registered and the scheduler/poller pick it up.
function getOrCreateConfig(guildId) {
  let cfg = getGuildConfig(guildId);
  if (cfg) return cfg;
  return ensureGuildConfig(guildId, {
    channel_ids:   [],
    activity_name: DEFAULTS.activity_name,
    locale:        DEFAULTS.locale,
    timezone:      DEFAULTS.timezone,
    summary_hour:  DEFAULTS.summary_hour,
  });
}

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guildId;
  const cfg = getOrCreateConfig(guildId);
  const { t } = displayFor(cfg);
  const s = t.cmd.setup;

  if (sub === 'add') {
    const ch = interaction.options.getChannel('channel', true);
    const channels = cfg.channel_ids;
    if (channels.includes(ch.id)) {
      return interaction.reply({ content: s.alreadyAdded(`<#${ch.id}>`), flags: MessageFlags.Ephemeral });
    }
    setGuildChannels(guildId, [...channels, ch.id]);
    scheduleGuild(interaction.client, guildId);
    return interaction.reply({ content: s.added(`<#${ch.id}>`), flags: MessageFlags.Ephemeral });
  }

  if (sub === 'remove') {
    const ch = interaction.options.getChannel('channel', true);
    const channels = cfg.channel_ids;
    if (!channels.includes(ch.id)) {
      return interaction.reply({ content: s.notTracked(`<#${ch.id}>`), flags: MessageFlags.Ephemeral });
    }
    setGuildChannels(guildId, channels.filter(id => id !== ch.id));
    return interaction.reply({ content: s.removed(`<#${ch.id}>`), flags: MessageFlags.Ephemeral });
  }

  if (sub === 'list') {
    const channels = cfg.channel_ids;
    if (!channels.length) {
      return interaction.reply({ content: s.noneTracked(PREFIX), flags: MessageFlags.Ephemeral });
    }
    const { activity, locale, timezone, summary_hour } = displayFor(cfg);
    const chLines = channels.map(id => `<#${id}>`).join(', ');

    const embed = new EmbedBuilder()
      .setTitle(s.listTitle)
      .addFields(
        { name: s.fChannels,    value: chLines },
        { name: s.fActivity,    value: activity,      inline: true },
        { name: s.fLocale,      value: locale,        inline: true },
        { name: s.fTimezone,    value: timezone,      inline: true },
        { name: s.fSummaryHour, value: `${summary_hour}:00`, inline: true },
      )
      .setColor(0x5865f2);

    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  if (sub === 'config') {
    const activity_name = interaction.options.getString('activity_name');
    const locale        = interaction.options.getString('locale');
    const timezone      = interaction.options.getString('timezone');
    const summary_hour  = interaction.options.getInteger('summary_hour');

    if (activity_name === null && locale === null && timezone === null && summary_hour === null) {
      return interaction.reply({ content: s.noChanges, flags: MessageFlags.Ephemeral });
    }

    if (timezone !== null && !isValidTimezone(timezone)) {
      return interaction.reply({ content: s.invalidTimezone(timezone), flags: MessageFlags.Ephemeral });
    }

    if (activity_name !== null) updateGuildField(guildId, 'activity_name', activity_name);
    if (locale        !== null) updateGuildField(guildId, 'locale', locale);
    if (timezone      !== null) updateGuildField(guildId, 'timezone', timezone);
    if (summary_hour  !== null) updateGuildField(guildId, 'summary_hour', summary_hour);

    // Re-schedule in case timezone or summary_hour changed.
    if (timezone !== null || summary_hour !== null) {
      scheduleGuild(interaction.client, guildId);
    }

    return interaction.reply({ content: s.configUpdated, flags: MessageFlags.Ephemeral });
  }
}
