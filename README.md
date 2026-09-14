# Ricoh Kopimaskin SNMP Overvåking & Nettvisning

Moderne, todelt sanntidsovervåking og hendelseslogg for Ricoh-kopimaskiner basert på SNMP.

Systemet er bygget med en **2-delt arkitektur**, der innsamlingen (Server 1) og visningen (Server 2) er fullstendig adskilt for maksimal sikkerhet, stabilitet og fleksibilitet.

---

## 🏛️ Arkitektur (2-delt design)

```
┌─────────────────────────────────────────────────────────────┐
│              SERVER 1: INNSAMLER (BACKEND)                  │
│       Kjører på lokalt nettverk (f.eks. Raspberry Pi)       │
│                                                             │
│   Ricoh Kopimaskiner                                        │
│          │                                                  │
│          │ SNMP (Parallell tråd-pool)                       │
│          ▼                                                  │
│   Python Collector Daemon (RicohReader.py)                  │
│          │                                                  │
│          ├───────────────► printer_data.json                │
│          │                      │                           │
│          │                      │ SFTP (Atomisk)            │
│          │                      ▼                           │
└──────────┼──────────────────────┼───────────────────────────┘
           │                      │
           │ HTTP POST            │
           ▼                      ▼
┌─────────────────────────────────────────────────────────────┐
│              SERVER 2: WEBSERVER & REST API                 │
│         Kjører på webhotell, VPS eller i skyen              │
│                                                             │
│   Nginx / Apache Webserver                                  │
│          ├─► printer_data.json                              │
│          │         │                                        │
│          │         ▼                                        │
│          ├─► Moderne Frontend (HTML5 / CSS3 / ES6)          │
│          │   • Sanntidsoversikt & CMYK-målere               │
│          │   • Kiosk / Infoskjerm (oppsummering.html)       │
│          │   • Lyd & Desktop Push-varsler                   │
│          │   • Statistikkdashboard (?stats=1)               │
│          │                                                  │
│          └─► PHP REST API (api/)                            │
│                    │                                        │
│                    ▼                                        │
│              MariaDB / MySQL                                │
│              (printer_incidents & printer_active_errors)    │
└─────────────────────────────────────────────────────────────┘
```

---

## ✨ Hovedfunksjoner

* **⚡ Lynrask parallell polling**: Henter status fra alle kopimaskiner samtidig. Én utilgjengelig maskin forsinker aldri de andre.
* **🎨 Nytt, moderne designsystem**:
  * Sømløs mørk og lys modus (med automatisk "mørketidsmodus" i nov–jan).
  * Realistiske CMYK-nivåmålere med fargegradienter og varsel ved lavt nivå.
  * Tydelige papirmagasin-indikatorer for hver enkelt skuff.
  * Monospace feilkode-chips (`{40440}`) og oversatte norske feilbeskrivelser.
  * Ett-klikks kopiering av serienummer til utklippstavlen.
* **🔔 Smarte varsler & Lyd**:
  * Desktop Push-varsler ved nye kritiske hendelser (papirstopp, åpne deksler, servicefeil).
  * Syntetisert varslingstone via Web Audio API (trykk `T` på tastaturet for å teste).
* **📱 PWA-støtte**: Kan installeres direkte som app på PC, Mac, Android og iPhone.
* **📺 Kiosk / Veggskjerm**: Egen forenklet visning (`oppsummering.html`) for info-skjermer og TVer i fellesarealer.
* **📊 Statistikk & Historikk**:
  * Beregner gjennomsnittlig løsningstid (MTTR) per feil og maskin.
  * Toppliste over maskiner med flest feil.
  * Skiller automatisk mellom tekniske feil, bekreftede tonerbytter og papirpåfyllinger.
* **🐳 Komplett Docker-støtte**: Ferdige Dockerfiles og `docker-compose.yml` for øyeblikkelig distribusjon.

---

## 🚀 Rask oppstart med Docker (Anbefalt)

Den raskeste og enkleste måten å starte opp på er med Docker Compose.

