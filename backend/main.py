#!/usr/bin/env python3
"""
Ricoh SNMP Collector - Hovedinngangspunkt (Industry Standard)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
"""

import sys
from pathlib import Path

# Sørg for at src/ ligger i sys.path
_src_dir = Path(__file__).resolve().parent / "src"
if str(_src_dir) not in sys.path:
    sys.path.insert(0, str(_src_dir))

# Sørg for at UTF-8 fungerer i Windows-terminaler
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import argparse
import logging
import signal
import time
from typing import Any

from ricoh_collector.config import CollectorConfig
from ricoh_collector.logger_client import EventLoggerClient
from ricoh_collector.printer_store import PrinterStore
from ricoh_collector.simulator import generate_mock_snapshot
from ricoh_collector.snmp_reader import SnmpReader
from ricoh_collector.uploader import SftpUploader

LOG_FORMAT = "%(asctime)s [%(levelname)s] %(message)s"
DATE_FORMAT = "%Y-%m-%d %H:%M:%S"


def setup_logging(verbose: bool = False) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(level=level, format=LOG_FORMAT, datefmt=DATE_FORMAT)


class RicohCollectorDaemon:
    def __init__(self, config: CollectorConfig, simulate: bool = False):
        self.config = config
        self.simulate = simulate
        self.store = PrinterStore(config.printers_file)
        self.snmp = SnmpReader(
            community=config.snmp_community,
            timeout=config.snmp_timeout,
            max_workers=config.max_workers,
        )
        self.uploader = SftpUploader(config.sftp)
        self.logger_client = EventLoggerClient(config.logger)
        self.running = False

    def collect_once(self) -> list[dict[str, Any]]:
        printers = self.store.load()
        if self.simulate:
            logging.info("Kjører i SIMULERING-modus med test-maskiner.")
            data = generate_mock_snapshot(printers)
        else:
            if not printers:
                logging.warning(f"Ingen printere definert i '{self.config.printers_file}'.")
                return []

            logging.info(f"Poller {len(printers)} kopimaskiner via SNMP (parallelt)...")
            start_t = time.time()
            data = self.snmp.fetch_all(printers)
            elapsed = time.time() - start_t
            logging.info(f"SNMP-polling fullført på {elapsed:.2f} sekunder.")

        output_file = Path(self.config.output_file)
        try:
            import json
            with open(output_file, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=4, ensure_ascii=False)
            logging.debug(f"Eksporterte snapshot til {output_file}.")
        except Exception as e:
            logging.error(f"Kunne ikke lagre lokal {output_file}: {e}")

        if self.config.sftp.is_configured:
            logging.info("Laster opp ferskt snapshot via SFTP...")
            self.uploader.upload_file(output_file)

        if self.config.logger.is_configured:
            logging.info("Sender snapshot til hendelseslogger API...")
            self.logger_client.send_snapshot(data)

        return data

    def run_loop(self) -> None:
        self.running = True
        logging.info("=" * 60)
        logging.info("Ricoh SNMP Collector Daemon er startet")
        logging.info(f"   * Intervall:    {self.config.interval} sekunder")
        logging.info(f"   * Printerliste: {self.config.printers_file}")
        logging.info(f"   * SFTP:         {'Aktivert' if self.config.sftp.is_configured else 'Deaktivert'}")
        logging.info(f"   * Logger-API:   {'Aktivert' if self.config.logger.is_configured else 'Deaktivert'}")
        logging.info(f"   * Modus:        {'Simulering' if self.simulate else 'Live SNMP'}")
        logging.info("=" * 60)

        while self.running:
            try:
                self.collect_once()
            except Exception as e:
                logging.error(f"Uventet feil i polling-sløyfen: {e}", exc_info=True)

            for _ in range(self.config.interval):
                if not self.running:
                    break
                time.sleep(1)

        logging.info("Tjenesten er stanset.")

    def stop(self) -> None:
        logging.info("Mottok stoppsignal. Avslutter elegant...")
        self.running = False


def test_snmp(collector: RicohCollectorDaemon) -> None:
    printers = collector.store.load()
    if not printers:
        print("Ingen printere konfigurert å teste.")
        return

    print(f"\nTester SNMP-forbindelse mot {len(printers)} maskiner...")
    for p in printers:
        print(f"Kontakter {p.Name} ({p.IP})... ", end="", flush=True)
        res = collector.snmp.fetch_printer(p)
        model = res.get("Model", "Ukjent")
        errors = res.get("Errors", [])
        if "Error fetching" in model or (errors and "Error fetching" in errors[0]):
            print("Kunne ikke nå via SNMP")
        else:
            print(f"OK! Modell: {model}, Feil: {len(errors)}")


