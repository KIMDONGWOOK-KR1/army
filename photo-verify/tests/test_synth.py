import numpy as np

from pv.synth import make_scene, warp_view


def test_make_scene_is_deterministic_rgb():
    a, b = make_scene(3), make_scene(3)
    assert a.shape == (480, 640, 3) and a.dtype == np.uint8
    assert np.array_equal(a, b)
    assert not np.array_equal(a, make_scene(4))


def test_warp_view_changes_pixels_keeps_shape():
    img = make_scene(1)
    out = warp_view(img, seed=5, brightness=0.8)
    assert out.shape == img.shape and out.dtype == np.uint8
    assert not np.array_equal(out, img)
