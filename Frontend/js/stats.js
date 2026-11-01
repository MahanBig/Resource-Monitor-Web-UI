/*
 * Statistics & event log view (?stats=1). Needs the PHP history API.
 */
import { formatDateTime, formatDuration, formatNumber, formatTime, getLanguage, t } from "./i18n.js";
import { translatePrinterMessage } from "./printer-messages.js";
import { escapeHtml, fetchJson } from "./util.js";

const PERIODS = ["today", "week", "month", "year", "all"];
const REFRESH_MS = 30000;

let root = null;
let api = null;
let period = "today";
let timer = null;
let lastData = null;

const h = escapeHtml;
const msg = (text) => h(translatePrinterMessage(text, getLanguage()));
const num = (value) => formatNumber(Number(value) || 0);
const code = (row) => (row.error_code ? ` <code>${h(row.error_code)}</code>` : "");

const pill = (severity) => `<span class="pill pill-${h(severity)}">${h(t(`severity.${severity}`) || severity)}</span>`;

const serviceBadge = (row) => {
  if (!row || row.service_status !== "reported") return "";
  const note = String(row.service_note || "").trim();
  return `<span class="service-badge" title="${h(note || t("service.title"))}">${h(t("service.badge"))}</span>`;
};

const colorLabel = (color) => t(`toner.${color || "unknown"}`);

function skeleton() {
  const tile = (id, label, tone = "") => `
    <div class="stat ${tone}"><span class="stat-label">${h(t(label))}</span><strong class="stat-value" id="${id}">…</strong></div>`;
  const table = (id, heads) => `
    <div class="table-scroll"><table class="data-table">
      <thead><tr>${heads.map((head) => `<th scope="col">${h(t(head))}</th>`).join("")}</tr></thead>
      <tbody id="${id}"></tbody>
    </table></div>`;
  const panel = (title, body, extra = "") => `
    <section class="card panel"><header class="panel-head"><h3>${h(t(title))}</h3>${extra}</header>${body}</section>`;

  root.innerHTML = `
    <div class="stats-head">
      <div>
        <h2>${h(t("stats.title"))}</h2>
        <p class="muted">${h(t("stats.subtitle"))}</p>
      </div>
      <span class="muted small" id="statsUpdated"></span>
    </div>

    <div class="segmented" role="group" aria-label="${h(t("stats.period"))}">
      ${PERIODS.map((key) => `<button type="button" data-period="${key}" aria-pressed="${key === period}">${h(t(`period.${key}`))}</button>`).join("")}
    </div>

    <div id="statsError" class="banner" data-mode="error" hidden></div>

    <div class="stat-grid">
      ${tile("statOpened", "stats.opened", "tone-critical")}
      ${tile("statResolved", "stats.resolved", "tone-ok")}
      ${tile("statCritical", "stats.criticalCount")}
      ${tile("statWarning", "stats.warningCount", "tone-warning")}
      ${tile("statOther", "stats.otherCount")}
      ${tile("statPrinters", "stats.printers")}
      ${tile("statAvg", "stats.avgResolution")}
      ${tile("statActive", "stats.active", "tone-accent")}
      ${tile("statActiveCritical", "stats.activeCritical", "tone-critical")}
      ${tile("statActiveWarning", "stats.activeWarning", "tone-warning")}
    </div>

    <h3 class="section-title">${h(t("stats.consumables"))}</h3>
    <div class="stat-grid">
      ${tile("statTonerReplaced", "stats.tonerReplaced", "tone-accent")}
      ${tile("statTonerAlerts", "stats.tonerAlerts")}
      ${tile("statActiveToner", "stats.activeToner")}
      ${tile("statPaperRefilled", "stats.paperRefilled", "tone-ok")}
      ${tile("statPaperEmpty", "stats.paperEmpty")}
      ${tile("statActivePaper", "stats.activePaper")}
    </div>

    <div class="panel-grid">
      ${panel("stats.printerBoard", table("printerBoard", ["col.rank", "col.printer", "col.total", "col.critical", "col.warning", "col.other"]))}
      ${panel("stats.errorBoard", table("errorBoard", ["col.rank", "col.error", "col.count", "col.avgTime"]))}
      ${panel("stats.tonerBoard", table("tonerBoard", ["col.rank", "col.printer", "col.total", "toner.black", "toner.cyan", "toner.magenta", "toner.yellow", "toner.waste"]))}
      ${panel("stats.paperBoard", table("paperBoard", ["col.rank", "col.printer", "col.refills"]))}
      ${panel("stats.longest", '<div id="longest" class="list"></div>')}
      ${panel("stats.activeIncidents", '<div id="activeIncidents" class="list"></div>')}
    </div>
    ${panel("stats.activeConsumables", '<div id="activeConsumables" class="list"></div>')}
    ${panel("stats.events", '<div id="eventLog" class="event-log"></div>', '<span class="muted small" id="eventCount"></span>')}
  `;

  root.querySelectorAll("[data-period]").forEach((button) =>
    button.addEventListener("click", () => {
      period = button.dataset.period;
      root.querySelectorAll("[data-period]").forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
      load();
    })
  );
}