def interactive_menu(collector: RicohCollectorDaemon) -> None:
    while True:
        print("\n" + "=" * 40)
        print("Ricoh SNMP Collector - Kontrollpanel")
        print("=" * 40)
        print(f"1. Start kontinuerlig overvåking ({collector.config.interval}s)")
        print("2. Kjør én innsamling nå (test)")
        print("3. Endre intervall")
        print("4. Vis definerte printere")
        print("5. Test SNMP-forbindelse")
        print("6. Test SFTP-forbindelse")
        print("7. Test Logger-API")
        print("8. Avslutt")
        print("=" * 40)

        choice = input("Velg et tall [1-8]: ").strip()
        if choice == "1":
            collector.run_loop()
            break
        elif choice == "2":
            collector.collect_once()
            print("Snapshot fullført og lagret!")
        elif choice == "3":
            try:
                val = int(input("Nytt intervall i sekunder: "))
                if val >= 1:
                    collector.config.interval = val
                    print(f"Intervall oppdatert til {val}s.")
            except ValueError:
                print("Ugyldig tall.")
        elif choice == "4":
            printers = collector.store.load()
            print(f"\nDefinerte printere ({len(printers)} stk):")
            for p in printers:
                print(f" * {p.Name:<18} IP: {p.IP:<16} S/N: {p.Serial or 'N/A'}")
        elif choice == "5":
            test_snmp(collector)
        elif choice == "6":
            ok, msg = collector.uploader.test_connection()
            print(f"{'OK' if ok else 'FEIL'}: {msg}")
        elif choice == "7":
            ok, msg = collector.logger_client.test_connection()
            print(f"{'OK' if ok else 'FEIL'}: {msg}")
        elif choice == "8":
            print("Ha det bra!")
            break


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Ricoh SNMP Collector Daemon - Samler data fra Ricoh-kopimaskiner via SNMP",
    )
    parser.add_argument("--config", "-c", type=str, help="Sti til konfigurasjonsfil")
    parser.add_argument("--printers", "-p", type=str, help="Sti til printerliste")
    parser.add_argument("--interval", "-i", type=int, help="Kjøreintervall i sekunder (standard: 40)")
    parser.add_argument("--once", action="store_true", help="Kjør én runde og avslutt")
    parser.add_argument("--simulate", action="store_true", help="Kjør med simulerte test-maskiner")
    parser.add_argument("--test-snmp", action="store_true", help="Test SNMP-tilkobling til maskiner")
    parser.add_argument("--test-sftp", action="store_true", help="Test SFTP-tilkobling til webserver")
    parser.add_argument("--test-logger", action="store_true", help="Test tilkobling til PHP-logger")
    parser.add_argument("--export-json", action="store_true", help="Eksporter Printers.pkl til printers.json")
    parser.add_argument("--menu", action="store_true", help="Åpne interaktiv terminalmeny")
    parser.add_argument("--verbose", "-v", action="store_true", help="Aktiver detaljert debug-logging")
    return parser.parse_args()


def main() -> None:
    args = parse_arguments()
    setup_logging(args.verbose)

    config = CollectorConfig.load(args.config)
    if args.interval:
        config.interval = args.interval
    if args.printers:
        config.printers_file = args.printers

    collector = RicohCollectorDaemon(config, simulate=args.simulate)

    if args.export_json:
        printers = collector.store.load()
        out_p = Path("printers.json")
        collector.store.save(printers, out_p)
        print(f"Eksporterte {len(printers)} maskiner til {out_p.resolve()}")
        sys.exit(0)

    if args.test_snmp:
        test_snmp(collector)
        sys.exit(0)

    if args.test_sftp:
        ok, msg = collector.uploader.test_connection()
        print(f"{'OK' if ok else 'FEIL'}: {msg}")
        sys.exit(0 if ok else 1)

    if args.test_logger:
        ok, msg = collector.logger_client.test_connection()
        print(f"{'OK' if ok else 'FEIL'}: {msg}")
        sys.exit(0 if ok else 1)

    if args.once:
        data = collector.collect_once()
        print(f"Fullført snapshot for {len(data)} maskiner.")
        sys.exit(0)

    if args.menu:
        interactive_menu(collector)
        sys.exit(0)

    def signal_handler(sig: int, frame: Any) -> None:
        collector.stop()

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    collector.run_loop()


if __name__ == "__main__":
    main()
