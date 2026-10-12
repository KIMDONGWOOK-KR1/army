import math

import numpy as np

from pv.calibrate import (SiteSamples, auc, eer, fit_site, fit_tau_accept,
                          fit_tau_reject, tar_at_far, threshold_at_far)
from pv.scorer import passes


def test_threshold_at_far_allows_floor_far_times_negatives():
    neg = np.arange(100, dtype=float)
    t = threshold_at_far(neg, far=0.01)
    assert int((neg >= t).sum()) == 1
    assert int((neg >= threshold_at_far(neg, far=0.0)).sum()) == 0
    assert threshold_at_far([], far=0.01) == -math.inf


def test_threshold_at_far_uses_total_denominator():
    t = threshold_at_far([0.9, 0.8], far=0.01, total=200)  # 200개 중 2개까지 허용
    assert t <= 0.8


def test_tar_auc_eer_on_separated_scores():
    pos, neg = np.linspace(0.8, 1.0, 50), np.linspace(0.0, 0.5, 50)
    assert tar_at_far(pos, neg) == 1.0
    assert auc(pos, neg) == 1.0
    assert eer(pos, neg) == 0.0


def test_eer_near_half_on_identical_distributions():
    x = np.random.default_rng(0).uniform(0, 1, 2000)
    assert abs(eer(x[:1000], x[1000:]) - 0.5) < 0.05


def test_fit_tau_reject_misses_at_most_one_percent():
    pos = np.arange(100, dtype=float)
    t = fit_tau_reject(pos, 0.01)
    assert int((pos < t).sum()) <= 1


def test_fit_tau_accept_margin_and_disable():
    assert fit_tau_accept(np.array([0.5, 0.7])) == 0.72
    assert fit_tau_accept(np.array([0.99])) is None
    assert fit_tau_accept(np.array([])) is None


def _synthetic(rng, n_each=40):
    s_g = np.r_[rng.uniform(0.8, 0.95, n_each), rng.uniform(0.75, 0.9, n_each), rng.uniform(0.1, 0.3, n_each)]
    n = np.r_[rng.integers(60, 120, n_each), rng.integers(2, 10, n_each), rng.integers(0, 5, n_each)]
    y = np.r_[np.ones(n_each), np.zeros(2 * n_each)].astype(int)
    return SiteSamples(s_g, n.astype(float), y)


def test_fit_site_logistic_separates_and_stop_rule_is_safe():
    s = _synthetic(np.random.default_rng(1))
    t = fit_site(s)
    assert t.mode == "logistic" and not t.early_accept
    accept = np.array([sg >= t.tau_reject and passes(t, sg, int(n)) for sg, n in zip(s.s_g, s.n)])
    assert accept[s.y == 1].mean() >= 0.9
    assert accept[s.y == 0].mean() <= 0.01
    assert passes(t, t.tau_reject, t.tau_n)  # n이 tau_n에 이르면 더 매칭하지 않아도 통과


def test_fit_site_rule_when_few_samples():
    s = SiteSamples(np.array([0.9, 0.85, 0.3]), np.array([80.0, 70.0, 4.0]), np.array([1, 1, 0]))
    t = fit_site(s)
    assert t.mode == "rule" and t.tau_n >= 8 and t.tau_low == t.tau_reject


def _accepted_negatives(t, s):
    return sum(1 for sg, n, y in zip(s.s_g, s.n, s.y)
               if y == 0 and sg >= t.tau_reject and passes(t, sg, int(n)))


def test_threshold_at_far_floor_epsilon():
    neg = np.arange(100, dtype=float)
    t = threshold_at_far(neg, far=0.29)  # 0.29 * 100 = 28.999... 이지만 29개 허용
    assert int((neg >= t).sum()) == 29


def test_logistic_far_budget_with_overlap():
    rng = np.random.default_rng(3)
    s_g = np.r_[rng.uniform(0.6, 0.95, 200), rng.uniform(0.55, 0.9, 300)]
    n = np.r_[rng.integers(20, 121, 200), rng.integers(0, 41, 300)].astype(float)
    y = np.r_[np.ones(200), np.zeros(300)].astype(int)
    s = SiteSamples(s_g, n, y)
    t = fit_site(s)
    assert t.mode == "logistic"
    assert _accepted_negatives(t, s) <= int(np.floor(0.01 * 300))


def test_rule_mode_far_count():
    rng = np.random.default_rng(5)
    s_g = np.r_[rng.uniform(0.8, 0.95, 5), rng.uniform(0.7, 0.95, 60)]
    n = np.r_[rng.integers(60, 120, 5), rng.integers(0, 80, 60)].astype(float)
    y = np.r_[np.ones(5), np.zeros(60)].astype(int)
    s = SiteSamples(s_g, n, y)
    t = fit_site(s)
    assert t.mode == "rule" and t.tau_n >= 8
    assert _accepted_negatives(t, s) <= int(np.floor(0.01 * 60))


def test_saturated_logistic_falls_back_to_rule(monkeypatch):
    # 자연 데이터로는 로지스틱 점수가 1.0에 포화되지 않으므로, 시그모이드가 전부 1.0을 내는 상황을 강제한다.
    monkeypatch.setattr("pv.calibrate.fused_score", lambda t, s_g, n: 1.0)
    rng = np.random.default_rng(7)
    s_g = np.r_[rng.uniform(0.8, 0.95, 20), rng.uniform(0.8, 0.95, 5), rng.uniform(0.1, 0.3, 15)]
    n = np.r_[rng.integers(60, 120, 20), np.full(5, 1000), rng.integers(0, 5, 15)].astype(float)
    y = np.r_[np.ones(20), np.zeros(20)].astype(int)
    s = SiteSamples(s_g, n, y)
    t = fit_site(s)
    assert t.mode == "rule"
    assert _accepted_negatives(t, s) <= int(np.floor(0.01 * 20))
