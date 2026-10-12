import logging
import os
import tempfile
import time

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from pv.pipeline import UnknownSite, VerifyResult
from pv.preprocess import InvalidImage
from pv.service import create_app

KEY = "test-key"
OK = VerifyResult(True, 0.91, "MATCH", 812)


class StubVerifier:
    def __init__(self, result=OK, exc=None, delay=0.0):
        self.result, self.exc, self.delay, self.seen = result, exc, delay, []

    def verify(self, site_id, data, early_exit="both"):
        self.seen.append((site_id, len(data)))
        if self.delay:
            time.sleep(self.delay)
        if self.exc:
            raise self.exc
        return self.result


def client(stub, **kw):
    return TestClient(create_app(lambda: stub, KEY, **kw))


def post(c, body=b"img", key=KEY, site="gate"):
    headers = {"Content-Type": "image/jpeg"}
    if key is not None:
        headers["X-PV-Key"] = key
    return c.post(f"/verify?site_id={site}", content=body, headers=headers)


def test_success_contract_has_exactly_four_fields():
    with client(StubVerifier()) as c:
        r = post(c)
    assert r.status_code == 200
    assert r.json() == {"match": True, "score": 0.91, "reason_code": "MATCH", "latency_ms": 812}


@pytest.mark.parametrize("key", [None, "wrong", ""])
def test_bad_key_is_401_and_verifier_not_called(key):
    stub = StubVerifier()
    with client(stub) as c:
        r = post(c, key=key)
    assert (r.status_code, r.json()) == (401, {"error": "UNAUTHORIZED"}) and stub.seen == []


@pytest.mark.parametrize("exc,status,code", [
    (UnknownSite("x"), 404, "UNKNOWN_SITE"),
    (InvalidImage("bad"), 400, "INVALID_IMAGE"),
    (RuntimeError("boom"), 503, "MODEL_ERROR"),
])
def test_error_mapping_hides_internals(exc, status, code):
    with client(StubVerifier(exc=exc)) as c:
        r = post(c)
    assert (r.status_code, r.json()) == (status, {"error": code})


def test_too_large_and_empty_body():
    stub = StubVerifier()
    with client(stub, max_bytes=1000) as c:
        assert post(c, body=b"x" * 1001).json() == {"error": "TOO_LARGE"}
        assert post(c, body=b"").json() == {"error": "INVALID_IMAGE"}
    assert stub.seen == []


def test_timeout_is_503():
    with client(StubVerifier(delay=0.5), timeout_s=0.1) as c:
        r = post(c)
    assert (r.status_code, r.json()) == (503, {"error": "TIMEOUT"})


def test_healthz_reports_ready_without_auth():
    with client(StubVerifier()) as c:
        assert c.get("/healthz").json() == {"ok": True, "ready": True}


def test_large_upload_never_touches_temp_files(monkeypatch):
    def forbidden(*a, **k):
        raise AssertionError("사진이 디스크에 쓰이면 안 된다")
    tmp_dir = tempfile.gettempdir()
    before = set(os.listdir(tmp_dir))
    for name in ("TemporaryFile", "SpooledTemporaryFile", "NamedTemporaryFile", "mkstemp"):
        monkeypatch.setattr(tempfile, name, forbidden)
    monkeypatch.setattr("starlette.formparsers.SpooledTemporaryFile", forbidden, raising=False)
    stub = StubVerifier()
    with client(stub) as c:
        r = post(c, body=b"x" * (5 * 1024 * 1024))
    assert r.status_code == 200 and stub.seen == [("gate", 5 * 1024 * 1024)]
    assert set(os.listdir(tmp_dir)) - before == set()


def test_verify_route_declares_no_body_params():
    app = create_app(lambda: StubVerifier(), KEY)
    routes = [r for r in app.routes if isinstance(r, APIRoute) and r.path == "/verify"]
    assert len(routes) == 1
    route = routes[0]
    assert route.dependant.body_params == []
    assert [p.name for p in route.dependant.query_params] == ["site_id"]


def test_model_error_is_logged_without_body(caplog):
    marker = b"PHOTO-BODY-MARKER"
    with caplog.at_level(logging.ERROR, logger="pv.service"):
        with client(StubVerifier(exc=RuntimeError("boom"))) as c:
            r = post(c, body=marker)
    assert r.json() == {"error": "MODEL_ERROR"}
    records = [rec for rec in caplog.records if rec.name == "pv.service" and rec.levelno == logging.ERROR]
    assert len(records) == 1
    assert marker.decode() not in records[0].getMessage()
    assert marker.decode() not in caplog.text


def test_missing_api_key_config_refuses_to_start():
    with pytest.raises(ValueError):
        create_app(lambda: StubVerifier(), "")


def test_openapi_docs_disabled():
    with client(StubVerifier()) as c:
        assert c.get("/docs").status_code == 404
