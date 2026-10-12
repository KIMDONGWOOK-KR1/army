import io

import cv2
import numpy as np
import pytest
from PIL import Image

from pv.preprocess import (InvalidImage, check_quality, decode_image,
                           to_global_input, to_local_input)
from pv.synth import make_scene


def _encode(arr: np.ndarray, fmt: str = "JPEG", **kw) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(arr).save(buf, fmt, **kw)
    return buf.getvalue()


def test_exif_orientation_is_applied():
    arr = np.zeros((100, 200, 3), np.uint8)
    arr[:, :100] = 255  # 왼쪽 절반 흰색
    exif = Image.Exif()
    exif[0x0112] = 6  # 시계 방향 90도 회전해서 보여야 하는 사진
    out = decode_image(_encode(arr, exif=exif.tobytes()))
    assert out.shape == (200, 100, 3)
    assert out[:80].mean() > 200  # 왼쪽이 위로 간다
    assert out[120:].mean() < 50


def test_grayscale_and_rgba_become_rgb():
    gray = _encode(np.full((80, 80), 128, np.uint8), "PNG")
    rgba = _encode(np.full((80, 80, 4), 200, np.uint8), "PNG")
    assert decode_image(gray).shape == (80, 80, 3)
    assert decode_image(rgba).shape == (80, 80, 3)


def test_garbage_bytes_raise_invalid_image():
    with pytest.raises(InvalidImage):
        decode_image(b"not an image")


def test_too_many_pixels_rejected_before_decoding(monkeypatch):
    monkeypatch.setattr("pv.preprocess.MAX_PIXELS", 100 * 100)
    with pytest.raises(InvalidImage):
        decode_image(_encode(np.zeros((200, 200, 3), np.uint8)))


def test_too_small_rejected():
    with pytest.raises(InvalidImage):
        decode_image(_encode(np.zeros((32, 32, 3), np.uint8)))


@pytest.mark.parametrize("shape", [(480, 640, 3), (1000, 300, 3), (224, 224, 3)])
def test_global_input_is_center_square(shape):
    assert to_global_input(np.zeros(shape, np.uint8)).shape == (224, 224, 3)


def test_local_input_limits_long_side():
    assert max(to_local_input(np.zeros((3000, 4000, 3), np.uint8)).shape[:2]) == 1024
    small = np.zeros((300, 400, 3), np.uint8)
    assert to_local_input(small).shape == small.shape


def test_quality_flags():
    scene = make_scene(1)
    assert check_quality(scene) is None
    assert check_quality(np.zeros_like(scene)) == "DARK"
    assert check_quality(np.full_like(scene, 255)) == "BRIGHT"
    assert check_quality(cv2.GaussianBlur(scene, (0, 0), 12)) == "BLUR"
