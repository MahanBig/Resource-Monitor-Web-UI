#!/usr/bin/env python3
"""
RicohReader.py - Bakoverkompatibel inngang for Ricoh SNMP Collector.
Videresender direkte til backend/main.py.
"""

import sys
from pathlib import Path

# Sørg for at src/ og gjeldende mappe ligger i sys.path
_cur_dir = Path(__file__).resolve().parent
_src_dir = _cur_dir / "src"

for p in [str(_cur_dir), str(_src_dir)]:
    if p not in sys.path:
        sys.path.insert(0, p)

from main import main

if __name__ == "__main__":
    main()
