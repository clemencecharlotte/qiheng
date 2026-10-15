import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from validate import validate_records  # noqa: E402


def rec(**kw):
    base = {
        "sourceId": "synth-air-1", "entity": "compressor-A3", "metric": "power",
        "value": 118.5, "unit": "kW", "observedAt": "2026-10-07T08:15:00+08:00",
    }
    base.update(kw)
    return base


class ValidateTests(unittest.TestCase):
    def test_valid_row_normalized_to_utc(self):
        r = validate_records([rec()])
        self.assertEqual(len(r["valid"]), 1)
        self.assertEqual(r["valid"][0]["observedAt"], "2026-10-07T00:15:00.000Z")
        self.assertFalse(r["unordered"])

    def test_nan_and_inf_rejected_never_zero(self):
        for bad in (float("nan"), float("inf"), "-Infinity", "abc"):
            r = validate_records([rec(value=bad)])
            self.assertEqual(len(r["valid"]), 0, bad)
            self.assertEqual(len(r["rejected"]), 1, bad)
            self.assertEqual(r["rejected"][0]["reason"], "non_finite_value", bad)

    def test_unknown_unit_rejected(self):
        r = validate_records([rec(unit="furlong")])
        self.assertEqual(r["rejected"][0]["reason"], "unknown_unit")

    def test_naive_and_bad_timestamp(self):
        self.assertEqual(
            validate_records([rec(observedAt="2026-10-07T08:15:00")])["rejected"][0]["reason"],
            "naive_timestamp",
        )
        self.assertEqual(
            validate_records([rec(observedAt="not-a-time")])["rejected"][0]["reason"],
            "bad_timestamp",
        )

    def test_missing_field(self):
        r = validate_records([rec(metric="")])
        self.assertEqual(r["rejected"][0]["reason"], "missing_field:metric")

    def test_duplicate_key_isolated(self):
        r = validate_records([rec(), rec()])
        self.assertEqual(len(r["valid"]), 1)
        self.assertEqual(len(r["isolated"]), 1)
        self.assertEqual(r["isolated"][0]["reason"], "duplicate_key")

    def test_duplicate_existing_isolated(self):
        existing = {("synth-air-1", "compressor-A3", "power", "2026-10-07T00:15:00.000Z")}
        r = validate_records([rec()], existing_keys=existing)
        self.assertEqual(len(r["valid"]), 0)
        self.assertEqual(r["isolated"][0]["reason"], "duplicate_existing")

    def test_out_of_order_kept_valid_but_flagged(self):
        a = rec(observedAt="2026-10-07T08:20:00+08:00", metric="power")
        b = rec(observedAt="2026-10-07T08:10:00+08:00", metric="power")
        r = validate_records([a, b])
        self.assertEqual(len(r["valid"]), 2)
        self.assertTrue(r["unordered"])

    def test_input_pass_not_trusted(self):
        # 输入谎称 pass/quality，但 value 非法 -> 仍被拒绝，且不影响判定
        r = validate_records([rec(value="nan", pass_=True, quality="valid")])
        self.assertEqual(len(r["valid"]), 0)
        self.assertEqual(r["rejected"][0]["reason"], "non_finite_value")

    def test_z_and_offset_parsing_py39_compat(self):
        # 末尾 Z / 小数 Z / +08:00 / +0800 均应解析并归一到 UTC 'Z'
        cases = {
            "2026-10-07T08:15:00Z": "2026-10-07T08:15:00.000Z",
            "2026-10-07T08:15:00.500z": "2026-10-07T08:15:00.500Z",
            "2026-10-07T08:15:00+08:00": "2026-10-07T00:15:00.000Z",
            "2026-10-07T08:15:00+0800": "2026-10-07T00:15:00.000Z",
        }
        for given, expected in cases.items():
            r = validate_records([rec(observedAt=given)])
            self.assertEqual(len(r["valid"]), 1, given)
            self.assertEqual(r["valid"][0]["observedAt"], expected, given)
        # 缺时区仍拒绝
        self.assertEqual(
            validate_records([rec(observedAt="2026-10-07T08:15:00")])["rejected"][0]["reason"],
            "naive_timestamp",
        )


if __name__ == "__main__":
    unittest.main()
