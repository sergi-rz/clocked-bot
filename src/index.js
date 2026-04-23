import { Client, GatewayIntentBits, Collection, MessageFlags } from 'discord.js';
import 'dotenv/config';
import { runPoll }                 from './poller.js';
import { handleJoin, handleLeave } from './sessions.js';
import { startScheduler }          from './scheduler.js';
import { CHANNELS }                from './utils.js';
import { t }                       from './i18n/index.js';
import * as ranking                from './commands/ranking.js';
import * as mystats                from './commands/mystats.js';
import * as buddies                from './commands/buddies.js';
import * as optout                 from './commands/optout.js';

// A Set for O(1) lookups when checking if a channel is tracked.
const channelSet = new Set(CHANNELS);

// GuildVoiceStates intent is required to receive voiceStateUpdate events
// and to populate channel.members in the cache (used by the poller).
// Server Members Intent must be enabled in the Discord Developer Portal.
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

client.commands = new Collection();
for (const cmd of [ranking, mystats, buddies, optout]) {
  client.commands.set(cmd.data.name, cmd);
}

client.once('clientReady', () => {
  console.log(`Bot ready: ${client.user.tag}`);
  console.log(`Tracking channels: ${CHANNELS.join(', ')}`);

  // Run an immediate poll on startup to catch anyone already in the channel
  // and to recover sessions from before the bot started.
  runPoll(client);
  setInterval(() => runPoll(client), Number(process.env.POLL_INTERVAL_MS) || 1_800_000);
  startScheduler(client);
});

// Primary session tracking: real-time events from Discord's WebSocket.
// The poller runs in parallel as a safety net for missed events.
client.on('voiceStateUpdate', (oldState, newState) => {
  const member = newState.member ?? oldState.member;
  if (member?.user.bot) return;

  const wasIn = channelSet.has(oldState.channelId);
  const isIn  = channelSet.has(newState.channelId);

  if (!wasIn && isIn) {
    // User joined a tracked channel.
    handleJoin(member.id, member.user.username, newState.channelId);
  } else if (wasIn && !isIn) {
    // User left a tracked channel (disconnected or moved to an untracked one).
    handleLeave(member.id, member.user.username, oldState.channelId);
  } else if (wasIn && isIn && oldState.channelId !== newState.channelId) {
    // User moved between two tracked channels: close the old session, open a new one.
    // Each channel tracks its sessions independently.
    handleLeave(member.id, member.user.username, oldState.channelId);
    handleJoin(member.id, member.user.username, newState.channelId);
  }
  // If wasIn === isIn and channelId didn't change, it's a mute/deafen event — ignore.
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(err);
    const reply = { content: t.errors.cmd, flags: MessageFlags.Ephemeral };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(reply);
    } else {
      await interaction.reply(reply);
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
