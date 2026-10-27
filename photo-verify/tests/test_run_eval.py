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


def test_write_deploy_produces_unit_that_verifier_loads(tmp_path, monkeypatch, capsys):
    import sys

    from fakes import MeanColorEmbedder, jpeg_bytes
    from pv.local_match import SiftMatcher
    from pv.pipeline import Verifier
    from pv.scorer import load_thresholds
    from pv.synth import make_scene, warp_view

    refs = tmp_path / "refs"
    for site, seed in (("gate", 1), ("wall", 2)):
        (refs / site).mkdir(parents=True)
        for i in range(3):
            (refs / site / f"r{i}.jpg").write_bytes(jpeg_bytes(warp_view(make_scene(seed), seed=10 + i)))
    ev = tmp_path / "eval"
    (ev / "images").mkdir(parents=True)
    lines = ["path,site_id,label,session,angle,distance,time,weather,occlusion"]
    for site, seed, other in (("gate", 1, 5), ("wall", 2, 6)):
        for session in ("s1", "s2"):
            for i in range(2):
                name = f"images/{site}_{session}_{i}.jpg"
                (ev / name).write_bytes(jpeg_bytes(warp_view(make_scene(seed), seed=20 + i + len(session))))
                lines.append(f"{name},{site},pos,{session},front,near,day,clear,none")
                neg = f"images/{site}_{session}_n{i}.jpg"
                (ev / neg).write_bytes(jpeg_bytes(make_scene(other + i)))
                lines.append(f"{neg},{site},hard_neg,{session},,,,,")
    (ev / "manifest.csv").write_text("\n".join(lines) + "\n", encoding="utf-8")
    monkeypatch.setattr(run_eval, "make_embedder", lambda name: MeanColorEmbedder(name))
    monkeypatch.setattr(run_eval, "make_matcher", lambda name, max_kp: SiftMatcher(max_kp))
    deploy = tmp_path / "deploy"
    monkeypatch.setattr(sys, "argv", ["run_eval", "--manifest", str(ev / "manifest.csv"), "--refs", str(refs),
                                      "--out", str(tmp_path / "results"), "--backbones", "fake",
                                      "--matchers", "sift", "--ref-counts", "2", "--max-kp", "512",
                                      "--local-long-side", "512",
                                      "--write-deploy", str(deploy)])
    run_eval.main()
    printed = capsys.readouterr().out
    assert "thresholds.json" in printed and "gate.npz" in printed
    cfg = load_thresholds(deploy / "thresholds.json")
    assert (cfg.n_refs, cfg.augment, cfg.max_keypoints, cfg.local_long_side) == (2, True, 512, 512)
    assert set(cfg.refs_fingerprint) == {"gate", "wall"}
    monkeypatch.setattr("pv.pipeline.make_embedder", lambda name: MeanColorEmbedder(name))
    v = Verifier.from_dir(deploy)
    assert v.galleries["gate"].n_refs == 2 and v.galleries["gate"].max_kp == 512
    assert v.galleries["gate"].local_long_side == 512
    assert v.galleries["gate"].refs_fingerprint == cfg.refs_fingerprint["gate"]
