"""이미지 빌드 시 가중치를 TORCH_HOME에 미리 받아 둔다."""
from __future__ import annotations

import argparse

from pv.global_embed import make_embedder
from pv.local_match import make_matcher


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--backbone", default="dinov2_vitb14")
    ap.add_argument("--matcher", default="aliked")
    args = ap.parse_args()
    make_embedder(args.backbone)
    make_matcher(args.matcher)
    print(f"가중치 준비 완료: {args.backbone}, {args.matcher}")


if __name__ == "__main__":
    main()
