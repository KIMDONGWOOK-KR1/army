"""이미지 디코딩·EXIF 보정·크기 조정·품질 검사. 픽셀 배열만 남기므로 메타데이터는 버려진다."""
from __future__ import annotations

import io
from dataclasses import dataclass

import cv2
import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError

MAX_PIXELS = 40_000_000
MIN_SIDE = 64
GLOBAL_SIZE = 224
# 2단계(국소 특징점) 입력의 긴 변. 1024→640에서 ALIKED 추출이 약 2.0→0.8초로 준다(docs/LATENCY.md).
LOCAL_LONG_SIDE = 640
# 해상도 항목이 없는 예전 thresholds.json·갤러리가 쓰던 값
LEGACY_LOCAL_LONG_SIDE = 1024
# 품질 검사 해상도. 라플라시안 분산은 해상도에 따라 달라지므로 2단계 해상도와 무관하게 고정한다.
QUALITY_LONG_SIDE = 1024


class InvalidImage(ValueError):
    """디코딩할 수 없거나 허용 범위를 벗어난 이미지."""


def decode_image(data: bytes) -> np.ndarray:
    try:
        with Image.open(io.BytesIO(data)) as im:
            if im.width * im.height > MAX_PIXELS:
                raise InvalidImage("too many pixels")
            if min(im.width, im.height) < MIN_SIDE:
                raise InvalidImage("too small")
            rgb = ImageOps.exif_transpose(im).convert("RGB")
            return np.asarray(rgb, dtype=np.uint8).copy()
    except InvalidImage:
        raise
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as exc:
        raise InvalidImage("cannot decode") from exc


def to_global_input(img: np.ndarray, size: int = GLOBAL_SIZE) -> np.ndarray:
    """짧은 변을 size로 맞춘 뒤 가운데를 정사각형으로 자른다."""
    h, w = img.shape[:2]
    scale = size / min(h, w)
    nh, nw = max(size, round(h * scale)), max(size, round(w * scale))
    resized = cv2.resize(img, (nw, nh), interpolation=cv2.INTER_AREA)
    y0, x0 = (nh - size) // 2, (nw - size) // 2
    return np.ascontiguousarray(resized[y0:y0 + size, x0:x0 + size])


def to_local_input(img: np.ndarray, long_side: int = LOCAL_LONG_SIDE) -> np.ndarray:
    h, w = img.shape[:2]
    scale = long_side / max(h, w)
    if scale >= 1.0:
        return img
    return cv2.resize(img, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA)


@dataclass(frozen=True)
class QualityConfig:
    blur_var_min: float = 60.0
    brightness_min: float = 25.0
    brightness_max: float = 235.0


def check_quality(img: np.ndarray, cfg: QualityConfig = QualityConfig()) -> str | None:
    gray = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)
    mean = float(gray.mean())
    if mean < cfg.brightness_min:
        return "DARK"
    if mean > cfg.brightness_max:
        return "BRIGHT"
    if float(cv2.Laplacian(gray, cv2.CV_64F).var()) < cfg.blur_var_min:
        return "BLUR"
    return None
