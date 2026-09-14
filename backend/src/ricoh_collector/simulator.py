"""
Simulering av Ricoh-kopimaskiner for lokal utvikling, testing og demoer.
Gjør det mulig å kjøre hele systemet uten fysiske Ricoh-maskiner på nettverket!
"""

from __future__ import annotations

import random
from datetime import datetime
from typing import Any

from .printer_store import PrinterItem

MOCK_PRINTERS = [
    PrinterItem(IP="192.168.1.101", Name="Bibliotek", Serial="W12345678", EID="BIB-01", Default=True),
    PrinterItem(IP="192.168.1.102", Name="Administrasjon", Serial="W87654321", EID="ADM-01", Default=True),
    PrinterItem(IP="192.168.1.103", Name="Lærerværelse", Serial="W11223344", EID="LV-01", Default=True),
    PrinterItem(IP="192.168.1.104", Name="Fløy A (1. etg)", Serial="W55667788", EID="FLA-01", Default=True),
    PrinterItem(IP="192.168.1.105", Name="Fløy B (2. etg)", Serial="W99001122", EID="FLB-01", Default=True),
    PrinterItem(IP="192.168.1.106", Name="Grafisk Senter", Serial="W33445566", EID="GS-01", Default=True),
]

MODELS = ["IM C3000", "IM C5500", "IM C300", "IM C3010", "IM C5510"]

SAMPLE_ERRORS = [
    ["Papirstopp {40440}"],
    ["Lite: gul toner {10075}", "Tomt for papir: magasin 2 {13400}"],
    ["Deksel åpent: frontdeksel {40010}"],
    ["Trenger flere stifter {40490}"],
    [],  # Feilfri
    [],  # Feilfri
]


def generate_mock_snapshot(printers: list[PrinterItem] | None = None) -> list[dict[str, Any]]:
    """Genererer realistisk Ricoh printer_data.json snapshot."""
    active_printers = printers if printers and len(printers) > 0 else MOCK_PRINTERS
    now_str = datetime.now().strftime("%d %m %Y, %H:%M")
    snapshot = []

    for idx, printer in enumerate(active_printers):
        model = MODELS[idx % len(MODELS)]
        errors = SAMPLE_ERRORS[idx % len(SAMPLE_ERRORS)]

        # Simuler toner- og skuffverdier
        black = max(5, min(100, 85 - (idx * 15)))
        cyan = max(5, min(100, 70 - (idx * 10)))
        magenta = max(5, min(100, 50 - (idx * 8)))
        yellow = 8 if "10075" in "".join(errors) else max(5, min(100, 90 - (idx * 12)))

        ink_levels = [
            f"{black}%",
            "0%",  # Ricoh waste/ekstra sensor
            f"{cyan}%",
            f"{magenta}%",
            f"{yellow}%",
        ]

        # Magasin 1-4
        tray_2_val = "0" if "magasin 2" in "".join(errors) else "250"
        trays = ["500", tray_2_val, "-3", "120", "500"]

        snapshot.append({
            "IP": printer.IP,
            "Name": printer.Name,
            "Serial": printer.Serial or f"SIM-{idx+1:04d}",
            "EID": printer.EID,
            "Default": printer.Default,
            "Time": now_str,
            "Model": model,
            "Ink Levels": ink_levels,
            "Tray Information": trays,
            "Errors": errors,
        })

    return snapshot
