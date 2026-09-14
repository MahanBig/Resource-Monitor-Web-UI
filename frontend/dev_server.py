#!/usr/bin/env python3
"""
Ricoh Frontend Utviklings- og Forhåndsvisningsserver
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
Kjører en lokal HTTP-server på port 8000 for umiddelbar testing
og visuell forhåndsvisning av frontenden uten behov for PHP eller MySQL.

Bruk:
  python dev_server.py
"""

import http.server
import json
import os
import socketserver
import sys
import urllib.parse
from datetime import datetime
from pathlib import Path

# Sørg for at UTF-8 fungerer i Windows-terminaler
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

PORT = 8000
FRONTEND_DIR = Path(__file__).resolve().parent


class RicohDevHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(FRONTEND_DIR), **kwargs)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        # Simuler API-endepunkter dersom PHP ikke er tilgjengelig lokalt
        if path.endswith("api/stats.php"):
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            mock_stats = {
                "ok": True,
                "period": {"key": "today", "label": "I dag"},
                "summary": {
                    "opened_count": 3,
                    "resolved_count": 2,
                    "critical_count": 1,
                    "warning_count": 2,
                    "other_count": 0,
                    "affected_printers": 3,
                    "avg_resolution_seconds": 1240,
                    "active_total": 2,
                    "toner_replaced_count": 4,
                    "toner_alerts_count": 1,
                    "active_toner": 1,
                    "paper_refilled_count": 6,
                    "paper_empty_count": 1,
                    "active_paper": 1,
                },
                "printer_leaderboard": [
                    {"printer_name": "Bibliotek", "printer_model": "IM C3000", "total": 2, "critical": 1, "warning": 1, "other": 0},
                    {"printer_name": "Administrasjon", "printer_model": "IM C5500", "total": 1, "critical": 0, "warning": 1, "other": 0},
                ],
                "error_leaderboard": [
                    {"severity": "critical", "error_message": "Papirstopp", "error_code": "40440", "total": 2, "avg_resolution_seconds": 450},
                    {"severity": "warning", "error_message": "Tomt for papir: magasin 2", "error_code": "13400", "total": 1, "avg_resolution_seconds": 1800},
                ],
                "toner_leaderboard": [
                    {"printer_name": "Bibliotek", "total": 2, "black_count": 1, "cyan_count": 0, "magenta_count": 1, "yellow_count": 0, "waste_count": 0},
                    {"printer_name": "Administrasjon", "total": 2, "black_count": 0, "cyan_count": 1, "magenta_count": 0, "yellow_count": 1, "waste_count": 0},
                ],
                "paper_leaderboard": [
                    {"printer_name": "Bibliotek", "total": 4},
                    {"printer_name": "Administrasjon", "total": 2},
                ],
                "longest_incident": {
                    "severity": "critical",
                    "printer_name": "Bibliotek",
                    "error_message": "Deksel åpent: høyre deksel {40010}",
                    "duration_seconds": 3820,
                    "opened_at": "2026-09-14 10:15:00",
                    "resolved_at": "2026-09-14 11:18:40",
                },
                "active_incidents": [
                    {"severity": "critical", "printer_name": "Bibliotek", "error_message": "Papirstopp {40440}", "duration_seconds": 620},
                    {"severity": "warning", "printer_name": "Administrasjon", "error_message": "Lite: gul toner {10075}", "duration_seconds": 1450},
                ],
            }
            self.wfile.write(json.dumps(mock_stats, ensure_ascii=False).encode("utf-8"))
            return

        if path.endswith("api/events.php"):
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            mock_events = {
                "ok": True,
                "events": [
                    {
                        "id": 1,
                        "event_type": "opened",
                        "event_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                        "printer_name": "Bibliotek",
                        "severity": "critical",
                        "error_message": "Papirstopp {40440}",
                        "duration_seconds": 620,
                    },
                    {
                        "id": 2,
                        "event_type": "resolved",
                        "event_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                        "printer_name": "Administrasjon",
                        "severity": "toner",
                        "error_message": "Gul toner byttet",
                        "duration_seconds": 940,
                    },
                ],
            }
            self.wfile.write(json.dumps(mock_events, ensure_ascii=False).encode("utf-8"))
            return

        return super().do_GET()


def run():
    os.chdir(str(FRONTEND_DIR))
    handler = RicohDevHandler

    with socketserver.TCPServer(("", PORT), handler) as httpd:
        print("=" * 60)
        print(f"[OK] Ricoh Frontend Utviklingsserver kjører!")
        print(f"   * Hovedvisning:   http://localhost:{PORT}/")
        print(f"   * Kiosk / TV:     http://localhost:{PORT}/oppsummering.html")
        print(f"   * Statistikk:     http://localhost:{PORT}/?stats=1")
        print("=" * 60)
        print("Trykk Ctrl+C for å stanse serveren.\n")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStanser utviklingsserver.")


if __name__ == "__main__":
    run()
