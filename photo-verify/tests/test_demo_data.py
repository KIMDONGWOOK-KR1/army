from fakes import MeanColorEmbedder, jpeg_bytes
from pv.demo_data import write_demo
from pv.local_match import SiftMatcher
from pv.pipeline import Verifier
from pv.synth import make_scene, warp_view


def test_demo_data_is_loadable_and_judges_synthetic_scene(tmp_path, monkeypatch):
    write_demo(tmp_path, MeanColorEmbedder(), SiftMatcher())
    assert (tmp_path / "thresholds.json").exists() and (tmp_path / "gallery" / "demo.npz").exists()
    monkeypatch.setattr("pv.pipeline.make_embedder", lambda name: MeanColorEmbedder(name))
    v = Verifier.from_dir(tmp_path)
    assert v.verify("demo", jpeg_bytes(warp_view(make_scene(1), seed=3))).match
    assert not v.verify("demo", jpeg_bytes(make_scene(50))).match
