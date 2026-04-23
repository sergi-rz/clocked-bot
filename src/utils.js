export const PREFIX   = process.env.COMMAND_PREFIX ?? 'deepwork';
export const ACTIVITY = process.env.ACTIVITY_NAME  ?? 'Deep Work';

// Supports both VOICE_CHANNEL_IDS (comma-separated list, new) and the legacy
// VOICE_CHANNEL_ID (single value) so existing configs keep working.
export const CHANNELS = (process.env.VOICE_CHANNEL_IDS ?? process.env.VOICE_CHANNEL_ID ?? '')
  .split(',').map(s => s.trim()).filter(Boolean);

// Returns the Unix timestamp for the start of the given period, or 0 for "all time".
// Week starts on Monday to match European convention.
export function periodStart(key) {
  const now = new Date();
  let d;
  switch (key) {
    case 'today':
      d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      break;
    case 'week': {
      d = new Date(now);
      d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
      d.setHours(0, 0, 0, 0);
      break;
    }
    case 'month':
      d = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
    case 'year':
      d = new Date(now.getFullYear(), 0, 1);
      break;
    default:
      return 0; // global — no time filter
  }
  return Math.floor(d.getTime() / 1000);
}

export function fmt(minutes) {
  if (!minutes) return '0m';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// Gap-and-island algorithm: walks the sorted list of active days and counts
// consecutive sequences (days exactly 1 apart). Returns both the longest streak
// ever achieved and the current streak (only active if the last day was today or yesterday).
export function computeStreaks(sortedDays) {
  if (!sortedDays.length) return { current: 0, best: 0 };

  let best = 1, run = 1;

  for (let i = 1; i < sortedDays.length; i++) {
    const diff = (new Date(sortedDays[i]) - new Date(sortedDays[i - 1])) / 86_400_000;
    run = diff === 1 ? run + 1 : 1;
    if (run > best) best = run;
  }

  // A streak is still "active" if the user connected today or yesterday.
  // Yesterday counts because someone who connected late at night hasn't broken their streak yet.
  const today     = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const last      = sortedDays.at(-1);
  const current   = (last === today || last === yesterday) ? run : 0;

  return { current, best };
}
