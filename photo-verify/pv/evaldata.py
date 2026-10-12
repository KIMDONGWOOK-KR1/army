"""평가 매니페스트. 평가 사진과 매니페스트는 private/photo-verify/eval/에만 둔다."""
from __future__ import annotations

import csv
from dataclasses import dataclass, replace
from pathlib import Path

LABELS = {"pos", "hard_neg", "easy_neg"}
TAG_COLUMNS = ("angle", "distance", "time", "weather", "occlusion")
REQUIRED = ("path", "site_id", "label", "session") + TAG_COLUMNS


@dataclass(frozen=True)
class Sample:
    path: Path
    site_id: str
    label: str
    session: str
    tags: dict[str, str]


def load_manifest(path: Path) -> list[Sample]:
    path = Path(path)
    with path.open(encoding="utf-8", newline="") as fh:
        reader = csv.DictReader(fh)
        missing = [c for c in REQUIRED if c not in (reader.fieldnames or [])]
        if missing:
            raise ValueError(f"manifest columns missing: {missing}")
        out = []
        for i, row in enumerate(reader, start=2):
            if row["label"] not in LABELS:
                raise ValueError(f"line {i}: unknown label {row['label']!r}")
            out.append(Sample(path.parent / row["path"], row["site_id"], row["label"], row["session"],
                              {c: row[c] for c in TAG_COLUMNS}))
    return out


def assign_folds(samples: list[Sample]) -> dict[str, int]:
    sessions = sorted({s.session for s in samples})
    if len(sessions) < 2:
        raise ValueError("2-fold 평가에는 촬영 회차가 2개 이상 필요하다")
    return {s: i % 2 for i, s in enumerate(sessions)}


def cross_site_negatives(samples: list[Sample], sites: list[str]) -> list[Sample]:
    """다른 거점의 정답 사진을 이 거점의 오답으로 쓴다."""
    return [replace(s, site_id=other, label="cross_neg")
            for s in samples if s.label == "pos" for other in sites if other != s.site_id]
