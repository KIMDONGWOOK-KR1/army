import numpy as np
import pytest

from fakes import CountingMatcher, FixedEmbedder, jpeg_bytes, manual_gallery
from pv.gallery import save_gallery
from pv.local_match import SiftMatcher
from pv.pipeline import UnknownSite, Verifier, compute_features
from pv.preprocess import InvalidImage, QualityConfig
from pv.scorer import SiteThresholds, ThresholdConfig, save_thresholds
from pv.synth import make_scene, warp_view

# SIFT는 다른 장면끼리도 우연한 일치점이 10개 안팎 나올 수 있어 tau_n을 25로 둔다.
RULE = SiteThresholds(tau_reject=0.5, tau_n=25, mode="rule", tau_low=0.5)


def setup(query_vec, refs=None, site=RULE):
    matcher = CountingMatcher(SiftMatcher())
    refs = refs or [make_scene(1)]
    g = manual_gallery("gate", refs, [[1.0, 0.0]] * len(refs), matcher, backbone="fake")
    matcher.extract_calls = 0
    cfg = ThresholdConfig("fake", "sift", 3, QualityConfig(), {"gate": site})
    return Verifier(FixedEmbedder(query_vec), matcher, {"gate": g}, cfg), matcher


def test_same_place_from_other_view_matches():
    v, _ = setup([1.0, 0.0])
    r = v.verify("gate", jpeg_bytes(warp_view(make_scene(1), seed=4, brightness=0.9)))
    assert (r.match, r.reason_code) == (True, "MATCH")
    assert r.latency_ms >= 0


def test_lookalike_with_perfect_global_score_is_rejected_by_stage2():
    v, m = setup([1.0, 0.0])  # s_g = 1.0
    r = v.verify("gate", jpeg_bytes(make_scene(2)))
    assert (r.match, r.reason_code) == (False, "NO_MATCH")
    assert m.extract_calls == 1  # 2단계를 실제로 거쳤다


def test_low_global_score_skips_stage2():
    v, m = setup([0.0, 1.0])  # s_g = 0.0
    r = v.verify("gate", jpeg_bytes(make_scene(1)))
    assert r.reason_code == "NO_MATCH" and m.extract_calls == 0


def test_dark_photo_asks_retake_without_models():
    v, m = setup([1.0, 0.0])
    r = v.verify("gate", jpeg_bytes(np.zeros((480, 640, 3), np.uint8)))
    assert (r.match, r.reason_code, r.score) == (False, "RETAKE", 0.0)
    assert v.embedder.calls == 0 and m.extract_calls == 0


def test_unknown_site_and_invalid_image():
    v, _ = setup([1.0, 0.0])
    with pytest.raises(UnknownSite):
        v.verify("nowhere", jpeg_bytes(make_scene(1)))
    with pytest.raises(InvalidImage):
        v.verify("gate", b"garbage")


def test_model_mismatch_fails_at_startup():
    matcher = SiftMatcher()
    g = manual_gallery("gate", [make_scene(1)], [[1.0, 0.0]], matcher, backbone="dinov2_vits14")
    cfg = ThresholdConfig("dinov2_vitb14", "sift", 3, QualityConfig(), {"gate": RULE})
    with pytest.raises(ValueError):
        Verifier(FixedEmbedder([1, 0], name="dinov2_vitb14"), matcher, {"gate": g}, cfg)


def test_missing_gallery_fails_at_startup():
    cfg = ThresholdConfig("fake", "sift", 3, QualityConfig(), {"gate": RULE})
    with pytest.raises(ValueError):
        Verifier(FixedEmbedder([1, 0]), SiftMatcher(), {}, cfg)


def test_compute_features_all_refs_with_timings():
    matcher = SiftMatcher()
    refs = [make_scene(1), make_scene(2)]
    g = manual_gallery("gate", refs, [[1, 0], [0.6, 0.8]], matcher)
    f = compute_features(FixedEmbedder([1, 0]), matcher, g, jpeg_bytes(make_scene(1)),
                         QualityConfig(), top_k=1, all_refs=True)
    assert f.quality is None and f.ranked_refs == [0, 1]
    assert set(f.inliers) == {0, 1} and f.inliers[0] > f.inliers[1]
    assert f.t_global_ms > 0 and f.t_extract_ms > 0 and set(f.t_pair_ms) == {0, 1}


def test_from_dir_loads_thresholds_and_galleries(tmp_path, monkeypatch):
    matcher = SiftMatcher()
    g = manual_gallery("gate", [make_scene(1)], [[1, 0]], matcher, backbone="fake")
    save_gallery(g, tmp_path / "gallery" / "gate.npz")
    save_thresholds(ThresholdConfig("fake", "sift", 3, QualityConfig(), {"gate": RULE}),
                    tmp_path / "thresholds.json")
    monkeypatch.setattr("pv.pipeline.make_embedder", lambda name: FixedEmbedder([1, 0], name=name))
    v = Verifier.from_dir(tmp_path)
    assert v.verify("gate", jpeg_bytes(warp_view(make_scene(1), seed=4))).match


