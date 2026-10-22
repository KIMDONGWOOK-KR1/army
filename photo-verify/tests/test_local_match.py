import cv2
import numpy as np
import pytest

from pv.local_match import (count_inliers, inliers_between, make_matcher)
from pv.synth import make_scene, warp_view


def test_too_few_points_give_zero():
    pts = np.random.default_rng(0).uniform(0, 100, (7, 2))
    assert count_inliers(pts, pts) == 0


def test_projective_points_are_mostly_inliers_random_are_not():
    rng = np.random.default_rng(1)
    pts0 = rng.uniform(0, 640, (200, 2)).astype(np.float32)
    H = np.array([[1.05, 0.02, 10], [-0.03, 0.98, 5], [1e-5, 2e-5, 1]], np.float64)
    pts1 = cv2.perspectiveTransform(pts0[None], H)[0]
    assert count_inliers(pts0, pts1) >= 180
    assert count_inliers(pts0, rng.uniform(0, 640, (200, 2))) < 60


def test_sift_same_scene_beats_different_scene():
    m = make_matcher("sift")
    base = m.extract(make_scene(1))
    same = m.extract(warp_view(make_scene(1), seed=3, brightness=0.85))
    other = m.extract(make_scene(2))
    n_same, n_other = inliers_between(m, base, same), inliers_between(m, base, other)
    assert n_same >= 30 and n_same > 3 * n_other


def test_flat_image_has_no_features_and_zero_inliers():
    m = make_matcher("sift")
    flat = m.extract(np.full((300, 300, 3), 127, np.uint8))
    assert len(flat.keypoints) == 0
    assert inliers_between(m, flat, m.extract(make_scene(1))) == 0


def test_unknown_matcher_raises():
    with pytest.raises(KeyError):
        make_matcher("nope")


@pytest.mark.model
def test_aliked_lightglue_same_scene_beats_different_scene():
    m = make_matcher("aliked", max_kp=512)
    base = m.extract(make_scene(1))
    n_same = inliers_between(m, base, m.extract(warp_view(make_scene(1), seed=3)))
    n_other = inliers_between(m, base, m.extract(make_scene(2)))
    assert n_same >= 30 and n_same > 3 * n_other


def test_count_inliers_returns_zero_when_magsac_finds_no_model():
    """흔들린 실제 프레임에서 나온 매칭 10쌍. OpenCV MAGSAC이 모델 없이 예외를 던지던 입력이다."""
    pts0 = np.float32([[264.1, 17.2], [243.7, 18.0], [279.9, 21.8], [263.4, 32.3], [342.7, 76.0],
                       [269.0, 76.9], [275.0, 157.7], [367.1, 208.0], [553.9, 480.4], [91.7, 840.4]])
    pts1 = np.float32([[272.5, 359.1], [264.8, 361.3], [277.3, 362.2], [270.3, 365.8], [290.7, 375.3],
                       [267.8, 384.0], [268.7, 398.3], [289.0, 421.9], [158.1, 530.2], [97.0, 779.0]])
    assert count_inliers(pts0, pts1) == 0
