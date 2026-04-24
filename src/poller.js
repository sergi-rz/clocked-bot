import {
  getOpenSessions, saveSnapshot, openUserSession, closeUserSession,
  isOptedOut, getAllActiveGuildConfigs,
} from './db.js';

// The poller runs periodically (every POLL_INTERVAL_MS) to reconcile the actual
// state of the voice channel with what the database thinks is happening.
// This recovers from two failure cases:
//   1. A user joined while the bot was down — no "join" event was received, so we open the session now.
//   2. A user left while the bot was down — no "leave" event was received, so we close the orphaned session.
// Exported so /clocked-setup add can trigger an immediate reconciliation — otherwise
// users already connected when a channel is registered wait up to POLL_INTERVAL_MS
// to be picked up.
export function pollChannel(client, guildId, channelId) {
  const channel = client.channels.cache.get(channelId);

  if (!channel?.isVoiceBased()) {
    console.error(`[poller] Channel not found or not voice: ${guildId}/${channelId}`);
    return;
  }

  const at      = Math.floor(Date.now() / 1000);
  const members = [...channel.members.values()].filter(m => !m.user.bot && !isOptedOut(guildId, m.id));
  const nowIds  = new Set(members.map(m => m.id));

  for (const m of members) saveSnapshot(guildId, m.id, m.user.username, channelId, at);

  const open    = getOpenSessions(guildId, channelId);
  const openIds = new Set(open.map(s => s.user_id));

  for (const m of members) {
    if (!openIds.has(m.id)) {
      openUserSession(guildId, m.id, m.user.username, channelId, at);
      console.log(`[poller] Recovered session: ${m.user.username} in ${guildId}/${channelId}`);
    }
  }

  for (const s of open) {
    if (!nowIds.has(s.user_id)) {
      closeUserSession(guildId, s.user_id, channelId, at);
      console.log(`[poller] Closed orphaned session: ${s.username} in ${guildId}/${channelId}`);
    }
  }

  console.log(`[poller] ${new Date().toISOString()} — ${guildId}/${channelId}: ${members.length} in channel`);
}

export function runPoll(client) {
  for (const cfg of getAllActiveGuildConfigs()) {
    for (const channelId of cfg.channel_ids) {
      pollChannel(client, cfg.guild_id, channelId);
    }
  }
}
