"""모델 가중치 없이 쓰는 테스트 대역."""
from __future__ import annotations

import io

import numpy as np
from PIL import Image

from pv.gallery import Gallery
from pv.global_embed import l2_normalize
from pv.preprocess import to_local_input


class FixedEmbedder:
    """모든 입력에 같은 벡터를 돌려준다. 1단계 점수를 테스트에서 직접 정할 때 쓴다."""

    def __init__(self, vec, name: str = "fake"):
        self.vec = l2_normalize(np.asarray(vec, np.float32)[None])[0]
        self.name = name
        self.calls = 0

    def embed(self, images):
        self.calls += 1
        return np.tile(self.vec, (len(images), 1))


class MeanColorEmbedder:
    def __init__(self, name: str = "fake"):
        self.name = name

    def embed(self, images):
        return l2_normalize(np.stack([im.reshape(-1, 3).mean(0) + 1.0 for im in images]))


class CountingMatcher:
    def __init__(self, inner):
        self.inner = inner
        self.name = inner.name
        self.extract_calls = 0
        self.match_calls = 0

    def extract(self, image):
        self.extract_calls += 1
        return self.inner.extract(image)

    def match(self, a, b):
        self.match_calls += 1
        return self.inner.match(a, b)


def jpeg_bytes(arr: np.ndarray) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(arr).save(buf, "JPEG", quality=95)
    return buf.getvalue()


def manual_gallery(site_id, refs, vecs, matcher, backbone: str = "fake") -> Gallery:
    vecs = l2_normalize(np.asarray(vecs, np.float32))
    return Gallery(site_id, backbone, matcher.name, vecs, np.arange(len(refs), dtype=np.int64),
                   [matcher.extract(to_local_input(r)) for r in refs])