const $id = (id) => root.querySelector(`#${id}`);
const empty = (text, cols) => (cols ? `<tr><td colspan="${cols}" class="empty-cell">${h(t(text))}</td></tr>` : `<p class="empty-cell">${h(t(text))}</p>`);
const printerCell = (row) => `<strong>${h(row.printer_name)}</strong>${row.printer_model ? `<br><small class="muted">${h(row.printer_model)}</small>` : ""}`;

function renderTables(stats) {
  const boards = {
    printerBoard: [stats.printer_leaderboard, 6, "stats.noFaults", (r, i) =>
      `<td class="rank">${i + 1}</td><td>${printerCell(r)}</td><td><strong>${num(r.total)}</strong></td><td>${num(r.critical)}</td><td>${num(r.warning)}</td><td>${num(r.other)}</td>`],
    errorBoard: [stats.error_leaderboard, 4, "stats.noFaults", (r, i) =>
      `<td class="rank">${i + 1}</td><td>${pill(r.severity)} ${msg(r.error_message)}${code(r)}</td><td>${num(r.total)}</td><td>${h(formatDuration(r.avg_resolution_seconds))}</td>`],
    tonerBoard: [stats.toner_leaderboard, 8, "stats.noToner", (r, i) =>
      `<td class="rank">${i + 1}</td><td>${printerCell(r)}</td><td><strong>${num(r.total)}</strong></td><td>${num(r.black_count)}</td><td>${num(r.cyan_count)}</td><td>${num(r.magenta_count)}</td><td>${num(r.yellow_count)}</td><td>${num(r.waste_count)}</td>`],
    paperBoard: [stats.paper_leaderboard, 3, "stats.noPaper", (r, i) =>
      `<td class="rank">${i + 1}</td><td><strong>${h(r.printer_name)}</strong></td><td>${num(r.total)}</td>`],
  };
  for (const [id, [rows, cols, emptyKey, row]] of Object.entries(boards)) {
    $id(id).innerHTML = rows?.length ? rows.map((r, i) => `<tr>${row(r, i)}</tr>`).join("") : empty(emptyKey, cols);
  }

  const longest = stats.longest_incident;
  $id("longest").innerHTML = longest
    ? `<div class="list-item">
        <strong>${h(longest.printer_name)}</strong>
        <div>${pill(longest.severity)} ${msg(longest.error_message)}${code(longest)}</div>
        <div>${h(t("stats.duration", { duration: formatDuration(longest.duration_seconds) }))}</div>
        <small class="muted">${h(formatDateTime(longest.opened_at))} → ${h(formatDateTime(longest.resolved_at))}</small>
      </div>`
    : empty("stats.noLongest");

  $id("activeIncidents").innerHTML = stats.active_incidents?.length
    ? stats.active_incidents.map((r) => `
      <div class="list-item${r.service_status === "reported" ? " has-service" : ""}">
        <div>${pill(r.severity)} <strong>${h(r.printer_name)}</strong> – ${msg(r.error_message)}${code(r)} ${serviceBadge(r)}</div>
        <small class="muted">${h(t("stats.startedFor", { time: formatDateTime(r.opened_at), duration: formatDuration(r.duration_seconds) }))}${
          r.service_status === "reported" && r.service_reported_at ? h(t("stats.serviceSince", { time: formatDateTime(r.service_reported_at) })) : ""
        }</small>
      </div>`).join("")
    : empty("stats.noActive");

  $id("activeConsumables").innerHTML = stats.active_consumables?.length
    ? stats.active_consumables.map((r) => {
        const toner = r.severity === "toner";
        const detail = toner
          ? `${h(colorLabel(r.consumable_color))}${r.toner_level_last !== null && r.toner_level_last !== undefined ? h(t("stats.lastMeasured", { n: r.toner_level_last })) : ""}`
          : `${r.paper_tray ? `${h(t("stats.trayN", { n: r.paper_tray }))} · ` : ""}${msg(r.error_message)}`;
        const meta = r.missing_since
          ? `<small class="pending">${h(t("stats.pending", { time: formatDateTime(r.missing_since) }))}</small>`
          : `<small class="muted">${h(t("stats.registered", { time: formatDateTime(r.opened_at), duration: formatDuration(r.duration_seconds) }))}</small>`;
        return `<div class="list-item"><div>${pill(r.severity)} <strong>${h(r.printer_name)}</strong> – ${detail}</div>${meta}</div>`;
      }).join("")
    : empty("stats.noConsumables");
}

