/**
 * @file The four language codes the switchers offer, and the labels they show.
 *
 * Generated from the archived vanilla frontend during the Angular migration by
 * tools/generate-i18n-data.mjs, which copied the text byte for byte so no
 * translation could be corrupted on the way over.
 *
 * THIS FILE IS NOW THE SOURCE OF TRUTH. Edit the strings here.
 * Add a new key to EVERY language block, keeping the four key sets identical -
 * tools/check-translations.mjs fails the build if they diverge. Re-running the
 * generator would overwrite your edits; it exists to document and reproduce the
 * one-off migration, not to be run again.
 */

import type { LanguageInfo } from './language.model';

/**
 * The language codes the switchers offer.
 *
 * Declared as a literal union so a typo in a translation lookup is a compile
 * error rather than a blank label.
 */
export const LANGUAGE_CODES = ["en", "zh", "vi", "ja"] as const;

/** One of the four supported language codes, derived from the list above. */
export type LanguageCode = (typeof LANGUAGE_CODES)[number];

/** The languages offered, in the order the switcher lists them. */
export const SUPPORTED_LANGUAGES: readonly LanguageInfo<LanguageCode>[] = [
  { code: "en", label: "English", nativeLabel: "English", htmlLang: "en-AU" },
  { code: "zh", label: "Chinese", nativeLabel: "中文", htmlLang: "zh-CN" },
  { code: "vi", label: "Vietnamese", nativeLabel: "Tiếng Việt", htmlLang: "vi-VN" },
  { code: "ja", label: "Japanese", nativeLabel: "日本語", htmlLang: "ja-JP" },
];

/** Used when nothing is stored and the browser expresses no preference. */
export const DEFAULT_LANGUAGE: LanguageCode = "en";
