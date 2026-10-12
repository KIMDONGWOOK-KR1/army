"""거점별 임계값 형식과 판정 규칙. 운영(Verifier)과 평가(evaluate)가 같은 decide를 쓴다."""
from __future__ import annotations

import json
import math
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Callable, Literal

from pv.preprocess import QualityConfig

Mode = Literal["logistic", "rule"]
EarlyExit = Literal["none", "reject", "both"]


@dataclass(frozen=True)
class SiteThresholds:
    tau_reject: float
    tau_n: int
    mode: Mode = "rule"
    tau_low: float = 0.0
    w_sg: float = 0.0
    w_n: float = 0.0
    bias: float = 0.0
    tau_score: float = 0.5
    early_accept: bool = False
    tau_accept: float | None = None


@dataclass(frozen=True)
class ThresholdConfig:
    backbone: str
    matcher: str
    top_k: int
    quality: QualityConfig
    sites: dict[str, SiteThresholds]
    max_keypoints: int = 1024


def load_thresholds(path: Path) -> ThresholdConfig:
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    if raw.get("version") != 1:
        raise ValueError("unsupported thresholds version")
    return ThresholdConfig(
        backbone=raw["backbone"], matcher=raw["matcher"], top_k=int(raw["top_k"]),
        quality=QualityConfig(**raw.get("quality", {})),
        sites={k: SiteThresholds(**v) for k, v in raw["sites"].items()},
        max_keypoints=int(raw.get("max_keypoints", 1024)),
    )


def save_thresholds(cfg: ThresholdConfig, path: Path) -> None:
    data = {
        "version": 1, "backbone": cfg.backbone, "matcher": cfg.matcher, "top_k": cfg.top_k,
        "max_keypoints": cfg.max_keypoints, "quality": asdict(cfg.quality),
        "sites": {k: asdict(v) for k, v in cfg.sites.items()},
    }
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


@dataclass(frozen=True)
class Decision:
    match: bool
    score: float
    reason_code: str
    n: int | None
    pairs_used: list[int]


def _sigmoid(z: float) -> float:
    if z >= 0:
        return 1.0 / (1.0 + math.exp(-z))
    e = math.exp(max(z, -745.0))
    return e / (1.0 + e)


def fused_score(t: SiteThresholds, s_g: float, n: int) -> float:
    if t.mode == "logistic":
        return _sigmoid(t.w_sg * s_g + t.w_n * math.log1p(n) + t.bias)
    return float(s_g)


def passes(t: SiteThresholds, s_g: float, n: int) -> bool:
    if t.mode == "logistic":
        return fused_score(t, s_g, n) >= t.tau_score
    return s_g >= t.tau_low and n >= t.tau_n


def decide(t: SiteThresholds, s_g: float, ranked_refs: list[int],
           inliers_of: Callable[[int], int], top_k: int,
           early_exit: EarlyExit = "both") -> Decision:
    """순차 중단은 이미 통과하는 시점에만 일어나므로 조기 종료가 판정 결과를 바꾸지 않는다."""
    if early_exit != "none" and s_g < t.tau_reject:
        return Decision(False, fused_score(t, s_g, 0), "NO_MATCH", None, [])
    if (early_exit == "both" and t.early_accept and t.tau_accept is not None
            and s_g >= t.tau_accept):
        return Decision(True, 1.0, "MATCH", None, [])
    used: list[int] = []
    n = 0
    for ref in ranked_refs[:top_k]:
        used.append(ref)
        n = max(n, int(inliers_of(ref)))
        if early_exit != "none" and passes(t, s_g, n):
            break
    ok = passes(t, s_g, n)
    return Decision(ok, fused_score(t, s_g, n), "MATCH" if ok else "NO_MATCH", n, used)
