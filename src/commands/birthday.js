import { SlashCommandBuilder, EmbedBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import {
  getGuildConfig, setBirthday, getBirthday, removeBirthday, getGuildBirthdays,
} from '../db.js';
import { PREFIX, displayFor, localDateParts } from '../utils.js';
import { getT, DEFAULT_LOCALE }               from '../i18n/index.js';

const bootT = getT(DEFAULT_LOCALE);

const monthChoices = bootT.cmd.birthday.months.map((name, i) => ({ name, value: i + 1 }));

export const data = new SlashCommandBuilder()
  .setName(`${PREFIX}-birthday`)
  .setDescription(bootT.cmd.birthday.desc)
  .setDMPermission(false)
  .addSubcommand(sc =>
    sc.setName('set')
      .setDescription(bootT.cmd.birthday.subSet)
      .addIntegerOption(o =>
        o.setName('day').setDescription(bootT.cmd.birthday.optDay).setRequired(true)
         .setMinValue(1).setMaxValue(31))
      .addIntegerOption(o =>
        o.setName('month').setDescription(bootT.cmd.birthday.optMonth).setRequired(true)
         .addChoices(...monthChoices))
      .addUserOption(o =>
        o.setName('user').setDescription(bootT.cmd.birthday.optUser))
  )
  .addSubcommand(sc =>
    sc.setName('remove')
      .setDescription(bootT.cmd.birthday.subRemove)
      .addUserOption(o =>
        o.setName('user').setDescription(bootT.cmd.birthday.optUser))
  )
  .addSubcommand(sc =>
    sc.setName('list')
      .setDescription(bootT.cmd.birthday.subList)
  );

// 2024 is a leap year, so Feb 29 is accepted (greeted on Feb 28 in other years).
function isValidDate(day, month) {
  return new Date(2024, month - 1, day).getDate() === day;
}

// Days from today until the next occurrence of day/month (0 = today).
function daysUntil(day, month, { year, month: m, day: d }) {
  const today = Date.UTC(year, m - 1, d);
  let next = Date.UTC(year, month - 1, day);
  if (next < today) next = Date.UTC(year + 1, month - 1, day);
  return Math.round((next - today) / 86_400_000);
}

export async function execute(interaction) {
  const sub     = interaction.options.getSubcommand();
  const guildId = interaction.guildId;
  const { t, timezone } = displayFor(getGuildConfig(guildId));
  const b       = t.cmd.birthday;
  const ephemeral = { flags: MessageFlags.Ephemeral };

  // Registering someone else's birthday is an admin-only shortcut.
  const target = interaction.options.getUser('user') ?? interaction.user;
  const forOther = target.id !== interaction.user.id;
  if (forOther && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({ content: b.adminOnly, ...ephemeral });
  }
  if (target.bot) {
    return interaction.reply({ content: b.noBots, ...ephemeral });
  }

  if (sub === 'set') {
    const day   = interaction.options.getInteger('day', true);
    const month = interaction.options.getInteger('month', true);
    if (!isValidDate(day, month)) {
      return interaction.reply({ content: b.invalidDate(day, b.months[month - 1]), ...ephemeral });
    }
    setBirthday(guildId, target.id, day, month);
    const date = b.dateLabel(day, b.months[month - 1]);
    const content = forOther ? b.savedFor(`<@${target.id}>`, date) : b.saved(date);
    return interaction.reply({ content, ...ephemeral });
  }

  if (sub === 'remove') {
    const removed = removeBirthday(guildId, target.id);
    const mention = `<@${target.id}>`;
    const content = removed
      ? (forOther ? b.removedFor(mention) : b.removed)
      : (forOther ? b.noneFor(mention) : b.none);
    return interaction.reply({ content, ...ephemeral });
  }

  if (sub === 'list') {
    const rows = getGuildBirthdays(guildId);
    if (!rows.length) {
      return interaction.reply({ content: b.listEmpty(PREFIX), ...ephemeral });
    }

    const today = localDateParts(timezone);
    const lines = rows
      .map(r => ({ ...r, inDays: daysUntil(r.day, r.month, today) }))
      .sort((a, z) => a.inDays - z.inDays)
      .map(r => {
        const when = r.inDays === 0 ? b.today : b.inDays(r.inDays);
        return `🎂 <@${r.user_id}> — ${b.dateLabel(r.day, b.months[r.month - 1])} · ${when}`;
      });

    const own = getBirthday(guildId, interaction.user.id);
    const embed = new EmbedBuilder()
      .setTitle(b.listTitle)
      .setDescription(lines.join('\n'))
      .setColor(0xf1c40f);
    if (!own) embed.setFooter({ text: b.listFooter(PREFIX) });

    return interaction.reply({ embeds: [embed], ...ephemeral });
  }
}
