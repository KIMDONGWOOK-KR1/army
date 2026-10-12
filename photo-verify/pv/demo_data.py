"""컨테이너 동작 확인용 합성 demo 거점. 실제 정답이 아니며 운영에 쓰지 않는다."""
from __future__ import annotations

import argparse
from pathlib import Path

from pv.gallery import build_gallery, save_gallery
from pv.global_embed import make_embedder
from pv.local_match import make_matcher
from pv.preprocess import LOCAL_LONG_SIDE, QualityConfig
from pv.scorer import SiteThresholds, ThresholdConfig, save_thresholds
from pv.synth import make_scene

DEMO_SITE = SiteThresholds(tau_reject=-1.0, tau_n=25, mode="rule", tau_low=-1.0)


def write_demo(out_dir: Path, embedder, matcher, local_long_side: int = LOCAL_LONG_SIDE) -> None:
    g = build_gallery("demo", [make_scene(1)], embedder, matcher, local_long_side=local_long_side)
    save_gallery(g, Path(out_dir) / "gallery" / "demo.npz")
    save_thresholds(ThresholdConfig(embedder.name, matcher.name, 3, QualityConfig(), {"demo": DEMO_SITE},
                                    local_long_side=local_long_side),
                    Path(out_dir) / "thresholds.json")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--backbone", default="dinov2_vitb14")
    ap.add_argument("--matcher", default="aliked")
    ap.add_argument("--local-long-side", type=int, default=LOCAL_LONG_SIDE)
    args = ap.parse_args()
    write_demo(args.out, make_embedder(args.backbone), make_matcher(args.matcher), args.local_long_side)
    print(f"합성 demo 자료: {args.out}")


if __name__ == "__main__":
    main()