### Alternativ 1: Start hele systemet samlet
Dersom du tester alt på én maskin:
```bash
docker compose up -d --build
```
Dette starter:
1. **Web Frontend**: [http://localhost:8080/](http://localhost:8080/)
2. **Kiosk-visning**: [http://localhost:8080/oppsummering.html](http://localhost:8080/oppsummering.html)
3. **Statistikk**: [http://localhost:8080/?stats=1](http://localhost:8080/?stats=1)
4. **MariaDB Database**: Initialiseres automatisk med tabellene fra `database.sql`.
5. **Python Innsamler**: Kjører i bakgrunnen og poller maskinene.

---

### Alternativ 2: Start kun Server 2 (Web & API)
På den offentlige webserveren din:
```bash
docker compose up -d web db
```
Webserveren lytter på port `8080` (eller port `80` ved å endre port-mappingen).

---

### Alternativ 3: Start kun Server 1 (Innsamler)
På den lokale maskinen eller Raspberry Pi som har tilgang til printerne:
```bash
docker compose up -d collector
```

---

## 🛠️ Manuell installasjon (Trinn for trinn)

### Del 1: Server 1 - Innsamler (Raspberry Pi / Linux / Windows)

Innsamleren må kjøre på et system som har direkte IP-tilgang til Ricoh-kopimaskinene.

#### 1. Installer Python 3 og avhengigheter
```bash
cd Backend
pip install -r requirements.txt
```

#### 2. Konfigurer innstillinger
Kopier eksempelfilene fra `config/`:
```bash
cp config/config.example.json config.json
cp config/printers.example.json printers.json
```

Rediger `config.json`:
```json
{
  "interval": 40,
  "printers_file": "printers.json",
  "sftp": {
    "host": "ditt-webhotell.no",
    "port": 22,
    "user": "sftp_bruker",
    "pass": "hemmelig_passord",
    "path": "/public_html/"
  },
  "logger": {
    "url": "https://ditt-webhotell.no/api/process-printers.php",
    "key": "EN_LANG_TILFELDIG_SIKKERHETSNOKKEL"
  }
}
```

Legg inn kopimaskinene dine i `printers.json`:
```json
[
  {
    "IP": "192.168.1.101",
    "Name": "Bibliotek",
    "Serial": "G12345678",
    "EID": "BIB-01",
    "Default": true
  },
  {
    "IP": "192.168.1.102",
    "Name": "Administrasjon",
    "Serial": "G87654321",
    "EID": "ADM-01",
    "Default": true
  }
]
```

#### 3. Test tilkoblingene
Innsamleren har innebygde test-kommandoer:
```bash
# Test at maskinene svarer på SNMP:
python main.py --test-snmp

# Test at SFTP-opplasting fungerer:
python main.py --test-sftp

# Test at kontakten med PHP-loggeren fungerer:
python main.py --test-logger
```

#### 4. Start kontinuerlig overvåking
```bash
python main.py
# (Eller 'python RicohReader.py' for bakoverkompatibilitet)
```

For automatisk bakgrunnsstart ved oppstart av Linux / Raspberry Pi:
```bash
sudo cp deploy/systemd/ricoh-reader.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ricoh-reader
```

---

### Del 2: Server 2 - Webserver & API (Webhotell / Domeneshop / Apache / Nginx)

Webserveren viser frontenden og lagrer historikken.

#### 1. Last opp filene
Last opp alt innholdet i mappen `frontend/` til din webrot (f.eks. `public_html/` eller `/var/www/html/`).

#### 2. Opprett database
Opprett en MariaDB- eller MySQL-database (f.eks. i cPanel eller Domeneshop) og importer tabellstrukturen fra:
```text
database/schema.sql
```

#### 3. Konfigurer `api/config.php`
Kopier `frontend/api/config.eksempel.php` til `frontend/api/config.php`:
```bash
cp frontend/api/config.eksempel.php frontend/api/config.php
```

Fyll inn databasedetaljene:
```php
<?php
return [
    'db' => [
        'host' => 'ditt_databaservert.mysql.domeneshop.no',
        'name' => 'database_navn',
        'user' => 'database_bruker',
        'pass' => 'database_passord',
        'charset' => 'utf8mb4',
    ],
    // Må være NØYAKTIG lik "logger.key" i Backend/config.json:
    'logger_key' => 'EN_LANG_TILFELDIG_SIKKERHETSNOKKEL',
];
```

#### 4. Gi SFTP-tilgang for Server 1
Sørg for at SFTP-brukeren som er definert i `Backend/config.json` har skrivetilgang til webrot-mappen slik at `printer_data.json` kan lastes opp.

---

## ⌨️ Hurtigtaster i nettleseren

| Tast | Handling |
| :--- | :--- |
| `/` | Hopper direkte til søkefeltet for å filtrere maskiner. |
| `Esc` | Tømmer søkefeltet. |
| `T` | Spiller av test av den syntetiserte varslingslyden. |

---

## 🧪 Lokal testing uten kopimaskiner (Simulator)

Dersom du ønsker å teste systemet, demonstrere funksjonene eller utvikle lokalt:

1. **Kjør innsamleren med simulerte maskiner**:
   ```bash
   python Backend/RicohReader.py --simulate --once
   ```
   Dette genererer et realistisk `printer_data.json` med ulike feiltilstander, tonernivåer og papirstatuser.

2. **Kjør frontenden lokalt**:
   ```bash
   python Frontend/dev_server.py
   ```
   Åpne [http://localhost:8000/](http://localhost:8000/) for å se grensesnittet umiddelbart.

---

## 📋 SNMP OID-referanse for Ricoh

| Parameter | OID | Beskrivelse |
| :--- | :--- | :--- |
| Modellnavn | `.1.3.6.1.2.1.43.5.1.1.16.1` | Returnerer modellbetegnelse (f.eks. IM C3000) |
| Tonernivåer | `.1.3.6.1.2.1.43.11.1.1.9.1` | Returnerer prosentandel for Sort, Cyan, Magenta, Gul |
| Papirmagasiner | `.1.3.6.1.2.1.43.8.2.1.10.1` | Returnerer restkapasitet per skuff |
| Feilmeldinger | `.1.3.6.1.2.1.43.18.1.1.8.1` | Returnerer aktive Ricoh-status- og feilmeldinger |

---

## 🔒 Lisens & Rettigheter

Dette prosjektet er basert på det åpne kildekodeprosjektet [Kopimaskin-SNMP-nettvisning](https://github.com/zhyl0/Kopimaskin-SNMP-nettvisning).
Fri til videre bruk og tilpasning for undervisnings-, bedrifts- og offentlige miljøer.
