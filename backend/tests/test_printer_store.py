import sys
import tempfile
from pathlib import Path

src_dir = Path(__file__).resolve().parent.parent / "src"
if str(src_dir) not in sys.path:
    sys.path.insert(0, str(src_dir))

import unittest
from ricoh_collector.printer_store import PrinterItem, PrinterStore


class TestPrinterStore(unittest.TestCase):
    def test_printer_item_dict(self):
        p = PrinterItem(IP="192.168.1.50", Name="Test Printer", Serial="ABC1234")
        d = p.to_dict()
        self.assertEqual(d["IP"], "192.168.1.50")
        self.assertEqual(d["Name"], "Test Printer")
        self.assertEqual(d["Serial"], "ABC1234")

    def test_save_and_load_json(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            fpath = Path(tmp_dir) / "printers.json"
            store = PrinterStore(fpath)
            items = [
                PrinterItem(IP="10.0.0.1", Name="Printer 1"),
                PrinterItem(IP="10.0.0.2", Name="Printer 2"),
            ]
            self.assertTrue(store.save(items))

            loaded = store.load()
            self.assertEqual(len(loaded), 2)
            self.assertEqual(loaded[0].Name, "Printer 1")
            self.assertEqual(loaded[1].IP, "10.0.0.2")


if __name__ == "__main__":
    unittest.main()
