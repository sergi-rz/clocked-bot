// Loads the translation file that matches the LOCALE env var (default: 'es').
// All user-facing strings live in the locale files — never hardcode them in commands.
import es from './es.js';
import en from './en.js';

const locales = { es, en };
export const t = locales[process.env.LOCALE ?? 'es'] ?? es;
