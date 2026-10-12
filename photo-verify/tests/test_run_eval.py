import importlib.util
from pathlib import Path

from pv.pipeline import Features

_spec = importlib.util.spec_from_file_location(
    "run_eval", Path(__file__).resolve().parents[1] / "eval" / "run_eval.py")
run_eval = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(run_eval)


def sample_features():
    return Features(quality=None, s_g=0.87, ranked_refs=[2, 0, 1], inliers={0: 12, 1: 3, 2: 55},
                    t_pre_ms=11.5, t_global_ms=101.0, t_extract_ms=202.5, t_pair_ms={0: 30.0, 1: 31.0, 2: 32.0})


def test_features_json_round_trip_restores_int_keys():
    import json
    f = sample_features()
    back = run_eval.features_from_json(json.loads(json.dumps(run_eval.features_to_json(f))))
    assert back == f
    assert all(isinstance(k, int) for k in back.inliers) and all(isinstance(k, int) for k in back.t_pair_ms)


def test_cache_tolerates_truncated_trailing_line(tmp_path, capsys):
    import json
    p = tmp_path / "c.jsonl"
    good = json.dumps({"path": "a.jpg", "site_id": "gate", "fp": "1-2",
                       "f": run_eval.features_to_json(sample_features())})
    p.write_text(good + "\n" + good[:40], encoding="utf-8")
    stored = run_eval.read_cache(p)
    assert list(stored) == [("a.jpg", "gate")]
    assert stored[("a.jpg", "gate")][0] == "1-2"
    assert "1개" in capsys.readouterr().out


def test_refs_fingerprint_changes_when_ref_changes(tmp_path):
    d = tmp_path / "gate"
    d.mkdir()
    (d / "r1.jpg").write_bytes(b"aaaa")
    a = run_eval.refs_fingerprint(tmp_path, ["gate"], 5)
    (d / "r1.jpg").write_bytes(b"aaaaaa")
    assert run_eval.refs_fingerprint(tmp_path, ["gate"], 5) != a
