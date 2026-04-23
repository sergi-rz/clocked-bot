import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { toggleOptOut }                      from '../db.js';
import { PREFIX, ACTIVITY }                  from '../utils.js';
import { t }                                 from '../i18n/index.js';

export const data = new SlashCommandBuilder()
  .setName(`${PREFIX}-optout`)
  .setDescription(t.cmd.optout.desc(ACTIVITY.toLowerCase()));

export async function execute(interaction) {
  const optedOut = toggleOptOut(interaction.user.id);
  const message  = optedOut ? t.cmd.optout.disabled : t.cmd.optout.enabled;
  await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
}
