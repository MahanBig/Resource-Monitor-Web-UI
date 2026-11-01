/*
 * Live printer view. Loads config.json, polls printer_data.json, renders
 * printer cards and wires up language, theme, search, PWA install and the
 * statistics view (js/stats.js, loaded on demand).
 */
import {
  LANGUAGES, applyTranslations, detectLanguage, formatDateTime, formatDuration, formatTime,
  getLanguage, onLanguageChange, setLanguage, t,
} from "./i18n.js";
import { FALLBACK_RULES } from "./rules.js";
import { translatePrinterMessage } from "./printer-messages.js";
import { buildPrinter, countStatuses, needsAttention, newestUpdate, sortPrinters } from "./printers.js";
import { initNotifications, processCritical, updateButton as updateNotificationButton } from "./notifications.js";
import { $, $$, escapeHtml, fetchJson, isTruthyFlag, storage } from "./util.js";

const DEFAULT_CONFIG = {
  title: "",
  logo: "",
  dataUrl: "printer_data.json",
  apiUrl: "api/",
  pollSeconds: 8,
  staleAfterMinutes: 5,
  lowPaperSheets: 55,
  defaultLanguage: "auto",
  defaultView: "attention",
};
const SERVICE_CACHE_MS = 30000;
const params = new URLSearchParams(location.search);

/** null (off), "attention" or "all". */
function kioskMode(value) {
  const v = String(value ?? "").toLowerCase();
  if (v === "all") return "all";
  if (isTruthyFlag(v) || v === "attention") return "attention";
  return null;
}

function readJson(text, fallback) {
  try {
    return text ? JSON.parse(text) : fallback;
  } catch {
    return fallback;
  }
}

const state = {
  config: DEFAULT_CONFIG,
  rules: FALLBACK_RULES,
  demo: isTruthyFlag(params.get("demo")),
  hideConsumables: isTruthyFlag(params.get("ignoreconsumables")),
  summaryOnly: params.get("view") === "summary",
  // Kiosk mode for wall screens/TVs: large cards and nothing else.
  //   ?kiosk=1   – only the printers that need attention
  //   ?kiosk=all – every printer (problems first)
  kiosk: kioskMode(params.get("kiosk")),
  view: "attention", // "attention" | "all"
  statusFilter: null, // null | "critical" | "warning" | "ok" | "service"
  search: kioskMode(params.get("kiosk")) ? "" : storage.get("rm_search") || "",
  raw: null,
  printers: [],
  lastSuccess: null,
  lastError: null,
  expanded: new Set(readJson(storage.get("rm_expanded"), [])),
  history: false,
  service: new Map(),
  serviceFetchedAt: 0,
  renderKey: "",
  statsModule: null,
};

const el = {
  title: $("#appTitle"),
  logo: $("#brandLogo"),
  liveText: $("#liveText"),
  live: $("#liveStatus"),
  grid: $("#printerGrid"),
  alerts: $("#alertsPanel"),
  alertsList: $("#alertsList"),
  empty: $("#emptyState"),
  noMatch: $("#noMatch"),
  banner: $("#banner"),
  search: $("#searchBox"),
  clearSearch: $("#clearSearch"),
  language: $("#languageSelect"),
  theme: $("#themeToggle"),
  install: $("#installButton"),
  printerView: $("#printerView"),
  statsView: $("#statsView"),
  tabPrinters: $("#tabPrinters"),
  tabStats: $("#tabStats"),
};

/* ---------------------------------------------------------------------------
 * Theme
 * ------------------------------------------------------------------------- */

