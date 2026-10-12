import numpy as np
import pytest

from fakes import MeanColorEmbedder, jpeg_bytes, manual_gallery
from pv.gallery import (augment_views, build_gallery, load_gallery,
                        load_ref_dir, ref_scores, save_gallery)
from pv.local_match import SiftMatcher
from pv.synth import make_scene


def test_build_with_augmentation_tracks_owners():
    g = build_gallery("gate", [make_scene(1), make_scene(2)], MeanColorEmbedder(), SiftMatcher())
    assert g.global_vecs.shape[0] == 10  # 기준 2장 × (원본 1 + 증강 4)
    assert g.global_ref_idx.tolist() == [0] * 5 + [1] * 5
    assert g.n_refs == 2 and g.backbone == "fake" and g.matcher == "sift"


def test_build_without_augmentation():
    g = build_gallery("gate", [make_scene(1)], MeanColorEmbedder(), SiftMatcher(), augment=False)
    assert g.global_vecs.shape[0] == 1


def test_empty_refs_rejected():
    with pytest.raises(ValueError):
        build_gallery("gate", [], MeanColorEmbedder(), SiftMatcher())


def test_augment_views_deterministic():
    img = make_scene(1)
    a, b = augment_views(img, seed=7), augment_views(img, seed=7)
    assert len(a) == 4 and all(np.array_equal(x, y) for x, y in zip(a, b))


def test_ref_scores_take_max_per_ref():
    m = SiftMatcher()
    g = manual_gallery("gate", [make_scene(1), make_scene(2)], [[1, 0], [0, 1]], m)
    scores = ref_scores(g, np.float32([0.6, 0.8]))
    assert np.allclose(scores, [0.6, 0.8])


def test_save_load_roundtrip(tmp_path):
    g = build_gallery("gate", [make_scene(1)], MeanColorEmbedder(), SiftMatcher())
    path = tmp_path / "gallery" / "gate.npz"
    save_gallery(g, path)
    h = load_gallery(path)
    assert (h.site_id, h.backbone, h.matcher, h.n_refs) == ("gate", "fake", "sift", 1)
    assert np.array_equal(h.global_vecs, g.global_vecs)
    assert np.array_equal(h.local[0].descriptors, g.local[0].descriptors)


def test_load_ref_dir_sorted_and_limited(tmp_path):
    for name, seed in (("b.jpg", 2), ("a.jpg", 1), ("c.txt", 3)):
        data = jpeg_bytes(make_scene(seed)) if name.endswith(".jpg") else b"x"
        (tmp_path / name).write_bytes(data)
    imgs = load_ref_dir(tmp_path)
    assert len(imgs) == 2
    assert len(load_ref_dir(tmp_path, limit=1)) == 1


def test_build_records_deploy_metadata_and_roundtrip(tmp_path):
    g = build_gallery("gate", [make_scene(1)], MeanColorEmbedder(), SiftMatcher(max_kp=512), augment=False,
                      refs_fingerprint="abc")
    assert (g.augment, g.max_kp, g.refs_fingerprint) == (False, 512, "abc")
    save_gallery(g, tmp_path / "g.npz")
    h = load_gallery(tmp_path / "g.npz")
    assert (h.augment, h.max_kp, h.refs_fingerprint) == (False, 512, "abc")


def test_old_gallery_without_metadata_loads_as_none(tmp_path):
    g = manual_gallery("gate", [make_scene(1)], [[1, 0]], SiftMatcher())
    save_gallery(g, tmp_path / "g.npz")
    h = load_gallery(tmp_path / "g.npz")
    assert (h.augment, h.max_kp, h.refs_fingerprint, h.local_long_side) == (None, None, None, None)


def test_build_uses_and_records_local_long_side(tmp_path):
    big = make_scene(1, 1600, 1200)
    g = build_gallery("gate", [big], MeanColorEmbedder(), SiftMatcher(), augment=False, local_long_side=512)
    assert g.local_long_side == 512
    assert max(g.local[0].image_size) == 512
    save_gallery(g, tmp_path / "g.npz")
    assert load_gallery(tmp_path / "g.npz").local_long_side == 512
    assert build_gallery("gate", [big], MeanColorEmbedder(), SiftMatcher(), augment=False).local_long_side == 640


def test_fingerprint_follows_content_not_mtime(tmp_path):
    import os
    from pv.gallery import fingerprint_files
    p = tmp_path / "r1.jpg"
    p.write_bytes(b"aaaa")
    a = fingerprint_files([p])
    os.utime(p, (1, 1))
    assert fingerprint_files([p]) == a
    p.write_bytes(b"aaab")
    assert fingerprint_files([p]) != a
