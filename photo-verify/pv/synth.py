"""테스트·벤치용 합성 장면. 실제 현장 사진을 대신하지 않는다."""
from __future__ import annotations

import cv2
import numpy as np


def make_scene(seed: int, width: int = 640, height: int = 480) -> np.ndarray:
    rng = np.random.default_rng(seed)
    base = rng.integers(0, 256, (height // 8, width // 8, 3), dtype=np.uint8)
    img = cv2.resize(base, (width, height), interpolation=cv2.INTER_CUBIC)
    for _ in range(40):
        color = tuple(int(c) for c in rng.integers(0, 256, 3))
        x0, y0 = int(rng.integers(0, width)), int(rng.integers(0, height))
        kind = int(rng.integers(0, 3))
        if kind == 0:
            x1, y1 = x0 + int(rng.integers(10, 120)), y0 + int(rng.integers(10, 120))
            cv2.rectangle(img, (x0, y0), (x1, y1), color, -1)
        elif kind == 1:
            cv2.circle(img, (x0, y0), int(rng.integers(5, 50)), color, -1)
        else:
            text = str(int(rng.integers(0, 10**6)))
            scale = float(rng.uniform(0.5, 2.0))
            cv2.putText(img, text, (x0, y0), cv2.FONT_HERSHEY_SIMPLEX, scale, color, 2)
    return img


def warp_view(img: np.ndarray, seed: int, strength: float = 0.08,
              brightness: float = 1.0) -> np.ndarray:
    """네 꼭짓점을 흔든 원근 변환과 밝기 변화로 다른 시점을 흉내 낸다."""
    rng = np.random.default_rng(seed)
    h, w = img.shape[:2]
    src = np.float32([[0, 0], [w, 0], [w, h], [0, h]])
    jitter = rng.uniform(-strength, strength, (4, 2)) * np.float32([w, h])
    dst = (src + jitter).astype(np.float32)
    homography = cv2.getPerspectiveTransform(src, dst)
    out = cv2.warpPerspective(img, homography, (w, h), borderMode=cv2.BORDER_REFLECT)
    return np.clip(out.astype(np.float32) * brightness, 0, 255).astype(np.uint8)
