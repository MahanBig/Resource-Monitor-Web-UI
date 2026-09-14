"""
SNMP-leser for Ricoh kopimaskiner.

Henter:
- Modell: .1.3.6.1.2.1.43.5.1.1.16.1
- Tonernivåer: .1.3.6.1.2.1.43.11.1.1.9.1
- Magasininformasjon: .1.3.6.1.2.1.43.8.2.1.10.1
- Feilmeldinger: .1.3.6.1.2.1.43.18.1.1.8.1

Bruker ThreadPoolExecutor for å spørre alle kopimaskiner parallelt,
slik at én offline maskin aldri forsinker resten av overvåkingen.
"""

from __future__ import annotations

import concurrent.futures
import logging
from datetime import datetime
from typing import Any, Optional

from .printer_store import PrinterItem

logger = logging.getLogger("ricoh_collector.snmp")

# Standard Ricoh SNMP OIDs
MODEL_OID = ".1.3.6.1.2.1.43.5.1.1.16.1"
INK_LEVELS_BASE_OID = ".1.3.6.1.2.1.43.11.1.1.9.1"
TRAY_CAPACITY_BASE_OID = ".1.3.6.1.2.1.43.8.2.1.10.1"
ERROR_BASE_OID = ".1.3.6.1.2.1.43.18.1.1.8.1"


def decode_snmp_text(value: Any) -> str:
    """
    Dekoder tekst fra Ricoh SNMP.
    Ricoh kan returnere tekst som enten UTF-8 eller Latin-1 (ISO-8859-1).
    Prøver UTF-8 først og faller tilbake til Latin-1 ved ugyldige tegn.
    """
    if isinstance(value, bytes):
        try:
            return value.decode("utf-8")
        except UnicodeDecodeError:
            return value.decode("latin-1", errors="replace")
    return str(value)


class SnmpReader:
    """Håndterer SNMP-forespørsler mot en eller flere kopimaskiner."""

    def __init__(
        self,
        community: str = "public",
        timeout: float = 3.0,
        max_workers: int = 8,
    ):
        self.community = community
        self.timeout = timeout
        self.max_workers = max_workers

    def fetch_printer(self, printer: PrinterItem, timestamp_str: Optional[str] = None) -> dict[str, Any]:
        """Spør én kopimaskin via SNMP og bygger standard snapshot-dict."""
        # Importer puresnmp lokalt slik at modulen kan importeres selv om puresnmp ikke er installert (f.eks. i test)
        try:
            from puresnmp import get, walk
        except ImportError:
            logger.error("Pakken 'puresnmp' er ikke installert. Vennligst kjør: pip install puresnmp")
            return self._build_error_snapshot(printer, timestamp_str, "puresnmp mangler")

        if not timestamp_str:
            timestamp_str = datetime.now().strftime("%d %m %Y, %H:%M")

        printer_dict = printer.to_dict()
        result: dict[str, Any] = {
            "IP": printer_dict["IP"],
            "Name": printer_dict["Name"],
            "Serial": printer_dict["Serial"],
            "EID": printer_dict["EID"],
            "Default": printer_dict["Default"],
            "Time": timestamp_str,
            "Model": "Error fetching model",
            "Ink Levels": [],
            "Tray Information": [],
            "Errors": [],
        }

        ip = printer.IP.strip()
        if not ip:
            logger.warning(f"Printer '{printer.Name}' har ingen IP-adresse konfigurert.")
            result["Errors"] = ["Ingen IP konfigurert"]
            return result

        # 1. Hent modell
        try:
            raw_model = get(ip, self.community, MODEL_OID, timeout=self.timeout)
            model_text = decode_snmp_text(raw_model).strip()
            result["Model"] = model_text if model_text else "Ukjent Ricoh"
        except Exception as e:
            logger.debug(f"[{printer.Name} ({ip})] Kunne ikke hente modell: {e}")
            result["Model"] = "Error fetching model"

        # 2. Hent tonernivåer (Ink levels)
        try:
            ink_levels: list[str] = []
            for item in walk(ip, self.community, INK_LEVELS_BASE_OID, timeout=self.timeout):
                if not item:
                    continue
                ink_val = item[1]
                ink_levels.append(f"{ink_val}%")
            result["Ink Levels"] = ink_levels if ink_levels else ["Error fetching ink levels"]
        except Exception as e:
            logger.debug(f"[{printer.Name} ({ip})] Kunne ikke hente tonernivå: {e}")
            result["Ink Levels"] = ["Error fetching ink levels"]

        # 3. Hent skuffinnhold (Tray information)
        try:
            tray_info: list[str] = []
            for item in walk(ip, self.community, TRAY_CAPACITY_BASE_OID, timeout=self.timeout):
                if not item:
                    continue
                tray_info.append(str(item[1]))
            result["Tray Information"] = tray_info if tray_info else ["Error fetching tray information"]
        except Exception as e:
            logger.debug(f"[{printer.Name} ({ip})] Kunne ikke hente magasininformasjon: {e}")
            result["Tray Information"] = ["Error fetching tray information"]

        # 4. Hent feilmeldinger (Errors)
        try:
            errors: list[str] = []
            for item in walk(ip, self.community, ERROR_BASE_OID, timeout=self.timeout):
                if not item:
                    continue
                try:
                    err_str = decode_snmp_text(item[1]).strip()
                    if err_str:
                        errors.append(err_str)
                except Exception as dec_err:
                    logger.debug(f"[{printer.Name} ({ip})] Kunne ikke dekode feilmelding: {dec_err}")
            result["Errors"] = errors
        except Exception as e:
            logger.debug(f"[{printer.Name} ({ip})] Kunne ikke hente feilmeldinger: {e}")
            result["Errors"] = ["Error fetching errors"]

        return result

    def fetch_all(self, printers: list[PrinterItem]) -> list[dict[str, Any]]:
        """
        Spør alle definerte maskiner parallelt med en tråd-pool.
        Beholder rekkefølgen til den opprinnelige printerlisten.
        """
        if not printers:
            return []

        now_str = datetime.now().strftime("%d %m %Y, %H:%M")
        workers = min(len(printers), self.max_workers)
        results: list[dict[str, Any]] = [None] * len(printers)  # type: ignore

        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as executor:
            future_to_index = {
                executor.submit(self.fetch_printer, printer, now_str): idx
                for idx, printer in enumerate(printers)
            }

            for future in concurrent.futures.as_completed(future_to_index):
                idx = future_to_index[future]
                try:
                    results[idx] = future.result()
                except Exception as e:
                    logger.error(f"Uventet unntak ved polling av {printers[idx].Name}: {e}")
                    results[idx] = self._build_error_snapshot(printers[idx], now_str, str(e))

        return results

    def _build_error_snapshot(
        self,
        printer: PrinterItem,
        timestamp_str: Optional[str],
        error_msg: str,
    ) -> dict[str, Any]:
        """Hjelpemetode for å bygge et gyldig feil-snapshot dersom alt feiler."""
        d = printer.to_dict()
        return {
            "IP": d["IP"],
            "Name": d["Name"],
            "Serial": d["Serial"],
            "EID": d["EID"],
            "Default": d["Default"],
            "Time": timestamp_str or datetime.now().strftime("%d %m %Y, %H:%M"),
            "Model": "Error fetching model",
            "Ink Levels": ["Error fetching ink levels"],
            "Tray Information": ["Error fetching tray information"],
            "Errors": ["Error fetching errors"],
        }
