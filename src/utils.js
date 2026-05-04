import { getT, DEFAULT_LOCALE } from './i18n/index.js';

// Baked into the slash command names at registration time.
export const PREFIX = 'clocked';

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

// Returns the Unix timestamps that bound the given period.
//   - until === null → open-ended: caller queries up to "now" and includes live sessions.
//   - until set      → closed range: caller queries only completed sessions in [since, until).
// Week starts on Monday to match European convention.
export function periodRange(key) {
  const now = new Date();
  const sec = (d) => Math.floor(d.getTime() / 1000);

  switch (key) {
    case 'today':
      return { since: sec(new Date(now.getFullYear(), now.getMonth(), now.getDate())), until: null };
    case 'week': {
      const monday = new Date(now);
      monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
      monday.setHours(0, 0, 0, 0);
      return { since: sec(monday), until: null };
    }
    case 'month':
      return { since: sec(new Date(now.getFullYear(), now.getMonth(), 1)), until: null };
    case 'year':
      return { since: sec(new Date(now.getFullYear(), 0, 1)), until: null };
    case 'last_year':
      return {
        since: sec(new Date(now.getFullYear() - 1, 0, 1)),
        until: sec(new Date(now.getFullYear(), 0, 1)),
      };
    case 'last_week': {
      const thisMonday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      thisMonday.setDate(thisMonday.getDate() - ((thisMonday.getDay() + 6) % 7));
      const lastMonday = new Date(thisMonday);
      lastMonday.setDate(thisMonday.getDate() - 7);
      return { since: sec(lastMonday), until: sec(thisMonday) };
    }
    case 'last_month': {
      const firstOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const firstOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return { since: sec(firstOfLastMonth), until: sec(firstOfThisMonth) };
    }
    default:
      return { since: 0, until: null }; // global — no time filter
  }
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
