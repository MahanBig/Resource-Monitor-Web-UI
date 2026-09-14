"""
Klient for sending av printer-snapshots til PHP-historikkloggeren.

Krever ingen eksterne biblioteker (bruker standardbiblioteket urllib).
"""

from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request
from typing import Any

from .config import LoggerConfig

logger = logging.getLogger("ricoh_collector.logger_client")


class EventLoggerClient:
    """Sender printerdata til PHP backend for logging av hendelser og statistikk."""

    def __init__(self, config: LoggerConfig):
        self.config = config

    def send_snapshot(self, printer_data: list[dict[str, Any]]) -> bool:
        """Poster et ferskt snapshot til PHP API-et."""
        if not self.config.is_configured:
            logger.debug("Logger-API er ikke konfigurert; hopper over hendelseslogging.")
            return False

        try:
            payload = json.dumps(printer_data, ensure_ascii=False).encode("utf-8")
            request = urllib.request.Request(
                self.config.url,
                data=payload,
                method="POST",
                headers={
                    "Content-Type": "application/json; charset=utf-8",
                    "X-Logger-Key": self.config.key,
                    "User-Agent": "RicohReader/3.1",
                },
            )

            with urllib.request.urlopen(request, timeout=15) as response:
                status = response.status
                body = response.read().decode("utf-8", errors="replace")
                logger.info(f"Hendelseslogger svarte med HTTP {status}: {body[:150]}")
                return True

        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8", errors="replace")
            logger.error(f"HTTP-feil fra hendelseslogger ({e.code}): {err_body}")
            return False
        except urllib.error.URLError as e:
            logger.error(f"Kunne ikke nå hendelseslogger ({self.config.url}): {e.reason}")
            return False
        except Exception as e:
            logger.error(f"Uventet feil ved sending til hendelseslogger: {e}")
            return False

    def test_connection(self) -> tuple[bool, str]:
        """Tester tilkobling og autentisering mot PHP logger API."""
        if not self.config.is_configured:
            return False, "Logger URL og/eller nøkkel er ikke konfigurert."

        # Send et tomt test-snapshot
        test_payload = json.dumps([], ensure_ascii=False).encode("utf-8")
        request = urllib.request.Request(
            self.config.url,
            data=test_payload,
            method="POST",
            headers={
                "Content-Type": "application/json; charset=utf-8",
                "X-Logger-Key": self.config.key,
                "User-Agent": "RicohReader/3.1-Test",
            },
        )

        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                body = response.read().decode("utf-8", errors="replace")
                return True, f"Logger-API svarte med HTTP {response.status}: {body[:200]}"
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")
            if e.code == 401:
                return False, f"Autentisering feilet (HTTP 401). Sjekk at logger_key er identisk i api/config.php: {body}"
            return False, f"Logger-API returnerte feilkode HTTP {e.code}: {body}"
        except Exception as e:
            return False, f"Kunne ikke kontakte logger-API: {e}"
