// Manually fires the weekly summary for a given guild. Useful for testing
// without waiting until Monday, or for re-posting if the scheduled run failed.
//
// Usage:
//   node scripts/trigger-summary.js <guild_id>
//
// Runs a throwaway Discord client that logs in, triggers postWeeklySummaryForGuild,
// and exits. Safe to run alongside the main bot — Discord allows concurrent sessions
// per bot token.

import { Client, GatewayIntentBits } from 'discord.js';
import 'dotenv/config';
import { postWeeklySummaryForGuild } from '../src/scheduler.js';

const guildId = process.argv[2];
if (!guildId) {
  console.error('Usage: node scripts/trigger-summary.js <guild_id>');
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('clientReady', async () => {
  console.log(`Triggering weekly summary for ${guildId}...`);
  try {
    await postWeeklySummaryForGuild(client, guildId);
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  }
  await client.destroy();
  process.exit();
});

client.login(process.env.DISCORD_TOKEN);
