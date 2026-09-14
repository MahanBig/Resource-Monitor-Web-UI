"""
Håndtering av printerlisten for Ricoh SNMP Collector.

Støtter både moderne `printers.json` og legacy `Printers.pkl` (pickle),
og kan automatisk konvertere fra pickle til JSON for bedre lesbarhet.
"""

from __future__ import annotations

import json
import logging
import pickle
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger("ricoh_collector.printer_store")


@dataclass
class PrinterItem:
    IP: str
    Name: str
    Serial: str = ""
    EID: str = ""
    Default: bool = True

    def to_dict(self) -> dict[str, Any]:
        return {
            "IP": self.IP.strip(),
            "Name": self.Name.strip(),
            "Serial": self.Serial.strip(),
            "EID": self.EID.strip(),
            "Default": bool(self.Default),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> PrinterItem:
        return cls(
            IP=str(data.get("IP", "")).strip(),
            Name=str(data.get("Name", "")).strip() or "Ukjent printer",
            Serial=str(data.get("Serial", "")).strip(),
            EID=str(data.get("EID", "")).strip(),
            Default=bool(data.get("Default", True)),
        )


class PrinterStore:
    """Lagrer og laster printerdefinisjoner fra disk."""

    def __init__(self, file_path: str | Path = "printers.json"):
        self.file_path = Path(file_path)

    def load(self) -> list[PrinterItem]:
        """
        Laster printere.
        Dersom `printers.json` ikke finnes men `Printers.pkl` finnes,
        lastes data fra pickle og eksporteres automatisk til JSON.
        """
        # 1. Prøv oppgitt filbane direkte
        if self.file_path.is_file():
            return self._load_file(self.file_path)

        # 2. Prøv å se etter printers.json i backend- eller config-mappen
        backend_dir = Path(__file__).resolve().parent.parent.parent
        for candidate_dir in [Path.cwd(), backend_dir, backend_dir / "config"]:
            json_alt = candidate_dir / "printers.json"
            if json_alt.is_file():
                self.file_path = json_alt
                return self._load_file(json_alt)

        # 3. Fallback til legacy Printers.pkl
        for candidate_dir in [Path.cwd(), backend_dir, backend_dir / "config"]:
            pkl_alt = candidate_dir / "Printers.pkl"
            if pkl_alt.is_file():
                logger.info(f"Fant legacy {pkl_alt.name}. Laster og migrerer...")
                items = self._load_file(pkl_alt)
                try:
                    target_json = candidate_dir / "printers.json"
                    self.file_path = target_json
                    self.save(items)
                    logger.info(f"Migrerte {len(items)} printere til {target_json}.")
                except Exception as e:
                    logger.warning(f"Kunne ikke lagre migrert JSON: {e}")
                return items

        # Fallback til lokal filbane hvis i nåværende mappe
        local_pkl = Path("Printers.pkl")
        if local_pkl.is_file():
            return self._load_file(local_pkl)

        logger.warning(f"Ingen printerliste funnet på '{self.file_path}'. Returnerer tom liste.")
        return []

    def _load_file(self, path: Path) -> list[PrinterItem]:
        """Laster fra enten JSON eller pickle basert på filendelse."""
        try:
            if path.suffix.lower() == ".pkl":
                with open(path, "rb") as f:
                    raw_data = pickle.load(f)
            else:
                with open(path, "r", encoding="utf-8") as f:
                    raw_data = json.load(f)

            if not isinstance(raw_data, list):
                logger.error(f"Ugyldig format i {path}. Forventet liste.")
                return []

            printers = []
            for item in raw_data:
                if isinstance(item, dict):
                    printers.append(PrinterItem.from_dict(item))
            return printers

        except Exception as e:
            logger.error(f"Feil ved lasting av printere fra {path}: {e}")
            return []

    def save(self, printers: list[PrinterItem], output_path: Optional[Path] = None) -> bool:
        """Lagrer printerlisten i rent JSON-format."""
        target = output_path or self.file_path
        if target.suffix.lower() == ".pkl":
            target = target.with_suffix(".json")

        data = [p.to_dict() for p in printers]
        try:
            with open(target, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=4, ensure_ascii=False)
            logger.info(f"Lagret {len(printers)} printere til {target}.")
            return True
        except Exception as e:
            logger.error(f"Kunne ikke lagre printere til {target}: {e}")
            return False
