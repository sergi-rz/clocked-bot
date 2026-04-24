import { getT, DEFAULT_LOCALE } from './i18n/index.js';

// PREFIX is bot-level: it's baked into the slash command names at registration time,
// so one bot instance = one prefix for all guilds it serves.
export const PREFIX = process.env.COMMAND_PREFIX ?? 'deepwork';

// Defaults inherited by every new guild when it's created via /setup
// (or when legacy env-var config is seeded on startup).
export const DEFAULTS = {
  activity_name: process.env.DEFAULT_ACTIVITY_NAME ?? process.env.ACTIVITY_NAME ?? 'Deep Work',
  locale:        process.env.DEFAULT_LOCALE        ?? process.env.LOCALE        ?? DEFAULT_LOCALE,
  timezone:      process.env.DEFAULT_TIMEZONE      ?? process.env.TIMEZONE      ?? 'Europe/Madrid',
  summary_hour:  Number(process.env.DEFAULT_SUMMARY_HOUR ?? process.env.SUMMARY_HOUR ?? 9),
};

// Shape a config row into a display-ready bundle for commands and scheduler.
// Always returns a usable object even if a field is NULL in the DB (unconfigured guild).
export function displayFor(config) {
  const locale       = config?.locale        ?? DEFAULTS.locale;
  const activity     = config?.activity_name ?? DEFAULTS.activity_name;
  const timezone     = config?.timezone      ?? DEFAULTS.timezone;
  const summary_hour = config?.summary_hour  ?? DEFAULTS.summary_hour;
  return { t: getT(locale), locale, activity, timezone, summary_hour };
}

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

  const today     = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const last      = sortedDays.at(-1);
  const current   = (last === today || last === yesterday) ? run : 0;

  return { current, best };
}
