"""거점별 임계값 보정과 평가 지표."""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score, roc_curve

from pv.local_match import MIN_POINTS
from pv.scorer import SiteThresholds

MIN_FOR_LOGISTIC = 10
DEFAULT_TAU_N = 15
NEVER = 10**9


def threshold_at_far(neg_scores, far: float = 0.01, total: int | None = None) -> float:
    neg = np.sort(np.asarray(neg_scores, np.float64))[::-1]
    if len(neg) == 0:
        return -math.inf
    k = int(math.floor(far * (total if total is not None else len(neg))))
    if k >= len(neg):
        return -math.inf
    return float(np.nextafter(neg[k], math.inf))


def tar_at_far(pos, neg, far: float = 0.01) -> float:
    pos = np.asarray(pos, np.float64)
    return float(np.mean(pos >= threshold_at_far(neg, far))) if len(pos) else float("nan")


def auc(pos, neg) -> float:
    y = np.r_[np.ones(len(pos)), np.zeros(len(neg))]
    return float(roc_auc_score(y, np.r_[pos, neg]))


def eer(pos, neg) -> float:
    y = np.r_[np.ones(len(pos)), np.zeros(len(neg))]
    fpr, tpr, _ = roc_curve(y, np.r_[pos, neg])
    fnr = 1 - tpr
    i = int(np.nanargmin(np.abs(fnr - fpr)))
    return float((fpr[i] + fnr[i]) / 2)


def fit_tau_reject(pos_sg, max_miss: float = 0.01) -> float:
    pos = np.sort(np.asarray(pos_sg, np.float64))
    if len(pos) == 0:
        return -math.inf
    return float(pos[int(math.floor(max_miss * len(pos)))])


def fit_tau_accept(neg_sg, margin: float = 0.02) -> float | None:
    if len(neg_sg) == 0:
        return None
    t = round(float(np.max(neg_sg)) + margin, 6)
    return t if t <= 1.0 else None


@dataclass(frozen=True)
class SiteSamples:
    s_g: np.ndarray
    n: np.ndarray
    y: np.ndarray


def _logistic_tau_n(w_sg: float, w_n: float, bias: float, tau_score: float, tau_reject: float) -> int:
    if w_n <= 0:
        return NEVER
    p = min(max(tau_score, 1e-6), 1 - 1e-6)
    s_worst = tau_reject if w_sg >= 0 else 1.0
    v = (math.log(p / (1 - p)) - bias - w_sg * s_worst) / w_n
    if v > 20:
        return NEVER
    return max(0, math.ceil(math.expm1(v)))


def fit_site(samples: SiteSamples, far: float = 0.01, margin: float = 0.02) -> SiteThresholds:
    pos, neg = samples.y == 1, samples.y == 0
    tau_reject = fit_tau_reject(samples.s_g[pos], far)
    tau_accept = fit_tau_accept(samples.s_g[neg], margin)
    surviving = neg & (samples.s_g >= tau_reject)
    total_neg = int(neg.sum())
    if pos.sum() >= MIN_FOR_LOGISTIC and neg.sum() >= MIN_FOR_LOGISTIC:
        x = np.c_[samples.s_g, np.log1p(samples.n)]
        lr = LogisticRegression(class_weight="balanced").fit(x, samples.y)
        w_sg, w_n = (float(c) for c in lr.coef_[0])
        bias = float(lr.intercept_[0])
        scores = 1.0 / (1.0 + np.exp(-(x @ np.array([w_sg, w_n]) + bias)))
        tau_score = threshold_at_far(scores[surviving], far, total=total_neg)
        tau_score = min(max(tau_score, 0.0), 1.0)
        return SiteThresholds(tau_reject=tau_reject, mode="logistic", w_sg=w_sg, w_n=w_n, bias=bias,
                              tau_score=tau_score,
                              tau_n=_logistic_tau_n(w_sg, w_n, bias, tau_score, tau_reject),
                              tau_accept=tau_accept)
    t_n = threshold_at_far(samples.n[surviving], far, total=total_neg)
    tau_n = DEFAULT_TAU_N if total_neg == 0 else max(MIN_POINTS, math.ceil(max(t_n, 0.0)))
    return SiteThresholds(tau_reject=tau_reject, tau_n=tau_n, mode="rule", tau_low=tau_reject,
                          tau_accept=tau_accept)