const currentTheme = () =>
  document.documentElement.dataset.theme ||
  (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");

function updateThemeButton() {
  const dark = currentTheme() === "dark";
  el.theme.textContent = "";
  el.theme.title = t(dark ? "nav.theme.light" : "nav.theme.dark");
  el.theme.setAttribute("aria-label", el.theme.title);
}

el.theme.addEventListener("click", () => {
  const next = currentTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  storage.set("rm_theme", next);
  updateThemeButton();
});

/* ---------------------------------------------------------------------------
 * Language
 * ------------------------------------------------------------------------- */

function buildLanguageSelect() {
  el.language.innerHTML = Object.entries(LANGUAGES)
    .map(([code, { name }]) => `<option value="${code}">${escapeHtml(name)}</option>`)
    .join("");
  el.language.value = getLanguage();
  el.language.addEventListener("change", () => setLanguage(el.language.value));
}

onLanguageChange(() => {
  el.language.value = getLanguage();
  const title = state.config.title || t("app.title");
  el.title.textContent = title;
  document.title = title;
  updateThemeButton();
  updateNotificationButton();
  state.renderKey = "";
  if (state.raw) render();
  updateLiveStatus();
  state.statsModule?.refreshLanguage();
});

/* ---------------------------------------------------------------------------
 * Data loading
 * ------------------------------------------------------------------------- */

const apiUrl = (file) => `${state.config.apiUrl.replace(/\/?$/, "/")}${file}`;

async function loadConfig() {
  try {
    state.config = { ...DEFAULT_CONFIG, ...(await fetchJson("config.json")) };
  } catch {
    state.config = DEFAULT_CONFIG;
  }
  if (state.demo) {
    state.config.dataUrl = "demo/printer_data.json";
    state.config.apiUrl = "";
  }
  if (params.get("view") === "all") state.view = "all";
  else if (params.get("view") !== "attention") state.view = state.config.defaultView === "all" ? "all" : "attention";
}

async function loadRules() {
  try {
    state.rules = await fetchJson("error_rules.json");
  } catch (error) {
    console.warn("Could not load error_rules.json, using built-in fallback rules:", error);
  }
}

async function detectHistory() {
  if (!state.config.apiUrl) return false;
  try {
    const payload = await fetchJson(apiUrl("service-status.php"));
    state.history = payload.history !== false;
    storeService(payload);
  } catch {
    state.history = false; // static hosting without PHP: history features stay hidden
  }
  el.tabStats.hidden = !state.history;
  $("#adminLink").hidden = !state.history;
  return state.history;
}

function storeService(payload) {
  const map = new Map();
  for (const item of payload.printers || []) {
    if (item.printer_id) map.set(item.printer_id, item);
    map.set(`name:${item.printer_name}`, item);
  }
  state.service = map;
  state.serviceFetchedAt = Date.now();
}

async function refreshService() {
  if (!state.history || Date.now() - state.serviceFetchedAt < SERVICE_CACHE_MS) return;
  try {
    storeService(await fetchJson(apiUrl("service-status.php")));
  } catch (error) {
    console.warn("Could not load service status:", error);
  }
}

function serviceFor(raw, id) {
  return state.service.get(id) || state.service.get(`name:${raw.Name}`) || null;
}

async function poll() {
  try {
    const [data] = await Promise.all([fetchJson(state.config.dataUrl), refreshService()]);
    if (!Array.isArray(data)) throw new Error("printer_data.json is not a list");
    state.raw = data;
    state.lastSuccess = new Date();
    state.lastError = null;
    rebuild();
    processCritical(state.printers);
  } catch (error) {
    state.lastError = error.message || String(error);
    console.error("Could not load printer data:", error);
  }
  updateLiveStatus();
  setTimeout(poll, Math.max(3, Number(state.config.pollSeconds) || 8) * 1000);
}

function rebuild() {
  state.printers = (state.raw || []).map((raw) => {
    const printer = buildPrinter(raw, {
      rules: state.rules,
      hideConsumables: state.hideConsumables,
      lowPaperSheets: Number(state.config.lowPaperSheets) || 55,
    });
    printer.service = serviceFor(raw, printer.id);
    return printer;
  });
  render();
}

/* ---------------------------------------------------------------------------
 * Rendering
 * ------------------------------------------------------------------------- */

const msg = (text) => escapeHtml(translatePrinterMessage(text, getLanguage()));

function updateLiveStatus() {
  const newest = newestUpdate(state.printers);
  const ageSeconds = newest ? (Date.now() - newest.getTime()) / 1000 : null;
  const staleLimit = (Number(state.config.staleAfterMinutes) || 5) * 60;

  let mode = "ok";
  let text = newest ? t("live.updated", { time: formatTime(newest) }) : t("app.loading");
  if (state.lastError) {
    mode = "error";
    text = t("live.error", { error: state.lastError });
  } else if (ageSeconds !== null && ageSeconds > staleLimit && !state.demo) {
    mode = "stale";
    text = t("live.stale", { age: formatDuration(ageSeconds) });
  }
  if (state.demo) text = `${t("live.demo")} · ${text}`;

  el.live.dataset.mode = mode;
  el.liveText.textContent = text;
  if (state.kiosk) {
    const bar = $("#kioskBar");
    bar.dataset.mode = mode;
    $("#kioskText").textContent = `${state.config.title || t("app.title")} · ${text}`;
  }
  el.banner.hidden = mode !== "error";
  el.banner.dataset.mode = mode;
  el.banner.textContent = mode === "ok" ? "" : text;
}

function tonerBar(supply) {
  const name = supply.color !== "unknown" ? t(`toner.${supply.color}`) : supply.label || t("toner.unknown");
  const known = supply.percent !== null && supply.percent !== undefined;
  const percent = known ? Math.round(supply.percent) : supply.someRemaining ? 100 : 0;
  const value = known ? `${percent}%` : supply.someRemaining ? t("toner.ok") : "?";
  const level = known && percent <= 5 ? "empty" : known && percent <= 15 ? "low" : "";
  return `
    <div class="toner ${level ? `is-${level}` : ""}" data-color="${escapeHtml(supply.color)}" title="${escapeHtml(supply.label || name)}">
      <div class="toner-meta"><span>${escapeHtml(name)}</span><span>${escapeHtml(value)}</span></div>
      <div class="toner-track" role="progressbar" aria-label="${escapeHtml(name)}" aria-valuemin="0" aria-valuemax="100" ${known ? `aria-valuenow="${percent}"` : ""}>
        <div class="toner-fill" style="--level:${percent}%"></div>
      </div>
    </div>`;
}

function trayChip(tray) {
  const name = tray.name ? translatePrinterMessage(tray.name, getLanguage()) : t("tray.name", { n: tray.number });
  let value;
  switch (tray.state) {
    case "has-paper": value = t("tray.hasPaper"); break;
    case "missing": value = t("tray.missing"); break;
    case "empty": value = t("tray.empty"); break;
    default: value = t("tray.sheets", { n: tray.level });
  }
  const fill = tray.max && tray.level >= 0 ? Math.min(100, Math.round((tray.level / tray.max) * 100)) : null;
  return `
    <li class="tray is-${tray.state}">
      <span class="tray-name">${escapeHtml(name)}</span>
      <span class="tray-value">${escapeHtml(value)}</span>
      ${fill !== null ? `<span class="tray-fill" style="--level:${fill}%"></span>` : ""}
    </li>`;
}

function serviceBox(service) {
  if (!service) return "";
  const note = String(service.service_note || "").trim();
  return `
    <div class="service-box" role="note">
      <strong>${escapeHtml(t("service.title"))}</strong>
      ${service.service_reported_at ? `<span>${escapeHtml(t("service.reportedAt", { time: formatDateTime(service.service_reported_at) }))}</span>` : ""}
      ${note ? `<p>${escapeHtml(note)}</p>` : ""}
    </div>`;
}

function printerCard(p) {
  const expanded = state.expanded.has(p.id);
  const statusKey = p.offline ? "offline" : p.status;
  const messages = p.messages.length
    ? `<ul class="messages">${p.messages
        .map((m) => `<li class="msg level-${m.level}"><span>${msg(m.message)}</span>${m.code ? `<code>${escapeHtml(m.code)}</code>` : ""}</li>`)
        .join("")}</ul>`
    : p.offline ? "" : `<p class="no-messages">${escapeHtml(t("card.noMessages"))}</p>`;

  return `
  <article class="card printer status-${p.status}${p.service ? " has-service" : ""}${p.offline ? " is-offline" : ""}" data-id="${escapeHtml(p.id)}">
    ${p.service ? '<div class="service-tape" aria-hidden="true"><span>SERVICE · SERVICE · SERVICE · SERVICE · SERVICE · SERVICE · SERVICE</span></div>' : ""}
    <header class="printer-head">
      <img class="printer-photo" src="${escapeHtml(p.image)}" alt="" loading="lazy" width="64" height="64">
      <div class="printer-title">
        <h3>${escapeHtml(p.name)}</h3>
        <span class="printer-model">${escapeHtml(p.model || "–")}</span>
      </div>
      <span class="status-pill status-${statusKey}">${escapeHtml(t(`status.${statusKey}`))}</span>
    </header>
    ${serviceBox(p.service)}
    ${p.offline ? `<p class="offline-note">${escapeHtml(t("card.offline"))}</p>` : ""}
    ${messages}
    ${p.supplies.length ? `<section class="supplies" aria-label="${escapeHtml(t("card.toner"))}">${p.supplies.map(tonerBar).join("")}</section>` : ""}
    ${p.trays.length ? `<ul class="trays" aria-label="${escapeHtml(t("card.paper"))}">${p.trays.map(trayChip).join("")}</ul>` : ""}
    <button type="button" class="details-toggle" aria-expanded="${expanded}">
      ${escapeHtml(t(expanded ? "card.hideDetails" : "card.details"))}<span aria-hidden="true">▾</span>
    </button>
    <dl class="details" ${expanded ? "" : "hidden"}>
      <div><dt>${escapeHtml(t("card.ip"))}</dt><dd>${p.host ? `<a href="http://${escapeHtml(p.host)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(t("card.openWeb"))}">${escapeHtml(p.host)} ↗</a>` : escapeHtml(p.ip || "–")}</dd></div>
      <div><dt>${escapeHtml(t("card.serial"))}</dt><dd>${p.serial ? `<button type="button" class="copy" data-copy="${escapeHtml(p.serial)}" title="${escapeHtml(t("card.copy"))}">${escapeHtml(p.serial)}</button>` : "–"}</dd></div>
      <div><dt>${escapeHtml(t("card.updated"))}</dt><dd>${escapeHtml(p.updated ? formatDateTime(p.updated) : "–")}</dd></div>
    </dl>
  </article>`;
}

function alertsHtml(printers) {
  return printers
    .filter((p) => p.status !== "ok")
    .map((p) => {
      const relevant = p.messages.filter((m) => m.level === p.status);
      const text = p.offline ? t("status.offline") : relevant.map((m) => translatePrinterMessage(m.message, getLanguage())).join(", ");
      return `
        <li class="alert level-${p.status}">
          <strong>${escapeHtml(p.name)}</strong>${p.model ? ` <small>${escapeHtml(p.model)}</small>` : ""}
          <span>${escapeHtml(text)}</span>
          ${p.service ? `<span class="service-badge">${escapeHtml(t("service.badge"))}</span>` : ""}
        </li>`;
    })
    .join("");
}

function visiblePrinters() {
  let list = sortPrinters(state.printers);
  if (state.statusFilter === "service") list = list.filter((p) => p.service);
  else if (state.statusFilter) list = list.filter((p) => p.status === state.statusFilter);
  else if (state.view === "attention") list = list.filter(needsAttention);
  return list;
}

function render() {
  const printers = visiblePrinters();
  const counts = countStatuses(state.printers);
  const key = JSON.stringify([state.raw, [...state.service.keys()], state.view, state.statusFilter, getLanguage(), [...state.expanded]]);

  for (const name of ["critical", "warning", "ok", "service"]) {
    $(`#count-${name}`).textContent = String(counts[name]);
  }
  $$(".tile").forEach((tile) => tile.setAttribute("aria-pressed", String(tile.dataset.filter === state.statusFilter)));
  $$("[data-view]").forEach((button) => button.setAttribute("aria-pressed", String(!state.statusFilter && button.dataset.view === state.view)));
  $("#tile-service").hidden = !state.history && counts.service === 0;

  if (key !== state.renderKey) {
    state.renderKey = key;
    el.grid.innerHTML = printers.map(printerCard).join("");
    if (state.kiosk) {
      // Fill a landscape screen: 1 card = 1 column, 2–4 = 2, 5–9 = 3, 10–16 = 4, 17–25 = 5, more = 6.
      const n = printers.length;
      const cols = n <= 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : n <= 16 ? 4 : n <= 25 ? 5 : 6;
      document.body.style.setProperty("--kiosk-cols", String(cols));
      document.body.dataset.kioskCols = String(cols);
    }
    const alerts = alertsHtml(sortPrinters(state.printers));
    el.alertsList.innerHTML = alerts;
    el.alerts.hidden = !alerts;
  }

  const nothingWrong = state.view === "attention" && !state.statusFilter && printers.length === 0;
  el.empty.hidden = !nothingWrong;
  $("#emptyText").textContent = state.printers.length ? t("empty.text") : t("empty.noPrinters");
  $("#emptyTitle").textContent = state.printers.length ? t("empty.title") : t("app.title");
  applySearch();
}

function applySearch() {
  const query = state.search.trim().toLowerCase();
  let visible = 0;
  $$(".printer", el.grid).forEach((card) => {
    const match = !query || card.textContent.toLowerCase().includes(query);
    card.hidden = !match;
    if (match) visible += 1;
  });
  el.clearSearch.hidden = !query;
  el.noMatch.hidden = !query || visible > 0 || el.grid.children.length === 0;
  el.noMatch.textContent = t("filter.noMatch", { query: state.search.trim() });
}

/* ---------------------------------------------------------------------------
 * Interaction
 * ------------------------------------------------------------------------- */

function bindEvents() {
  el.grid.addEventListener("click", async (event) => {
    const toggle = event.target.closest(".details-toggle");
    if (toggle) {
      const id = toggle.closest(".printer").dataset.id;
      if (state.expanded.has(id)) state.expanded.delete(id);
      else state.expanded.add(id);
      storage.set("rm_expanded", JSON.stringify([...state.expanded]));
      render();
      return;
    }
    const copy = event.target.closest(".copy");
    if (copy) {
      try {
        await navigator.clipboard.writeText(copy.dataset.copy);
        copy.dataset.copied = t("card.copied");
        setTimeout(() => delete copy.dataset.copied, 1200);
      } catch { /* clipboard needs HTTPS */ }
    }
  });

  // Missing model photo -> generic image (no inline handlers needed).
  document.addEventListener("error", (event) => {
    const img = event.target;
    if (img instanceof HTMLImageElement && img.classList.contains("printer-photo") && !img.src.endsWith("missing.png")) {
      img.src = "images/missing.png";
    }
  }, true);

  $$("[data-view]").forEach((button) =>
    button.addEventListener("click", () => {
      state.view = button.dataset.view;
      state.statusFilter = null;
      render();
    })
  );

  $$(".tile").forEach((tile) =>
    tile.addEventListener("click", () => {
      state.statusFilter = state.statusFilter === tile.dataset.filter ? null : tile.dataset.filter;
      render();
    })
  );

  el.search.value = state.search;
  let timer;
  el.search.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.search = el.search.value;
      storage.set("rm_search", state.search);
      applySearch();
    }, 150);
  });
  el.clearSearch.addEventListener("click", () => {
    el.search.value = "";
    state.search = "";
    storage.remove("rm_search");
    applySearch();
    el.search.focus();
  });

  el.tabPrinters.addEventListener("click", () => showView("printers"));
  el.tabStats.addEventListener("click", () => showView("stats"));
  window.addEventListener("popstate", () => showView(isTruthyFlag(new URLSearchParams(location.search).get("stats")) ? "stats" : "printers", false));

  setInterval(updateLiveStatus, 15000);
}

