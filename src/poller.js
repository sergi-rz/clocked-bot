import { getOpenSessions, saveSnapshot, openUserSession, closeUserSession, isOptedOut } from './db.js';
import { CHANNELS } from './utils.js';

// The poller runs periodically (every POLL_INTERVAL_MS) to reconcile the actual
// state of the voice channel with what the database thinks is happening.
// This recovers from two failure cases:
//   1. A user joined while the bot was down — no "join" event was received, so we open the session now.
//   2. A user left while the bot was down — no "leave" event was received, so we close the orphaned session.
function pollChannel(client, channelId) {
  const channel = client.channels.cache.get(channelId);

  if (!channel?.isVoiceBased()) {
    console.error(`[poller] Channel not found: ${channelId}`);
    return;
  }

  const at      = Math.floor(Date.now() / 1000);
  const members = [...channel.members.values()].filter(m => !m.user.bot && !isOptedOut(m.id));
  const nowIds  = new Set(members.map(m => m.id));

  // Save a raw snapshot for every user currently in the channel (audit trail).
  for (const m of members) saveSnapshot(m.id, m.user.username, channelId, at);

  const open    = getOpenSessions(channelId);
  const openIds = new Set(open.map(s => s.user_id));

  // Open a session for anyone in the channel who doesn't have one yet.
  for (const m of members) {
    if (!openIds.has(m.id)) {
      openUserSession(m.id, m.user.username, channelId, at);
      console.log(`[poller] Recovered session: ${m.user.username} in ${channelId}`);
    }
  }

  // Close sessions for users who are no longer in the channel.
  for (const s of open) {
    if (!nowIds.has(s.user_id)) {
      closeUserSession(s.user_id, channelId, at);
      console.log(`[poller] Closed orphaned session: ${s.username} in ${channelId}`);
    }
  }

  console.log(`[poller] ${new Date().toISOString()} — ${channelId}: ${members.length} in channel`);
}

export function runPoll(client) {
  for (const channelId of CHANNELS) pollChannel(client, channelId);
}
