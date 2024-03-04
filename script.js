document.addEventListener('DOMContentLoaded', function() {
    fetch('printer_data.json')
        .then(response => response.json())
        .then(printerData => {
            const container = document.getElementById('printerInfo');

            printerData.forEach(printer => {
                const printerDiv = document.createElement('div');
                printerDiv.className = 'printer';

                printerDiv.innerHTML = `
                    <h2>${printer.Name} (${printer.Model})</h2>
                    <div class="details">
                        <div class="detail"><strong>IP:</strong> ${printer.IP}</div>
                        <div class="detail"><strong>Serial:</strong> ${printer.Serial || 'N/A'}</div>
                        <div class="ink-level"><strong>Ink Levels:</strong> ${printer['Ink Levels'].join(', ')}</div>
                        <ul class="tray-info"><strong>Tray Information:</strong> ${printer['Tray Information'].map(info => `<li>${info}</li>`).join('')}</ul>
                        <div class="errors"><strong>Errors:</strong></div>
                        <ul class="errors-list">${printer.Errors.map(error => `<li class="error">${error}</li>`).join('')}</ul>
                    </div>
                `;

                container.appendChild(printerDiv);
            });
        })
        .catch(error => console.error('Error loading the printer data:', error));
});
