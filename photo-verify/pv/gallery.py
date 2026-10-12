"""거점별 기준 갤러리. 갤러리 파일은 정답이므로 private/photo-verify/gallery/에만 둔다."""
from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from pv.global_embed import GlobalEmbedder, make_embedder
from pv.local_match import LocalFeatures, LocalMatcher, make_matcher
from pv.preprocess import decode_image, to_global_input, to_local_input

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png"}


@dataclass
class Gallery:
    site_id: str
    backbone: str
    matcher: str
    global_vecs: np.ndarray
    global_ref_idx: np.ndarray
    local: list[LocalFeatures]

    @property
    def n_refs(self) -> int:
        return len(self.local)


def augment_views(img: np.ndarray, seed: int = 0, n_color: int = 2, n_crop: int = 2) -> list[np.ndarray]:
    """색상 변화와 무작위 crop. 좌우 반전은 글자·비대칭 구조를 바꾸므로 쓰지 않는다."""
    rng = np.random.default_rng(seed)
    out = []
    for _ in range(n_color):
        alpha, beta = rng.uniform(0.7, 1.3), rng.uniform(-25, 25)
        out.append(np.clip(img.astype(np.float32) * alpha + beta, 0, 255).astype(np.uint8))
    h, w = img.shape[:2]
    for _ in range(n_crop):
        s = rng.uniform(0.8, 0.95)
        ch, cw = int(h * s), int(w * s)
        y0, x0 = int(rng.integers(0, h - ch + 1)), int(rng.integers(0, w - cw + 1))
        out.append(np.ascontiguousarray(img[y0:y0 + ch, x0:x0 + cw]))
    return out


def build_gallery(site_id: str, refs: list[np.ndarray], embedder: GlobalEmbedder,
                  matcher: LocalMatcher, augment: bool = True, seed: int = 0) -> Gallery:
    if not refs:
        raise ValueError("no reference images")
    views, owners = [], []
    for i, img in enumerate(refs):
        vs = [img] + (augment_views(img, seed + i) if augment else [])
        views += [to_global_input(v) for v in vs]
        owners += [i] * len(vs)
    vecs = embedder.embed(views).astype(np.float32)
    local = [matcher.extract(to_local_input(img)) for img in refs]
    return Gallery(site_id, embedder.name, matcher.name, vecs, np.array(owners, np.int64), local)


def ref_scores(g: Gallery, q: np.ndarray) -> np.ndarray:
    sims = g.global_vecs @ np.asarray(q, np.float32)
    out = np.full(g.n_refs, -1.0, np.float32)
    np.maximum.at(out, g.global_ref_idx, sims.astype(np.float32))
    return out


def save_gallery(g: Gallery, path: Path) -> None:
    arrays = {"global_vecs": g.global_vecs, "global_ref_idx": g.global_ref_idx}
    for i, f in enumerate(g.local):
        arrays[f"kp_{i}"], arrays[f"desc_{i}"], arrays[f"size_{i}"] = f.keypoints, f.descriptors, f.image_size
    meta = json.dumps({"site_id": g.site_id, "backbone": g.backbone, "matcher": g.matcher, "n_refs": g.n_refs})
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(path, meta=np.array(meta), **arrays)


def load_gallery(path: Path) -> Gallery:
    with np.load(path, allow_pickle=False) as z:
        meta = json.loads(str(z["meta"]))
        local = [LocalFeatures(z[f"kp_{i}"], z[f"desc_{i}"], z[f"size_{i}"]) for i in range(meta["n_refs"])]
        return Gallery(meta["site_id"], meta["backbone"], meta["matcher"],
                       z["global_vecs"], z["global_ref_idx"], local)


def load_ref_dir(d: Path, limit: int | None = None) -> list[np.ndarray]:
    files = sorted(p for p in Path(d).iterdir() if p.suffix.lower() in IMAGE_SUFFIXES)
    if limit is not None:
        files = files[:limit]
    return [decode_image(p.read_bytes()) for p in files]


def main() -> None:
    ap = argparse.ArgumentParser(description="거점별 기준 갤러리 생성")
    ap.add_argument("--refs", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--backbone", default="dinov2_vitb14")
    ap.add_argument("--matcher", default="aliked")
    ap.add_argument("--max-kp", type=int, default=1024)
    ap.add_argument("--no-augment", action="store_true")
    args = ap.parse_args()
    embedder, matcher = make_embedder(args.backbone), make_matcher(args.matcher, args.max_kp)
    for site_dir in sorted(p for p in args.refs.iterdir() if p.is_dir()):
        g = build_gallery(site_dir.name, load_ref_dir(site_dir), embedder, matcher, augment=not args.no_augment)
        save_gallery(g, args.out / f"{site_dir.name}.npz")
        print(f"{site_dir.name}: 기준 {g.n_refs}장, 벡터 {len(g.global_vecs)}개")


if __name__ == "__main__":
    main()