def _meta_gallery(n_refs=2, **meta):
    matcher = SiftMatcher()
    refs = [make_scene(i + 1) for i in range(n_refs)]
    g = manual_gallery("gate", refs, [[1.0, 0.0]] * n_refs, matcher, backbone="fake")
    for k, v in meta.items():
        setattr(g, k, v)
    return matcher, g


@pytest.mark.parametrize("cfg_kw,gal_kw", [
    ({"n_refs": 1}, {"n_refs": 2}),
    ({"max_keypoints": 512}, {"max_kp": 1024}),
    ({"augment": True}, {"augment": False}),
    ({"refs_fingerprint": {"gate": "aaa"}}, {"refs_fingerprint": "bbb"}),
    ({"local_long_side": 640}, {"local_long_side": 1024}),
])
def test_deploy_metadata_mismatch_fails_at_startup(cfg_kw, gal_kw):
    matcher, g = _meta_gallery(gal_kw.pop("n_refs", 2), **gal_kw)
    cfg = ThresholdConfig("fake", "sift", 3, QualityConfig(), {"gate": RULE}, **cfg_kw)
    with pytest.raises(ValueError):
        Verifier(FixedEmbedder([1, 0]), matcher, {"gate": g}, cfg)


def test_deploy_metadata_match_or_absent_is_accepted():
    matcher, g = _meta_gallery(2, max_kp=1024, augment=True, refs_fingerprint="aaa")
    cfg = ThresholdConfig("fake", "sift", 3, QualityConfig(), {"gate": RULE}, 1024, n_refs=5, augment=True,
                          refs_fingerprint={"gate": "aaa"})
    Verifier(FixedEmbedder([1, 0]), matcher, {"gate": g}, cfg)  # 기준 사진이 상한(5)보다 적은 것은 허용
    _, old = _meta_gallery(2)  # 메타가 없는 예전 갤러리
    Verifier(FixedEmbedder([1, 0]), matcher, {"gate": old}, cfg)


@pytest.mark.parametrize("query_seed", [1, 2])  # 1: 같은 장면(일치), 2: 다른 장면(불일치)
def test_verify_matches_evaluation_decision(query_seed):
    from pv.scorer import decide
    matcher = SiftMatcher()
    refs = [make_scene(1), make_scene(3)]
    g = manual_gallery("gate", refs, [[1.0, 0.0], [0.6, 0.8]], matcher, backbone="fake")
    cfg = ThresholdConfig("fake", "sift", 3, QualityConfig(), {"gate": RULE})
    emb = FixedEmbedder([1.0, 0.0])
    data = jpeg_bytes(warp_view(make_scene(query_seed), seed=4))
    v = Verifier(emb, matcher, {"gate": g}, cfg)
    f = compute_features(emb, matcher, g, data, QualityConfig(), 3, all_refs=True)
    expected = decide(RULE, f.s_g, f.ranked_refs, lambda r: f.inliers[r], 3, "both").match
    assert v.verify("gate", data).match == expected
    assert expected is (query_seed == 1)


class ShapeSpyMatcher(CountingMatcher):
    def __init__(self, inner):
        super().__init__(inner)
        self.shapes = []

    def extract(self, image):
        self.shapes.append(image.shape[:2])
        return super().extract(image)


@pytest.mark.parametrize("side", [512, 768])
def test_query_uses_configured_local_side_but_quality_stays_at_1024(monkeypatch, side):
    import pv.pipeline as pipeline
    seen = []
    real = pipeline.check_quality
    monkeypatch.setattr(pipeline, "check_quality", lambda img, cfg: seen.append(img.shape[:2]) or real(img, cfg))
    matcher = ShapeSpyMatcher(SiftMatcher())
    g = manual_gallery("gate", [make_scene(1)], [[1.0, 0.0]], matcher, backbone="fake")
    cfg = ThresholdConfig("fake", "sift", 3, QualityConfig(), {"gate": RULE}, local_long_side=side)
    data = jpeg_bytes(warp_view(make_scene(1, 1600, 1200), seed=4))
    matcher.shapes.clear()
    Verifier(FixedEmbedder([1, 0]), matcher, {"gate": g}, cfg).verify("gate", data)
    compute_features(FixedEmbedder([1, 0]), matcher, g, data, QualityConfig(), 3, local_long_side=side)
    assert [max(s) for s in matcher.shapes] == [side, side]
    assert [max(s) for s in seen] == [1024, 1024]
