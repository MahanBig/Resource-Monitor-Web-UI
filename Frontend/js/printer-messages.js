/*
 * Translates the status texts printers report (in whatever language the
 * printer panel uses) into the language chosen on the website.
 *
 * Every entry lists the same phrase in each supported language. Any known
 * variant found in a message is replaced by the phrase in the target
 * language, so Norwegian printers read fine in English and vice versa.
 * Add new phrases here; "alt" holds extra spellings that should also match.
 */

export const PHRASES = [
  { en: "No connection", nb: "Ingen kontakt", sv: "Ingen kontakt", de: "Keine Verbindung", alt: ["Error fetching errors"] },
  { en: "Paper jam", nb: "Papirstopp", sv: "Pappersstopp", de: "Papierstau", alt: ["Paper misfeed"] },
  { en: "Cover open", nb: "Deksel åpent", sv: "Lucka öppen", de: "Abdeckung offen" },
  { en: "Out of paper", nb: "Tomt for papir", sv: "Slut på papper", de: "Kein Papier", alt: ["Tom for papir"] },
  { en: "Load paper", nb: "Fyll på papir", sv: "Fyll på papper", de: "Papier einlegen" },
  { en: "Add staples", nb: "Trenger flere stifter", sv: "Fyll på häftklamrar", de: "Heftklammern nachfüllen" },
  { en: "Almost empty", nb: "Nesten tom", sv: "Nästan tom", de: "Fast leer", alt: ["Almost out", "Near end"] },
  { en: "Empty:", nb: "Tom:", sv: "Slut:", de: "Leer:" },
  { en: "Not found:", nb: "Finner ikke:", sv: "Hittades inte:", de: "Nicht gefunden:" },
  { en: "Low level:", nb: "Lavt nivå:", sv: "Låg nivå:", de: "Niedriger Füllstand:", alt: ["Lavt niv:"] },
  { en: "Preparing", nb: "Forbereder", sv: "Förbereder", de: "Vorbereitung" },
  { en: "Energy saver mode", nb: "Energisparemodus", sv: "Energisparläge", de: "Energiesparmodus" },
  { en: "Call service", nb: "Ring service", sv: "Ring service", de: "Service anrufen" },
  { en: "Functional problem", nb: "Funksjonsproblem", sv: "Funktionsfel", de: "Funktionsstörung" },
  { en: "Replace", nb: "Bytt", sv: "Byt", de: "Ersetzen" },
  { en: "waste toner", nb: "brukt toner", sv: "spilltoner", de: "Resttoner" },
  { en: "black toner", nb: "sort toner", sv: "svart toner", de: "Toner Schwarz" },
  { en: "yellow toner", nb: "gul toner", sv: "gul toner", de: "Toner Gelb" },
  { en: "cyan toner", nb: "cyan toner", sv: "cyan toner", de: "Toner Cyan" },
  { en: "magenta toner", nb: "magenta toner", sv: "magenta toner", de: "Toner Magenta" },
  { en: "print cartridge", nb: "skriverkassett", sv: "tonerkassett", de: "Druckkassette" },
  { en: "staples", nb: "stifter", sv: "häftklamrar", de: "Heftklammern" },
  { en: "tray", nb: "magasin", sv: "fack", de: "Fach" },
];

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

let compiled = null;

function compile() {
  const lookup = new Map();
  for (const phrase of PHRASES) {
    const variants = [phrase.en, phrase.nb, phrase.sv, phrase.de, ...(phrase.alt || [])];
    for (const variant of variants) {
      if (variant && !lookup.has(variant.toLowerCase())) lookup.set(variant.toLowerCase(), phrase);
    }
  }
  // Longest first so "Tomt for papir" wins over shorter overlaps.
  const sources = [...lookup.keys()]
    .sort((a, b) => b.length - a.length)
    .map((variant) => {
      const start = /^\p{L}/u.test(variant) ? "(?<!\\p{L})" : "";
      const end = /\p{L}$/u.test(variant) ? "(?!\\p{L})" : "";
      return start + escapeRegExp(variant) + end;
    });
  compiled = { lookup, regex: new RegExp(sources.join("|"), "giu") };
}

const matchCase = (original, replacement) =>
  /^\p{Lu}/u.test(original) ? replacement.charAt(0).toUpperCase() + replacement.slice(1) : replacement;

export function translatePrinterMessage(text, language) {
  if (!text) return "";
  if (!compiled) compile();
  return String(text).replace(compiled.regex, (found) => {
    const phrase = compiled.lookup.get(found.toLowerCase());
    const target = phrase?.[language] ?? phrase?.en;
    return target ? matchCase(found, target) : found;
  });
}
