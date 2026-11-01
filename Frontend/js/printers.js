/*
 * Turns raw printer_data.json entries into a view model for rendering.
 * Pure functions (no DOM), so they are unit-tested in tests/frontend.test.mjs.
 */
import { classify, isRoutineConsumable, OFFLINE_MESSAGE, parseMessage } from "./rules.js";

// Legacy Ricoh layout of "Ink Levels": 0=black, 1=waste, 2=cyan, 3=magenta, 4=yellow.
const LEGACY_TONER_INDEX = [
  ["black", 0],
  ["cyan", 2],
  ["magenta", 3],
  ["yellow", 4],
];
const TONER_ORDER = ["black", "cyan", "magenta", "yellow"];
const STATUS_RANK = { critical: 0, warning: 1, ok: 2 };

/** Same algorithm as printer_identifier() in api/bootstrap.php. */
export function printerId(printer) {
  const serial = String(printer.Serial ?? "").trim();
  if (serial) return `serial:${serial}`;
  const ip = String(printer.IP ?? "").trim();
  if (ip) return `ip:${ip}`;
  return `name:${String(printer.Name ?? "unknown").trim()}`;
}

/** Image file for a model: "IM C3000" -> "images/IM-C3000.png". */
export function modelImage(model) {
  if (!model || model === "Error fetching model") return "images/missing.png";
  return `images/${encodeURIComponent(String(model).trim().replace(/\s+/g, "-"))}.png`;
}

/** Snapshot time: ISO "Timestamp" (new backend) or legacy "DD MM YYYY, HH:MM". */
export function snapshotDate(printer) {
  if (printer.Timestamp) {
    const date = new Date(printer.Timestamp);
    if (!Number.isNaN(date.getTime())) return date;
  }
  const match = String(printer.Time ?? "").match(/^(\d{1,2}) (\d{1,2}) (\d{4}), (\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const [, day, month, year, hour, minute] = match.map(Number);
  return new Date(year, month - 1, day, hour, minute);
}

const toNumber = (value) => {
  const number = Number.parseFloat(String(value ?? "").replace("%", ""));
  return Number.isFinite(number) ? number : null;
};

export function readSupplies(printer) {
  if (Array.isArray(printer.Supplies) && printer.Supplies.length) {
    const named = printer.Supplies.filter((s) => s.color && s.color !== "waste");
    const list = (named.length ? named : printer.Supplies).map((s) => ({
      color: s.color || "unknown",
      label: s.name || "",
      percent: s.percent ?? (s.level >= 0 ? Math.min(100, s.level) : null),
      someRemaining: s.level === -3,
    }));
    return list.sort((a, b) => TONER_ORDER.indexOf(a.color) - TONER_ORDER.indexOf(b.color));
  }

  const levels = Array.isArray(printer["Ink Levels"]) ? printer["Ink Levels"] : [];
  if (!levels.length || String(levels[0]).startsWith("Error")) return [];

  const layout = levels.length >= 5 ? LEGACY_TONER_INDEX : [["black", 0]];
  return layout
    .filter(([, index]) => index < levels.length)
    .map(([color, index]) => {
      const value = toNumber(levels[index]);
      return {
        color,
        label: "",
        percent: value !== null && value >= 0 ? Math.min(100, value) : null,
        someRemaining: value === -3,
      };
    });
}

const BYPASS = /bypass|manual|manuell|multi|universal/i;

export function readTrays(printer, lowPaperSheets = 55) {
  let trays;
  if (Array.isArray(printer.Trays) && printer.Trays.length) {
    trays = printer.Trays.map((tray, index) => ({ ...tray, number: index + 1 }));
    const hasNames = trays.some((tray) => tray.name);
    trays = hasNames
      ? trays.filter((tray) => !BYPASS.test(tray.name || ""))
      : trays.slice(0, Math.max(1, trays.length - 1));
  } else {
    const raw = Array.isArray(printer["Tray Information"]) ? printer["Tray Information"] : [];
    if (!raw.length || String(raw[0]).startsWith("Error")) return [];
    // The last entry is the bypass tray on Ricoh devices.
    trays = raw.slice(0, Math.max(1, raw.length - 1)).map((level, index) => ({
      name: "",
      level: toNumber(level),
      max: null,
      number: index + 1,
    }));
  }

  return trays.map((tray) => {
    const level = tray.level;
    let state = "ok";
    if (level === -3) state = "has-paper";
    else if (level === -2 || level === null || level === undefined) state = "missing";
    else if (level === 0) state = "empty";
    else if (level < lowPaperSheets) state = "low";
    return {
      number: tray.number,
      name: tray.name || "",
      level,
      max: tray.max > 0 ? tray.max : null,
      state,
    };
  });
}

/**
 * @param {object} raw          one entry of printer_data.json
 * @param {object} options      { rules, hideConsumables, lowPaperSheets, service }
 */
export function buildPrinter(raw, options = {}) {
  const { rules, hideConsumables = false, lowPaperSheets = 55, service = null } = options;
  const errors = Array.isArray(raw.Errors) ? raw.Errors.filter((e) => typeof e === "string" && e.trim()) : [];
  const offline = raw.Online === false || errors.some((e) => parseMessage(e).message === OFFLINE_MESSAGE);

  const seen = new Set();
  const messages = [];
  for (const error of errors) {
    const parsed = parseMessage(error);
    if (parsed.message === OFFLINE_MESSAGE) continue; // shown as the offline state instead
    const classification = classify(parsed, rules);
    if (!classification) continue;
    if (hideConsumables && isRoutineConsumable(classification)) continue;
    const key = `${parsed.message.toLowerCase()}|${parsed.code}`;
    if (seen.has(key)) continue;
    seen.add(key);
    messages.push({ ...parsed, ...classification });
  }
  messages.sort((a, b) => STATUS_RANK[a.level === "info" ? "ok" : a.level] - STATUS_RANK[b.level === "info" ? "ok" : b.level]);

  let status = "ok";
  if (offline || messages.some((m) => m.level === "critical")) status = "critical";
  else if (messages.some((m) => m.level === "warning")) status = "warning";

  return {
    id: printerId(raw),
    name: String(raw.Name || raw.IP || "?"),
    ip: String(raw.IP || ""),
    serial: String(raw.Serial || raw.DetectedSerial || ""),
    model: raw.Model && raw.Model !== "Error fetching model" ? String(raw.Model) : "",
    image: modelImage(raw.Model),
    updated: snapshotDate(raw),
    offline,
    status,
    messages,
    supplies: offline ? [] : readSupplies(raw),
    trays: offline ? [] : readTrays(raw, lowPaperSheets),
    service,
  };
}

export function needsAttention(printer) {
  return printer.status !== "ok" || Boolean(printer.service);
}

export function sortPrinters(printers) {
  return [...printers].sort(
    (a, b) =>
      STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
      Number(Boolean(b.service)) - Number(Boolean(a.service)) ||
      a.name.localeCompare(b.name, undefined, { numeric: true })
  );
}

export function countStatuses(printers) {
  const counts = { critical: 0, warning: 0, ok: 0, service: 0, offline: 0 };
  for (const printer of printers) {
    counts[printer.status] += 1;
    if (printer.service) counts.service += 1;
    if (printer.offline) counts.offline += 1;
  }
  return counts;
}

/** Newest snapshot time across all printers. */
export function newestUpdate(printers) {
  return printers.reduce((newest, p) => (p.updated && (!newest || p.updated > newest) ? p.updated : newest), null);
}
