/**
 * @file Types shared by the generated dictionaries and the translation service.
 *
 * The DATA (the language list and the dictionaries) lives in generated files:
 *   languages.ts            the codes and their labels
 *   client-translations.ts  the public site's strings
 *   admin-translations.ts   the admin site's strings
 *
 * Those files are produced by tools/generate-i18n-data.mjs from the archived
 * vanilla frontend, so the text is copied byte for byte rather than retyped.
 */

/** One entry of the language switcher. */
export interface LanguageInfo<Code extends string = string> {
  /** The short code stored in localStorage, for example 'ja'. */
  readonly code: Code;
  /** The English name, used in `title` attributes and documentation. */
  readonly label: string;
  /** The name in its own language, which is what the switcher displays. */
  readonly nativeLabel: string;
  /** The value written to <html lang> for screen readers and hyphenation. */
  readonly htmlLang: string;
}

/** One flat key/value map of interface strings. */
export type Dictionary = Readonly<Record<string, string>>;

/** One dictionary per language code. */
export type Dictionaries<Code extends string = string> = Readonly<Record<Code, Dictionary>>;
