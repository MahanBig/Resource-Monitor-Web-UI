import sys
from pathlib import Path

src_dir = Path(__file__).resolve().parent.parent / "src"
if str(src_dir) not in sys.path:
    sys.path.insert(0, str(src_dir))

import unittest
from ricoh_collector.config import CollectorConfig


class TestCollectorConfig(unittest.TestCase):
    def test_default_config(self):
        cfg = CollectorConfig()
        self.assertEqual(cfg.interval, 40)
        self.assertEqual(cfg.snmp_community, "public")
        self.assertEqual(cfg.output_file, "printer_data.json")
        self.assertFalse(cfg.sftp.is_configured)
        self.assertFalse(cfg.logger.is_configured)

    def test_sftp_config_validation(self):
        cfg = CollectorConfig()
        cfg.sftp.host = "example.com"
        cfg.sftp.user = "admin"
        cfg.sftp.target_path = "/var/www"
        self.assertTrue(cfg.sftp.is_configured)

    def test_logger_config_validation(self):
        cfg = CollectorConfig()
        cfg.logger.url = "https://example.com/api"
        cfg.logger.key = "secret"
        self.assertTrue(cfg.logger.is_configured)


if __name__ == "__main__":
    unittest.main()
