/**
 * ==============================================================================
 * Ricoh Kopimaskin Status - Statistikk & Historikk Dashboard (v3.1)
 * ==============================================================================
 */

document.addEventListener("DOMContentLoaded", () => {
  const params = new URLSearchParams(window.location.search);
  const statsMode = params.get("stats") === "1" || params.get("stats") === "true";

  const printerView = document.getElementById("printerView");
  const statsView = document.getElementById("statsView");
  const statsToggleButton = document.getElementById("statsToggleButton");

  const toggleStatsMode = () => {
    const url = new URL(window.location.href);
    if (statsMode) {
      url.searchParams.delete("stats");
    } else {
      url.searchParams.set("stats", "1");
    }
    window.location.href = url.toString();
  };

  if (statsToggleButton) {
    statsToggleButton.textContent = statsMode ? "🖨️ Kopimaskiner" : "📊 Statistikk";
    statsToggleButton.title = statsMode ? "Gå tilbake til direkte printerstatus" : "Åpne statistikk og hendelseshistorikk";
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

  // KPI-elementer
  const statOpened = byId("statOpened");
  const statResolved = byId("statResolved");
  const statCritical = byId("statCritical");
  const statWarning = byId("statWarning");
  const statPrinters = byId("statPrinters");
  const statAvgResolution = byId("statAvgResolution");
  const statActive = byId("statActive");

  const statTonerReplaced = byId("statTonerReplaced");
  const statTonerAlerts = byId("statTonerAlerts");
  const statActiveToner = byId("statActiveToner");
  const statPaperRefilled = byId("statPaperRefilled");
  const statPaperEmpty = byId("statPaperEmpty");
  const statActivePaper = byId("statActivePaper");

  const statsPeriodLabel = byId("statsPeriodLabel");
  const printerLeaderboard = byId("printerLeaderboard");
  const errorLeaderboard = byId("errorLeaderboard");
  const tonerLeaderboard = byId("tonerLeaderboard");
  const paperLeaderboard = byId("paperLeaderboard");
  const longestIncident = byId("longestIncident");
  const activeIncidentList = byId("activeIncidentList");
  const eventLog = byId("eventLog");
  const eventCount = byId("eventCount");
  const periodButtons = Array.from(document.querySelectorAll("[data-period]"));

  let selectedPeriod = "today";
  let refreshTimer = null;

  const escapeHtml = (val) =>
    String(val ?? "")
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
    const remMinutes = minutes % 60;
    if (hours < 24) return remMinutes ? `${hours}t ${remMinutes}m` : `${hours}t`;
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    return remHours ? `${days}d ${remHours}t` : `${days}d`;
  };

  const formatDateTime = (val) => {
    if (!val) return "–";
    const date = new Date(String(val).replace(" ", "T"));
    if (Number.isNaN(date.getTime())) return val;
    return new Intl.DateTimeFormat("nb-NO", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  };

  const severityLabel = (sev) =>
    ({
      critical: "Kritisk",
      warning: "Advarsel",
      toner: "Toner",
      paper: "Papir",
      other: "Annet",
    }[sev] || "Annet");

  const severityPill = (sev) =>
    `<span class="severity-pill severity-${escapeHtml(sev)}">${severityLabel(sev)}</span>`;

  /* Rendring av Toppliste Maskiner */
  const renderPrinterLeaderboard = (rows) => {
    if (!rows || rows.length === 0) {
      printerLeaderboard.innerHTML = '<tr><td colspan="6" class="empty-state">Ingen registrerte feil i valgt periode.</td></tr>';
      return;
    }

    printerLeaderboard.innerHTML = rows
      .map((r, idx) => {
        const medal = idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : `${idx + 1}`;
        return `
        <tr>
          <td class="rank-number">${medal}</td>
          <td><strong>${escapeHtml(r.printer_name)}</strong><br><small style="color: var(--text-muted);">${escapeHtml(r.printer_model || "")}</small></td>
          <td><strong>${Number(r.total)}</strong></td>
          <td style="color: var(--status-critical); font-weight: 700;">${Number(r.critical)}</td>
          <td style="color: var(--status-warning); font-weight: 600;">${Number(r.warning)}</td>
          <td style="color: var(--text-muted);">${Number(r.other)}</td>
        </tr>
      `;
      })
      .join("");
  };

  /* Rendring av Vanligste Feil */
  const renderErrorLeaderboard = (rows) => {
    if (!rows || rows.length === 0) {
      errorLeaderboard.innerHTML = '<tr><td colspan="4" class="empty-state">Ingen registrerte feil i perioden.</td></tr>';
      return;
    }

    errorLeaderboard.innerHTML = rows
      .map((r, idx) => {
        const medal = idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : `${idx + 1}`;
        return `
        <tr>
          <td class="rank-number">${medal}</td>
          <td>${severityPill(r.severity)} <strong>${escapeHtml(r.error_message)}</strong>${r.error_code ? ` <small class="error-code-chip">{${escapeHtml(r.error_code)}}</small>` : ""}</td>
          <td><strong>${Number(r.total)}</strong></td>
          <td style="color: var(--text-muted);">${formatDuration(r.avg_resolution_seconds)}</td>
        </tr>
      `;
      })
      .join("");
  };

  /* Rendring av Tonerbytter */
  const renderTonerLeaderboard = (rows) => {
    if (!rows || rows.length === 0) {
      tonerLeaderboard.innerHTML = '<tr><td colspan="9" class="empty-state">Ingen bekreftede tonerbytter i perioden.</td></tr>';
      return;
    }

    tonerLeaderboard.innerHTML = rows
      .map((r, idx) => `
      <tr>
        <td class="rank-number">${idx + 1}</td>
        <td><strong>${escapeHtml(r.printer_name)}</strong></td>
        <td><strong>${Number(r.total)}</strong></td>
        <td style="color: var(--text-secondary);">${Number(r.black_count)}</td>
        <td style="color: var(--ink-cyan);">${Number(r.cyan_count)}</td>
        <td style="color: var(--ink-magenta);">${Number(r.magenta_count)}</td>
        <td style="color: var(--ink-yellow);">${Number(r.yellow_count)}</td>
        <td style="color: var(--text-muted);">${Number(r.waste_count)}</td>
      </tr>
    `)
      .join("");
  };

  /* Rendring av Papirpåfyllinger */
  const renderPaperLeaderboard = (rows) => {
    if (!rows || rows.length === 0) {
      paperLeaderboard.innerHTML = '<tr><td colspan="3" class="empty-state">Ingen papirpåfyllinger registrert i perioden.</td></tr>';
      return;
    }

    paperLeaderboard.innerHTML = rows
      .map((r, idx) => `
      <tr>
        <td class="rank-number">${idx + 1}</td>
        <td><strong>${escapeHtml(r.printer_name)}</strong></td>
        <td><strong style="color: var(--ink-cyan);">${Number(r.total)}</strong></td>
      </tr>
    `)
      .join("");
  };

  /* Lengste hendelse */
  const renderLongestIncident = (row) => {
    if (!longestIncident) return;
    if (!row) {
      longestIncident.className = "empty-state";
      longestIncident.textContent = "Ingen løste hendelser i valgt periode.";
      return;
    }

    longestIncident.className = "longest-incident-card";
    longestIncident.innerHTML = `
      <div style="font-size: 1.1rem; font-weight: 700; margin-bottom: 0.35rem;">
        ${severityPill(row.severity)} ${escapeHtml(row.printer_name)}
      </div>
      <div style="color: var(--text-secondary); font-size: 0.9rem; margin-bottom: 0.5rem;">
        ${escapeHtml(row.error_message)}
      </div>
      <div style="font-size: 0.8rem; color: var(--text-muted);">
        Varighet: <strong style="color: var(--brand-ricoh);">${formatDuration(row.duration_seconds)}</strong>
        (${formatDateTime(row.opened_at)} → ${formatDateTime(row.resolved_at)})
      </div>
    `;
  };

  /* Aktive hendelser */
  const renderActiveIncidents = (rows) => {
    if (!activeIncidentList) return;
    if (!rows || rows.length === 0) {
      activeIncidentList.innerHTML = '<div class="empty-state">Ingen uoppklarte feil for øyeblikket.</div>';
      return;
    }

    activeIncidentList.innerHTML = rows
      .map((r) => `
      <div class="event-entry">
        <div class="event-details">
          ${severityPill(r.severity)}
          <span><strong>${escapeHtml(r.printer_name)}:</strong> ${escapeHtml(r.error_message)}</span>
        </div>
        <span class="event-time">Aktiv i ${formatDuration(r.duration_seconds)}</span>
      </div>
    `)
      .join("");
  };

  /* Hendelseslogg */
  const renderEventLog = (events) => {
    if (!eventLog) return;
    if (!events || events.length === 0) {
      eventLog.innerHTML = '<div class="empty-state">Ingen hendelser registrert i perioden.</div>';
      if (eventCount) eventCount.textContent = "0 hendelser";
      return;
    }

    if (eventCount) eventCount.textContent = `${events.length} hendelser`;

    eventLog.innerHTML = events
      .map((e) => {
        const isResolved = e.event_type === "resolved";
        const icon = isResolved ? "✅" : "⚠️";
        return `
        <div class="event-entry">
          <div class="event-details">
            <span>${icon}</span>
            ${severityPill(e.severity)}
            <span><strong>${escapeHtml(e.printer_name)}</strong>: ${escapeHtml(e.error_message)}</span>
          </div>
          <span class="event-time">${formatDateTime(e.event_at)}</span>
        </div>
      `;
      })
      .join("");
  };

  /* Hovedfunksjon for lasting av statistikk */
  const loadStats = async () => {
    try {
      const statsRes = await fetch(`api/stats.php?period=${encodeURIComponent(selectedPeriod)}&_t=${Date.now()}`);
      if (!statsRes.ok) throw new Error(`HTTP ${statsRes.status}`);
      const data = await statsRes.json();

      if (!data.ok) throw new Error(data.error || "Statistikkfeil");

      const s = data.summary || {};
      if (statOpened) statOpened.textContent = s.opened_count ?? "0";
      if (statResolved) statResolved.textContent = s.resolved_count ?? "0";
      if (statCritical) statCritical.textContent = s.critical_count ?? "0";
      if (statWarning) statWarning.textContent = s.warning_count ?? "0";
      if (statPrinters) statPrinters.textContent = s.affected_printers ?? "0";
      if (statAvgResolution) statAvgResolution.textContent = formatDuration(s.avg_resolution_seconds);
      if (statActive) statActive.textContent = s.active_total ?? "0";

      if (statTonerReplaced) statTonerReplaced.textContent = s.toner_replaced_count ?? "0";
      if (statTonerAlerts) statTonerAlerts.textContent = s.toner_alerts_count ?? "0";
      if (statActiveToner) statActiveToner.textContent = s.active_toner ?? "0";
      if (statPaperRefilled) statPaperRefilled.textContent = s.paper_refilled_count ?? "0";
      if (statPaperEmpty) statPaperEmpty.textContent = s.paper_empty_count ?? "0";
      if (statActivePaper) statActivePaper.textContent = s.active_paper ?? "0";

      if (statsPeriodLabel && data.period) {
        statsPeriodLabel.textContent = `Periode: ${data.period.label}`;
      }

      renderPrinterLeaderboard(data.printer_leaderboard);
      renderErrorLeaderboard(data.error_leaderboard);
      renderTonerLeaderboard(data.toner_leaderboard);
      renderPaperLeaderboard(data.paper_leaderboard);
      renderLongestIncident(data.longest_incident);
      renderActiveIncidents(data.active_incidents);

      // Hent hendelseslogg
      const eventsRes = await fetch(`api/events.php?period=${encodeURIComponent(selectedPeriod)}&limit=100&_t=${Date.now()}`);
      if (eventsRes.ok) {
        const evData = await eventsRes.json();
        renderEventLog(evData.events || []);
      }
    } catch (err) {
      console.warn("Kunne ikke hente statistikk:", err);
    }
  };

  periodButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      periodButtons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      selectedPeriod = btn.dataset.period || "today";
      loadStats();
    });
  });

  loadStats();
  refreshTimer = setInterval(loadStats, 30000);
});
