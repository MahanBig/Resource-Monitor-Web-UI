document.addEventListener("DOMContentLoaded", function () {
  const fetchPrinterData = () => {
    fetch("printer_data.json")
      .then((response) => response.json())
      .then((printerData) => {
        const container = document.getElementById("printerInfo");
        container.innerHTML = ""; // Clear existing content before adding new fetched data

        printerData.forEach((printer) => {
          const printerDiv = document.createElement("div");
          printerDiv.className = "printer";

          // Create ink level bars
          const createInkLevelBar = (color, width) => {
            return `
              <div class="ink-level-bar-container">
                  <div class="ink-level-bar ink-${color}" style="width: ${width};">
                  <div class="hidetext">
                  ${color} ${width}
                  </div>
                  </div>
              </div>
            `;
          };
          const hasWarning = printer.Errors.some(
            (error) =>
              error.includes("Nesten") ||
              error.includes("Forbred") ||
              error.includes("Finner ikke:")
          );
          const hasCriticalError = printer.Errors.some(
            (error) =>
              error.includes("Error fetching errors") ||
              error.includes("Papirstopp") ||
              error.includes("Tom:") ||
              error.includes("stifter") ||
              error.includes("Reduser") ||
              error.includes("Fyll på") ||
              error.includes("Funksjonsproblem")
          );
          if (hasCriticalError) {
            printerDiv.classList.add("pulsate-error");
          }
          if (hasWarning) {
            printerDiv.classList.add("pulsate-warning");
          }

          // Skipping the second ink level as it is unknown
          const inkLevelsHtml = `
            ${createInkLevelBar("black", printer["Ink Levels"][0])}
            ${createInkLevelBar("cyan", printer["Ink Levels"][2])}
            ${createInkLevelBar("magenta", printer["Ink Levels"][3])}
            ${createInkLevelBar("yellow", printer["Ink Levels"][4])}
          `;

          // Create tray counters
          const trayCountersHtml = printer["Tray Information"]
            .slice(0, -1) // Ignore the last tray information
            .map((count, index) => {
              // Determine class based on count value
              let countClass = "";
              if (count == 0) {
                countClass = "empty";
              } else if (count < 56) {
                countClass = "almostempty";
              }

              // Generate HTML string with the appropriate class
              return `
              <div class="tray-counter ${countClass}">
                  <strong class="detail">Tray ${
                    index + 1
                  }:</strong><strong> ${count} Ark</strong>
              </div>
            `;
            })
            .join("");

          printerDiv.innerHTML = `
              <div class="printer-icon"></div>
              <h2>${printer.Name} (${printer.Model})</h2>
              <div class="details">
                  <div class="detail"><strong>IP:</strong> ${printer.IP}</div>
                  <div class="detail"><strong>Serial:</strong> ${
                    printer.Serial || "N/A"
                  }</div>
                  <div class="ink-levels">
                      <strong>Ink Levels:</strong>
                      ${inkLevelsHtml}
                  </div>
                  <div class="tray-counters">
                      <strong>Tray Paper Count:</strong>
                      ${trayCountersHtml}
                  </div>
                  <div class="detail"><strong>Time:</strong> ${
                    printer.Time
                  }</div>
                  <ul class="errors-list"><strong>Status:</strong> ${printer.Errors.map(
                    (error) => `<li class="error">${error}</li>`
                  ).join("")}</ul>
              </div>
          `;

          container.appendChild(printerDiv);
          const EmptyPaper =
            printerDiv.textContent.includes("{13200}") &&
            printerDiv.textContent.includes("{13300}") &&
            printerDiv.textContent.includes("{13400}");
          if (EmptyPaper) {
            printerDiv.classList.add("pulsate-warning");
          }
        });
      })
      .catch((error) =>
        console.error("Error loading the printer data:", error)
      );
  };

  // Call fetchPrinterData every 10 seconds
  fetchPrinterData(); // Fetch immediately on load
  setInterval(fetchPrinterData, 8500); // Then fetch every 10 seconds
});
