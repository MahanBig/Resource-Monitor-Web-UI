import asyncio
import json
import pickle
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import RicohReader as rr  # noqa: E402


class FakeReader:
    def __init__(self, results):
        self.results = results

    async def read_printer(self, printer):
        return dict(self.results[printer["IP"]])


class DecodeTests(unittest.TestCase):
    def test_utf8(self):
        self.assertEqual(rr.decode_snmp_text("Deksel åpent".encode("utf-8")), "Deksel åpent")

    def test_latin1_fallback(self):
        self.assertEqual(rr.decode_snmp_text("Deksel åpent".encode("latin-1")), "Deksel åpent")

    def test_strips_nulls_and_non_bytes(self):
        self.assertEqual(rr.decode_snmp_text(b"IM C3000\x00"), "IM C3000")
        self.assertEqual(rr.decode_snmp_text(42), "42")
        self.assertEqual(rr.decode_snmp_text(None), "")


class SupplyTests(unittest.TestCase):
    def test_percent(self):
        self.assertEqual(rr.supply_percent(50, 100), 50)
        self.assertEqual(rr.supply_percent(5, 10), 50)
        self.assertEqual(rr.supply_percent(-3, 100), None)
        self.assertEqual(rr.supply_percent(80, 0), 80)
        self.assertEqual(rr.supply_percent("x", 100), None)

    def test_colors(self):
        self.assertEqual(rr.detect_supply_color("Black Toner"), "black")
        self.assertEqual(rr.detect_supply_color("Waste Toner Bottle"), "waste")
        self.assertEqual(rr.detect_supply_color("Gul toner"), "yellow")
        self.assertEqual(rr.detect_supply_color("Cyan"), "cyan")
        self.assertIsNone(rr.detect_supply_color("Drum unit"))


class ConfigTests(unittest.TestCase):
    def test_legacy_credentials(self):
        cfg = rr.legacy_credentials_to_config({
            "host": "h", "port": "22", "user": "u", "pass": "p", "path": "/x",
            "logger_url": "https://l", "logger_key": "k",
        })
        self.assertEqual(cfg["sftp"]["port"], 22)
        self.assertEqual(cfg["logger"], {"url": "https://l", "key": "k"})

    def test_env_overrides(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "config.json"
            path.write_text(json.dumps({"interval_seconds": 60}))
            cfg = rr.load_config(path, environ={
                "RM_SNMP_COMMUNITY": "secret",
                "RM_SFTP_HOST": "example.com",
                "RM_SNMP_TIMEOUT": "3",
            })
        self.assertEqual(cfg["interval_seconds"], 60)
        self.assertEqual(cfg["snmp"]["community"], "secret")
        self.assertEqual(cfg["snmp"]["timeout"], 3)
        self.assertTrue(cfg["sftp"]["enabled"])

    def test_sftp_disabled_without_host(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "config.json"
            path.write_text("{}")
            cfg = rr.load_config(path, environ={})
        # credentials.json may exist next to the script on a dev machine
        if not (rr.BASE_DIR / "credentials.json").is_file():
            self.assertFalse(cfg["sftp"]["enabled"])

    def test_interval_validation(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "config.json"
            path.write_text(json.dumps({"interval_seconds": 1}))
            with self.assertRaises(rr.ConfigError):
                rr.load_config(path, environ={})

    def test_redact(self):
        safe = rr.redact({"sftp": {"pass": "x"}, "logger": {"key": "y"}})
        self.assertEqual(safe["sftp"]["pass"], "********")
        self.assertEqual(safe["logger"]["key"], "********")


class SecurityTests(unittest.TestCase):
    def base(self, url, key="x" * 20):
        return {"logger": {"url": url, "key": key}}

    def test_plain_http_logger_warns(self):
        self.assertTrue(any("http://" in w for w in rr.security_warnings(self.base("http://example.com/api/process-printers.php"))))

    def test_local_http_is_fine(self):
        self.assertFalse(any("http://" in w for w in rr.security_warnings(self.base("http://web/api/process-printers.php"))))

    def test_short_key_warns(self):
        self.assertTrue(any("shorter" in w for w in rr.security_warnings(self.base("https://x.org/a", key="short"))))

    def test_logger_rejects_other_schemes(self):
        with self.assertRaises(RuntimeError):
            rr.post_to_logger([], {"url": "file:///etc/passwd", "key": "k" * 20})


class PrinterListTests(unittest.TestCase):
    def test_normalize_defaults(self):
        p = rr.normalize_printer({"IP": " 10.0.0.1 "})
        self.assertEqual(p, {"IP": "10.0.0.1", "Name": "10.0.0.1", "Serial": "", "EID": "", "Default": True})

    def test_missing_ip(self):
        with self.assertRaises(ValueError):
            rr.normalize_printer({"Name": "x"})

    def test_save_and_load(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "Printers.json"
            rr.save_printers(path, [{"IP": "10.0.0.1", "Name": "A"}])
            self.assertEqual(rr.load_printers(path)[0]["Name"], "A")

    def test_import_pickle(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "Printers.pkl"
            path.write_bytes(pickle.dumps([{"IP": "10.0.0.2", "Name": "B", "Serial": "S", "EID": "", "Default": True}]))
            self.assertEqual(rr.import_pickle(path)[0]["Serial"], "S")

    def test_import_pickle_rejects_objects(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "evil.pkl"
            path.write_bytes(pickle.dumps([Path("/")]))
            with self.assertRaises(pickle.UnpicklingError):
                rr.import_pickle(path)


class PollTests(unittest.TestCase):
    def test_poll_merges_config_and_snmp(self):
        printers = [rr.normalize_printer({"IP": "10.0.0.1", "Name": "A"})]
        reader = FakeReader({"10.0.0.1": {"Online": True, "Model": "IM C3000", "Errors": []}})
        snapshot = asyncio.run(rr.poll_printers(printers, reader, 4))
        self.assertEqual(snapshot[0]["Name"], "A")
        self.assertEqual(snapshot[0]["Model"], "IM C3000")
        self.assertIn("Timestamp", snapshot[0])
        self.assertRegex(snapshot[0]["Time"], r"^\d\d \d\d \d{4}, \d\d:\d\d$")

    def test_offline_printer_placeholders(self):
        reader = rr.SnmpReader("public", 161, 1, 0)
        # 192.0.2.0/24 is TEST-NET-1 and never answers.
        info = asyncio.run(reader.read_printer({"IP": "192.0.2.1", "Name": "x"}))
        self.assertFalse(info["Online"])
        self.assertEqual(info["Errors"], [rr.ERR_ERRORS])
        self.assertEqual(info["Model"], rr.ERR_MODEL)

    def test_atomic_write(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "sub" / "out.json"
            rr.atomic_write_json(path, [{"a": "å"}])
            self.assertEqual(json.loads(path.read_text(encoding="utf-8")), [{"a": "å"}])
            self.assertEqual(len(list(path.parent.iterdir())), 1)


if __name__ == "__main__":
    unittest.main()
