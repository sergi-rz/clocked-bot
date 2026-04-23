import { openUserSession, closeUserSession, isOptedOut } from './db.js';

// Shared session logic used by both the real-time event handler (index.js)
// and the reconciliation poller (poller.js) to avoid duplication.

export function handleJoin(userId, username, channelId) {
  // Silently skip opted-out users — they should never appear in the DB.
  if (isOptedOut(userId)) return;
  const opened = openUserSession(userId, username, channelId);
  if (opened) console.log(`[session] Opened: ${username} in ${channelId}`);
}

export function handleLeave(userId, username, channelId) {
  closeUserSession(userId, channelId);
  console.log(`[session] Closed: ${username ?? userId} in ${channelId}`);
}
