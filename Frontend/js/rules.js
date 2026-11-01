/*
 * Classification of printer status messages.
 * Mirrors classify_error() in api/bootstrap.php and uses the same error_rules.json.
 *
 * classify() returns null for ignored messages, otherwise
 *   { category: "toner"|"paper"|"critical"|"warning"|"other",
 *     level:    "critical"|"warning"|"info" }
 * "category" is what the history logger stores, "level" is how it is shown.
 */

export const OFFLINE_MESSAGE = "Error fetching errors";

// Used only if error_rules.json cannot be loaded.
export const FALLBACK_RULES = {
  ignore: { codes: ["10033", "10003"], exact: ["Energisparemodus", "Energy saver mode"] },
  toner: { contains: ["toner", "skriverkassett", "print cartridge"], codes: ["10072", "10073", "10074", "10075"] },
  paper: { contains: ["Tomt for papir", "Out of paper", "Fyll på papir", "Load paper"], codes: ["13400"] },
  critical: { starts: ["Tom:", "Empty:"], contains: [OFFLINE_MESSAGE, "Papirstopp", "Paper jam", "Deksel åpent", "Cover open", "Replace"] },
  warning: { contains: ["Nesten", "Almost", "Forbred", "Preparing", "Finner ikke:", "Not found:"] },
};

const normalize = (text) => String(text ?? "").replace(/\s+/gu, " ").trim().toLowerCase();

export function parseMessage(raw) {
  const text = String(raw ?? "").trim();
  const match = text.match(/\s*\{([^{}]+)\}\s*$/u);
  return {
    raw: text,
    code: match ? match[1].trim() : "",
    message: match ? text.slice(0, match.index).trim() : text,
  };
}

export function matchesGroup(group, parsed) {
  if (!group) return false;
  if (parsed.code && (group.codes || []).map(String).includes(parsed.code)) return true;
  const message = normalize(parsed.message);
  if ((group.exact || []).some((value) => normalize(value) === message)) return true;
  if ((group.starts || []).some((value) => normalize(value) !== "" && message.startsWith(normalize(value)))) return true;
  return (group.contains || []).some((value) => {
    const needle = normalize(value);
    return needle !== "" && message.includes(needle);
  });
}

export function classify(raw, rules = FALLBACK_RULES) {
  const parsed = typeof raw === "string" ? parseMessage(raw) : raw;
  if (matchesGroup(rules.ignore, parsed)) return null;

  for (const category of ["toner", "paper"]) {
    if (matchesGroup(rules[category], parsed)) {
      // An *empty* cartridge or a consumable matching a critical rule is shown red.
      return { category, level: matchesGroup(rules.critical, parsed) ? "critical" : "warning" };
    }
  }
  if (matchesGroup(rules.critical, parsed)) return { category: "critical", level: "critical" };
  if (matchesGroup(rules.warning, parsed)) return { category: "warning", level: "warning" };
  return { category: "other", level: "info" };
}

/** Low toner / empty tray: hidden by ?ignoreconsumables=1. Empty toner is never hidden. */
export function isRoutineConsumable(classification) {
  return Boolean(
    classification &&
      (classification.category === "toner" || classification.category === "paper") &&
      classification.level !== "critical"
  );
}
