"""비교 실험 시뮬레이션. 특징을 한 번 계산해 두고 구조·조기 종료 방식을 바꿔 가며 판정한다."""
from __future__ import annotations

import math
import sys
from collections import defaultdict
from dataclasses import dataclass, field, replace

import numpy as np

from pv.calibrate import SiteSamples, auc, eer, fit_site, threshold_at_far
from pv.evaldata import Sample
from pv.pipeline import Features
from pv.scorer import SiteThresholds, decide, fused_score
from pv.timing import summarize_ms

METHODS = ("A_global", "B_local", "C_none", "C_reject", "C_both")
NAN = float("nan")


@dataclass(frozen=True)
class Row:
    sample: Sample
    fold: int
    f: Features

    @property
    def y(self) -> int:
        return 1 if self.sample.label == "pos" else 0

    @property
    def ok_quality(self) -> bool:
        return self.f.quality is None


def n_topk(f: Features, k: int) -> int:
    return max((f.inliers.get(r, 0) for r in f.ranked_refs[:k]), default=0)


def n_all(f: Features) -> int:
    return max(f.inliers.values(), default=0)


def est_latency_ms(f: Features, used: list[int]) -> float:
    t = f.t_pre_ms + (0.0 if f.quality else f.t_global_ms)
    if used:
        t += f.t_extract_ms + sum(f.t_pair_ms[r] for r in used)
    return t


@dataclass
class Outcome:
    rows: list[Row] = field(default_factory=list)
    accept: list[bool] = field(default_factory=list)
    score: list[float | None] = field(default_factory=list)
    latency: list[float] = field(default_factory=list)
    early_accept: list[bool] = field(default_factory=list)

    def add(self, row: Row, accept: bool, score: float | None, latency: float, early: bool = False) -> None:
        self.rows.append(row)
        self.accept.append(bool(accept))
        self.score.append(score)
        self.latency.append(latency)
        self.early_accept.append(early)


def _samples(rows: list[Row], top_k: int) -> SiteSamples:
    good = [r for r in rows if r.ok_quality]
    return SiteSamples(np.array([r.f.s_g for r in good], float),
                       np.array([n_topk(r.f, top_k) for r in good], float),
                       np.array([r.y for r in good], int))


def evaluate(rows: list[Row], top_k: int = 3, far: float = 0.01) -> dict[str, Outcome]:
    out = {m: Outcome() for m in METHODS}
    for test_fold in (0, 1):
        for site in sorted({r.sample.site_id for r in rows}):
            cal = [r for r in rows if r.fold != test_fold and r.sample.site_id == site]
            test = [r for r in rows if r.fold == test_fold and r.sample.site_id == site]
            if not cal or not test:
                print(f"경고: 거점 {site}는 fold {test_fold} 평가에서 "
                      f"{'보정' if not cal else '평가'} fold 표본이 없어 건너뜀", file=sys.stderr)
                continue
            total_neg = sum(1 for r in cal if r.y == 0)
            cal_neg = [r for r in cal if r.y == 0 and r.ok_quality]
            thr_a = threshold_at_far([r.f.s_g for r in cal_neg], far, total=total_neg)
            thr_b = threshold_at_far([math.log1p(n_all(r.f)) for r in cal_neg], far, total=total_neg)
            cal_samples = _samples(cal, top_k)
            t = fit_site(cal_samples, far)
            t_none = fit_site(cal_samples, far, early_reject=False)  # 조기 거절이 없으면 모든 오답이 2단계까지 간다
            for r in test:
                f = r.f
                if not r.ok_quality:
                    for m in METHODS:
                        out[m].add(r, False, None, est_latency_ms(f, []))
                    continue
                out["A_global"].add(r, f.s_g >= thr_a, f.s_g, f.t_pre_ms + f.t_global_ms)
                nb = math.log1p(n_all(f))
                out["B_local"].add(r, nb >= thr_b, nb, f.t_pre_ms + f.t_extract_ms + sum(f.t_pair_ms.values()))
                for name, mode in (("C_none", "none"), ("C_reject", "reject"), ("C_both", "both")):
                    base = t_none if mode == "none" else t
                    tm = replace(t, early_accept=t.tau_accept is not None) if mode == "both" else base
                    d = decide(tm, f.s_g, f.ranked_refs, lambda ref, f=f: f.inliers[ref], top_k, mode)
                    out[name].add(r, d.match, fused_score(base, f.s_g, n_topk(f, top_k)),
                                  est_latency_ms(f, d.pairs_used), early=d.match and not d.pairs_used)
    return out