async function showView(view, push = true) {
  const stats = view === "stats" && state.history;
  el.printerView.hidden = stats;
  el.statsView.hidden = !stats;
  el.tabPrinters.setAttribute("aria-selected", String(!stats));
  el.tabStats.setAttribute("aria-selected", String(stats));
  if (push) {
    const url = new URL(location.href);
    if (stats) url.searchParams.set("stats", "1");
    else url.searchParams.delete("stats");
    history.pushState(null, "", url);
  }
  if (stats) {
    state.statsModule ||= await import("./stats.js");
    state.statsModule.start(el.statsView, apiUrl);
  } else {
    state.statsModule?.stop();
  }
}

/* ---------------------------------------------------------------------------
 * Kiosk mode (?kiosk=1 or ?kiosk=all)
 * ------------------------------------------------------------------------- */

function startKiosk() {
  document.body.classList.add("kiosk", `kiosk-${state.kiosk}`);
  state.view = state.kiosk === "all" ? "all" : "attention";
  state.statusFilter = null;
  $("#kioskBar").hidden = false;

  // When there are more problem printers than fit on the screen, scroll slowly
  // down, pause, and jump back to the top – so every card is seen.
  let direction = 1;
  let pauseUntil = Date.now() + 8000;
  setInterval(() => {
    const max = document.documentElement.scrollHeight - innerHeight;
    if (max <= 4 || Date.now() < pauseUntil) return;
    if (direction > 0 && scrollY >= max - 1) {
      direction = -1;
      pauseUntil = Date.now() + 8000;
    } else if (direction < 0) {
      scrollTo({ top: 0, behavior: "smooth" });
      direction = 1;
      pauseUntil = Date.now() + 10000;
    } else {
      scrollBy(0, 1);
    }
  }, 40);
}

