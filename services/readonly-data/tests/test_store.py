import os
import sqlite3
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from store import Store, utc_now_iso, _STATEMENTS_V1  # noqa: E402
from validate import validate_records  # noqa: E402


def rec(**kw):
    base = {
        "sourceId": "synth-air-1", "entity": "compressor-A3", "metric": "power",
        "value": 118.5, "unit": "kW", "observedAt": "2026-10-07T08:15:00+08:00",
    }
    base.update(kw)
    return base


def insert(store, records, batch_key="k1", source_id="synth-air-1"):
    res = validate_records(records, existing_keys=store.existing_keys_for(source_id))
    return store.insert_batch(
        batch_key=batch_key, source_id=source_id, entity="compressor-A3", fmt="json",
        filename="s.json", rule_version="qh-readonly-validate/1", received_at=utc_now_iso(),
        valid=res["valid"], isolated=res["isolated"], rejected=res["rejected"],
        unordered=res["unordered"],
    )


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.db = os.path.join(self.tmp, "t.sqlite3")
        self.store = Store(self.db)

    def tearDown(self):
        self.store.close()

    def test_schema_version(self):
        self.assertEqual(self.store.schema_version(), 2)

    def test_insert_and_query(self):
        out = insert(self.store, [rec(), rec(metric="power", observedAt="2026-10-07T08:30:00+08:00")])
        self.assertFalse(out["idempotent"])
        items, total = self.store.list_batches()
        self.assertEqual(total, 1)
        batch = self.store.get_batch(out["id"])
        self.assertEqual(batch["valid_rows"], 2)
        obs, n = self.store.get_observations(out["id"])
        self.assertEqual(n, 2)
        q = self.store.get_quality(out["id"])
        self.assertEqual(q["counts"]["valid"], 2)

    def test_idempotent_same_key(self):
        insert(self.store, [rec()], batch_key="same")
        again = insert(self.store, [rec()], batch_key="same")
        self.assertTrue(again["idempotent"])
        _items, total = self.store.list_batches()
        self.assertEqual(total, 1)

    def test_transaction_rolls_back_on_error(self):
        bad = [{"sourceId": "synth-air-1"}]  # 缺 value/unit/observedAt 等 -> KeyError 于事务内
        with self.assertRaises(Exception):
            self.store.insert_batch(
                batch_key="boom", source_id="synth-air-1", entity="x", fmt="json",
                filename="x", rule_version="r", received_at=utc_now_iso(),
                valid=[{"sourceId": "s", "entity": "e", "metric": "m"}],  # 缺 value
                isolated=[], rejected=[], unordered=False,
            )
        _items, total = self.store.list_batches()
        self.assertEqual(total, 0)
        self.assertIsNone(self.store.find_batch_by_key("boom"))

    def test_persistence_across_reopen(self):
        insert(self.store, [rec()], batch_key="persist")
        self.store.close()
        reopened = Store(self.db)
        try:
            _items, total = reopened.list_batches()
            self.assertEqual(total, 1)
            self.assertIsNotNone(reopened.find_batch_by_key("persist"))
        finally:
            reopened.close()

    def test_source_state_separates_timestamps(self):
        out = insert(self.store, [rec()])
        state = self.store.get_source_state("synth-air-1")
        self.assertTrue(state["configured"])
        self.assertEqual(state["sourceObservedAt"], "2026-10-07T00:15:00.000Z")
        self.assertIsNotNone(state["receivedAt"])
        self.assertIsNotNone(state["heartbeatAt"])
        # 离线批次不得标 live
        self.assertEqual(state["status"], "unconfigured")
        self.assertEqual(state["observationCount"], 1)
        self.assertIsNotNone(self.store.get_batch(out["id"]))

    # ── M07 治理事件 ────────────────────────────────────────
    def test_events_emitted_without_secret_fields(self):
        bad = {"sourceId": "synth-air-1", "entity": "compressor-A3", "metric": "power",
               "value": "NaN", "unit": "kW", "observedAt": "2026-10-07T08:00:00Z"}
        insert(self.store, [rec(), bad])
        items, total = self.store.list_events()
        self.assertGreaterEqual(total, 2)
        types = {e["type"] for e in items}
        self.assertIn("import_completed", types)
        self.assertIn("rows_rejected", types)
        allowed = {"event_id", "source_id", "batch_id", "type", "severity", "occurred_at",
                   "received_at", "rule_version", "reasons", "detail"}
        for e in items:
            self.assertTrue(allowed.issuperset(e.keys()))
            for secret in ("raw", "token", "headers", "authorization", "body"):
                self.assertNotIn(secret, e)

    def test_idempotent_import_does_not_add_event(self):
        insert(self.store, [rec()], batch_key="dup-ev")
        n1 = self.store.count_events()
        again = insert(self.store, [rec()], batch_key="dup-ev")
        self.assertTrue(again["idempotent"])
        self.assertEqual(self.store.count_events(), n1)

    def test_events_persist_across_reopen(self):
        insert(self.store, [rec()], batch_key="persist-ev")
        n1 = self.store.count_events()
        reopened = Store(self.db)
        try:
            self.assertEqual(reopened.count_events(), n1)
            self.assertGreaterEqual(n1, 1)
        finally:
            reopened.close()

    def test_migration_v1_to_v2_preserves_batches(self):
        p = os.path.join(self.tmp, "v1.sqlite3")
        c = sqlite3.connect(p)
        for stmt in _STATEMENTS_V1:
            c.execute(stmt)
        c.execute("PRAGMA user_version=1")
        c.execute(
            "INSERT INTO batches (id,batch_key,source_id,entity,format,filename,rule_version,received_at,"
            "total_rows,valid_rows,isolated_rows,rejected_rows,status,unordered,note) "
            "VALUES ('b1','k','s','e','json','f','r','t',1,1,0,0,'ok',0,'n')"
        )
        c.commit()
        c.close()
        migrated = Store(p)
        try:
            self.assertEqual(migrated.schema_version(), 2)
            self.assertIsNotNone(migrated.get_batch("b1"))  # 原批次保留
            self.assertEqual(migrated.count_events(), 0)     # 迁移不造事件
        finally:
            migrated.close()


if __name__ == "__main__":
    unittest.main()
