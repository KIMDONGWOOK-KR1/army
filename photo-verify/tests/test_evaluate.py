from pathlib import Path

import numpy as np

from pv.evaldata import Sample
from pv.evaluate import (Row, early_accept_safe, evaluate, fit_all, per_site,
                         per_tag, summarize)
from pv.pipeline import Features


def feat(s_g, n0, n1=0, quality=None):
    return Features(quality=quality, s_g=s_g, ranked_refs=[0, 1], inliers={0: n0, 1: n1},
                    t_pre_ms=10, t_global_ms=100, t_extract_ms=200, t_pair_ms={0: 300, 1: 300})


def rows(seed=0, per=20):
    rng = np.random.default_rng(seed)
    out = []
    for fold, session in ((0, "s1"), (1, "s2")):
        for i in range(per):
            tag = {"angle": "side" if i % 2 else "front"}
            out.append(Row(Sample(Path(f"p{fold}{i}"), "gate", "pos", session, tag), fold,
                           feat(rng.uniform(0.8, 0.95), int(rng.integers(60, 120)))))
            out.append(Row(Sample(Path(f"h{fold}{i}"), "gate", "hard_neg", session, {}), fold,
                           feat(rng.uniform(0.85, 0.99), int(rng.integers(2, 10)))))
            out.append(Row(Sample(Path(f"e{fold}{i}"), "gate", "easy_neg", session, {}), fold,
                           feat(rng.uniform(0.1, 0.3), int(rng.integers(0, 5)))))
    return out


def by_method(table):
    return {r["method"]: r for r in table}


def test_combined_beats_global_only_on_lookalikes():
    t = by_method(summarize(evaluate(rows())))
    # FAR ≤ 1% is guaranteed on the calibration fold only; held-out FAR is an estimate
    # (40 calibration negatives per fold → budget 0), so allow up to 2/80 held-out false accepts.
    assert t["C_reject"]["TAR"] >= 0.9 and t["C_reject"]["FAR"] <= 0.025
    assert t["A_global"]["TAR"] < t["C_reject"]["TAR"]


def test_early_reject_cuts_latency_for_easy_negatives():
    t = by_method(summarize(evaluate(rows())))
    assert t["C_reject"]["lat_mean"] < t["C_none"]["lat_mean"]
    # 조기 거절은 보정 fold의 정답 최솟값을 기준으로 하므로 정답을 약간 더 놓칠 수 있다
    assert t["C_reject"]["TAR"] >= t["C_none"]["TAR"] - 0.05


def test_retake_counts_as_rejection():
    rs = rows()
    rs.append(Row(Sample(Path("r"), "gate", "pos", "s1", {}), 0, feat(0.0, 0, quality="BLUR")))
    t = by_method(summarize(evaluate(rs)))
    assert 0 < t["C_reject"]["retake_rate_pos"] < 0.1


def test_per_site_and_tag_tables():
    out = evaluate(rows())
    assert per_site(out["C_reject"])[0]["site_id"] == "gate"
    assert {r["value"] for r in per_tag(out["C_reject"], "angle")} == {"front", "side"}


def test_early_accept_disabled_when_lookalikes_exceed_tau_accept():
    out = evaluate(rows())
    safe = early_accept_safe(out["C_both"])
    sites = fit_all(rows(), top_k=3, far=0.01, safe=safe)
    assert sites["gate"].early_accept is (safe["gate"] and sites["gate"].tau_accept is not None)


def test_test_fold_rows_do_not_affect_calibration():
    base = rows()
    ref = evaluate(base)["C_reject"]
    # fold 1 행의 절반만 특징을 바꾼다. 바뀌지 않은 fold 1 행의 판정은 보정 fold(0)에서만 나오므로 그대로여야 한다.
    perturbed = []
    for i, r in enumerate(base):
        if r.fold == 1 and i % 2 == 0:
            r = Row(r.sample, r.fold, feat(0.5, 1))
        perturbed.append(r)
    new = evaluate(perturbed)["C_reject"]
    untouched = {str(r.sample.path) for i, r in enumerate(base) if r.fold == 1 and i % 2 == 1}
    old_dec = {str(r.sample.path): a for r, a in zip(ref.rows, ref.accept) if str(r.sample.path) in untouched}
    new_dec = {str(r.sample.path): a for r, a in zip(new.rows, new.accept) if str(r.sample.path) in untouched}
    assert untouched and old_dec == new_dec


def test_far_split_by_negative_label_and_macro_auc_groups():
    rs = rows()
    rs.append(Row(Sample(Path("x0"), "gate", "cross_neg", "s1", {}), 0, feat(0.2, 1)))
    rs.append(Row(Sample(Path("x1"), "gate", "cross_neg", "s2", {}), 1, feat(0.2, 1)))
    t = by_method(summarize(evaluate(rs)))["C_reject"]
    assert all(0.0 <= t[k] <= 1.0 for k in ("FAR_hard", "FAR_easy", "FAR_cross"))
    assert t["auc_groups"] == 2  # (gate, fold 0), (gate, fold 1)
    site = per_site(evaluate(rs)["C_reject"])[0]
    assert {"FAR_hard", "FAR_easy", "FAR_cross"} <= set(site)
    assert np.isnan(by_method(summarize(evaluate(rows())))["C_reject"]["FAR_cross"])


def test_macro_auc_does_not_pool_sites_with_different_score_scales():
    # 거점마다 점수 범위가 달라도 각 거점 안에서 완전히 분리되면 AUC는 1이어야 한다(한데 섞으면 1보다 낮다).
    out = []
    for site, lo in (("a", 0.0), ("b", 0.5)):
        for fold, session in ((0, "s1"), (1, "s2")):
            for i in range(10):
                out.append(Row(Sample(Path(f"{site}p{fold}{i}"), site, "pos", session, {}), fold,
                               feat(lo + 0.3 + i * 0.001, 0)))
                out.append(Row(Sample(Path(f"{site}n{fold}{i}"), site, "easy_neg", session, {}), fold,
                               feat(lo + 0.1 + i * 0.001, 0)))
    t = by_method(summarize(evaluate(out)))["A_global"]
    assert t["AUC"] == 1.0 and t["auc_groups"] == 4


def test_skipped_site_warns_on_stderr(capsys):
    rs = rows() + [Row(Sample(Path("lonely"), "wall", "pos", "s1", {}), 0, feat(0.9, 80))]
    evaluate(rs)
    assert "wall" in capsys.readouterr().err


def test_c_none_is_calibrated_without_early_reject(monkeypatch):
    import pv.evaluate as ev
    calls = []
    real = ev.fit_site

    def spy(samples, far=0.01, margin=0.02, early_reject=True):
        calls.append(early_reject)
        return real(samples, far, margin, early_reject)
    monkeypatch.setattr(ev, "fit_site", spy)
    evaluate(rows())
    assert calls.count(False) == 2 and calls.count(True) == 2  # fold마다 C_none용 1번, 나머지용 1번