/* ---------------------------------------------------------------------------
 * PWA install button
 * ------------------------------------------------------------------------- */

function initInstall() {
  let deferred = null;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferred = event;
    el.install.hidden = false;
  });
  el.install.addEventListener("click", async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice;
    deferred = null;
    el.install.hidden = true;
  });
  window.addEventListener("appinstalled", () => { el.install.hidden = true; });
}

/* ---------------------------------------------------------------------------
 * Start
 * ------------------------------------------------------------------------- */

async function main() {
  await loadConfig();
  if (state.summaryOnly) document.body.classList.add("summary-only");
  if (state.kiosk) startKiosk();
  // Only same-site relative image paths are accepted for the logo.
  if (state.config.logo && /^[\w./-]+\.(png|jpe?g|svg|webp|gif)$/i.test(state.config.logo) && !state.config.logo.startsWith("//")) {
    el.logo.src = state.config.logo;
    el.logo.hidden = false;
  }

  setLanguage(detectLanguage(state.config.defaultLanguage), { persist: Boolean(params.get("lang")) });
  buildLanguageSelect();
  applyTranslations();
  initNotifications($("#notificationToggle"));
  initInstall();
  bindEvents();

  await Promise.all([loadRules(), detectHistory()]);
  poll();

  if (isTruthyFlag(params.get("stats"))) showView("stats", false);
}

main();
