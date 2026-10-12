"""평가셋 비교 실험과 보고서. 결과는 private/photo-verify/eval/results/에 쓴다."""
from __future__ import annotations

import argparse
import datetime as dt
import json
import platform
import sys
from dataclasses import asdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pv.evaldata import assign_folds, cross_site_negatives, load_manifest  # noqa: E402
from pv.evaluate import (Row, early_accept_safe, evaluate, fit_all, per_site,  # noqa: E402
                         per_tag, summarize)
from pv.gallery import build_gallery, load_ref_dir  # noqa: E402
from pv.global_embed import make_embedder  # noqa: E402
from pv.local_match import make_matcher  # noqa: E402
from pv.pipeline import Features, compute_features  # noqa: E402
from pv.preprocess import QualityConfig  # noqa: E402
from pv.scorer import ThresholdConfig, save_thresholds  # noqa: E402

TAGS = ("angle", "distance", "time", "weather", "occlusion")


def features_to_json(f: Features) -> dict:
    return asdict(f)


def features_from_json(d: dict) -> Features:
    d = dict(d)
    d["inliers"] = {int(k): int(v) for k, v in d["inliers"].items()}
    d["t_pair_ms"] = {int(k): float(v) for k, v in d["t_pair_ms"].items()}
    return Features(**d)


def md_table(rows: list[dict]) -> str:
    if not rows:
        return "(없음)\n"
    keys = list(rows[0])
    fmt = lambda v: f"{v:.3f}" if isinstance(v, float) else str(v)  # noqa: E731
    lines = ["| " + " | ".join(keys) + " |", "|" + "---|" * len(keys)]
    lines += ["| " + " | ".join(fmt(r[k]) for k in keys) + " |" for r in rows]
    return "\n".join(lines) + "\n"


def run_config(samples, folds, refs_root, out_dir, backbone, matcher_name, n_refs, augment, top_k, max_kp, cache):
    key = f"{backbone}__{matcher_name}__refs{n_refs}__aug{int(augment)}__kp{max_kp}"
    cache_path = out_dir / "cache" / f"{key}.jsonl"
    stored = {}
    if cache_path.exists():
        for line in cache_path.read_text(encoding="utf-8").splitlines():
            item = json.loads(line)
            stored[(item["path"], item["site_id"])] = features_from_json(item["f"])
    if ("e", backbone) not in cache:
        cache[("e", backbone)] = make_embedder(backbone)
    if ("m", matcher_name, max_kp) not in cache:
        cache[("m", matcher_name, max_kp)] = make_matcher(matcher_name, max_kp)
    embedder, matcher = cache[("e", backbone)], cache[("m", matcher_name, max_kp)]
    sites = sorted({s.site_id for s in samples})
    galleries = {s: build_gallery(s, load_ref_dir(refs_root / s, n_refs), embedder, matcher, augment) for s in sites}
    rows = []
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    with cache_path.open("a", encoding="utf-8") as fh:
        for s in samples:
            k = (str(s.path), s.site_id)
            if k not in stored:
                stored[k] = compute_features(embedder, matcher, galleries[s.site_id], s.path.read_bytes(),
                                             QualityConfig(), top_k, all_refs=True)
                fh.write(json.dumps({"path": k[0], "site_id": k[1], "f": features_to_json(stored[k])}) + "\n")
            rows.append(Row(s, folds[s.session], stored[k]))
    return key, rows


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", type=Path, required=True)
    ap.add_argument("--refs", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--backbones", nargs="+", default=["dinov2_vitb14"])
    ap.add_argument("--matchers", nargs="+", default=["aliked"])
    ap.add_argument("--ref-counts", type=int, nargs="+", default=[5])
    ap.add_argument("--augment", nargs="+", choices=["on", "off"], default=["on"])
    ap.add_argument("--top-k", type=int, default=3)
    ap.add_argument("--max-kp", type=int, default=1024)
    ap.add_argument("--far", type=float, default=0.01)
    ap.add_argument("--no-cross-site", action="store_true")
    ap.add_argument("--write-thresholds", type=Path)
    args = ap.parse_args()

    samples = load_manifest(args.manifest)
    folds = assign_folds(samples)
    if not args.no_cross_site:
        samples += cross_site_negatives(samples, sorted({s.site_id for s in samples}))
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    report = [f"# 사진 판정 평가 {stamp}\n",
              f"- 환경: {platform.processor()} / Python {platform.python_version()}",
              f"- 표본 {len(samples)}개, 회차 fold {folds}, top_k {args.top_k}, FAR 목표 {args.far}\n"]
    cache: dict = {}
    first = None
    for backbone in args.backbones:
        for matcher_name in args.matchers:
            for n_refs in args.ref_counts:
                for aug in args.augment:
                    key, rows = run_config(samples, folds, args.refs, args.out, backbone, matcher_name,
                                           n_refs, aug == "on", args.top_k, args.max_kp, cache)
                    out = evaluate(rows, args.top_k, args.far)
                    report += [f"\n## {key}\n", md_table(summarize(out)), "\n### 거점별 (C_reject)\n",
                               md_table(per_site(out["C_reject"]))]
                    for tag in TAGS:
                        report += [f"\n### 조건별 TAR: {tag} (C_reject)\n", md_table(per_tag(out["C_reject"], tag))]
                    if first is None:
                        first = (backbone, matcher_name, rows, early_accept_safe(out["C_both"]))
    args.out.mkdir(parents=True, exist_ok=True)
    path = args.out / f"report-{stamp}.md"
    path.write_text("\n".join(report), encoding="utf-8")
    print(f"보고서: {path}")
    if args.write_thresholds and first:
        backbone, matcher_name, rows, safe = first
        cfg = ThresholdConfig(backbone, matcher_name, args.top_k, QualityConfig(),
                              fit_all(rows, args.top_k, args.far, safe), args.max_kp)
        save_thresholds(cfg, args.write_thresholds)
        print(f"임계값: {args.write_thresholds} (첫 번째 설정 {backbone}+{matcher_name}, 전체 표본으로 보정)")


if __name__ == "__main__":
    main()
