# Database Schema & Migrasjoner

Dette området inneholder databaseoppsettet for Ricoh SNMP Overvåkingssystem.

## Filer

* `schema.sql`: Det offisielle databaseskjemaet for MariaDB 10.4+ / MySQL 8.0+.
  Inneholder tabellstrukturene for:
  - `printer_incidents`: Hovedtabell for alle registrerte hendelser (kritiske feil, advarsler, tonerbytter, papirpåfyllinger).
  - `printer_active_errors`: Tabell for nåværende aktive hendelser som venter på løsning eller bekreftelsestid.

## Importering

### Via MySQL CLI
```bash
mysql -u brukernavn -p databasenavn < schema.sql
```

### Via Docker
Når du starter `docker-compose.yml`, mountes denne filen automatisk inn i `/docker-entrypoint-initdb.d/` slik at databasen initialiseres automatisk ved første oppstart.
