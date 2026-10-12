"""판정 파이프라인. verify는 운영용(지연 계산·조기 종료), compute_features는 평가용(전부 계산)."""
from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from pv.gallery import Gallery, load_gallery, ref_scores
from pv.global_embed import GlobalEmbedder, make_embedder
from pv.local_match import LocalMatcher, inliers_between, make_matcher
from pv.preprocess import QualityConfig, check_quality, decode_image, to_global_input, to_local_input
from pv.scorer import EarlyExit, ThresholdConfig, decide, load_thresholds


class UnknownSite(KeyError):
    """임계값이 없는 거점."""


@dataclass(frozen=True)
class VerifyResult:
    match: bool
    score: float
    reason_code: str
    latency_ms: int


@dataclass
class Features:
    quality: str | None
    s_g: float = 0.0
    ranked_refs: list[int] = field(default_factory=list)
    inliers: dict[int, int] = field(default_factory=dict)
    t_pre_ms: float = 0.0
    t_global_ms: float = 0.0
    t_extract_ms: float = 0.0
    t_pair_ms: dict[int, float] = field(default_factory=dict)


def _since_ms(t: float) -> float:
    return (time.perf_counter() - t) * 1000.0


def _prepare(data: bytes, quality_cfg: QualityConfig):
    img = decode_image(data)
    local_img = to_local_input(img)
    return img, local_img, check_quality(local_img, quality_cfg)


def _rank(embedder: GlobalEmbedder, gallery: Gallery, img: np.ndarray) -> tuple[float, list[int]]:
    scores = ref_scores(gallery, embedder.embed([to_global_input(img)])[0])
    ranked = [int(i) for i in np.argsort(-scores, kind="stable")]
    return float(scores[ranked[0]]), ranked


def compute_features(embedder: GlobalEmbedder, matcher: LocalMatcher, gallery: Gallery, data: bytes,
                     quality_cfg: QualityConfig, top_k: int, all_refs: bool = False) -> Features:
    t = time.perf_counter()
    img, local_img, quality = _prepare(data, quality_cfg)
    f = Features(quality=quality, t_pre_ms=_since_ms(t))
    if quality is not None:
        return f
    t = time.perf_counter()
    f.s_g, f.ranked_refs = _rank(embedder, gallery, img)
    f.t_global_ms = _since_ms(t)
    t = time.perf_counter()
    q = matcher.extract(local_img)
    f.t_extract_ms = _since_ms(t)
    for ref in (range(gallery.n_refs) if all_refs else f.ranked_refs[:top_k]):
        t = time.perf_counter()
        f.inliers[ref] = inliers_between(matcher, q, gallery.local[ref])
        f.t_pair_ms[ref] = _since_ms(t)
    return f


class Verifier:
    def __init__(self, embedder: GlobalEmbedder, matcher: LocalMatcher,
                 galleries: dict[str, Gallery], thresholds: ThresholdConfig):
        if (embedder.name, matcher.name) != (thresholds.backbone, thresholds.matcher):
            raise ValueError("loaded models do not match thresholds.json")
        for site_id in thresholds.sites:
            g = galleries.get(site_id)
            if g is None:
                raise ValueError(f"gallery missing for site {site_id}")
            if (g.backbone, g.matcher) != (thresholds.backbone, thresholds.matcher):
                raise ValueError(f"gallery for site {site_id} was built with other models")
            # n_refs는 거점당 기준 사진 상한이다. 기준 사진이 상한보다 적은 거점은 갤러리 n_refs가 더 작으므로
            # 상한을 넘을 때만 불일치로 본다. 정확한 기준 사진 집합은 refs_fingerprint가 확인한다.
            if thresholds.n_refs is not None and g.n_refs > thresholds.n_refs:
                raise ValueError(f"gallery for site {site_id} differs from thresholds.json: "
                                 f"n_refs {g.n_refs} > {thresholds.n_refs}")
            fp = (thresholds.refs_fingerprint or {}).get(site_id)
            for what, want, got in (("augment", thresholds.augment, g.augment),
                                    ("max_keypoints", thresholds.max_keypoints, g.max_kp),
                                    ("refs_fingerprint", fp, g.refs_fingerprint)):
                if want is not None and got is not None and want != got:
                    raise ValueError(f"gallery for site {site_id} differs from thresholds.json: "
                                     f"{what} {got!r} != {want!r}")
        self.embedder, self.matcher = embedder, matcher
        self.galleries, self.thresholds = galleries, thresholds
        self._lock = threading.Lock()

    @classmethod
    def from_dir(cls, data_dir: Path) -> "Verifier":
        cfg = load_thresholds(Path(data_dir) / "thresholds.json")
        galleries = {s: load_gallery(Path(data_dir) / "gallery" / f"{s}.npz") for s in cfg.sites}
        return cls(make_embedder(cfg.backbone), make_matcher(cfg.matcher, cfg.max_keypoints), galleries, cfg)

    def verify(self, site_id: str, data: bytes, early_exit: EarlyExit = "both") -> VerifyResult:
        t0 = time.perf_counter()
        if site_id not in self.thresholds.sites:
            raise UnknownSite(site_id)
        with self._lock:
            img, local_img, quality = _prepare(data, self.thresholds.quality)
            if quality is not None:
                return VerifyResult(False, 0.0, "RETAKE", round(_since_ms(t0)))
            g, t = self.galleries[site_id], self.thresholds.sites[site_id]
            s_g, ranked = _rank(self.embedder, g, img)
            query = []

            def inliers_of(ref: int) -> int:
                if not query:
                    query.append(self.matcher.extract(local_img))
                return inliers_between(self.matcher, query[0], g.local[ref])

            d = decide(t, s_g, ranked, inliers_of, self.thresholds.top_k, early_exit)
        return VerifyResult(d.match, round(d.score, 4), d.reason_code, round(_since_ms(t0)))
