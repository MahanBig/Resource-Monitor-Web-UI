# Del 2: Ricoh Web Frontend & REST API (Server 2)

Dette er webgrensesnittet og API-serveren (Server 2) som viser sanntidsstatus for alle Ricoh-kopimaskiner, og lagrer feil- og forbrukshistorikk i MySQL/MariaDB.

---

## Egenskaper

* **Moderne, responsivt designsystem**: Full støtte for mørk og lys modus, lekre CMYK-nivåmålere, papirskuff-kort og statuslys.
* **Sanntidsoppdatering**: Poller `printer_data.json` hvert 8. sekund med visuell nedtellingsindikator.
* **Hurtigfiltre & Søk**: Filtrer lynraskt mellom "Alle maskiner", "Kun feil" og "Kritiske", eller søk direkte med hurtigtast `/`.
* **Varslinger & Lyd**: Web Push Notifications for nye kritiske driftsfeil + Web Audio API synthesizer-lydvarsling (trykk `T` for test).
* **PWA-støtte**: Kan installeres direkte som app på Windows, Mac, iOS og Android.
* **Kiosk-modus**: Egen minimalistisk oppsummeringsside (`oppsummering.html`) optimalisert for infoskjermer og vegg-TVer.
* **Statistikk & Historikk-dashboard**: Full analyse av gjennomsnittlig løsningstid, topplister over maskiner med flest feil, bekreftede tonerbytter og papirpåfyllinger.

---

## Alternativ A: Kjøre med Docker (Enklest)

Mappen inneholder en ferdig `docker-compose.yml` som starter både webserveren (PHP 8.2 + Apache) og en MariaDB-database ferdig initialisert med `database.sql`:

```bash
cd Frontend
docker compose up -d
```

Åpne i nettleseren:
* Hovedoversikt: [http://localhost:8080/](http://localhost:8080/)
* Kioskoversikt: [http://localhost:8080/oppsummering.html](http://localhost:8080/oppsummering.html)
* Statistikk: [http://localhost:8080/?stats=1](http://localhost:8080/?stats=1)
* API Health Check: [http://localhost:8080/api/health.php](http://localhost:8080/api/health.php)

---

## Alternativ B: Manuell installasjon på Webhotell / Egen Linux-server

### 1. Last opp filene
Last opp alt innholdet i `Frontend/`-mappen til webrot-mappen (f.eks. `public_html/` eller `/var/www/html/`).

### 2. Importer databasestrukturen
Opprett en MySQL/MariaDB-database og importer filen:
```bash
mysql -u brukernavn -p databasenavn < ../database.sql
```

### 3. Konfigurer API-et
Kopier `api/config.eksempel.php` til `api/config.php`:
```bash
cp api/config.eksempel.php api/config.php
```

Rediger `api/config.php`:
```php
<?php
return [
    'db' => [
        'host' => 'localhost',
        'name' => 'ricoh_db',
        'user' => 'ricoh_user',
        'pass' => 'ditt_passord',
        'charset' => 'utf8mb4',
    ],
    // Må være identisk med logger.key i Backend/config.json:
    'logger_key' => 'BYTT_TIL_EN_LANG_TILFELDIG_NOKKEL',
];
```

### 4. Klargjør SFTP for Server 1 (Backend)
Opprett eller gi SFTP-tilgang til webrot-mappen slik at Python-innsamleren på Server 1 kan laste opp `printer_data.json`.
Sørg for at webserver-brukeren (f.eks. `www-data` eller Apache) har lesetilgang til `printer_data.json`.

---

## Lokal testing og forhåndsvisning (Uten PHP/MySQL)

Dersom du kun vil se og jobbe med designet lokalt på maskinen din:
```bash
python dev_server.py
```
Dette starter en lettvekts utviklingsserver på [http://localhost:8000/](http://localhost:8000/) med realistiske simulerte API-svar.
