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
    assert t["C_reject"]["TAR"] >= 0.9 and t["C_reject"]["FAR"] <= 0.01
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
