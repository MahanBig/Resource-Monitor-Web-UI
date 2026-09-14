document.addEventListener("DOMContentLoaded", () => {
  const params = new URLSearchParams(window.location.search);
  const statsMode = params.get("stats") === "1" || params.get("stats") === "true";

  const printerView = document.getElementById("printerView");
  const statsView = document.getElementById("statsView");
  const statsToggleButton = document.getElementById("statsToggleButton");

  const toggleStatsMode = () => {
    const url = new URL(window.location.href);
    if (statsMode) url.searchParams.delete("stats");
    else url.searchParams.set("stats", "1");
    window.location.href = url.toString();
  };

  if (statsToggleButton) {
    statsToggleButton.textContent = statsMode ? "🖨 Printere" : "📊 Statistikk";
    statsToggleButton.title = statsMode
      ? "Tilbake til printervisning"
      : "Åpne statistikk og hendelseslogg";
    statsToggleButton.addEventListener("click", toggleStatsMode);
  }

  if (!statsMode) {
    if (statsView) statsView.hidden = true;
    if (printerView) printerView.hidden = false;
    return;
  }

  if (printerView) printerView.hidden = true;
  if (statsView) statsView.hidden = false;

  const byId = (id) => document.getElementById(id);

  const statOpened = byId("statOpened");
  const statResolved = byId("statResolved");
  const statCritical = byId("statCritical");
  const statWarning = byId("statWarning");
  const statOther = byId("statOther");
  const statPrinters = byId("statPrinters");
  const statAvgResolution = byId("statAvgResolution");
  const statActive = byId("statActive");
  const statActiveCritical = byId("statActiveCritical");
  const statActiveWarning = byId("statActiveWarning");

  const statTonerReplaced = byId("statTonerReplaced");
  const statTonerAlerts = byId("statTonerAlerts");
  const statActiveToner = byId("statActiveToner");
  const statPaperRefilled = byId("statPaperRefilled");
  const statPaperEmpty = byId("statPaperEmpty");
  const statActivePaper = byId("statActivePaper");

  const statsLastUpdated = byId("statsLastUpdated");
  const statsPeriodLabel = byId("statsPeriodLabel");
  const printerLeaderboard = byId("printerLeaderboard");
  const errorLeaderboard = byId("errorLeaderboard");
  const tonerLeaderboard = byId("tonerLeaderboard");
  const paperLeaderboard = byId("paperLeaderboard");
  const longestIncident = byId("longestIncident");
  const activeIncidentList = byId("activeIncidentList");
  const activeConsumableList = byId("activeConsumableList");
  const eventLog = byId("eventLog");
  const eventCount = byId("eventCount");
  const periodButtons = Array.from(document.querySelectorAll("[data-period]"));

  let selectedPeriod = "today";
  let refreshTimer = null;

  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  const formatDuration = (seconds) => {
    if (seconds === null || seconds === undefined || Number.isNaN(Number(seconds))) return "–";
    const total = Math.max(0, Math.round(Number(seconds)));
    if (total < 60) return `${total} sek`;
    const minutes = Math.floor(total / 60);
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    if (hours < 24) return remainingMinutes ? `${hours}t ${remainingMinutes}m` : `${hours}t`;
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    return remainingHours ? `${days}d ${remainingHours}t` : `${days}d`;
  };

  const formatDateTime = (value) => {
    if (!value) return "–";
    const date = new Date(String(value).replace(" ", "T"));
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat("nb-NO", {
      day: "2-digit", month: "2-digit", year: "2-digit",
      hour: "2-digit", minute: "2-digit"
    }).format(date);
  };

  const severityLabel = (severity) => ({
    critical: "Kritisk",
    warning: "Warning",
    toner: "Toner",
    paper: "Papir",
    other: "Annet"
  }[severity] || "Annet");

  const colorLabel = (color) => ({
    black: "Sort",
    cyan: "Cyan",
    magenta: "Magenta",
    yellow: "Gul",
    waste: "Brukt toner",
    unknown: "Ukjent"
  }[color] || "Ukjent");

  const severityPill = (severity) =>
    `<span class="severity-pill severity-${escapeHtml(severity)}">${severityLabel(severity)}</span>`;

  const renderPrinterLeaderboard = (rows) => {
    if (!rows?.length) {
      printerLeaderboard.innerHTML = '<tr><td colspan="6" class="empty-state">Ingen tekniske feil i perioden.</td></tr>';
      return;
    }
    printerLeaderboard.innerHTML = rows.map((row, index) => `
      <tr>
        <td class="rank-number">${index + 1}</td>
        <td><strong>${escapeHtml(row.printer_name)}</strong><br><small>${escapeHtml(row.printer_model || "")}</small></td>
        <td>${Number(row.total)}</td>
        <td>${Number(row.critical)}</td>
        <td>${Number(row.warning)}</td>
        <td>${Number(row.other)}</td>
      </tr>
    `).join("");
  };

  const renderErrorLeaderboard = (rows) => {
    if (!rows?.length) {
      errorLeaderboard.innerHTML = '<tr><td colspan="4" class="empty-state">Ingen tekniske feil i perioden.</td></tr>';
      return;
    }
    errorLeaderboard.innerHTML = rows.map((row, index) => `
      <tr>
        <td class="rank-number">${index + 1}</td>
        <td>${severityPill(row.severity)} ${escapeHtml(row.error_message)}${row.error_code ? ` <small>{${escapeHtml(row.error_code)}}</small>` : ""}</td>
        <td>${Number(row.total)}</td>
        <td>${formatDuration(row.avg_resolution_seconds)}</td>
      </tr>
    `).join("");
  };

  const renderTonerLeaderboard = (rows) => {
    if (!rows?.length) {
      tonerLeaderboard.innerHTML = '<tr><td colspan="8" class="empty-state">Ingen bekreftede tonerbytter i perioden.</td></tr>';
      return;
    }
    tonerLeaderboard.innerHTML = rows.map((row, index) => `
      <tr>
        <td class="rank-number">${index + 1}</td>
        <td><strong>${escapeHtml(row.printer_name)}</strong><br><small>${escapeHtml(row.printer_model || "")}</small></td>
        <td><strong>${Number(row.total)}</strong></td>
        <td>${Number(row.black_count)}</td>
        <td>${Number(row.cyan_count)}</td>
        <td>${Number(row.magenta_count)}</td>
        <td>${Number(row.yellow_count)}</td>
        <td>${Number(row.waste_count)}</td>
      </tr>
    `).join("");
  };

  const renderPaperLeaderboard = (rows) => {
    if (!rows?.length) {
      paperLeaderboard.innerHTML = '<tr><td colspan="3" class="empty-state">Ingen registrerte papirpåfyllinger i perioden.</td></tr>';
      return;
    }
    paperLeaderboard.innerHTML = rows.map((row, index) => `
      <tr>
        <td class="rank-number">${index + 1}</td>
        <td><strong>${escapeHtml(row.printer_name)}</strong></td>
        <td>${Number(row.total)}</td>
      </tr>
    `).join("");
  };

  const renderLongestIncident = (incident) => {
    if (!incident) {
      longestIncident.className = "longest-incident empty-state";
      longestIncident.textContent = "Ingen løste tekniske hendelser i perioden.";
      return;
    }
    longestIncident.className = "longest-incident";
    longestIncident.innerHTML = `
      <strong>${escapeHtml(incident.printer_name)}</strong><br>
      ${severityPill(incident.severity)} ${escapeHtml(incident.error_message)}${incident.error_code ? ` {${escapeHtml(incident.error_code)}}` : ""}<br>
      <span>Varighet: <strong>${formatDuration(incident.duration_seconds)}</strong></span><br>
      <small>${formatDateTime(incident.opened_at)} → ${formatDateTime(incident.resolved_at)}</small>
    `;
  };

  const renderActiveIncidents = (rows) => {
    if (!rows?.length) {
      activeIncidentList.innerHTML = '<div class="empty-state">Ingen aktive tekniske hendelser.</div>';
      return;
    }
    activeIncidentList.innerHTML = rows.map(row => `
      <div class="active-incident-item">
        ${severityPill(row.severity)}
        <strong>${escapeHtml(row.printer_name)}</strong> – ${escapeHtml(row.error_message)}${row.error_code ? ` {${escapeHtml(row.error_code)}}` : ""}
        <span class="meta">Startet ${formatDateTime(row.opened_at)} · aktiv i ${formatDuration(row.duration_seconds)}</span>
      </div>
    `).join("");
  };

  const renderActiveConsumables = (rows) => {
    if (!rows?.length) {
      activeConsumableList.innerHTML = '<div class="empty-state">Ingen aktive toner- eller papirvarsler.</div>';
      return;
    }

    activeConsumableList.innerHTML = rows.map(row => {
      const isToner = row.severity === "toner";
      const detail = isToner
        ? `${colorLabel(row.consumable_color)}${row.toner_level_last !== null && row.toner_level_last !== undefined ? ` · sist målt ${Number(row.toner_level_last)} %` : ""}`
        : `${row.paper_tray ? `Magasin ${escapeHtml(row.paper_tray)} · ` : ""}${escapeHtml(row.error_message)}`;
      const pending = row.missing_since
        ? `<span class="meta pending-confirmation">Varsel borte siden ${formatDateTime(row.missing_since)} – venter på bekreftelse</span>`
        : `<span class="meta">Registrert ${formatDateTime(row.opened_at)} · ${formatDuration(row.duration_seconds)}</span>`;

      return `
        <div class="active-incident-item consumable-item">
          ${severityPill(row.severity)}
          <strong>${escapeHtml(row.printer_name)}</strong> – ${detail}
          ${pending}
        </div>
      `;
    }).join("");
  };

  const renderEvents = (events) => {
    eventCount.textContent = `${events?.length || 0} viste hendelser`;
    if (!events?.length) {
      eventLog.innerHTML = '<div class="empty-state">Ingen hendelser i perioden.</div>';
      return;
    }

    eventLog.innerHTML = events.map(event => {
      const isResolved = event.event_type === "resolved";
      let icon = "🔵";
      let action = isResolved ? "Løst" : "Oppstod";
      let message = `${escapeHtml(event.error_message)}${event.error_code ? ` {${escapeHtml(event.error_code)}}` : ""}`;

      if (event.severity === "critical") icon = isResolved ? "✅" : "🔴";
      else if (event.severity === "warning") icon = isResolved ? "✅" : "🟠";
      else if (event.severity === "toner") {
        icon = isResolved ? "✅" : "🖨";
        if (isResolved && event.resolution_type === "replaced") {
          action = "Toner byttet";
          message = colorLabel(event.consumable_color);
          if (event.toner_level_resolved !== null && event.toner_level_resolved !== undefined) {
            message += ` · ${Number(event.toner_level_resolved)} %`;
          }
          if (Number(event.replacement_confirmed_by_level) === 1) message += " · nivå bekreftet";
        } else {
          action = "Tonervarsel";
          message = `${colorLabel(event.consumable_color)} · ${message}`;
        }
      } else if (event.severity === "paper") {
        icon = isResolved ? "✅" : "📄";
        if (isResolved && event.resolution_type === "refilled") {
          action = "Papir fylt på";
          message = event.paper_tray ? `Magasin ${escapeHtml(event.paper_tray)}` : escapeHtml(event.error_message);
        } else {
          action = "Tomt for papir";
        }
      } else if (isResolved) {
        icon = "✅";
      }

      return `
        <div class="event-row">
          <div class="event-time">${formatDateTime(event.event_at)}</div>
          <div class="event-icon" aria-hidden="true">${icon}</div>
          <div class="event-printer">${escapeHtml(event.printer_name)}</div>
          <div class="event-message">
            ${severityPill(event.severity)}
            ${action}: ${message}
          </div>
          <div class="event-duration">${isResolved ? formatDuration(event.duration_seconds) : ""}</div>
        </div>
      `;
    }).join("");
  };

  const loadingElements = [
    statOpened, statResolved, statCritical, statWarning, statOther, statPrinters,
    statAvgResolution, statActive, statActiveCritical, statActiveWarning,
    statTonerReplaced, statTonerAlerts, statActiveToner,
    statPaperRefilled, statPaperEmpty, statActivePaper
  ];

  const setLoading = () => loadingElements.forEach(element => {
    if (element) element.textContent = "…";
  });

  const showError = (message) => {
    eventLog.innerHTML = `<div class="stats-error">Kunne ikke laste statistikk: ${escapeHtml(message)}</div>`;
  };

  const loadDashboard = async () => {
    setLoading();

    try {
      const [statsResponse, eventsResponse] = await Promise.all([
        fetch(`api/stats.php?period=${encodeURIComponent(selectedPeriod)}`, { cache: "no-store" }),
        fetch(`api/events.php?period=${encodeURIComponent(selectedPeriod)}&limit=200`, { cache: "no-store" })
      ]);

      if (!statsResponse.ok) throw new Error(`stats.php svarte HTTP ${statsResponse.status}`);
      if (!eventsResponse.ok) throw new Error(`events.php svarte HTTP ${eventsResponse.status}`);

      const stats = await statsResponse.json();
      const events = await eventsResponse.json();

      statOpened.textContent = Number(stats.summary.opened_count || 0);
      statResolved.textContent = Number(stats.summary.resolved_count || 0);
      statCritical.textContent = Number(stats.summary.critical_count || 0);
      statWarning.textContent = Number(stats.summary.warning_count || 0);
      statOther.textContent = Number(stats.summary.other_count || 0);
      statPrinters.textContent = Number(stats.summary.affected_printers || 0);
      statAvgResolution.textContent = formatDuration(stats.summary.avg_resolution_seconds);
      statActive.textContent = Number(stats.summary.active_total || 0);
      statActiveCritical.textContent = Number(stats.summary.active_critical || 0);
      statActiveWarning.textContent = Number(stats.summary.active_warning || 0);

      statTonerReplaced.textContent = Number(stats.summary.toner_replaced_count || 0);
      statTonerAlerts.textContent = Number(stats.summary.toner_alerts_count || 0);
      statActiveToner.textContent = Number(stats.summary.active_toner || 0);
      statPaperRefilled.textContent = Number(stats.summary.paper_refilled_count || 0);
      statPaperEmpty.textContent = Number(stats.summary.paper_empty_count || 0);
      statActivePaper.textContent = Number(stats.summary.active_paper || 0);

      statsPeriodLabel.textContent = stats.period.label;
      statsLastUpdated.textContent = `Oppdatert ${new Intl.DateTimeFormat("nb-NO", {
        hour: "2-digit", minute: "2-digit", second: "2-digit"
      }).format(new Date())}`;

      renderPrinterLeaderboard(stats.printer_leaderboard);
      renderErrorLeaderboard(stats.error_leaderboard);
      renderTonerLeaderboard(stats.toner_leaderboard);
      renderPaperLeaderboard(stats.paper_leaderboard);
      renderLongestIncident(stats.longest_incident);
      renderActiveIncidents(stats.active_incidents);
      renderActiveConsumables(stats.active_consumables);
      renderEvents(events.events);
    } catch (error) {
      console.error(error);
      showError(error.message);
    }
  };

  periodButtons.forEach(button => {
    button.addEventListener("click", () => {
      selectedPeriod = button.dataset.period;
      periodButtons.forEach(item => item.classList.toggle("active", item === button));
      loadDashboard();
    });
  });

  loadDashboard();
  refreshTimer = window.setInterval(loadDashboard, 30000);

  window.addEventListener("beforeunload", () => {
    if (refreshTimer) window.clearInterval(refreshTimer);
  });
});
