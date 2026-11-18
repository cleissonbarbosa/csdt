/**
 * The interface in the viewer's language.
 *
 * A phrase is written where it is used, in English, and passed through
 * `t()`: `t('Search')`, `t('{n} services, all normal', { n })`. English is
 * the phrase itself. Every other language is a dictionary keyed by the
 * phrase (`pt-BR/`), and `Phrase` is the set of its keys, so a phrase
 * nobody translated does not compile.
 *
 * The language is chosen once, when the page loads: from the setting, or
 * with none from the browser's first language. Changing the setting reloads
 * the page. That is deliberate: a table of labels written at the top of a
 * module is in the right language because the module was read after the
 * language was known, and nothing has to be told that it changed.
 *
 * What is translated is what the interface says. What a file wrote or the
 * engine recorded (a service's name, a scenario's title, an event's text, a
 * message from the server) is shown as it was written.
 *
 * Two conventions:
 *
 * - A phrase that means two things takes a note after `#`, which is not
 *   shown: `t('Open#verb')` and `t('Open#state')` are both "Open" in
 *   English and two entries in a dictionary.
 * - One or many is two phrases, chosen where they are used:
 *   `t(n === 1 ? '{n} service' : '{n} services', { n })`.
 */
import { PT_BR } from './pt-BR';

export type Language = 'en' | 'pt-BR';
export type LanguageSetting = 'auto' | Language;

/** A phrase of the interface, as it is written in English. */
export type Phrase = keyof typeof PT_BR;
export type Values = Record<string, string | number>;

/** Where the settings are kept; `stores/ui.ts` writes it. */
const SETTINGS_KEY = 'aegis.settings.v1';
const NOTE = /#[a-z-]+$/;

/** The language asked for in the settings, read before anything is drawn. */
export function storedLanguage(): LanguageSetting {
  try {
    const raw = globalThis.localStorage?.getItem(SETTINGS_KEY);
    const value: unknown = raw
      ? (JSON.parse(raw) as { state?: { language?: unknown } }).state?.language
      : null;
    return value === 'en' || value === 'pt-BR' ? value : 'auto';
  } catch {
    // Storage that cannot be read, or holds something else: as if unset.
    return 'auto';
  }
}

/**
 * The language a worker was started in. A worker has no storage to read the
 * setting from, so the page names it with its own language
 * (`engine/transport.ts`) and the worker's messages are in the page's.
 */
function workerLanguage(): Language | null {
  const scope = globalThis as { WorkerGlobalScope?: unknown; name?: unknown };
  if (scope.WorkerGlobalScope === undefined || typeof scope.name !== 'string') return null;
  const named = /:(en|pt-BR)$/.exec(scope.name)?.[1];
  return named === 'en' || named === 'pt-BR' ? named : null;
}

/** The language shown: the setting, or the browser's first language. */
export function resolveLanguage(setting: LanguageSetting, preferred: string | undefined): Language {
  if (setting !== 'auto') return setting;
  return preferred?.toLowerCase().startsWith('pt') ? 'pt-BR' : 'en';
}

/** The language of this page, for as long as it is open. */
export const language: Language =
  workerLanguage() ??
  resolveLanguage(
    storedLanguage(),
    typeof navigator === 'undefined' ? undefined : navigator.language,
  );

if (typeof document !== 'undefined') document.documentElement.lang = language;

/** A phrase as English shows it: without its note. */
export function english(phrase: string): string {
  return phrase.replace(NOTE, '');
}

/** Puts values where a phrase names them: `{n}`. */
export function fill(text: string, values: Values): string {
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in values ? String(values[name]) : whole,
  );
}

/** A phrase in a given language. Tests use it; the interface uses `t`. */
export function translate(to: Language, phrase: Phrase, values?: Values): string {
  const text = to === 'pt-BR' ? PT_BR[phrase] : english(phrase);
  return values ? fill(text, values) : text;
}

/** A phrase in the language of this page. */
export function t(phrase: Phrase, values?: Values): string {
  return translate(language, phrase, values);
}