def _rates(rows: list[Row], accept: list[bool]) -> tuple[float, float]:
    y, a = np.array([r.y for r in rows]), np.array(accept, bool)
    tar = float(a[y == 1].mean()) if (y == 1).any() else NAN
    far_ = float(a[y == 0].mean()) if (y == 0).any() else NAN
    return tar, far_


NEG_LABELS = (("FAR_hard", "hard_neg"), ("FAR_easy", "easy_neg"), ("FAR_cross", "cross_neg"))


def _far_by_label(rows: list[Row], accept: list[bool]) -> dict[str, float]:
    out = {}
    for col, label in NEG_LABELS:
        a = [ok for r, ok in zip(rows, accept) if r.sample.label == label]
        out[col] = float(np.mean(a)) if a else NAN
    return out


def _macro_auc_eer(o: Outcome) -> tuple[float, float, int]:
    """(거점, fold)마다 AUC·EER을 따로 구해 평균한다. 거점별 임계값이 다르므로 점수를 한데 섞지 않는다.
    RETAKE(점수 None) 행은 빠진다."""
    groups: dict[tuple[str, int], tuple[list[float], list[float]]] = defaultdict(lambda: ([], []))
    for r, s in zip(o.rows, o.score):
        if s is not None:
            groups[(r.sample.site_id, r.fold)][0 if r.y == 1 else 1].append(s)
    aucs, eers = [], []
    for ps, ns in groups.values():
        if ps and ns:
            aucs.append(auc(ps, ns))
            eers.append(eer(ps, ns))
    if not aucs:
        return NAN, NAN, 0
    return float(np.mean(aucs)), float(np.mean(eers)), len(aucs)


def summarize(out: dict[str, Outcome]) -> list[dict]:
    table = []
    for method, o in out.items():
        tar, far_ = _rates(o.rows, o.accept)
        auc_, eer_, n_groups = _macro_auc_eer(o)
        lat_samples = [lat for r, lat in zip(o.rows, o.latency) if r.ok_quality]
        lat = summarize_ms(lat_samples) if lat_samples else {"p50": NAN, "p95": NAN, "mean": NAN}
        pos_rows = [r for r in o.rows if r.y == 1]
        table.append({
            "method": method, "n_pos": len(pos_rows), "n_neg": len(o.rows) - len(pos_rows),
            "TAR": tar, "FAR": far_, **_far_by_label(o.rows, o.accept),
            "AUC": auc_, "EER": eer_, "auc_groups": n_groups,
            "lat_mean": lat["mean"], "lat_p50": lat["p50"], "lat_p95": lat["p95"],
            "early_false_accepts": sum(1 for r, e in zip(o.rows, o.early_accept) if e and r.y == 0),
            "retake_rate_pos": (sum(1 for r in pos_rows if not r.ok_quality) / len(pos_rows)) if pos_rows else NAN,
        })
    return table


def per_site(o: Outcome) -> list[dict]:
    groups: dict[str, list[int]] = defaultdict(list)
    for i, r in enumerate(o.rows):
        groups[r.sample.site_id].append(i)
    table = []
    for site, idx in sorted(groups.items()):
        rs, acc = [o.rows[i] for i in idx], [o.accept[i] for i in idx]
        tar, far_ = _rates(rs, acc)
        table.append({"site_id": site, "TAR": tar, "FAR": far_, **_far_by_label(rs, acc), "n": len(idx)})
    return table


def per_tag(o: Outcome, tag: str) -> list[dict]:
    groups: dict[str, list[bool]] = defaultdict(list)
    for r, a in zip(o.rows, o.accept):
        if r.y == 1:
            groups[r.sample.tags.get(tag, "") or "(없음)"].append(a)
    return [{"tag": tag, "value": v, "TAR": float(np.mean(a)), "n": len(a)} for v, a in sorted(groups.items())]


def early_accept_safe(o: Outcome) -> dict[str, bool]:
    safe: dict[str, bool] = {}
    for r, e in zip(o.rows, o.early_accept):
        safe.setdefault(r.sample.site_id, True)
        if e and r.y == 0:
            safe[r.sample.site_id] = False
    return safe


def fit_all(rows: list[Row], top_k: int, far: float, safe: dict[str, bool]) -> dict[str, SiteThresholds]:
    sites = {}
    for site in sorted({r.sample.site_id for r in rows}):
        t = fit_site(_samples([r for r in rows if r.sample.site_id == site], top_k), far)
        sites[site] = replace(t, early_accept=bool(safe.get(site)) and t.tau_accept is not None)
    return sites
