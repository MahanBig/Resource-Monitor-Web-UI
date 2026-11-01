/*
 * Tiny i18n helper. To add a language: create js/locales/<code>.js (copy
 * en.js), add it to LANGUAGES below, add its phrases to printer-messages.js
 * and (optionally) to admin/lang.php.
 */
import en from "./locales/en.js";
import nb from "./locales/nb.js";
import sv from "./locales/sv.js";
import de from "./locales/de.js";

export const LANGUAGES = {
  en: { name: "English", locale: "en-GB", strings: en },
  nb: { name: "Norsk", locale: "nb-NO", strings: nb },
  sv: { name: "Svenska", locale: "sv-SE", strings: sv },
  de: { name: "Deutsch", locale: "de-DE", strings: de },
};

const STORAGE_KEY = "rm_lang";
const ALIASES = { no: "nb", nn: "nb", nob: "nb", nno: "nb" };

let current = "en";
const listeners = new Set();

const storage = {
  get(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch { /* private mode */ }
  },
};

function normalizeCode(code) {
  const base = String(code || "").toLowerCase().split(/[-_]/)[0];
  const resolved = ALIASES[base] || base;
  return LANGUAGES[resolved] ? resolved : null;
}

export function detectLanguage(configDefault) {
  const fromUrl = normalizeCode(new URLSearchParams(location.search).get("lang"));
  if (fromUrl) return fromUrl;
  const stored = normalizeCode(storage.get(STORAGE_KEY));
  if (stored) return stored;
  if (configDefault && configDefault !== "auto") {
    const configured = normalizeCode(configDefault);
    if (configured) return configured;
  }
  for (const candidate of navigator.languages || [navigator.language]) {
    const code = normalizeCode(candidate);
    if (code) return code;
  }
  return "en";
}

export function getLanguage() {
  return current;
}

export function getLocale() {
  return LANGUAGES[current].locale;
}

export function setLanguage(code, { persist = true } = {}) {
  current = normalizeCode(code) || "en";
  document.documentElement.lang = current;
  if (persist) {
    storage.set(STORAGE_KEY, current);
    // Lets the PHP admin page pick the same language.
    document.cookie = `${STORAGE_KEY}=${current}; path=/; max-age=31536000; SameSite=Lax`;
  }
  applyTranslations();
  listeners.forEach((listener) => listener(current));
}

export function onLanguageChange(listener) {
  listeners.add(listener);
}

export function t(key, vars = {}) {
  const template = LANGUAGES[current].strings[key] ?? en[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? String(vars[name]) : match));
}

/** Fills elements marked with data-i18n, data-i18n-title, data-i18n-placeholder, data-i18n-aria-label. */
export function applyTranslations(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll("[data-i18n-title]").forEach((el) => { el.title = t(el.dataset.i18nTitle); });
  root.querySelectorAll("[data-i18n-placeholder]").forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
  root.querySelectorAll("[data-i18n-aria-label]").forEach((el) => { el.setAttribute("aria-label", t(el.dataset.i18nAriaLabel)); });
}

/* ---------- Formatting ---------- */

/** Parses "YYYY-MM-DD HH:MM:SS" (database), ISO 8601 or a Date. */
export function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const date = new Date(String(value).replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDateTime(value, { seconds = false, year = true } = {}) {
  const date = toDate(value);
  if (!date) return "–";
  return new Intl.DateTimeFormat(getLocale(), {
    day: "2-digit",
    month: "2-digit",
    ...(year ? { year: "numeric" } : {}),
    hour: "2-digit",
    minute: "2-digit",
    ...(seconds ? { second: "2-digit" } : {}),
  }).format(date);
}

export function formatTime(value, { seconds = false } = {}) {
  const date = toDate(value);
  if (!date) return "–";
  return new Intl.DateTimeFormat(getLocale(), {
    hour: "2-digit",
    minute: "2-digit",
    ...(seconds ? { second: "2-digit" } : {}),
  }).format(date);
}

export function formatDuration(seconds) {
  if (seconds === null || seconds === undefined || Number.isNaN(Number(seconds))) return "–";
  const total = Math.max(0, Math.round(Number(seconds)));
  if (total < 60) return t("duration.s", { n: total });
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return t("duration.m", { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("duration.h", { h: hours, m: minutes % 60 });
  return t("duration.d", { d: Math.floor(hours / 24), h: hours % 24 });
}

export function formatNumber(value) {
  return new Intl.NumberFormat(getLocale()).format(Number(value) || 0);
}
