import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { toggleOptOut, getGuildConfig }      from '../db.js';
import { PREFIX, displayFor }                from '../utils.js';
import { getT, DEFAULT_LOCALE }              from '../i18n/index.js';

const bootT        = getT(DEFAULT_LOCALE);
const bootActivity = process.env.DEFAULT_ACTIVITY_NAME ?? process.env.ACTIVITY_NAME ?? 'Deep Work';

export const data = new SlashCommandBuilder()
  .setName(`${PREFIX}-optout`)
  .setDescription(bootT.cmd.optout.desc(bootActivity.toLowerCase()))
  .setDMPermission(false);

export async function execute(interaction) {
  const { t }    = displayFor(getGuildConfig(interaction.guildId));
  const optedOut = toggleOptOut(interaction.guildId, interaction.user.id);
  const message  = optedOut ? t.cmd.optout.disabled : t.cmd.optout.enabled;
  await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
}
