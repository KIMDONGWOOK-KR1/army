"""평가셋 비교 실험과 보고서. 결과는 private/photo-verify/eval/results/에 쓴다."""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import platform
import sys
from dataclasses import asdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pv.evaldata import ALL_TAG_COLUMNS, assign_folds, cross_site_negatives, load_manifest  # noqa: E402
from pv.evaluate import (Row, early_accept_safe, evaluate, fit_all, per_site,  # noqa: E402
                         per_tag, summarize)
from pv.gallery import (IMAGE_SUFFIXES, build_gallery, fingerprint_files, ref_files,  # noqa: E402
                        save_gallery)
from pv.global_embed import make_embedder  # noqa: E402
from pv.local_match import make_matcher  # noqa: E402
from pv.pipeline import Features, compute_features  # noqa: E402
from pv.preprocess import LOCAL_LONG_SIDE, QualityConfig, decode_image  # noqa: E402
from pv.scorer import ThresholdConfig, save_thresholds  # noqa: E402

TAGS = ALL_TAG_COLUMNS


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


def file_fp(path: Path) -> str:
    st = Path(path).stat()
    return f"{st.st_size}-{st.st_mtime_ns}"


def refs_fingerprint(refs_root: Path, sites: list[str], n_refs: int) -> str:
    """실제로 쓰이는 기준 사진(이름·크기·mtime)의 짧은 지문. 기준 사진이 바뀌면 캐시 키가 달라진다."""
    h = hashlib.sha1()
    for site in sorted(sites):
        files = sorted(p for p in (Path(refs_root) / site).iterdir() if p.suffix.lower() in IMAGE_SUFFIXES)[:n_refs]
        for p in files:
            st = p.stat()
            h.update(f"{site}/{p.name}:{st.st_size}:{st.st_mtime_ns};".encode("utf-8"))
    return h.hexdigest()[:10]


def read_cache(path: Path) -> dict:
    """캐시를 읽는다. 깨진 줄(중단된 쓰기)은 건너뛰고 개수를 경고한다."""
    stored, bad = {}, 0
    if Path(path).exists():
        for line in Path(path).read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                item = json.loads(line)
                stored[(item["path"], item["site_id"])] = (item.get("fp"), features_from_json(item["f"]))
            except (ValueError, KeyError, TypeError):
                bad += 1
    if bad:
        print(f"경고: 캐시 {path}에서 깨진 줄 {bad}개를 건너뜀")
    return stored


def run_config(samples, folds, refs_root, out_dir, backbone, matcher_name, n_refs, augment, top_k, max_kp, cache,
               local_long_side=LOCAL_LONG_SIDE):
    sites = sorted({s.site_id for s in samples})
    key = (f"{backbone}__{matcher_name}__refs{n_refs}__aug{int(augment)}__kp{max_kp}__side{local_long_side}"
           f"__{refs_fingerprint(refs_root, sites, n_refs)}")
    cache_path = out_dir / "cache" / f"{key}.jsonl"
    stored = read_cache(cache_path)
    if ("e", backbone) not in cache:
        cache[("e", backbone)] = make_embedder(backbone)
    if ("m", matcher_name, max_kp) not in cache:
        cache[("m", matcher_name, max_kp)] = make_matcher(matcher_name, max_kp)
    embedder, matcher = cache[("e", backbone)], cache[("m", matcher_name, max_kp)]
    galleries = {}
    for site in sites:
        files = ref_files(refs_root / site, n_refs)
        galleries[site] = build_gallery(site, [decode_image(p.read_bytes()) for p in files], embedder, matcher,
                                        augment, refs_fingerprint=fingerprint_files(files),
                                        local_long_side=local_long_side)
    rows = []
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    with cache_path.open("a", encoding="utf-8") as fh:
        for s in samples:
            k = (str(s.path), s.site_id)
            fp = file_fp(s.path)
            if k not in stored or stored[k][0] != fp:
                f = compute_features(embedder, matcher, galleries[s.site_id], s.path.read_bytes(),
                                     QualityConfig(), top_k, all_refs=True, local_long_side=local_long_side)
                stored[k] = (fp, f)
                fh.write(json.dumps({"path": k[0], "site_id": k[1], "fp": fp, "f": features_to_json(f)}) + "\n")
                fh.flush()
            rows.append(Row(s, folds[s.session], stored[k][1]))
    return key, rows, galleries


def write_deploy(out_dir: Path, backbone: str, matcher_name: str, n_refs: int, augment: bool, top_k: int,
                 max_kp: int, far: float, rows, safe: dict[str, bool], galleries,
                 local_long_side: int = LOCAL_LONG_SIDE) -> list[Path]:
    """같은 기준 사진·설정으로 만든 갤러리와 임계값을 한 배포 단위로 쓴다."""
    sites = fit_all(rows, top_k, far, safe)
    cfg = ThresholdConfig(backbone, matcher_name, top_k, QualityConfig(), sites, max_kp, local_long_side, n_refs=n_refs,
                          augment=augment, refs_fingerprint={s: galleries[s].refs_fingerprint for s in sites})
    written = [Path(out_dir) / "thresholds.json"]
    save_thresholds(cfg, written[0])
    for s in sites:
        written.append(Path(out_dir) / "gallery" / f"{s}.npz")
        save_gallery(galleries[s], written[-1])
    return written


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
    ap.add_argument("--local-long-side", type=int, default=LOCAL_LONG_SIDE, help="2단계 입력 긴 변(px)")
    ap.add_argument("--far", type=float, default=0.01)
    ap.add_argument("--no-cross-site", action="store_true")
    ap.add_argument("--write-deploy", type=Path, help="thresholds.json과 gallery/를 쓸 배포 디렉터리")
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
                    key, rows, galleries = run_config(samples, folds, args.refs, args.out, backbone, matcher_name,
                                           n_refs, aug == "on", args.top_k, args.max_kp, cache,
                                           args.local_long_side)
                    out = evaluate(rows, args.top_k, args.far)
                    report += [f"\n## {key}\n", md_table(summarize(out)), "\n### 거점별 (C_reject)\n",
                               md_table(per_site(out["C_reject"]))]
                    for tag in TAGS:
                        report += [f"\n### 조건별 TAR: {tag} (C_reject)\n", md_table(per_tag(out["C_reject"], tag))]
                    if first is None:
                        first = (backbone, matcher_name, n_refs, aug == "on", rows,
                                 early_accept_safe(out["C_both"]), galleries)
    args.out.mkdir(parents=True, exist_ok=True)
    path = args.out / f"report-{stamp}.md"
    path.write_text("\n".join(report), encoding="utf-8")
    print(f"보고서: {path}")
    if args.write_deploy and first:
        backbone, matcher_name, n_refs, aug, rows, safe, galleries = first
        written = write_deploy(args.write_deploy, backbone, matcher_name, n_refs, aug, args.top_k, args.max_kp,
                               args.far, rows, safe, galleries, args.local_long_side)
        print(f"배포 자료 (첫 번째 설정 {backbone}+{matcher_name}, 기준 {n_refs}장, 증강 {'on' if aug else 'off'}, "
              f"kp {args.max_kp}, 2단계 {args.local_long_side}px, 전체 표본으로 보정):")
        for p in written:
            print(f"  {p}")


if __name__ == "__main__":
    main()
