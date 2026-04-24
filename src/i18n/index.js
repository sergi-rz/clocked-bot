// Per-guild locale lookup. Commands resolve the guild's locale at runtime
// via getT(config.locale) so one bot instance can serve guilds in different languages.
import es from './es.js';
import en from './en.js';

const locales = { es, en };

export const DEFAULT_LOCALE = process.env.DEFAULT_LOCALE ?? 'es';

export function getT(locale) {
  return locales[locale] ?? locales[DEFAULT_LOCALE] ?? es;
}
