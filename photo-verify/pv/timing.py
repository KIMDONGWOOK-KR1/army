"""지연 측정값 요약."""
from __future__ import annotations

import statistics


def summarize_ms(samples: list[float]) -> dict[str, float]:
    """밀리초 표본의 p50·p95·평균. 백분위는 최근접 순위(nearest-rank) 방식이다."""
    if not samples:
        raise ValueError("samples is empty")
    s = sorted(samples)

    def pct(p: float) -> float:
        idx = max(0, min(len(s) - 1, int(-(-p * len(s) // 100)) - 1))
        return s[idx]

    return {"p50": pct(50), "p95": pct(95), "mean": statistics.fmean(s)}
