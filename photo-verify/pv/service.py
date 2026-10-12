"""추론 서버. 사진은 요청 본문에서 메모리로만 읽고 저장하지 않는다.

실행: PV_API_KEY=... PV_DATA_DIR=... uvicorn pv.service:app_from_env --factory
"""
from __future__ import annotations

import asyncio
import hmac
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Callable

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from pv.pipeline import UnknownSite, Verifier
from pv.preprocess import InvalidImage

DEFAULT_MAX_BYTES = 10 * 1024 * 1024


def _error(status: int, code: str) -> JSONResponse:
    return JSONResponse({"error": code}, status_code=status)


def create_app(verifier_factory: Callable[[], Verifier], api_key: str,
               max_bytes: int = DEFAULT_MAX_BYTES, timeout_s: float = 8.0) -> FastAPI:
    if not api_key:
        raise ValueError("PV_API_KEY is required")
    expected = api_key.encode("utf-8")
    state: dict = {"verifier": None}

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        state["verifier"] = await run_in_threadpool(verifier_factory)
        yield

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

    @app.get("/healthz")
    async def healthz():
        return {"ok": True, "ready": state["verifier"] is not None}

    @app.post("/verify")
    async def verify(request: Request, site_id: str):
        given = request.headers.get("x-pv-key", "").encode("utf-8")
        if not hmac.compare_digest(given, expected):
            return _error(401, "UNAUTHORIZED")
        verifier = state["verifier"]
        if verifier is None:
            return _error(503, "NOT_READY")
        declared = request.headers.get("content-length", "")
        if declared.isdigit() and int(declared) > max_bytes:
            return _error(400, "TOO_LARGE")
        body = bytearray()
        async for chunk in request.stream():
            body.extend(chunk)
            if len(body) > max_bytes:
                return _error(400, "TOO_LARGE")
        if not body:
            return _error(400, "INVALID_IMAGE")
        try:
            result = await asyncio.wait_for(run_in_threadpool(verifier.verify, site_id, bytes(body)), timeout_s)
        except UnknownSite:
            return _error(404, "UNKNOWN_SITE")
        except InvalidImage:
            return _error(400, "INVALID_IMAGE")
        except asyncio.TimeoutError:
            return _error(503, "TIMEOUT")
        except Exception:
            return _error(503, "MODEL_ERROR")
        return {"match": result.match, "score": result.score,
                "reason_code": result.reason_code, "latency_ms": result.latency_ms}

    return app


def app_from_env() -> FastAPI:
    data_dir = Path(os.environ.get("PV_DATA_DIR", "/data"))
    return create_app(lambda: Verifier.from_dir(data_dir), os.environ.get("PV_API_KEY", ""),
                      int(os.environ.get("PV_MAX_BYTES", DEFAULT_MAX_BYTES)),
                      float(os.environ.get("PV_TIMEOUT_S", "8")))
