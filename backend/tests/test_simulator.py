import sys
from pathlib import Path

src_dir = Path(__file__).resolve().parent.parent / "src"
if str(src_dir) not in sys.path:
    sys.path.insert(0, str(src_dir))

import unittest
from ricoh_collector.simulator import generate_mock_snapshot


class TestSimulator(unittest.TestCase):
    def test_mock_snapshot_generation(self):
        snapshot = generate_mock_snapshot()
        self.assertIsInstance(snapshot, list)
        self.assertGreaterEqual(len(snapshot), 6)

        first = snapshot[0]
        self.assertIn("IP", first)
        self.assertIn("Name", first)
        self.assertIn("Model", first)
        self.assertIn("Ink Levels", first)
        self.assertIn("Tray Information", first)
        self.assertIn("Errors", first)
        self.assertEqual(len(first["Ink Levels"]), 5)


if __name__ == "__main__":
    unittest.main()
