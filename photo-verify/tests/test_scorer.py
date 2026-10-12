import pytest

from pv.preprocess import QualityConfig
from pv.scorer import (SiteThresholds, ThresholdConfig, decide, fused_score,
                       load_thresholds, passes, save_thresholds)

RULE = SiteThresholds(tau_reject=0.4, tau_n=20, mode="rule", tau_low=0.5)


def lookup(table):
    calls = []

    def inliers_of(ref):
        calls.append(ref)
        return table[ref]
    return inliers_of, calls


def never(ref):
    raise AssertionError("2단계가 실행되면 안 된다")


def test_low_similarity_is_rejected_without_stage2():
    d = decide(RULE, 0.3, [0, 1, 2], never, top_k=3, early_exit="reject")
    assert (d.match, d.reason_code, d.pairs_used, d.n) == (False, "NO_MATCH", [], None)


def test_none_mode_runs_stage2_even_when_low():
    fn, calls = lookup({0: 1, 1: 2, 2: 3})
    d = decide(RULE, 0.3, [0, 1, 2], fn, top_k=3, early_exit="none")
    assert calls == [0, 1, 2] and d.n == 3 and not d.match


def test_sequential_stop_after_enough_inliers():
    fn, calls = lookup({0: 50, 1: 99, 2: 99})
    d = decide(RULE, 0.9, [0, 1, 2], fn, top_k=3, early_exit="reject")
    assert calls == [0] and d.match and d.n == 50


def test_continues_until_threshold_reached():
    fn, calls = lookup({0: 5, 1: 30, 2: 99})
    d = decide(RULE, 0.9, [0, 1, 2], fn, top_k=3)
    assert calls == [0, 1] and d.n == 30 and d.match


def test_top_k_limits_pairs():
    fn, calls = lookup({0: 1, 1: 1, 2: 1, 3: 99})
    d = decide(RULE, 0.9, [0, 1, 2, 3], fn, top_k=3)
    assert calls == [0, 1, 2] and not d.match


def test_high_similarity_alone_never_passes_by_default():
    fn, _ = lookup({0: 3})
    d = decide(RULE, 0.99, [0], fn, top_k=1)
    assert not d.match and d.pairs_used == [0]


def test_early_accept_requires_flag_and_mode():
    t = SiteThresholds(tau_reject=0.4, tau_n=20, tau_low=0.5, early_accept=True, tau_accept=0.95)
    d = decide(t, 0.97, [0], never, top_k=1, early_exit="both")
    assert d.match and d.pairs_used == [] and d.score == 1.0
    fn, calls = lookup({0: 0})
    assert not decide(t, 0.97, [0], fn, top_k=1, early_exit="reject").match and calls == [0]
    off = SiteThresholds(tau_reject=0.4, tau_n=20, tau_low=0.5, early_accept=False, tau_accept=0.95)
    fn2, calls2 = lookup({0: 0})
    assert not decide(off, 0.97, [0], fn2, top_k=1, early_exit="both").match and calls2 == [0]


def test_rule_needs_both_conditions():
    assert passes(RULE, 0.6, 20)
    assert not passes(RULE, 0.45, 100)
    assert not passes(RULE, 0.9, 19)


def test_logistic_score_is_stable_for_extremes():
    t = SiteThresholds(tau_reject=0.0, tau_n=10, mode="logistic", w_sg=10, w_n=2, bias=-10, tau_score=0.5)
    assert fused_score(t, 0.0, 0) == pytest.approx(0.0, abs=1e-4)
    big_negative = SiteThresholds(tau_reject=0.0, tau_n=10, mode="logistic", bias=-1000)
    assert fused_score(big_negative, 0.0, 0) < 1e-300  # 넘침 예외 없이 0에 가깝다
    assert passes(t, 1.0, 100)


def test_thresholds_roundtrip(tmp_path):
    cfg = ThresholdConfig(backbone="dinov2_vitb14", matcher="aliked", top_k=3,
                          quality=QualityConfig(blur_var_min=50.0),
                          sites={"gate": RULE}, max_keypoints=512)
    path = tmp_path / "thresholds.json"
    save_thresholds(cfg, path)
    assert load_thresholds(path) == cfg


def test_unknown_version_rejected(tmp_path):
    path = tmp_path / "t.json"
    path.write_text('{"version": 2}', encoding="utf-8")
    with pytest.raises(ValueError):
        load_thresholds(path)
