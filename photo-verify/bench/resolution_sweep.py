"""2단계(ALIKED+LightGlue) 입력 해상도별 지연과 inlier 분리도를 잰다.

사용: uv run python bench/resolution_sweep.py --sides 1024 896 768 640 512 --threads 2
합성 장면 기준이라 실제 현장 사진의 정확도를 대신하지 않는다. 지연과 상대적인 분리도 경향만 본다.
"""
from __future__ import annotations

import argparse
import os
import platform
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import cv2  # noqa: E402
import numpy as np  # noqa: E402
import torch  # noqa: E402

from pv.local_match import inliers_between, make_matcher  # noqa: E402
from pv.preprocess import to_local_input  # noqa: E402
from pv.synth import make_scene, warp_view  # noqa: E402
from pv.timing import summarize_ms  # noqa: E402


def timed(fn, runs: int, warmup: int = 2) -> list[float]:
    for _ in range(warmup):
        fn()
    out = []
    for _ in range(runs):
        t = time.perf_counter()
        fn()
        out.append((time.perf_counter() - t) * 1000)
    return out


def far_shot(ref: np.ndarray, background: np.ndarray, frac: float, seed: int) -> np.ndarray:
    """기준 장면을 frac 비율로 줄여 다른 배경 가운데에 붙인다. 멀리서 찍은 사진을 흉내 낸다."""
    h, w = background.shape[:2]
    small = cv2.resize(ref, (int(w * frac), int(h * frac)), interpolation=cv2.INTER_AREA)
    out = background.copy()
    y0, x0 = (h - small.shape[0]) // 2, (w - small.shape[1]) // 2
    out[y0:y0 + small.shape[0], x0:x0 + small.shape[1]] = small
    return warp_view(out, seed=seed, strength=0.05)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sides", type=int, nargs="+", default=[1024, 896, 768, 640, 512])
    ap.add_argument("--threads", type=int, default=2)
    ap.add_argument("--runs", type=int, default=10)
    ap.add_argument("--scenes", type=int, default=8)
    ap.add_argument("--far", type=float, nargs="+", default=[],
                    help="멀리서 찍은 정답 쿼리: 대상이 차지하는 화면 비율(예: 0.5 0.3)")
    args = ap.parse_args()
    torch.set_num_threads(args.threads)
    cv2.setNumThreads(args.threads)

    print(f"- CPU: {platform.processor()} / 논리 코어 {os.cpu_count()} / torch 스레드 {args.threads}")
    print(f"- torch {torch.__version__}, 반복 {args.runs}회, 합성 장면 {args.scenes}개(원본 1600x1200)")

    refs = [make_scene(s, 1600, 1200) for s in range(args.scenes)]
    # 정답 쿼리: 같은 장면의 보통 시점 변화와 강한 시점 변화+어두움
    pos = [(i, warp_view(r, seed=100 + i, strength=st, brightness=br))
           for i, r in enumerate(refs) for st, br in ((0.08, 1.0), (0.15, 0.7))]
    if args.far:
        bgs = [make_scene(1000 + s, 1600, 1200) for s in range(args.scenes)]
        pos = [(i, far_shot(r, bgs[i], fr, 200 + i)) for i, r in enumerate(refs) for fr in args.far]
    # 오답 쿼리: 다른 장면(쿼리 i를 기준 i+1과 비교)
    neg = [((i + 1) % args.scenes, q) for i, q in pos]

    matcher = make_matcher("aliked")
    print("\n| 긴 변 px | 추출 p50 | 추출 p95 | 매칭 1쌍 p50 | 매칭 1쌍 p95 | 정답 inlier 최소/중앙 | 오답 inlier 최대 |")
    print("|---|---|---|---|---|---|---|")
    with torch.inference_mode():
        for side in args.sides:
            ref_f = [matcher.extract(to_local_input(r, side)) for r in refs]
            q_imgs = [to_local_input(q, side) for _, q in pos]
            q_f = [matcher.extract(q) for q in q_imgs]
            pos_n = [inliers_between(matcher, q_f[k], ref_f[i]) for k, (i, _) in enumerate(pos)]
            neg_n = [inliers_between(matcher, q_f[k], ref_f[j]) for k, (j, _) in enumerate(neg)]
            ext = summarize_ms(timed(lambda: matcher.extract(q_imgs[0]), args.runs))
            mat = summarize_ms(timed(lambda: inliers_between(matcher, q_f[0], ref_f[0]), args.runs))
            print(f"| {side} | {ext['p50']:.0f} | {ext['p95']:.0f} | {mat['p50']:.0f} | {mat['p95']:.0f} "
                  f"| {min(pos_n)}/{int(np.median(pos_n))} | {max(neg_n)} |", flush=True)


if __name__ == "__main__":
    main()
