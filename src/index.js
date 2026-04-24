import { Client, GatewayIntentBits, Collection, MessageFlags } from 'discord.js';
import 'dotenv/config';
import { runPoll }                               from './poller.js';
import { handleJoin, handleLeave }               from './sessions.js';
import { startScheduler, unscheduleGuild }       from './scheduler.js';
import { ensureGuildConfig, getGuildConfig, updateGuildField } from './db.js';
import { DEFAULTS }                              from './utils.js';
import { getT }                                  from './i18n/index.js';
import * as ranking                              from './commands/ranking.js';
import * as mystats                              from './commands/mystats.js';
import * as buddies                              from './commands/buddies.js';
import * as optout                               from './commands/optout.js';
import * as setup                                from './commands/setup.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

client.commands = new Collection();
for (const cmd of [ranking, mystats, buddies, optout, setup]) {
  client.commands.set(cmd.data.name, cmd);
}

// Seed a guild_config from legacy env vars so existing self-hosted deployments
// (and first-run local dev) just work without having to call /setup.
// Only runs if GUILD_ID is set AND no config row exists yet for that guild.
function seedFromEnv() {
  const guildId   = process.env.GUILD_ID;
  const channels  = (process.env.VOICE_CHANNEL_IDS ?? process.env.VOICE_CHANNEL_ID ?? '')
    .split(',').map(s => s.trim()).filter(Boolean);

  if (!guildId || !channels.length) return;
  if (getGuildConfig(guildId)) return;

  ensureGuildConfig(guildId, {
    channel_ids:   channels,
    activity_name: DEFAULTS.activity_name,
    locale:        DEFAULTS.locale,
    timezone:      DEFAULTS.timezone,
    summary_hour:  DEFAULTS.summary_hour,
  });
  console.log(`[boot] Seeded guild_config from env for ${guildId} with channels ${channels.join(', ')}`);
}

client.once('clientReady', () => {
  console.log(`Bot ready: ${client.user.tag}`);

  seedFromEnv();

  runPoll(client);
  setInterval(() => runPoll(client), Number(process.env.POLL_INTERVAL_MS) || 600_000);
  startScheduler(client);
});

// Primary session tracking: real-time events from Discord's WebSocket.
// The poller runs in parallel as a safety net for missed events.
client.on('voiceStateUpdate', (oldState, newState) => {
  const member = newState.member ?? oldState.member;
  if (member?.user.bot) return;

  const guildId = newState.guild?.id ?? oldState.guild?.id;
  if (!guildId) return;

  const cfg = getGuildConfig(guildId);
  if (!cfg || !cfg.active) return;

  const tracked = new Set(cfg.channel_ids);
  const wasIn = tracked.has(oldState.channelId);
  const isIn  = tracked.has(newState.channelId);

  if (!wasIn && isIn) {
    handleJoin(guildId, member.id, member.user.username, newState.channelId);
  } else if (wasIn && !isIn) {
    handleLeave(guildId, member.id, member.user.username, oldState.channelId);
  } else if (wasIn && isIn && oldState.channelId !== newState.channelId) {
    // User moved between two tracked channels: close the old session, open a new one.
    handleLeave(guildId, member.id, member.user.username, oldState.channelId);
    handleJoin(guildId, member.id, member.user.username, newState.channelId);
  }
  // If wasIn === isIn and channelId didn't change, it's a mute/deafen event — ignore.
});

// When the bot is kicked from a guild, stop its scheduled weekly summary and mark inactive.
// Historical data is kept; if the bot is re-added, /setup will reactivate it.
client.on('guildDelete', guild => {
  console.log(`[guild] Removed from ${guild.id}`);
  unscheduleGuild(guild.id);
  if (getGuildConfig(guild.id)) {
    updateGuildField(guild.id, 'active', 0);
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(err);
    const cfg   = interaction.guildId ? getGuildConfig(interaction.guildId) : null;
    const t     = getT(cfg?.locale);
    const reply = { content: t.errors.cmd, flags: MessageFlags.Ephemeral };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(reply);
    } else {
      await interaction.reply(reply);
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
