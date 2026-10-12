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
def test_dinov2_prefers_same_scene():
    emb = make_embedder("dinov2_vits14")
    a = to_global_input(make_scene(1))
    b = to_global_input(warp_view(make_scene(1), seed=2, brightness=0.8))
    c = to_global_input(make_scene(9))
    v = emb.embed([a, b, c])
    assert v.shape == (3, 384)
    assert float(v[0] @ v[1]) > float(v[0] @ v[2])
