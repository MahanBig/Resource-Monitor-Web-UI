/**
 * ==============================================================================
 * Ricoh Kopimaskin Status - Frontend Skript (v3.1)
 * ==============================================================================
 * Robust, modulær og moderne frontend-kontroller for sanntidsovervåking av
 * Ricoh-kopimaskiner via SNMP.
 */

document.addEventListener("DOMContentLoaded", () => {
  // DOM-elementer
  const container = document.getElementById("printerInfo");
  const noErrorsMessage = document.getElementById("no-errors-message");
  const summaryContainer = document.getElementById("printerSummary");
  const searchBox = document.getElementById("searchBox");
  const clearButton = document.getElementById("clearButton");
  const toggleButton = document.getElementById("toggleButton");
  const filterAllBtn = document.getElementById("filterAllBtn");
  const filterCriticalBtn = document.getElementById("filterCriticalBtn");
  const refreshCountdown = document.getElementById("refreshCountdown");
  const pulseDot = document.getElementById("pulseDot");
  const totalBadgeCount = document.getElementById("totalBadgeCount");
  const errorBadgeCount = document.getElementById("errorBadgeCount");
  const criticalBadgeCount = document.getElementById("criticalBadgeCount");

  // Tilstand
  let currentFilter = "auto"; // "auto" (kun feil), "all" (alle), "critical" (kun kritiske)
  const expandedPrinters = new Set();
  let countdownSeconds = 8;
  let pollIntervalId = null;
  let countdownIntervalId = null;

  /* ==========================================================================
     1. PWA - Installer nettsiden som app
     ========================================================================== */
  const installAppButton = document.getElementById("installAppButton");
  let deferredInstallPrompt = null;

  const isRunningAsApp =
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    window.navigator.standalone === true;

  if (isRunningAsApp && installAppButton) {
    installAppButton.hidden = true;
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    if (installAppButton && !isRunningAsApp) {
      installAppButton.hidden = false;
    }
  });

  if (installAppButton) {
    installAppButton.addEventListener("click", async () => {
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      const result = await deferredInstallPrompt.userChoice;
      console.log("PWA installasjonsresultat:", result.outcome);
      deferredInstallPrompt = null;
      installAppButton.hidden = true;
    });
  }

  window.addEventListener("appinstalled", () => {
    console.log("Webappen er nå installert lokalt.");
    deferredInstallPrompt = null;
    if (installAppButton) installAppButton.hidden = true;
  });

  /* ==========================================================================
     2. Lyd & Desktop-varsling ved nye kritiske feil
     ========================================================================== */
  const notificationToggle = document.getElementById("notificationToggle");
  const notificationIcon = document.getElementById("notificationIcon");
  const notificationText = document.getElementById("notificationText");
  const NOTIFICATION_ENABLED_KEY = "printerCriticalNotificationsEnabled";
  const KNOWN_CRITICAL_ERRORS_KEY = "printerKnownCriticalErrors";

  const browserSupportsNotifications = "Notification" in window;
  let notificationsEnabled =
    localStorage.getItem(NOTIFICATION_ENABLED_KEY) === "true" &&
    browserSupportsNotifications &&
    Notification.permission === "granted";

  let knownCriticalErrors = new Set();
  let notificationBaselineReady = false;
  let audioContext = null;

  try {
    const stored = localStorage.getItem(KNOWN_CRITICAL_ERRORS_KEY);
    if (stored !== null) {
      knownCriticalErrors = new Set(JSON.parse(stored));
      notificationBaselineReady = true;
    }
  } catch (err) {
    console.warn("Kunne ikke lese lagrede feil fra localStorage:", err);
  }

  const getAudioContext = () => {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    if (!audioContext) {
      audioContext = new AudioContextClass();
    }
    return audioContext;
  };

  const playNotificationSound = () => {
    const ctx = getAudioContext();
    if (!ctx) return;

    const playTones = () => {
      const now = ctx.currentTime;
      // Harmonisk tre-toners varsling (E5, A5, C#6)
      [659.25, 880.0, 1108.73].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const start = now + idx * 0.14;
        const end = start + 0.18;

        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, start);

        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.2, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, end);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(end);
      });
    };

    if (ctx.state === "suspended") {
      ctx.resume().then(playTones).catch(() => {});
    } else {
      playTones();
    }
  };

  // Hurtigtast 'T' for å teste varsellyd
  document.addEventListener("keydown", (e) => {
    if (e.repeat) return;
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || document.activeElement?.isContentEditable) return;

    if (e.key.toLowerCase() === "t") {
      playNotificationSound();
      console.log("Test av varsellyd trigget.");
    }
    if (e.key === "/" && searchBox) {
      e.preventDefault();
      searchBox.focus();
    }
  });

  const updateNotificationUi = () => {
    if (!notificationToggle) return;

    if (!browserSupportsNotifications) {
      notificationToggle.disabled = true;
      notificationToggle.title = "Denne nettleseren støtter ikke skrivebordsvarsler.";
      if (notificationIcon) notificationIcon.textContent = "🚫";
      if (notificationText) notificationText.textContent = "Støttes ikke";
      return;
    }

    const denied = Notification.permission === "denied";
    const active = notificationsEnabled && Notification.permission === "granted";

    notificationToggle.disabled = false;
    notificationToggle.classList.toggle("enabled", active);
    notificationToggle.classList.toggle("permission-denied", denied);
    notificationToggle.setAttribute("aria-pressed", String(active));

    if (active) {
      notificationToggle.title = "Varsling er aktiv. Klikk for å slå av.";
      if (notificationIcon) notificationIcon.textContent = "🔔";
      if (notificationText) notificationText.textContent = "Varsling på";
    } else if (denied) {
      notificationToggle.title = "Varsling er blokkert i nettleserinnstillingene.";
      if (notificationIcon) notificationIcon.textContent = "🚫";
      if (notificationText) notificationText.textContent = "Blokkert";
    } else {
      notificationToggle.title = "Klikk for å aktivere varsling ved kritiske printerfeil.";
      if (notificationIcon) notificationIcon.textContent = "🔕";
      if (notificationText) notificationText.textContent = "Varsling av";
    }
  };

  const toggleNotifications = async () => {
    if (!browserSupportsNotifications) {
      alert("Nettleseren støtter ikke desktop-varsler.");
      return;
    }

    if (notificationsEnabled) {
      notificationsEnabled = false;
      localStorage.setItem(NOTIFICATION_ENABLED_KEY, "false");
      updateNotificationUi();
      return;
    }

    let perm = Notification.permission;
    if (perm !== "granted") {
      perm = await Notification.requestPermission();
    }

    if (perm === "granted") {
      notificationsEnabled = true;
      localStorage.setItem(NOTIFICATION_ENABLED_KEY, "true");
      const ctx = getAudioContext();
      if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
      playNotificationSound();
    } else {
      notificationsEnabled = false;
      localStorage.setItem(NOTIFICATION_ENABLED_KEY, "false");
      alert("Varsling ble ikke godkjent. Tillat varsler for nettstedet i nettleseren.");
    }
    updateNotificationUi();
  };

  notificationToggle?.addEventListener("click", toggleNotifications);
  updateNotificationUi();

  // Lås opp lyd ved første brukerklikk
  const unlockAudio = () => {
    const ctx = getAudioContext();
    if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
    document.removeEventListener("pointerdown", unlockAudio);
    document.removeEventListener("keydown", unlockAudio);
  };
  document.addEventListener("pointerdown", unlockAudio);
  document.addEventListener("keydown", unlockAudio);

  /* ==========================================================================
     3. Feilklassifisering og Oversettelser (error_rules.json)
     ========================================================================== */
  let sharedErrorRules = null;

  const loadSharedErrorRules = async () => {
    try {
      const res = await fetch("error_rules.json", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      sharedErrorRules = await res.json();
    } catch (err) {
      console.warn("Bruker innebygde feilregler:", err);
      sharedErrorRules = null;
    }
  };

  const parseErrorString = (raw) => {
    const str = String(raw || "").trim();
    const match = str.match(/\{([^{}]+)\}\s*$/);
    return {
      raw: str,
      code: match ? match[1].trim() : "",
      message: str.replace(/\s*\{[^{}]+\}\s*$/, "").trim(),
    };
  };

  const groupMatches = (group, parsed) => {
    if (!group) return false;
    const msg = parsed.message.toLowerCase();
    const code = parsed.code;

    if (code && (group.codes || []).map(String).includes(code)) return true;
    if ((group.exact || []).some((val) => String(val).toLowerCase() === msg)) return true;
    return (group.contains || []).some((val) => msg.includes(String(val).toLowerCase()));
  };

  const classifyError = (rawError) => {
    const parsed = parseErrorString(rawError);

    if (sharedErrorRules) {
      if (groupMatches(sharedErrorRules.ignore, parsed)) return null;
      if (groupMatches(sharedErrorRules.toner, parsed)) return "warning";
      if (groupMatches(sharedErrorRules.paper, parsed)) return "warning";
      if (groupMatches(sharedErrorRules.critical, parsed)) return "critical";
      if (groupMatches(sharedErrorRules.warning, parsed)) return "warning";
      return "normal";
    }

    // Fallback ved manglende error_rules.json
    const lower = parsed.message.toLowerCase();
    const criticalKeywords = ["papirstopp", "deksel", "cover", "empty:", "tom:", "fyll på", "replace", "stifter", "error fetching"];
    const warningKeywords = ["nesten", "forbred", "preparing", "finner ikke", "not found", "lavt", "toner", "papir"];

    if (criticalKeywords.some((k) => lower.includes(k))) return "critical";
    if (warningKeywords.some((k) => lower.includes(k))) return "warning";
    return "normal";
  };

  const translations = [
    ["Ring service:", "Ring service: "],
    ["Tomt for papir: magasin", "Tomt for papir i magasin"],
    ["Finner ikke: magasin", "Finner ikke magasin"],
    ["Empty:", "Tom:"],
    ["Cover open", "Deksel åpent"],
    ["Almost out", "Nesten tom"],
    ["Not found:", "Finner ikke:"],
    ["Preparing", "Forbereder"],
    ["Out of paper", "Tom for papir"],
    ["brukt toner", "Avfallsbeholder for toner"],
    ["Lavt niv: stifter", "Lavt stifte-nivå"],
    ["skriverkassett", "tonerkassett"],
    ["Error fetching errors", "Frakoblet / Nettverksfeil"],
  ];

  const translateErrorText = (msg) => {
    let out = msg;
    for (const [from, to] of translations) {
      out = out.split(from).join(to);
    }
    return out;
  };

  /* ==========================================================================
     4. Håndtering av Kritiske Push-Varsler
     ========================================================================== */
  const processCriticalNotifications = (printers) => {
    const currentErrors = new Set();
    const newErrorsByPrinter = new Map();

    printers.forEach((p) => {
      const critErrors = (p.Errors || []).filter((e) => classifyError(e) === "critical");
      critErrors.forEach((rawErr) => {
        const key = `${p.IP}|${rawErr.trim().toLowerCase()}`;
        currentErrors.add(key);

        if (notificationBaselineReady && !knownCriticalErrors.has(key)) {
          if (!newErrorsByPrinter.has(p.IP)) {
            newErrorsByPrinter.set(p.IP, { printer: p, errors: [] });
          }
          newErrorsByPrinter.get(p.IP).errors.push(rawErr);
        }
      });
    });

    if (notificationBaselineReady && notificationsEnabled && Notification.permission === "granted") {
      newErrorsByPrinter.forEach(({ printer, errors }) => {
        const readable = errors.map((e) => {
          const parsed = parseErrorString(e);
          return translateErrorText(parsed.message);
        });

        const n = new Notification(`Kritisk feil: ${printer.Name}`, {
          body: `${printer.Model}: ${readable.join(", ")}`,
          icon: "images/printer-icon1.png",
          badge: "images/favicon-96x96.png",
          tag: `ricoh-critical-${printer.IP}`,
          renotify: true,
          requireInteraction: true,
        });

        n.onclick = () => {
          window.focus();
          n.close();
        };

        playNotificationSound();
      });
    }

    knownCriticalErrors = currentErrors;
    notificationBaselineReady = true;

    try {
      localStorage.setItem(KNOWN_CRITICAL_ERRORS_KEY, JSON.stringify(Array.from(knownCriticalErrors)));
    } catch (e) {
      // Ignorer kvotebegrensning
    }
  };

  /* ==========================================================================
     5. Kort-bygging og Rendring
     ========================================================================== */
  const escapeHtml = (str) =>
    String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  const formatDate = (raw) => {
    if (!raw) return "";
    const parts = raw.split(", ");
    if (parts.length < 2) return raw;
    const dateParts = parts[0].split(" ");
    if (dateParts.length < 3) return raw;
    return `${dateParts[0]}.${dateParts[1]}.${dateParts[2]}, ${parts[1]}`;
  };

  const createPrinterCard = (p, statusClass) => {
    const card = document.createElement("article");
    card.className = `printer-card ${statusClass ? `status-${statusClass}` : ""}`;
    card.id = `printer-${p.IP.replaceAll(".", "-")}`;
    card.dataset.ip = p.IP;
    card.dataset.name = p.Name;
    card.dataset.model = p.Model;

    if (expandedPrinters.has(p.IP)) {
      card.classList.add("expanded");
    }

    // Statusindikator
    let statusPillHtml = `<span class="card-status-indicator ok">● Operativ</span>`;
    if (statusClass === "critical") {
      statusPillHtml = `<span class="card-status-indicator critical">⚠️ Kritisk</span>`;
    } else if (statusClass === "warning") {
      statusPillHtml = `<span class="card-status-indicator warning">⚡ Advarsel</span>`;
    }

    // CMYK Tonernivåer
    const ink = Array.isArray(p["Ink Levels"]) ? p["Ink Levels"] : [];
    const blackPct = parseFloat(ink[0]) || 0;
    const cyanPct = parseFloat(ink[2]) || 0;
    const magentaPct = parseFloat(ink[3]) || 0;
    const yellowPct = parseFloat(ink[4]) || 0;

    const buildTonerItem = (name, label, pct, colorClass) => {
      const isLow = pct > 0 && pct <= 15;
      return `
        <div class="toner-bar-item ${isLow ? "low-level" : ""}">
          <div class="toner-bar-header">
            <span class="toner-name ${colorClass}">${label}</span>
            <span class="toner-val">${pct}%</span>
          </div>
          <div class="toner-progress-track">
            <div class="toner-progress-fill ${colorClass}" style="width: ${Math.min(100, Math.max(0, pct))}%"></div>
          </div>
        </div>
      `;
    };

    const tonersHtml = `
      <div class="toner-bars-grid">
        ${buildTonerItem("black", "Sort", blackPct, "black")}
        ${buildTonerItem("cyan", "Cyan", cyanPct, "cyan")}
        ${buildTonerItem("magenta", "Magenta", magentaPct, "magenta")}
        ${buildTonerItem("yellow", "Gul", yellowPct, "yellow")}
      </div>
    `;

    // Skuffer / Magasiner
    const rawTrays = Array.isArray(p["Tray Information"]) ? p["Tray Information"] : [];
    const trays = rawTrays.slice(0, -1); // Fjern bypass/total
    const traysHtml = trays
      .map((amount, idx) => {
        let chipClass = "";
        let text = `${amount} ark`;

        if (amount == "-3") {
          text = "Har papir";
        } else if (amount == "-2") {
          text = "Mangler";
          chipClass = "almostempty";
        } else if (amount == "0") {
          text = "Tom";
          chipClass = "empty";
        } else if (parseInt(amount, 10) < 56) {
          chipClass = "almostempty";
        }

        return `
        <div class="tray-chip ${chipClass}">
          <span class="tray-label">Skuff ${idx + 1}</span>
          <span class="tray-amount">${text}</span>
        </div>
      `;
      })
      .join("");

    // Feilmeldinger
    const errorsList = Array.isArray(p.Errors) ? p.Errors : [];
    const classifiedErrors = errorsList
      .map((err) => {
        const cls = classifyError(err);
        if (cls === null) return null;
        const parsed = parseErrorString(err);
        return {
          raw: err,
          classification: cls,
          message: translateErrorText(parsed.message),
          code: parsed.code,
        };
      })
      .filter(Boolean);

    // Prioritering: critical -> warning -> normal
    classifiedErrors.sort((a, b) => {
      const order = { critical: 1, warning: 2, normal: 3 };
      return order[a.classification] - order[b.classification];
    });

    const errorsHtml =
      classifiedErrors.length > 0
        ? `
        <div class="card-errors">
          <ul class="card-errors-list">
            ${classifiedErrors
              .map(
                (e) => `
              <li class="error-item ${e.classification}">
                <span>${escapeHtml(e.message)}</span>
                ${e.code ? `<span class="error-code-chip">{${escapeHtml(e.code)}}</span>` : ""}
              </li>
            `
              )
              .join("")}
          </ul>
        </div>
      `
        : "";

    // Bildebane
    let imgName = p.Model;
    if (!imgName || imgName === "Error fetching model") {
      imgName = "missing";
    }
    const imgSrc = `images/${encodeURIComponent(imgName)}.png`;

    card.innerHTML = `
      <header class="card-header">
        <div class="card-title-group">
          <h2 class="card-printer-name" title="${escapeHtml(p.Name)}">${escapeHtml(p.Name)}</h2>
          <span class="card-model-badge">${escapeHtml(p.Model || "Ricoh")}</span>
        </div>
        ${statusPillHtml}
      </header>

      <div class="card-body">
        <div class="printer-hero">
          <img
            src="${imgSrc}"
            alt="${escapeHtml(p.Model)}"
            class="printer-thumbnail"
            loading="lazy"
            onerror="this.src='images/missing.png'"
          >
          <div class="printer-meta-list">
            <div class="meta-row">
              <span class="meta-label">IP-adresse:</span>
              <a href="http://${escapeHtml(p.IP)}" target="_blank" rel="noopener noreferrer" class="printer-ip-link" title="Åpne webgrensesnitt">
                ${escapeHtml(p.IP)} ↗
              </a>
            </div>
            <div class="meta-row">
              <span class="meta-label">Serienummer:</span>
              <button
                type="button"
                class="serial-copy-btn"
                title="Klikk for å kopiere serienummer"
                data-serial="${escapeHtml(p.Serial || '')}"
              >
                <span>${escapeHtml(p.Serial || "N/A")}</span>
                <span class="copy-icon" aria-hidden="true">📋</span>
              </button>
            </div>
            <div class="meta-row">
              <span class="meta-label">EID / ID:</span>
              <span class="meta-value">${escapeHtml(p.EID || "–")}</span>
            </div>
          </div>
        </div>

        <div class="toner-section">
          <span class="toner-section-title">Tonernivåer (CMYK)</span>
          ${tonersHtml}
        </div>

        <div class="trays-section">
          <div class="trays-grid">
            ${traysHtml}
          </div>
        </div>

        ${errorsHtml}
      </div>

      <footer class="card-footer">
        <span>Sist oppdatert: ${formatDate(p.Time)}</span>
        <span style="cursor: pointer;" title="Klikk kortet for full bredde">⤢ Vis detaljer</span>
      </footer>
    `;

    // Klikk på serienummer for å kopiere
    const serialBtn = card.querySelector(".serial-copy-btn");
    serialBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      const serial = serialBtn.dataset.serial;
      if (!serial) return;
      navigator.clipboard.writeText(serial).then(() => {
        serialBtn.classList.add("copied");
        const originalText = serialBtn.querySelector("span:first-child").textContent;
        serialBtn.querySelector("span:first-child").textContent = "Kopiert!";
        setTimeout(() => {
          serialBtn.classList.remove("copied");
          serialBtn.querySelector("span:first-child").textContent = originalText;
        }, 1200);
      });
    });

    // Klikk på kortet for å utvide / komprimere
    card.addEventListener("click", () => {
      card.classList.toggle("expanded");
      if (card.classList.contains("expanded")) {
        expandedPrinters.add(p.IP);
      } else {
        expandedPrinters.delete(p.IP);
      }
    });

    return card;
  };

  /* ==========================================================================
     6. Henting og Oppdatering av Printerdata
     ========================================================================== */
  const fetchPrinterData = async () => {
    try {
      const res = await fetch(`printer_data.json?_t=${Date.now()}`, {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const printerData = await res.json();

      if (!Array.isArray(printerData)) {
        throw new Error("Dataformatet i printer_data.json er ikke en array.");
      }

      // Tilbakestill countdown
      countdownSeconds = 8;
      if (pulseDot) pulseDot.classList.remove("stale");

      // Push-varsler
      processCriticalNotifications(printerData);

      // Tell opp statuser
      let totalCount = printerData.length;
      let errorCount = 0;
      let criticalCount = 0;

      const criticalPrinters = [];
      const warningPrinters = [];
      const okPrinters = [];

      printerData.forEach((p) => {
        const errors = Array.isArray(p.Errors) ? p.Errors : [];
        const hasCrit = errors.some((e) => classifyError(e) === "critical");
        const hasWarn = errors.some((e) => classifyError(e) === "warning");

        if (hasCrit) {
          criticalCount++;
          errorCount++;
          criticalPrinters.push(p);
        } else if (hasWarn) {
          errorCount++;
          warningPrinters.push(p);
        } else {
          okPrinters.push(p);
        }
      });

      // Oppdater tellere i topp-filter
      if (totalBadgeCount) totalBadgeCount.textContent = String(totalCount);
      if (errorBadgeCount) errorBadgeCount.textContent = String(errorCount);
      if (criticalBadgeCount) criticalBadgeCount.textContent = String(criticalCount);

      // Bevar rulleposisjon
      const scrollY = window.scrollY;

      // Tøm container
      if (container) container.innerHTML = "";

      // Hvilke maskiner skal vises basert på valgt filter?
      let printersToRender = [];
      if (currentFilter === "all") {
        printersToRender = [...criticalPrinters, ...warningPrinters, ...okPrinters];
      } else if (currentFilter === "critical") {
        printersToRender = criticalPrinters;
      } else {
        // "auto": Vis kun maskiner med feil
        printersToRender = [...criticalPrinters, ...warningPrinters];
      }

      // Hvis ingen feil finnes og vi er i auto-modus -> vis feiring
      if (currentFilter === "auto" && printersToRender.length === 0) {
        if (noErrorsMessage) noErrorsMessage.style.display = "block";
        if (summaryContainer) summaryContainer.style.display = "none";
      } else {
        if (noErrorsMessage) noErrorsMessage.style.display = "none";
      }

      // Bygg kort
      printersToRender.forEach((p) => {
        const errors = Array.isArray(p.Errors) ? p.Errors : [];
        const hasCrit = errors.some((e) => classifyError(e) === "critical");
        const hasWarn = errors.some((e) => classifyError(e) === "warning");
        const statusClass = hasCrit ? "critical" : hasWarn ? "warning" : "ok";

        const card = createPrinterCard(p, statusClass);
        if (container) container.appendChild(card);
      });

      // Utfør eventuell aktiv søkefiltrering
      if (searchBox && searchBox.value.trim() !== "") {
        applySearchFilter(searchBox.value.trim());
      }

      // Oppdater oppsummeringspanel dersom tilstede
      renderSummaryPanel(criticalPrinters, warningPrinters);

      window.scrollTo(0, scrollY);
    } catch (err) {
      console.warn("Kunne ikke hente printer_data.json:", err);
      if (pulseDot) pulseDot.classList.add("stale");
      const liveText = document.getElementById("liveStatusText");
      if (liveText) liveText.textContent = "Tilkoblingsfeil";
    }
  };

  const renderSummaryPanel = (criticalPrinters, warningPrinters) => {
    if (!summaryContainer) return;

    if (criticalPrinters.length === 0 && warningPrinters.length === 0) {
      summaryContainer.style.display = "none";
      return;
    }

    let html = `<h3>⚠️ Aktive feilmeldinger i drift</h3>`;

    if (criticalPrinters.length > 0) {
      html += `
        <div class="summary-group">
          <ul>
            ${criticalPrinters
              .map((p) => {
                const msgs = (p.Errors || [])
                  .filter((e) => classifyError(e) === "critical")
                  .map((e) => translateErrorText(parseErrorString(e).message));
                return `
                <li class="summary-item critical">
                  <span><strong>${escapeHtml(p.Name)}:</strong> ${escapeHtml(msgs.join(", "))}</span>
                  <a href="http://${escapeHtml(p.IP)}" target="_blank" rel="noopener" class="printer-ip-link">Gå til maskin ↗</a>
                </li>
              `;
              })
              .join("")}
          </ul>
        </div>
      `;
    }

    if (warningPrinters.length > 0) {
      html += `
        <div class="summary-group">
          <ul>
            ${warningPrinters
              .map((p) => {
                const msgs = (p.Errors || [])
                  .filter((e) => classifyError(e) === "warning")
                  .map((e) => translateErrorText(parseErrorString(e).message));
                return `
                <li class="summary-item warning">
                  <span><strong>${escapeHtml(p.Name)}:</strong> ${escapeHtml(msgs.join(", "))}</span>
                  <a href="http://${escapeHtml(p.IP)}" target="_blank" rel="noopener" class="printer-ip-link">Gå til maskin ↗</a>
                </li>
              `;
              })
              .join("")}
          </ul>
        </div>
      `;
    }

    summaryContainer.innerHTML = html;
    summaryContainer.style.display = "block";
  };

  /* ==========================================================================
     7. Søk og Filter-knapper
     ========================================================================== */
  const applySearchFilter = (query) => {
    const q = query.toLowerCase();
    const cards = container ? container.querySelectorAll(".printer-card") : [];

    cards.forEach((card) => {
      const content = card.textContent.toLowerCase();
      card.classList.toggle("hidden", !content.includes(q));
    });
  };

  searchBox?.addEventListener("input", (e) => {
    const val = e.target.value;
    applySearchFilter(val);
    if (clearButton) clearButton.hidden = val === "";
  });

  clearButton?.addEventListener("click", () => {
    if (searchBox) searchBox.value = "";
    applySearchFilter("");
    if (clearButton) clearButton.hidden = true;
    searchBox?.focus();
  });

  const setActiveFilter = (filterName) => {
    currentFilter = filterName;
    toggleButton?.classList.toggle("active", filterName === "auto");
    filterAllBtn?.classList.toggle("active", filterName === "all");
    filterCriticalBtn?.classList.toggle("active", filterName === "critical");
    fetchPrinterData();
  };

  toggleButton?.addEventListener("click", () => setActiveFilter("auto"));
  filterAllBtn?.addEventListener("click", () => setActiveFilter("all"));
  filterCriticalBtn?.addEventListener("click", () => setActiveFilter("critical"));

  /* ==========================================================================
     8. Nedtellings-indikator for polling
     ========================================================================== */
  const startPolling = async () => {
    await loadSharedErrorRules();
    fetchPrinterData();

    // Hent data hvert 8. sekund
    pollIntervalId = setInterval(fetchPrinterData, 8000);

    // Nedtelling hvert sekund
    countdownIntervalId = setInterval(() => {
      countdownSeconds = Math.max(0, countdownSeconds - 1);
      if (refreshCountdown) {
        refreshCountdown.textContent = `· ${countdownSeconds}s`;
      }
    }, 1000);
  };

  startPolling();

  /* ==========================================================================
     9. Mørk / Lys Modus
     ========================================================================== */
  const darkModeToggle = document.getElementById("darkModeToggle");
  const THEME_KEY = "printerThemeMode";

  const setTheme = (isDark) => {
    document.body.classList.toggle("dark-mode", isDark);
    if (darkModeToggle) {
      darkModeToggle.textContent = isDark ? "🌙" : "☀️";
      darkModeToggle.title = isDark ? "Bytt til lys modus" : "Bytt til mørk modus";
    }
    localStorage.setItem(THEME_KEY, isDark ? "dark" : "light");
  };

  // Sjekk URL-parametre først (?darkmode=1, ?darkseason=1)
  const urlParams = new URLSearchParams(window.location.search);
  const darkParam = urlParams.get("darkmode");
  const darkSeasonParam = urlParams.get("darkseason");

  if (darkParam === "1" || darkParam === "true") {
    setTheme(true);
  } else if (darkSeasonParam === "1" || darkSeasonParam === "true") {
    const month = new Date().getMonth();
    const isDarkSeason = month === 10 || month === 11 || month === 0;
    setTheme(isDarkSeason);
  } else {
    // Sjekk lagret preferanse eller systeminnstilling
    const saved = localStorage.getItem(THEME_KEY);
    if (saved) {
      setTheme(saved === "dark");
    } else {
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      setTheme(prefersDark);
    }
  }

  darkModeToggle?.addEventListener("click", () => {
    const isDark = document.body.classList.contains("dark-mode");
    setTheme(!isDark);
  });
});
