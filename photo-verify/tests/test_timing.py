from pv.timing import summarize_ms


def test_summarize_ms_percentiles():
    out = summarize_ms([float(i) for i in range(1, 101)])
    assert out["p50"] == 50.0
    assert out["p95"] == 95.0
    assert out["mean"] == 50.5


def test_summarize_ms_single_value():
    assert summarize_ms([7.0]) == {"p50": 7.0, "p95": 7.0, "mean": 7.0}
