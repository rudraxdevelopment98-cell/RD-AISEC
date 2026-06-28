"""Harness tests — the scanner+gateway must ace the current Attack Range.

Run from the harness dir:  python -m unittest discover -s tests
"""
import sys
import unittest
from pathlib import Path

HARNESS_DIR = Path(__file__).resolve().parents[1]
SHIVA_DIR = HARNESS_DIR.parent
RANGE_DIR = SHIVA_DIR / "attack-range"
sys.path.insert(0, str(HARNESS_DIR))

from shiva_harness.runner import evaluate, score  # noqa: E402


class TestBenchmark(unittest.TestCase):
    def setUp(self):
        self.results = evaluate(RANGE_DIR)
        self.s = score(self.results)

    def test_full_detection(self):
        self.assertEqual(self.s["detection_rate"], 1.0,
                         "every malicious server should be detected")

    def test_zero_false_positives(self):
        self.assertEqual(self.s["fp_rate"], 0.0,
                         "benign baseline must not be flagged HIGH+")

    def test_gateway_blocks_poisoned_tool(self):
        poisoned = [r for r in self.results if r.case.attack == "poisoning"][0]
        self.assertTrue(poisoned.gateway_blocked, "gateway must block the poisoned tool")

    def test_all_cases_pass(self):
        self.assertTrue(self.s["all_passed"])
        self.assertTrue(all(r.passed for r in self.results))


if __name__ == "__main__":
    unittest.main()
