"""
Konfigurasjonshåndtering for Ricoh SNMP Collector.

Støtter:
- config.json (anbefalt moderne format)
- credentials.json (legacy bakoverkompatibilitet)
- Miljøvariabler (SFTP_HOST, LOGGER_KEY, etc. for Docker/systemd)
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional


@dataclass
class SftpConfig:
    host: str = ""
    port: int = 22
    user: str = ""
    password: str = ""
    target_path: str = ""

    @property
    def is_configured(self) -> bool:
        return bool(self.host and self.user and self.target_path)


@dataclass
class LoggerConfig:
    url: str = ""
    key: str = ""

    @property
    def is_configured(self) -> bool:
        return bool(self.url and self.key)


@dataclass
class CollectorConfig:
    interval: int = 40
    printers_file: str = "printers.json"
    snmp_community: str = "public"
    snmp_timeout: float = 3.0
    max_workers: int = 8
    output_file: str = "printer_data.json"
    sftp: SftpConfig = field(default_factory=SftpConfig)
    logger: LoggerConfig = field(default_factory=LoggerConfig)

    @classmethod
    def load(
        cls,
        config_path: Optional[str | Path] = None,
        search_dirs: Optional[list[Path]] = None,
    ) -> CollectorConfig:
        """
        Laster konfigurasjon med følgende prioritet:
        1. Angitt filbane
        2. config.json
        3. credentials.json (bakoverkompatibelt)
        4. Miljøvariabler (overskriver filinnstillinger)
        """
        if search_dirs is None:
            pkg_dir = Path(__file__).resolve().parent
            backend_dir = pkg_dir.parent.parent
            search_dirs = [
                Path.cwd(),
                backend_dir,
                backend_dir / "config",
                pkg_dir.parent,
            ]

        raw_data: dict[str, Any] = {}

        # 1. Finn konfigurasjonsfil dersom ikke eksplisitt oppgitt
        target_file: Optional[Path] = None
        if config_path:
            p = Path(config_path)
            if p.is_file():
                target_file = p
        else:
            candidates = ["config.json", "credentials.json"]
            for s_dir in search_dirs:
                for cand in candidates:
                    check = s_dir / cand
                    if check.is_file():
                        target_file = check
                        break
                if target_file:
                    break

        if target_file and target_file.is_file():
            try:
                with open(target_file, "r", encoding="utf-8") as f:
                    raw_data = json.load(f)
            except Exception as e:
                print(f"[ADVARSEL] Kunne ikke lese konfigurasjonsfil {target_file}: {e}")

        # Støtt både flat credentials.json og strukturert config.json
        sftp_host = raw_data.get("sftp", {}).get("host") or raw_data.get("host", "")
        sftp_port = int(
            raw_data.get("sftp", {}).get("port")
            or raw_data.get("port", 22)
        )
        sftp_user = raw_data.get("sftp", {}).get("user") or raw_data.get("user", "")
        sftp_pass = raw_data.get("sftp", {}).get("pass") or raw_data.get("pass", "")
        sftp_path = raw_data.get("sftp", {}).get("path") or raw_data.get("path", "")

        logger_url = (
            raw_data.get("logger", {}).get("url")
            or raw_data.get("logger_url", "")
        )
        logger_key = (
            raw_data.get("logger", {}).get("key")
            or raw_data.get("logger_key", "")
        )

        interval = int(
            raw_data.get("interval", raw_data.get("run_interval", 40))
        )
        printers_file = str(
            raw_data.get("printers_file", "printers.json")
        )

        # 2. Miljøvariabler overstyrer filkonfigurasjon
        sftp_host = os.environ.get("SFTP_HOST", sftp_host)
        sftp_port = int(os.environ.get("SFTP_PORT", str(sftp_port)))
        sftp_user = os.environ.get("SFTP_USER", sftp_user)
        sftp_pass = os.environ.get("SFTP_PASS", sftp_pass)
        sftp_path = os.environ.get("SFTP_PATH", sftp_path)

        logger_url = os.environ.get("LOGGER_URL", logger_url)
        logger_key = os.environ.get("LOGGER_KEY", logger_key)
        interval = int(os.environ.get("POLL_INTERVAL", str(interval)))
        printers_file = os.environ.get("PRINTERS_FILE", printers_file)

        return cls(
            interval=max(1, interval),
            printers_file=printers_file,
            snmp_community=os.environ.get("SNMP_COMMUNITY", raw_data.get("snmp_community", "public")),
            snmp_timeout=float(os.environ.get("SNMP_TIMEOUT", raw_data.get("snmp_timeout", 3.0))),
            max_workers=int(os.environ.get("MAX_WORKERS", raw_data.get("max_workers", 8))),
            output_file=raw_data.get("output_file", "printer_data.json"),
            sftp=SftpConfig(
                host=sftp_host,
                port=sftp_port,
                user=sftp_user,
                password=sftp_pass,
                target_path=sftp_path,
            ),
            logger=LoggerConfig(
                url=logger_url,
                key=logger_key,
            ),
        )
