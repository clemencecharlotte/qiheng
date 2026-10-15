import json
import os
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import server as server_mod  # noqa: E402
from store import Store  # noqa: E402

TOKEN = "test-cap-token"
PUBLIC_ORIGIN = "https://4202-a1db149b692927f8.code.cosmoplat.cn"


def start(cfg):
    httpd, cfg, store = server_mod.build_server(cfg)
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    port = httpd.server_address[1]
    return httpd, port, store


def req(method, url, headers=None, data=None):
    r = urllib.request.Request(url, data=data, method=method)
    for k, v in (headers or {}).items():
        r.add_header(k, v)
    try:
        with urllib.request.urlopen(r, timeout=10) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8")
        try:
            return e.code, json.loads(body or "{}")
        except json.JSONDecodeError:
            return e.code, {"raw": body}


CSV = (
    "sourceId,entity,metric,value,unit,observedAt\n"
    "synth-air-1,compressor-A3,power,118.5,kW,2026-10-07T08:15:00+08:00\n"
    "synth-air-1,compressor-A3,power,119.1,kW,2026-10-07T08:30:00+08:00\n"
)


class HttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        cfg = server_mod.Config()
        cfg.token = TOKEN
        cfg.port = 0
        cfg.db_path = os.path.join(cls.tmp, "http.sqlite3")
        cfg.allowed_origins = {"http://127.0.0.1:4202", PUBLIC_ORIGIN}
        cls.httpd, cls.port, cls.store = start(cfg)
        cls.base = f"http://127.0.0.1:{cls.port}"
        cls.auth = {"X-QH-Capability": TOKEN}

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.store.close()

    def test_health_requires_token(self):
        code, _ = req("GET", self.base + "/health")
        self.assertEqual(code, 401)
        code, body = req("GET", self.base + "/health", self.auth)
        self.assertEqual(code, 200)
        self.assertEqual(body["status"], "ok")
        self.assertEqual(body["schemaVersion"], 2)

    def test_origin_denied(self):
        code, _ = req("GET", self.base + "/health", {**self.auth, "Origin": "http://evil.example"})
        self.assertEqual(code, 403)

    def test_origin_allowed_echoes_exact(self):
        code, _ = req("GET", self.base + "/health", {**self.auth, "Origin": "http://127.0.0.1:4202"})
        self.assertEqual(code, 200)

    def test_public_https_origin_allowed_for_read_and_write(self):
        code, _ = req("GET", self.base + "/health", {**self.auth, "Origin": PUBLIC_ORIGIN})
        self.assertEqual(code, 200)
        payload = json.dumps({"records": [
            {"sourceId": "synth-air-9", "entity": "compressor-Z", "metric": "power",
             "value": 55.0, "unit": "kW", "observedAt": "2026-10-07T08:00:00Z"},
        ]}).encode()
        code2, body = req("POST", self.base + "/batches?format=json",
                          {**self.auth, "Origin": PUBLIC_ORIGIN, "Content-Type": "application/json"}, payload)
        self.assertEqual(code2, 201)
        self.assertEqual(body["counts"]["valid"], 1)

    def test_import_csv_and_idempotent(self):
        code, body = req("POST", self.base + "/batches?format=csv&filename=s.csv",
                         {**self.auth, "Content-Type": "text/csv"}, CSV.encode())
        self.assertEqual(code, 201)
        self.assertEqual(body["counts"]["valid"], 2)
        bid = body["batchId"]
        # 同内容重复导入 -> 幂等，不新增
        code2, body2 = req("POST", self.base + "/batches?format=csv&filename=s.csv",
                           {**self.auth, "Content-Type": "text/csv"}, CSV.encode())
        self.assertEqual(code2, 200)
        self.assertTrue(body2["idempotent"])
        self.assertEqual(body2["batchId"], bid)
        self._bid = bid

    def test_list_detail_observations_quality_source(self):
        code, body = req("GET", self.base + "/batches", self.auth)
        self.assertEqual(code, 200)
        self.assertGreaterEqual(body["total"], 1)
        bid = body["items"][0]["id"]
        self.assertEqual(req("GET", f"{self.base}/batches/{bid}", self.auth)[0], 200)
        ocode, obs = req("GET", f"{self.base}/batches/{bid}/observations", self.auth)
        self.assertEqual(ocode, 200)
        self.assertGreaterEqual(obs["total"], 2)
        qcode, q = req("GET", f"{self.base}/batches/{bid}/quality", self.auth)
        self.assertEqual(qcode, 200)
        self.assertEqual(q["counts"]["valid"], 2)
        self.assertIn("非官方", q["note"])
        scode, st = req("GET", self.base + "/sources/synth-air-1/state", self.auth)
        self.assertEqual(scode, 200)
        self.assertEqual(st["status"], "unconfigured")
        self.assertIsNotNone(st["sourceObservedAt"])
        self.assertIsNotNone(st["receivedAt"])
        self.assertIsNotNone(st["heartbeatAt"])

    def test_bad_rows_rejected_not_zero(self):
        payload = json.dumps({"records": [
            {"sourceId": "synth-air-2", "entity": "dryer", "metric": "dew", "value": "NaN",
             "unit": "%", "observedAt": "2026-10-07T08:00:00Z"},
            {"sourceId": "synth-air-2", "entity": "dryer", "metric": "dew", "value": 3.2,
             "unit": "furlong", "observedAt": "2026-10-07T08:00:00Z"},
            {"sourceId": "synth-air-2", "entity": "dryer", "metric": "dew", "value": 3.2,
             "unit": "%", "observedAt": "2026-10-07T08:00:00"},
        ]}).encode()
        code, body = req("POST", self.base + "/batches?format=json",
                         {**self.auth, "Content-Type": "application/json"}, payload)
        self.assertEqual(code, 201)
        self.assertEqual(body["counts"]["valid"], 0)
        self.assertEqual(body["counts"]["rejected"], 3)
        _q, q = req("GET", f"{self.base}/batches/{body['batchId']}/quality", self.auth)
        reasons = {r["reason"] for r in q["rejectReasons"]}
        self.assertIn("non_finite_value", reasons)
        self.assertIn("unknown_unit", reasons)
        self.assertIn("naive_timestamp", reasons)

    def test_events_requires_token_and_no_secret_fields(self):
        code, _ = req("GET", self.base + "/events")
        self.assertEqual(code, 401)
        code, body = req("GET", self.base + "/events?limit=5", self.auth)
        self.assertEqual(code, 200)
        self.assertIn("items", body)
        self.assertIn("total", body)
        for e in body["items"]:
            for secret in ("raw", "token", "headers", "authorization"):
                self.assertNotIn(secret, e)

    def test_events_invalid_params_400(self):
        for q in ("limit=0", "limit=999", "offset=-1", "type=bogus", "severity=bogus", "since=notatime", "foo=1"):
            code, _ = req("GET", f"{self.base}/events?{q}", self.auth)
            self.assertEqual(code, 400, q)
        code, _ = req("GET", f"{self.base}/events?since=2026-10-08T00:00:00Z&until=2026-10-07T00:00:00Z", self.auth)
        self.assertEqual(code, 400)

    def test_events_filter_pagination_and_detail(self):
        payload = json.dumps({"records": [
            {"sourceId": "synth-ev", "entity": "e", "metric": "power", "value": "NaN",
             "unit": "kW", "observedAt": "2026-10-07T08:00:00Z"},
        ]}).encode()
        code, _ = req("POST", self.base + "/batches?format=json",
                      {**self.auth, "Content-Type": "application/json"}, payload)
        self.assertEqual(code, 201)
        code, body = req("GET", self.base + "/events?type=rows_rejected&limit=1", self.auth)
        self.assertEqual(code, 200)
        self.assertLessEqual(len(body["items"]), 1)
        for e in body["items"]:
            self.assertEqual(e["type"], "rows_rejected")
        code2, body2 = req("GET", self.base + "/events?sourceId=does-not-exist", self.auth)
        self.assertEqual(code2, 200)
        self.assertEqual(body2["total"], 0)
        self.assertEqual(body2["items"], [])
        code3, body3 = req("GET", self.base + "/events?limit=2&offset=0", self.auth)
        self.assertEqual(code3, 200)
        self.assertEqual(body3["limit"], 2)
        if body3["items"]:
            eid = body3["items"][0]["eventId"]
            dcode, d = req("GET", f"{self.base}/events/{eid}", self.auth)
            self.assertEqual(dcode, 200)
            self.assertEqual(d["eventId"], eid)
        self.assertEqual(req("GET", self.base + "/events/nope", self.auth)[0], 404)

    def test_events_method_not_allowed(self):
        self.assertEqual(req("POST", self.base + "/events", self.auth)[0], 405)

    def test_events_time_filter_z_and_naive(self):
        payload = json.dumps({"records": [
            {"sourceId": "synth-tz", "entity": "e", "metric": "m", "value": 1,
             "unit": "kW", "observedAt": "2026-10-07T08:00:00Z"},
        ]}).encode()
        req("POST", self.base + "/batches?format=json",
            {**self.auth, "Content-Type": "application/json"}, payload)
        code, body = req("GET", self.base + "/events?since=2020-01-01T00:00:00Z", self.auth)
        self.assertEqual(code, 200)
        self.assertGreaterEqual(body["total"], 1)
        # 小数 Z 也接受
        self.assertEqual(req("GET", self.base + "/events?since=2020-01-01T00:00:00.000Z", self.auth)[0], 200)
        # 偏移时间也接受
        self.assertEqual(req("GET", self.base + "/events?since=2020-01-01T08:00:00%2B08:00", self.auth)[0], 200)
        # 缺时区拒绝
        self.assertEqual(req("GET", self.base + "/events?since=2026-10-07T00:00:00", self.auth)[0], 400)

    def test_oversize_rejected(self):
        cfg = server_mod.Config()
        cfg.token = TOKEN
        cfg.port = 0
        cfg.max_body = 200
        cfg.db_path = os.path.join(self.tmp, "small.sqlite3")
        httpd, port, store = start(cfg)
        try:
            big = ("sourceId,entity,metric,value,unit,observedAt\n" + "x" * 400).encode()
            code, body = req("POST", f"http://127.0.0.1:{port}/batches?format=csv",
                             {"X-QH-Capability": TOKEN, "Content-Type": "text/csv"}, big)
            self.assertEqual(code, 413)
            self.assertEqual(body["error"], "payload_too_large")
            # 超限之后服务器仍可用（有界丢弃请求体 + Connection: close，连接不错乱）
            code2, _ = req("GET", f"http://127.0.0.1:{port}/health", {"X-QH-Capability": TOKEN})
            self.assertEqual(code2, 200)
        finally:
            httpd.shutdown()
            httpd.server_close()
            store.close()

    def test_persistence_restart(self):
        cfg = server_mod.Config()
        cfg.token = TOKEN
        cfg.port = 0
        cfg.db_path = self.store.db_path
        httpd, port, store = start(cfg)
        try:
            code, body = req("GET", f"http://127.0.0.1:{port}/batches", {"X-QH-Capability": TOKEN})
            self.assertEqual(code, 200)
            self.assertGreaterEqual(body["total"], 1)
        finally:
            httpd.shutdown()
            httpd.server_close()
            store.close()


if __name__ == "__main__":
    unittest.main()
