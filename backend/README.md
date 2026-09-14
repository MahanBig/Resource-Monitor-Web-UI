# Del 1: Ricoh SNMP Collector (Backend)

Dette er innsamlingsmodulen (Server 1) som kjører på et lokalt nettverk (f.eks. en Raspberry Pi eller intern server) med nettverkstilgang til Ricoh-kopimaskinene via SNMP.

Den samler data fra maskinene parallelt, eksporterer `printer_data.json`, laster filen opp til webserveren via SFTP og sender hendelsesdata til PHP-loggeren via HTTP POST.

---

## Egenskaper

* **Parallell SNMP-polling**: Henter status fra alle maskiner samtidig med tråd-pool. Én offline maskin vil aldri sinke resten!
* **Rent JSON-oppsett**: Kopimaskiner defineres i en enkel, menneskelig lesbar `printers.json` (automatisk migrasjon fra eldre `Printers.pkl`).
* **Atomisk SFTP-opplasting**: Laster opp til `.uploading` før atomisk omdøping slik at webfrontenden aldri leser en halv fil.
* **Integrert simulator**: Kan kjøres med `--simulate` for testing og demo uten tilkoblede kopimaskiner.
* **Menneskevennlig CLI**: Støtte for `--test-snmp`, `--test-sftp`, `--test-logger`, `--once` og interaktiv terminalmeny (`--menu`).
* **Docker & systemd**: Ferdig Dockerfile, docker-compose og systemd-oppskrift for 24/7 drift.

---

## Installasjon (Manuell på Raspberry Pi / Linux)

### 1. Klon eller kopier koden
```bash
cd /opt/ricoh-monitor/Backend
```

### 2. Installer Python-avhengigheter
```bash
pip3 install -r requirements.txt
```

### 3. Konfigurer innstillinger
Kopier eksempel-filene:
```bash
cp config.example.json config.json
cp printers.example.json printers.json
```

Rediger `config.json` med dine SFTP- og Logger-detaljer:
```json
{
  "interval": 40,
  "printers_file": "printers.json",
  "sftp": {
    "host": "ditt-webhotell.no",
    "port": 22,
    "user": "sftp_bruker",
    "pass": "hemmelig",
    "path": "/public_html/"
  },
  "logger": {
    "url": "https://ditt-webhotell.no/api/process-printers.php",
    "key": "EN_LANG_TILFELDIG_NOKKEL"
  }
}
```

Legg inn kopimaskinene i `printers.json`:
```json
[
  {
    "IP": "192.168.1.101",
    "Name": "Bibliotek",
    "Serial": "G12345678",
    "EID": "BIB-01",
    "Default": true
  }
]
```

### 4. Test tilkoblingene
```bash
# Test at maskinene svarer på SNMP:
python3 RicohReader.py --test-snmp

# Test SFTP-tilkobling til webserveren:
python3 RicohReader.py --test-sftp

# Test logger-API-et på webserveren:
python3 RicohReader.py --test-logger
```

### 5. Kjør som systemd-tjeneste (24/7 automatisk oppstart)
```bash
sudo cp systemd/ricoh-reader.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ricoh-reader
```

Sjekk status og logg:
```bash
sudo systemctl status ricoh-reader
journalctl -u ricoh-reader -f
```

---

## Kjøre med Docker

Bygg og start containeren:
```bash
docker compose up -d --build
```

Se logger:
```bash
docker compose logs -f
```

---

## Kommandolinjevalg

| Flagg | Beskrivelse |
| :--- | :--- |
| `python RicohReader.py` | Starter kontinuerlig innsamling med konfigurert intervall (standard 40 sek). |
| `--once` | Kjører én runde og avslutter (ypperlig for cron jobs eller rask sjekk). |
| `--simulate` | Kjører med simulerte Ricoh-maskiner (krever ingen SNMP). |
| `--test-snmp` | Pinger og tester SNMP mot alle definerte maskiner. |
| `--test-sftp` | Tester SFTP-innlogging og skrivetilgang på webserveren. |
| `--test-logger` | Tester HTTP POST mot PHP-loggeren med konfigurert nøkkel. |
| `--menu` | Åpner et interaktivt terminal-kontrollpanel. |
| `--export-json` | Konverterer eldre `Printers.pkl` til `printers.json`. |
| `--verbose` | Viser detaljert debug-logging i terminalen. |
