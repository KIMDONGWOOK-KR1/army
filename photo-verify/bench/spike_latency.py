"""Task 1 지연 실측 스파이크. 파이프라인 구현 전에 모델 단계별 CPU 시간을 잰다.

사용: uv run python bench/spike_latency.py --runs 20 --threads 2
"""
from __future__ import annotations

import argparse
import os
import platform
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import torch  # noqa: E402
from lightglue import ALIKED, LightGlue  # noqa: E402

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


def row(name: str, samples: list[float]) -> str:
    s = summarize_ms(samples)
    return f"| {name} | {s['p50']:.0f} | {s['p95']:.0f} | {s['mean']:.0f} |"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", type=int, default=20)
    ap.add_argument("--threads", type=int, default=2)
    ap.add_argument("--kp", type=int, nargs="+", default=[512, 1024])
    args = ap.parse_args()
    torch.set_num_threads(args.threads)

    print(f"- CPU: {platform.processor()} / 논리 코어 {os.cpu_count()} / torch 스레드 {args.threads}")
    print(f"- torch {torch.__version__}, Python {platform.python_version()}, 반복 {args.runs}회")
    print("\n| 단계 | p50 ms | p95 ms | 평균 ms |\n|---|---|---|---|")

    with torch.inference_mode():
        x = torch.rand(1, 3, 224, 224)
        for variant in ("dinov2_vits14", "dinov2_vitb14"):
            model = torch.hub.load("facebookresearch/dinov2", variant, trust_repo=True).eval()
            print(row(f"{variant} 224px", timed(lambda: model.forward_features(x), args.runs)))

        scene = make_scene(0, 1024, 768)
        other = warp_view(scene, seed=1)
        t0 = torch.from_numpy(scene).permute(2, 0, 1).float() / 255.0
        t1 = torch.from_numpy(other).permute(2, 0, 1).float() / 255.0
        matcher = LightGlue(features="aliked").eval()
        for kp in args.kp:
            extractor = ALIKED(max_num_keypoints=kp).eval()
            f0 = extractor.extract(t0, resize=None)
            f1 = extractor.extract(t1, resize=None)
            print(row(f"ALIKED 추출 kp={kp}", timed(lambda: extractor.extract(t0, resize=None), args.runs)))
            print(row(f"LightGlue 1쌍 kp={kp}",
                      timed(lambda: matcher({"image0": f0, "image1": f1}), args.runs)))


if __name__ == "__main__":
    main()
