"""특징점 추출·매칭과 MAGSAC++ 기본 행렬 기하 검증."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

import cv2
import numpy as np
import torch

MIN_POINTS = 8


@dataclass
class LocalFeatures:
    keypoints: np.ndarray
    descriptors: np.ndarray
    image_size: np.ndarray


class LocalMatcher(Protocol):
    name: str
    max_kp: int

    def extract(self, image: np.ndarray) -> LocalFeatures: ...

    def match(self, a: LocalFeatures, b: LocalFeatures) -> np.ndarray: ...


def _empty(image: np.ndarray, dim: int) -> LocalFeatures:
    return LocalFeatures(np.zeros((0, 2), np.float32), np.zeros((0, dim), np.float32),
                         np.float32([image.shape[1], image.shape[0]]))


def count_inliers(pts0: np.ndarray, pts1: np.ndarray, thresh_px: float = 3.0) -> int:
    if len(pts0) < MIN_POINTS:
        return 0
    try:
        _, mask = cv2.findFundamentalMat(np.asarray(pts0, np.float64), np.asarray(pts1, np.float64),
                                         cv2.USAC_MAGSAC, thresh_px, 0.999, 10000)
    except cv2.error:
        # 흔들린 사진처럼 일치점이 적고 퇴화되면 MAGSAC이 모델 없이 예외를 던진다. 기하 검증 실패로 본다.
        return 0
    return 0 if mask is None else int(mask.ravel().astype(bool).sum())


def inliers_between(matcher: LocalMatcher, a: LocalFeatures, b: LocalFeatures) -> int:
    if len(a.keypoints) == 0 or len(b.keypoints) == 0:
        return 0
    m = matcher.match(a, b)
    if len(m) == 0:
        return 0
    return count_inliers(a.keypoints[m[:, 0]], b.keypoints[m[:, 1]])


class SiftMatcher:
    name = "sift"

    def __init__(self, max_kp: int = 1024, ratio: float = 0.75):
        self.max_kp = max_kp
        self.sift = cv2.SIFT_create(nfeatures=max_kp)
        self.ratio = ratio
        self.bf = cv2.BFMatcher(cv2.NORM_L2)

    def extract(self, image: np.ndarray) -> LocalFeatures:
        gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
        kps, desc = self.sift.detectAndCompute(gray, None)
        if desc is None or len(kps) == 0:
            return _empty(image, 128)
        return LocalFeatures(np.float32([k.pt for k in kps]), desc.astype(np.float32),
                             np.float32([image.shape[1], image.shape[0]]))

    def match(self, a: LocalFeatures, b: LocalFeatures) -> np.ndarray:
        if len(a.descriptors) < 2 or len(b.descriptors) < 2:
            return np.zeros((0, 2), np.int64)
        good = []
        for pair in self.bf.knnMatch(a.descriptors, b.descriptors, k=2):
            if len(pair) == 2 and pair[0].distance < self.ratio * pair[1].distance:
                good.append((pair[0].queryIdx, pair[0].trainIdx))
        return np.array(good, dtype=np.int64).reshape(-1, 2)


class LightGlueMatcher:
    def __init__(self, features: str = "aliked", max_kp: int = 1024):
        from lightglue import ALIKED, LightGlue, SuperPoint

        extractors = {"aliked": ALIKED, "superpoint": SuperPoint}
        self.name = features
        self.max_kp = max_kp
        self.extractor = extractors[features](max_num_keypoints=max_kp).eval()
        self.matcher = LightGlue(features=features).eval()

    @torch.inference_mode()
    def extract(self, image: np.ndarray) -> LocalFeatures:
        t = torch.from_numpy(image).permute(2, 0, 1).float() / 255.0
        f = self.extractor.extract(t, resize=None)
        return LocalFeatures(f["keypoints"][0].numpy().astype(np.float32),
                             f["descriptors"][0].numpy().astype(np.float32),
                             f["image_size"][0].numpy().astype(np.float32))

    @torch.inference_mode()
    def match(self, a: LocalFeatures, b: LocalFeatures) -> np.ndarray:
        def pack(f: LocalFeatures) -> dict:
            return {"keypoints": torch.from_numpy(f.keypoints)[None],
                    "descriptors": torch.from_numpy(f.descriptors)[None],
                    "image_size": torch.from_numpy(f.image_size)[None]}

        out = self.matcher({"image0": pack(a), "image1": pack(b)})
        return out["matches"][0].numpy().astype(np.int64).reshape(-1, 2)


def make_matcher(name: str, max_kp: int = 1024) -> LocalMatcher:
    if name == "sift":
        return SiftMatcher(max_kp)
    if name in ("aliked", "superpoint"):
        return LightGlueMatcher(name, max_kp)
    raise KeyError(f"unknown matcher: {name}")
