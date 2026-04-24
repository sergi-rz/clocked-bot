import { openUserSession, closeUserSession, isOptedOut } from './db.js';

// Shared session logic used by both the real-time event handler (index.js)
// and the reconciliation poller (poller.js) to avoid duplication.

export function handleJoin(guildId, userId, username, channelId) {
  if (isOptedOut(guildId, userId)) return;
  const opened = openUserSession(guildId, userId, username, channelId);
  if (opened) console.log(`[session] Opened: ${username} in ${guildId}/${channelId}`);
}

export function handleLeave(guildId, userId, username, channelId) {
  closeUserSession(guildId, userId, channelId);
  console.log(`[session] Closed: ${username ?? userId} in ${guildId}/${channelId}`);
}
