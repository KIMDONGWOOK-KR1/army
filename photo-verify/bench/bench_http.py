"""실행 중인 추론 서버의 판정 지연을 HTTP로 잰다.

사용: uv run python bench/bench_http.py --url http://localhost:8080 --key dev-key --site demo --image x.jpg --runs 30
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pv.timing import summarize_ms  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True)
    ap.add_argument("--key", required=True)
    ap.add_argument("--site", required=True)
    ap.add_argument("--image", type=Path, required=True)
    ap.add_argument("--runs", type=int, default=30)
    args = ap.parse_args()
    body = args.image.read_bytes()
    wall, server = [], []
    with httpx.Client(timeout=30) as c:
        c.post(f"{args.url}/verify", params={"site_id": args.site}, content=body,
               headers={"X-PV-Key": args.key, "Content-Type": "image/jpeg"})  # 예열
        for _ in range(args.runs):
            t = time.perf_counter()
            r = c.post(f"{args.url}/verify", params={"site_id": args.site}, content=body,
                       headers={"X-PV-Key": args.key, "Content-Type": "image/jpeg"})
            wall.append((time.perf_counter() - t) * 1000)
            r.raise_for_status()
            server.append(float(r.json()["latency_ms"]))
    print("응답 예:", r.json())
    print("왕복(ms):", summarize_ms(wall))
    print("서버 처리(ms):", summarize_ms(server))


if __name__ == "__main__":
    main()
