import numpy as np
import pytest
import torch

from pv.global_embed import gem, l2_normalize, make_embedder, to_tensor
from pv.preprocess import to_global_input
from pv.synth import make_scene, warp_view


def test_gem_p1_is_mean_of_clamped_tokens():
    x = torch.tensor([[[1.0, -2.0], [3.0, 4.0]]])
    out = gem(x, p=1.0)
    assert torch.allclose(out, torch.tensor([[2.0, (1e-6 + 4.0) / 2]]))


def test_gem_large_p_approaches_max():
    x = torch.rand(1, 50, 8) + 0.1
    assert torch.allclose(gem(x, p=200.0), x.max(dim=1).values, rtol=0.05)


def test_l2_normalize_unit_norm_and_zero_safe():
    out = l2_normalize(np.array([[3.0, 4.0], [0.0, 0.0]]))
    assert out.dtype == np.float32
    assert np.allclose(out[0], [0.6, 0.8]) and np.allclose(out[1], [0.0, 0.0])


def test_to_tensor_shape_and_normalization():
    x = to_tensor([np.full((224, 224, 3), 255, np.uint8)])
    assert x.shape == (1, 3, 224, 224)
    assert torch.allclose(x[0, 0, 0, 0], torch.tensor((1 - 0.485) / 0.229))


def test_unknown_backbone_raises():
    with pytest.raises(KeyError):
        make_embedder("nope")


@pytest.mark.model
def test_dinov2_embedding_sanity():
    emb = make_embedder("dinov2_vits14")
    a = to_global_input(make_scene(1))
    b = to_global_input(np.clip(make_scene(1).astype(np.float32) * 0.9, 0, 255).astype(np.uint8))
    stripes = np.zeros((480, 640, 3), np.uint8)
    for band in range(0, 480, 16):
        if (band // 16) % 2 == 1:
            stripes[band:band + 16] = 255
    c = to_global_input(stripes)
    v = emb.embed([a, b, c])
    assert v.shape == (3, 384)
    assert np.allclose(np.linalg.norm(v, axis=1), 1.0, atol=1e-5)
    assert np.allclose(emb.embed([a])[0], v[0], atol=1e-5)
    assert float(v[0] @ v[1]) > 0.95
    assert float(v[0] @ v[1]) > float(v[0] @ v[2])


def test_unknown_pooling_rejected():
    from pv.global_embed import pool_tokens

    feats = {"x_norm_patchtokens": torch.rand(1, 4, 8), "x_norm_clstoken": torch.rand(1, 8)}
    with pytest.raises(ValueError):
        pool_tokens(feats, "nope", 3.0)


def test_pooling_ablation_backbones_registered():
    from pv.global_embed import EMBEDDERS, dinov2_name
    for v in ("dinov2_vits14", "dinov2_vitb14"):
        for pool in ("mean", "cls", "cls_mean"):
            assert f"{v}_{pool}" in EMBEDDERS
        assert v in EMBEDDERS
    assert dinov2_name("dinov2_vitb14", "gem") == "dinov2_vitb14"
    assert dinov2_name("dinov2_vits14", "cls_mean") == "dinov2_vits14_cls_mean"


def test_registry_entries_build_their_own_variant_and_pooling(monkeypatch):
    seen = []
    monkeypatch.setattr(torch.hub, "load", lambda repo, variant, **kw: seen.append(variant) or torch.nn.Identity())
    e = make_embedder("dinov2_vits14_cls")
    assert (e.name, e.pooling, seen) == ("dinov2_vits14_cls", "cls", ["dinov2_vits14"])
    assert make_embedder("dinov2_vitb14").pooling == "gem"