function eventRow(e) {
  const resolved = e.event_type === "resolved";
  const service = e.event_type === "service_reported";
  let icon = resolved ? "✅" : "🔵";
  let action = t(resolved ? "event.resolved" : "event.opened");
  let text = `${msg(e.error_message)}${code(e)}`;

  if (service) {
    icon = "🔧";
    action = t("event.service");
    if (e.service_note) text += ` · ${h(e.service_note)}`;
  } else if (e.severity === "critical") {
    icon = resolved ? "✅" : "🔴";
  } else if (e.severity === "warning") {
    icon = resolved ? "✅" : "🟠";
  } else if (e.severity === "toner") {
    if (resolved && e.resolution_type === "replaced") {
      icon = "🖨";
      action = t("event.tonerReplaced");
      text = h(colorLabel(e.consumable_color));
      if (e.toner_level_resolved !== null && e.toner_level_resolved !== undefined) text += ` · ${num(e.toner_level_resolved)} %`;
      if (Number(e.replacement_confirmed_by_level) === 1) text += ` · ${h(t("event.levelConfirmed"))}`;
    } else if (!resolved) {
      icon = "🖨";
      action = t("event.tonerAlert");
      text = `${h(colorLabel(e.consumable_color))} · ${text}`;
    }
  } else if (e.severity === "paper") {
    if (resolved && e.resolution_type === "refilled") {
      icon = "📄";
      action = t("event.paperRefilled");
      text = e.paper_tray ? h(t("stats.trayN", { n: e.paper_tray })) : msg(e.error_message);
    } else if (!resolved) {
      icon = "📄";
      action = t("event.paperEmpty");
    }
  }

  const duration = resolved
    ? formatDuration(e.duration_seconds)
    : service && e.duration_seconds !== null ? t("event.after", { duration: formatDuration(e.duration_seconds) }) : "";

  return `
    <div class="event">
      <time class="event-time">${h(formatDateTime(e.event_at, { year: false }))}</time>
      <span class="event-icon" aria-hidden="true">${icon}</span>
      <span class="event-printer">${h(e.printer_name)}</span>
      <span class="event-text">${pill(e.severity)} ${h(action)}: ${text} ${service ? "" : serviceBadge(e)}</span>
      <span class="event-duration">${h(duration)}</span>
    </div>`;
}

function renderAll(stats, events) {
  const s = stats.summary || {};
  const set = (id, value) => { $id(id).textContent = value; };
  set("statOpened", num(s.opened_count));
  set("statResolved", num(s.resolved_count));
  set("statCritical", num(s.critical_count));
  set("statWarning", num(s.warning_count));
  set("statOther", num(s.other_count));
  set("statPrinters", num(s.affected_printers));
  set("statAvg", formatDuration(s.avg_resolution_seconds));
  set("statActive", num(s.active_total));
  set("statActiveCritical", num(s.active_critical));
  set("statActiveWarning", num(s.active_warning));
  set("statTonerReplaced", num(s.toner_replaced_count));
  set("statTonerAlerts", num(s.toner_alerts_count));
  set("statActiveToner", num(s.active_toner));
  set("statPaperRefilled", num(s.paper_refilled_count));
  set("statPaperEmpty", num(s.paper_empty_count));
  set("statActivePaper", num(s.active_paper));

  renderTables(stats);

  const list = events.events || [];
  $id("eventCount").textContent = t("stats.eventCount", { n: list.length });
  $id("eventLog").innerHTML = list.length ? list.map(eventRow).join("") : empty("stats.noEvents");
  $id("statsUpdated").textContent = t("stats.updated", { time: formatTime(new Date(), { seconds: true }) });
}

async function load() {
  if (!root) return;
  const error = $id("statsError");
  try {
    const [stats, events] = await Promise.all([
      fetchJson(api(`stats.php?period=${encodeURIComponent(period)}`)),
      fetchJson(api(`events.php?period=${encodeURIComponent(period)}&limit=200`)),
    ]);
    lastData = [stats, events];
    error.hidden = true;
    renderAll(stats, events);
  } catch (err) {
    error.hidden = false;
    error.textContent = t("stats.error", { error: err.message || String(err) });
  }
}

export function start(container, apiUrl) {
  root = container;
  api = apiUrl;
  skeleton();
  if (lastData) renderAll(...lastData);
  load();
  clearInterval(timer);
  timer = setInterval(load, REFRESH_MS);
}

export function stop() {
  clearInterval(timer);
  timer = null;
}

export function refreshLanguage() {
  if (!root || root.hidden) return;
  skeleton();
  if (lastData) renderAll(...lastData);
}
