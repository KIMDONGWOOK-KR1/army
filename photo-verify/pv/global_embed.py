"""전역 임베딩 백본. 모두 224×224 RGB uint8을 받아 L2 정규화된 float32 벡터를 낸다."""
from __future__ import annotations

from typing import Callable, Protocol

import numpy as np
import torch

IMAGENET_MEAN = (0.485, 0.456, 0.406)
IMAGENET_STD = (0.229, 0.224, 0.225)


class GlobalEmbedder(Protocol):
    name: str

    def embed(self, images: list[np.ndarray]) -> np.ndarray: ...


def gem(tokens: torch.Tensor, p: float = 3.0, eps: float = 1e-6) -> torch.Tensor:
    """(B, N, D) 패치 토큰 → (B, D). p=1이면 평균, p가 커지면 최댓값에 가까워진다."""
    return tokens.clamp(min=eps).pow(p).mean(dim=1).pow(1.0 / p)


def l2_normalize(x: np.ndarray) -> np.ndarray:
    norm = np.linalg.norm(x, axis=1, keepdims=True)
    return (x / np.maximum(norm, 1e-12)).astype(np.float32)


def to_tensor(images: list[np.ndarray], mean=IMAGENET_MEAN, std=IMAGENET_STD) -> torch.Tensor:
    x = torch.from_numpy(np.stack(images)).permute(0, 3, 1, 2).float() / 255.0
    m = torch.tensor(mean).view(1, 3, 1, 1)
    s = torch.tensor(std).view(1, 3, 1, 1)
    return (x - m) / s


POOLINGS = ("gem", "mean", "cls", "cls_mean")


def pool_tokens(feats: dict, pooling: str, p: float = 3.0) -> torch.Tensor:
    """DINOv2 forward_features 결과 → (B, D). LayerNorm된 패치 토큰은 부호가 있어 clamp형 GeM을 쓰면 값이 뭉개진다."""
    patch, cls = feats["x_norm_patchtokens"], feats["x_norm_clstoken"]
    if pooling == "gem":
        return gem(patch, p)
    if pooling == "mean":
        return patch.mean(dim=1)
    if pooling == "cls":
        return cls
    if pooling == "cls_mean":
        return torch.cat([cls, patch.mean(dim=1)], dim=1)
    raise ValueError(f"unknown pooling: {pooling}")


class DinoV2Embedder:
    def __init__(self, variant: str = "dinov2_vitb14", pooling: str = "gem", p: float = 3.0):
        if pooling not in POOLINGS:
            raise ValueError(f"unknown pooling: {pooling}")
        self.name = variant
        self.pooling = pooling
        self.p = p
        self.model = torch.hub.load("facebookresearch/dinov2", variant,
                                    trust_repo=True, skip_validation=True).eval()

    @torch.inference_mode()
    def embed(self, images: list[np.ndarray]) -> np.ndarray:
        feats = self.model.forward_features(to_tensor(images))
        return l2_normalize(pool_tokens(feats, self.pooling, self.p).numpy())


class OpenClipEmbedder:
    """논문 비교용. `uv sync --extra eval`이 필요하다."""

    def __init__(self, name: str, arch: str, pretrained: str):
        import open_clip

        self.name = name
        self.model, _, self.preprocess = open_clip.create_model_and_transforms(arch, pretrained=pretrained)
        self.model.eval()

    @torch.inference_mode()
    def embed(self, images: list[np.ndarray]) -> np.ndarray:
        from PIL import Image

        x = torch.stack([self.preprocess(Image.fromarray(im)) for im in images])
        return l2_normalize(self.model.encode_image(x).float().numpy())


EMBEDDERS: dict[str, Callable[[], GlobalEmbedder]] = {
    "dinov2_vits14": lambda: DinoV2Embedder("dinov2_vits14"),
    "dinov2_vitb14": lambda: DinoV2Embedder("dinov2_vitb14"),
    "clip_vitb16": lambda: OpenClipEmbedder("clip_vitb16", "ViT-B-16", "openai"),
    "siglip_vitb16": lambda: OpenClipEmbedder("siglip_vitb16", "ViT-B-16-SigLIP", "webli"),
}


def make_embedder(name: str) -> GlobalEmbedder:
    if name not in EMBEDDERS:
        raise KeyError(f"unknown backbone: {name}")
    return EMBEDDERS[name]()
