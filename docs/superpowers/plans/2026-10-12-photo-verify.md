# 현장 사진 판정(Photo Verify) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기준 사진과 참가자 사진이 같은 장소·대상인지 판정하는 2단계 하이브리드 판정기, 논문용 평가 도구, FastAPI 추론 서버 시제품을 `photo-verify/`에 만든다.

**Architecture:** 전처리·품질 검사 → DINOv2+GeM 전역 유사도 `s_g` → (낮으면 조기 거절) → 상위 k개 기준 사진과 ALIKED+LightGlue 매칭 + MAGSAC++ inlier `n`(순차 조기 종료) → 거점별 임계값으로 판정한다. 판정 규칙(`pv/scorer.py`의 `decide`)은 운영 서버와 평가 도구가 함께 쓴다. 평가 도구는 모든 기준 사진에 대한 특징을 한 번 계산해 두고, 비교 실험(전역만·국소만·결합, 조기 종료 방식)을 시뮬레이션한다.

**Tech Stack:** Python 3.11, uv, PyTorch(CPU), DINOv2(torch.hub), LightGlue·ALIKED(git), OpenCV, scikit-learn, FastAPI·uvicorn, pytest, Docker. 논문 비교용으로 open_clip(CLIP·SigLIP)을 쓰고, 조건부로 onnxruntime을 쓴다.

**Spec:** [`docs/superpowers/specs/2026-10-12-photo-verify-design.md`](../specs/2026-10-12-photo-verify-design.md)

## Global Constraints

- Python `>=3.11,<3.13`이고 uv로 관리한다. torch·torchvision은 `https://download.pytorch.org/whl/cpu` 인덱스에서 받는다.
- 실제 기준 사진, 갤러리(`*.npz`), `thresholds.json`, 평가 사진, 평가 결과는 루트 `.gitignore`의 `/private/` 아래 `private/photo-verify/`에만 둔다. 커밋하지 않는다.
- 저장소에는 코드와 합성 이미지 테스트만 둔다. `pv/demo_data.py`가 만드는 합성 `demo` 거점은 실제 정답이 아니다.
- `/verify` 성공 응답 필드는 `match`, `score`, `reason_code`(`MATCH`/`NO_MATCH`/`RETAKE`), `latency_ms` 네 개뿐이다. 기준 사진 ID·특징·임계값·`s_g`·`n`은 응답에 넣지 않는다.
- 오류 응답은 `{"error": "<CODE>"}`이다. 400(`INVALID_IMAGE`, `TOO_LARGE`), 401(`UNAUTHORIZED`), 404(`UNKNOWN_SITE`), 503(`NOT_READY`, `TIMEOUT`, `MODEL_ERROR`)를 쓴다.
- 참가자 사진은 디스크에 쓰지 않는다. 업로드 상한은 10MB(`PV_MAX_BYTES`), 처리 제한 시간은 8초(`PV_TIMEOUT_S`, Cloud Run 요청 제한 10초보다 짧게)다.
- 앱 기본 모델은 `dinov2_vitb14` + `aliked`, `top_k=3`, 특징점 최대 1024개다. `superpoint`는 비상업 라이선스라 논문 비교 실험에만 쓴다.
- 조기 종료: 낮은 쪽 조기 거절은 기본으로 켜고, 통과는 항상 2단계를 거친다. 높은 쪽 조기 통과는 평가 두 fold 모두에서 오답 조기 통과가 0건인 거점만 켠다.
- 성공 기준(FAR ≤ 1%에서 TAR ≥ 90%, CPU p95 ≤ 2초)은 가정이다. 실제로 측정하기 전에는 성능을 주장하지 않는다.
- 작업은 `main`을 추적하는 worktree에서 한다. 한국어 커밋 메시지 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`을 붙인다. 김동욱 PM 본인 작업이므로 Task마다 검증 후 `git push origin HEAD:main`한다.
- 모든 명령은 `photo-verify/` 디렉터리에서 실행한다(따로 적은 경우 제외).
- 스펙 6.3의 선택 기준선(비전 LLM 판정)과 9절 다음 단계(게임 연동)는 이번 계획에서 구현하지 않는다.

## Review Focus

- **큰 업로드가 디스크로 넘어가는 경우**: multipart `UploadFile`은 1MB를 넘으면 임시 파일로 spool된다. 그래서 `/verify`는 원시 본문(`Content-Type: image/jpeg`)과 `?site_id=`를 받아 메모리에서만 읽는다. 5MB 요청에서도 임시 파일 API가 호출되지 않아야 한다(Task 8 테스트).
- **전역 유사도가 아주 높은 다른 대상**: `s_g=1.0`이어도 다른 장면이면 2단계에서 거절되어야 한다(Task 7 테스트).
- **바이트는 작은데 픽셀이 매우 큰 이미지(decompression bomb)**: 메모리 폭발 없이 `INVALID_IMAGE`로 거절해야 한다(Task 2 테스트).
- **EXIF 회전된 세로 사진**: 매칭 전에 실제 방향으로 돌려야 한다(Task 2 테스트).
- **갤러리와 배포 모델 불일치**: 다른 백본·매처로 만든 갤러리를 읽으면, 엉뚱한 점수를 조용히 내지 말고 시작 단계에서 실패해야 한다(Task 7 테스트).

## 파일 구조

```
photo-verify/
  pyproject.toml, uv.lock, Dockerfile, .dockerignore, README.md
  pv/
    timing.py         지연 요약(p50/p95/mean)
    synth.py          합성 장면·시점 변환(테스트·벤치용)
    preprocess.py     디코딩·EXIF·크기·품질
    scorer.py         임계값 형식, 점수 결합, decide(조기 종료 포함)
    global_embed.py   전역 임베딩(DINOv2, CLIP, SigLIP)
    local_match.py    특징점 추출·매칭·MAGSAC inlier
    gallery.py        기준 갤러리 생성·저장·로드 CLI
    pipeline.py       compute_features(평가), Verifier(운영)
    service.py        FastAPI 앱
    calibrate.py      임계값 보정·지표
    evaldata.py       평가 매니페스트·fold
    evaluate.py       비교 실험 시뮬레이션·요약
    download_weights.py, demo_data.py, onnx_embed.py(조건부)
  eval/run_eval.py    평가 CLI·보고서
  bench/spike_latency.py, bench/bench_http.py
  docs/LATENCY.md, docs/LICENSES.md, docs/CAPTURE_GUIDE.md, docs/DEPLOY_CLOUD_RUN.md
  tests/fakes.py, tests/test_*.py
.github/workflows/photo-verify.yml
```

---

### Task 1: 프로젝트 골격과 CPU 지연 실측 스파이크

이 Task의 결과로 Cloud Run CPU 유지와 Modal GPU 전환 중 하나를 고른다. 측정 결과는 사용자에게 보고하고, 진행 여부를 확인받은 뒤 Task 2로 넘어간다.

**Files:**
- Create: `photo-verify/pyproject.toml`, `photo-verify/pv/__init__.py`, `photo-verify/pv/timing.py`, `photo-verify/pv/synth.py`, `photo-verify/bench/spike_latency.py`, `photo-verify/docs/LATENCY.md`, `photo-verify/docs/LICENSES.md`, `photo-verify/.gitignore`
- Test: `photo-verify/tests/test_timing.py`, `photo-verify/tests/test_synth.py`

**Interfaces:**
- Produces: `pv.timing.summarize_ms(samples: list[float]) -> dict[str, float]` (키 `p50`, `p95`, `mean`), `pv.synth.make_scene(seed: int, width: int = 640, height: int = 480) -> np.ndarray` (RGB uint8), `pv.synth.warp_view(img: np.ndarray, seed: int, strength: float = 0.08, brightness: float = 1.0) -> np.ndarray`

- [ ] **Step 1: 프로젝트 파일 작성**

`photo-verify/pyproject.toml`:

```toml
[project]
name = "photo-verify"
version = "0.1.0"
requires-python = ">=3.11,<3.13"
dependencies = [
  "numpy>=1.26,<3",
  "opencv-python>=4.9",
  "pillow>=10.3",
  "torch>=2.4",
  "torchvision>=0.19",
  "kornia>=0.7",
  "lightglue",
  "scikit-learn>=1.4",
  "fastapi>=0.115",
  "uvicorn>=0.30",
]

[project.optional-dependencies]
eval = ["matplotlib>=3.8", "open_clip_torch>=2.26"]
onnx = ["onnx>=1.16", "onnxruntime>=1.18"]

[dependency-groups]
dev = ["pytest>=8", "httpx>=0.27"]

[tool.uv]
package = false

[tool.uv.sources]
torch = { index = "pytorch-cpu" }
torchvision = { index = "pytorch-cpu" }
lightglue = { git = "https://github.com/cvg/LightGlue.git" }

[[tool.uv.index]]
name = "pytorch-cpu"
url = "https://download.pytorch.org/whl/cpu"
explicit = true

[tool.pytest.ini_options]
addopts = "-m 'not model'"
markers = ["model: 사전학습 가중치를 내려받아 실행하는 테스트"]
testpaths = ["tests"]
pythonpath = [".", "tests"]
```

`photo-verify/.gitignore`:

```
.venv/
__pycache__/
.pytest_cache/
*.onnx
```

`photo-verify/pv/__init__.py`는 빈 파일로 만든다.

- [ ] **Step 2: 실패하는 테스트 작성**

`photo-verify/tests/test_timing.py`:

```python
from pv.timing import summarize_ms


def test_summarize_ms_percentiles():
    out = summarize_ms([float(i) for i in range(1, 101)])
    assert out["p50"] == 50.0
    assert out["p95"] == 95.0
    assert out["mean"] == 50.5


def test_summarize_ms_single_value():
    assert summarize_ms([7.0]) == {"p50": 7.0, "p95": 7.0, "mean": 7.0}
```

`photo-verify/tests/test_synth.py`:

```python
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
```

- [ ] **Step 3: 의존성을 설치하고 실패를 확인**

Run: `uv sync --extra eval`
Expected: `.venv` 생성, `uv.lock` 생성. lightglue가 git commit으로 고정된다.

Run: `uv run pytest tests/test_timing.py tests/test_synth.py -v`
Expected: FAIL (`ModuleNotFoundError: No module named 'pv.timing'`)

- [ ] **Step 4: 구현**

`photo-verify/pv/timing.py`:

```python
"""지연 측정값 요약."""
from __future__ import annotations

import statistics


def summarize_ms(samples: list[float]) -> dict[str, float]:
    """밀리초 표본의 p50·p95·평균. 백분위는 최근접 순위(nearest-rank) 방식이다."""
    if not samples:
        raise ValueError("samples is empty")
    s = sorted(samples)

    def pct(p: float) -> float:
        idx = max(0, min(len(s) - 1, int(-(-p * len(s) // 100)) - 1))
        return s[idx]

    return {"p50": pct(50), "p95": pct(95), "mean": statistics.fmean(s)}
```

`photo-verify/pv/synth.py`:

```python
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
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `uv run pytest tests/test_timing.py tests/test_synth.py -v`
Expected: 4 passed

- [ ] **Step 6: 지연 스파이크 스크립트 작성**

`photo-verify/bench/spike_latency.py`:

```python
"""Task 1 지연 실측 스파이크. 파이프라인 구현 전에 모델 단계별 CPU 시간을 잰다.

사용: uv run python bench/spike_latency.py --runs 20 --threads 2
"""
from __future__ import annotations

import argparse
import os
import platform
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import torch  # noqa: E402
from lightglue import ALIKED, LightGlue  # noqa: E402

from pv.synth import make_scene, warp_view  # noqa: E402
from pv.timing import summarize_ms  # noqa: E402


def timed(fn, runs: int, warmup: int = 2) -> list[float]:
    for _ in range(warmup):
        fn()
    out = []
    for _ in range(runs):
        t = time.perf_counter()
        fn()
        out.append((time.perf_counter() - t) * 1000)
    return out


def row(name: str, samples: list[float]) -> str:
    s = summarize_ms(samples)
    return f"| {name} | {s['p50']:.0f} | {s['p95']:.0f} | {s['mean']:.0f} |"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", type=int, default=20)
    ap.add_argument("--threads", type=int, default=2)
    ap.add_argument("--kp", type=int, nargs="+", default=[512, 1024])
    args = ap.parse_args()
    torch.set_num_threads(args.threads)

    print(f"- CPU: {platform.processor()} / 논리 코어 {os.cpu_count()} / torch 스레드 {args.threads}")
    print(f"- torch {torch.__version__}, Python {platform.python_version()}, 반복 {args.runs}회")
    print("\n| 단계 | p50 ms | p95 ms | 평균 ms |\n|---|---|---|---|")

    with torch.inference_mode():
        x = torch.rand(1, 3, 224, 224)
        for variant in ("dinov2_vits14", "dinov2_vitb14"):
            model = torch.hub.load("facebookresearch/dinov2", variant, trust_repo=True).eval()
            print(row(f"{variant} 224px", timed(lambda: model.forward_features(x), args.runs)))

        scene = make_scene(0, 1024, 768)
        other = warp_view(scene, seed=1)
        t0 = torch.from_numpy(scene).permute(2, 0, 1).float() / 255.0
        t1 = torch.from_numpy(other).permute(2, 0, 1).float() / 255.0
        matcher = LightGlue(features="aliked").eval()
        for kp in args.kp:
            extractor = ALIKED(max_num_keypoints=kp).eval()
            f0 = extractor.extract(t0, resize=None)
            f1 = extractor.extract(t1, resize=None)
            print(row(f"ALIKED 추출 kp={kp}", timed(lambda: extractor.extract(t0, resize=None), args.runs)))
            print(row(f"LightGlue 1쌍 kp={kp}",
                      timed(lambda: matcher({"image0": f0, "image1": f1}), args.runs)))


if __name__ == "__main__":
    main()
```

- [ ] **Step 7: 실측 실행**

Run: `uv run python bench/spike_latency.py --runs 20 --threads 2`
Expected: 첫 실행에서 DINOv2·ALIKED·LightGlue 가중치를 내려받는다. 단계별 p50/p95 표가 출력된다.

- [ ] **Step 8: 결과 기록과 판정**

`photo-verify/docs/LATENCY.md`에 출력 그대로의 표와 측정 환경을 적고, 아래 계산을 덧붙인다.

```markdown
# CPU 지연 실측

## Task 1 스파이크 (YYYY-MM-DD, 측정자)

(spike_latency.py 출력 붙여넣기)

### 판정 1건 최악 경로 추정
- 계산: DINOv2-B p95 + ALIKED 추출 p95 + LightGlue 1쌍 p95 × 3 (top_k=3, 조기 종료 없음)
- kp=1024: ___ ms / kp=512: ___ ms
- 판정: 2,000ms 이하이면 CPU(Cloud Run) 유지. 넘으면 kp 512, 백본 S, ONNX(Task 12), Modal 중 무엇을 쓸지 사용자에게 묻는다.

### 한계
- 합성 장면이라 실제 사진과 특징점 분포가 다르다. 최종 지연은 Task 11의 HTTP 실측과 Task 10의 평가셋 지연으로 다시 잰다.
```

빈칸은 측정값으로 채운다. 측정 전에는 수치를 적지 않는다.

- [ ] **Step 9: 라이선스 확인 기록**

아래 저장소의 LICENSE와 가중치 안내를 직접 열어 확인하고, `photo-verify/docs/LICENSES.md`에 표로 적는다. 확인하지 못한 항목은 "미확인"으로 둔다.

```markdown
# 모델·라이브러리 라이선스 확인

| 구성 | 코드 라이선스 | 가중치 라이선스 | 확인한 곳 | 확인일 | 앱 사용 |
|---|---|---|---|---|---|
| DINOv2 | | | https://github.com/facebookresearch/dinov2 | | |
| LightGlue | | | https://github.com/cvg/LightGlue | | |
| ALIKED | | | https://github.com/Shiaoming/ALIKED | | |
| SuperPoint | | | https://github.com/magicleap/SuperPointPretrainedNetwork | | 논문 비교만 |
| open_clip (CLIP, SigLIP) | | | https://github.com/mlfoundations/open_clip | | 논문 비교만 |
```

- [ ] **Step 10: 커밋·푸시하고 사용자에게 보고**

```bash
git add photo-verify/pyproject.toml photo-verify/uv.lock photo-verify/.gitignore photo-verify/pv/__init__.py photo-verify/pv/timing.py photo-verify/pv/synth.py photo-verify/bench/spike_latency.py photo-verify/docs/LATENCY.md photo-verify/docs/LICENSES.md photo-verify/tests/test_timing.py photo-verify/tests/test_synth.py
git commit -m "feat: 사진 판정 프로젝트 골격과 CPU 지연 실측 추가" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin HEAD:main
```

`LATENCY.md`의 판정과 표를 사용자에게 보고한다. 2,000ms를 넘으면 진행 방식을 물어보고 답을 받은 뒤 Task 2로 넘어간다.

---

### Task 2: 전처리와 품질 검사

**Files:**
- Create: `photo-verify/pv/preprocess.py`
- Test: `photo-verify/tests/test_preprocess.py`
- Modify: `docs/superpowers/specs/2026-10-12-photo-verify-design.md` 4.1절

**Interfaces:**
- Consumes: `pv.synth.make_scene`
- Produces: `InvalidImage(ValueError)`, `MAX_PIXELS = 40_000_000`, `MIN_SIDE = 64`, `decode_image(data: bytes) -> np.ndarray` (EXIF 회전 반영 RGB uint8), `to_global_input(img, size=224) -> np.ndarray` (224×224×3), `to_local_input(img, long_side=1024) -> np.ndarray`, `QualityConfig(blur_var_min=60.0, brightness_min=25.0, brightness_max=235.0)`, `check_quality(img, cfg=QualityConfig()) -> str | None` (`"DARK"`/`"BRIGHT"`/`"BLUR"`/`None`)

- [ ] **Step 1: 실패하는 테스트 작성**

`photo-verify/tests/test_preprocess.py`:

```python
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
```

- [ ] **Step 2: 실패 확인**

Run: `uv run pytest tests/test_preprocess.py -v`
Expected: FAIL (`ModuleNotFoundError: No module named 'pv.preprocess'`)

- [ ] **Step 3: 구현**

`photo-verify/pv/preprocess.py`:

```python
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
LOCAL_LONG_SIDE = 1024


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
```

- [ ] **Step 4: 통과 확인**

Run: `uv run pytest tests/test_preprocess.py -v`
Expected: 10 passed

- [ ] **Step 5: 스펙 4.1절 동기화**

`docs/superpowers/specs/2026-10-12-photo-verify-design.md` 4.1절의 "전역 단계는 짧은 변을 224px로 맞추고"를 아래로 바꾼다.

```markdown
- 전역 단계는 짧은 변을 224px로 맞춘 뒤 가운데 224×224를 자른다(백본 간 입력 통일, ONNX 고정 입력). 국소 단계는 긴 변을 1024px 이하로 줄인다.
- 픽셀 수가 4천만을 넘거나 짧은 변이 64px 미만이면 디코딩 전에 `INVALID_IMAGE`로 거절한다. 품질 기본값은 흐림 하한 60, 밝기 25~235이고 평가셋으로 조정한다.
```

- [ ] **Step 6: 커밋·푸시**

```bash
git add photo-verify/pv/preprocess.py photo-verify/tests/test_preprocess.py docs/superpowers/specs/2026-10-12-photo-verify-design.md
git commit -m "feat: 사진 판정 전처리와 품질 검사 추가" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin HEAD:main
```

---

### Task 3: 임계값 형식과 판정 규칙(조기 종료 포함)

**Files:**
- Create: `photo-verify/pv/scorer.py`
- Test: `photo-verify/tests/test_scorer.py`

**Interfaces:**
- Consumes: `pv.preprocess.QualityConfig`
- Produces:
  - `Mode = Literal["logistic", "rule"]`, `EarlyExit = Literal["none", "reject", "both"]`
  - `SiteThresholds(tau_reject: float, tau_n: int, mode: Mode = "rule", tau_low: float = 0.0, w_sg: float = 0.0, w_n: float = 0.0, bias: float = 0.0, tau_score: float = 0.5, early_accept: bool = False, tau_accept: float | None = None)` (frozen)
  - `ThresholdConfig(backbone: str, matcher: str, top_k: int, quality: QualityConfig, sites: dict[str, SiteThresholds], max_keypoints: int = 1024)`
  - `load_thresholds(path: Path) -> ThresholdConfig`, `save_thresholds(cfg: ThresholdConfig, path: Path) -> None`
  - `Decision(match: bool, score: float, reason_code: str, n: int | None, pairs_used: list[int])`
  - `fused_score(t, s_g, n) -> float`, `passes(t, s_g, n) -> bool`
  - `decide(t, s_g, ranked_refs: list[int], inliers_of: Callable[[int], int], top_k: int, early_exit: EarlyExit = "both") -> Decision`
- 의미: `early_exit="none"`은 조기 종료 없이 top_k를 모두 매칭한다. `"reject"`는 낮은 쪽 조기 거절과 순차 중단만 한다. `"both"`는 여기에 `t.early_accept`가 참인 거점의 조기 통과를 더한다. 조기 거절의 `score`는 `fused_score(t, s_g, 0)`, 조기 통과의 `score`는 1.0이다.

- [ ] **Step 1: 실패하는 테스트 작성**

`photo-verify/tests/test_scorer.py`:

```python
import pytest

from pv.preprocess import QualityConfig
from pv.scorer import (SiteThresholds, ThresholdConfig, decide, fused_score,
                       load_thresholds, passes, save_thresholds)

RULE = SiteThresholds(tau_reject=0.4, tau_n=20, mode="rule", tau_low=0.5)


def lookup(table):
    calls = []

    def inliers_of(ref):
        calls.append(ref)
        return table[ref]
    return inliers_of, calls


def never(ref):
    raise AssertionError("2단계가 실행되면 안 된다")


def test_low_similarity_is_rejected_without_stage2():
    d = decide(RULE, 0.3, [0, 1, 2], never, top_k=3, early_exit="reject")
    assert (d.match, d.reason_code, d.pairs_used, d.n) == (False, "NO_MATCH", [], None)


def test_none_mode_runs_stage2_even_when_low():
    fn, calls = lookup({0: 1, 1: 2, 2: 3})
    d = decide(RULE, 0.3, [0, 1, 2], fn, top_k=3, early_exit="none")
    assert calls == [0, 1, 2] and d.n == 3 and not d.match


def test_sequential_stop_after_enough_inliers():
    fn, calls = lookup({0: 50, 1: 99, 2: 99})
    d = decide(RULE, 0.9, [0, 1, 2], fn, top_k=3, early_exit="reject")
    assert calls == [0] and d.match and d.n == 50


def test_continues_until_threshold_reached():
    fn, calls = lookup({0: 5, 1: 30, 2: 99})
    d = decide(RULE, 0.9, [0, 1, 2], fn, top_k=3)
    assert calls == [0, 1] and d.n == 30 and d.match


def test_top_k_limits_pairs():
    fn, calls = lookup({0: 1, 1: 1, 2: 1, 3: 99})
    d = decide(RULE, 0.9, [0, 1, 2, 3], fn, top_k=3)
    assert calls == [0, 1, 2] and not d.match


def test_high_similarity_alone_never_passes_by_default():
    fn, _ = lookup({0: 3})
    d = decide(RULE, 0.99, [0], fn, top_k=1)
    assert not d.match and d.pairs_used == [0]


def test_early_accept_requires_flag_and_mode():
    t = SiteThresholds(tau_reject=0.4, tau_n=20, tau_low=0.5, early_accept=True, tau_accept=0.95)
    d = decide(t, 0.97, [0], never, top_k=1, early_exit="both")
    assert d.match and d.pairs_used == [] and d.score == 1.0
    fn, calls = lookup({0: 0})
    assert not decide(t, 0.97, [0], fn, top_k=1, early_exit="reject").match and calls == [0]
    off = SiteThresholds(tau_reject=0.4, tau_n=20, tau_low=0.5, early_accept=False, tau_accept=0.95)
    fn2, calls2 = lookup({0: 0})
    assert not decide(off, 0.97, [0], fn2, top_k=1, early_exit="both").match and calls2 == [0]


def test_rule_needs_both_conditions():
    assert passes(RULE, 0.6, 20)
    assert not passes(RULE, 0.45, 100)
    assert not passes(RULE, 0.9, 19)


def test_logistic_score_is_stable_for_extremes():
    t = SiteThresholds(tau_reject=0.0, tau_n=10, mode="logistic", w_sg=10, w_n=2, bias=-10, tau_score=0.5)
    assert fused_score(t, 0.0, 0) == pytest.approx(0.0, abs=1e-4)
    big_negative = SiteThresholds(tau_reject=0.0, tau_n=10, mode="logistic", bias=-1000)
    assert fused_score(big_negative, 0.0, 0) < 1e-300  # 넘침 예외 없이 0에 가깝다
    assert passes(t, 1.0, 100)


def test_thresholds_roundtrip(tmp_path):
    cfg = ThresholdConfig(backbone="dinov2_vitb14", matcher="aliked", top_k=3,
                          quality=QualityConfig(blur_var_min=50.0),
                          sites={"gate": RULE}, max_keypoints=512)
    path = tmp_path / "thresholds.json"
    save_thresholds(cfg, path)
    assert load_thresholds(path) == cfg


def test_unknown_version_rejected(tmp_path):
    path = tmp_path / "t.json"
    path.write_text('{"version": 2}', encoding="utf-8")
    with pytest.raises(ValueError):
        load_thresholds(path)
```

- [ ] **Step 2: 실패 확인**

Run: `uv run pytest tests/test_scorer.py -v`
Expected: FAIL (`ModuleNotFoundError: No module named 'pv.scorer'`)

- [ ] **Step 3: 구현**

`photo-verify/pv/scorer.py`:

```python
"""거점별 임계값 형식과 판정 규칙. 운영(Verifier)과 평가(evaluate)가 같은 decide를 쓴다."""
from __future__ import annotations

import json
import math
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Callable, Literal

from pv.preprocess import QualityConfig

Mode = Literal["logistic", "rule"]
EarlyExit = Literal["none", "reject", "both"]


@dataclass(frozen=True)
class SiteThresholds:
    tau_reject: float
    tau_n: int
    mode: Mode = "rule"
    tau_low: float = 0.0
    w_sg: float = 0.0
    w_n: float = 0.0
    bias: float = 0.0
    tau_score: float = 0.5
    early_accept: bool = False
    tau_accept: float | None = None


@dataclass(frozen=True)
class ThresholdConfig:
    backbone: str
    matcher: str
    top_k: int
    quality: QualityConfig
    sites: dict[str, SiteThresholds]
    max_keypoints: int = 1024


def load_thresholds(path: Path) -> ThresholdConfig:
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    if raw.get("version") != 1:
        raise ValueError("unsupported thresholds version")
    return ThresholdConfig(
        backbone=raw["backbone"], matcher=raw["matcher"], top_k=int(raw["top_k"]),
        quality=QualityConfig(**raw.get("quality", {})),
        sites={k: SiteThresholds(**v) for k, v in raw["sites"].items()},
        max_keypoints=int(raw.get("max_keypoints", 1024)),
    )


def save_thresholds(cfg: ThresholdConfig, path: Path) -> None:
    data = {
        "version": 1, "backbone": cfg.backbone, "matcher": cfg.matcher, "top_k": cfg.top_k,
        "max_keypoints": cfg.max_keypoints, "quality": asdict(cfg.quality),
        "sites": {k: asdict(v) for k, v in cfg.sites.items()},
    }
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


@dataclass(frozen=True)
class Decision:
    match: bool
    score: float
    reason_code: str
    n: int | None
    pairs_used: list[int]


def _sigmoid(z: float) -> float:
    if z >= 0:
        return 1.0 / (1.0 + math.exp(-z))
    e = math.exp(max(z, -745.0))
    return e / (1.0 + e)


def fused_score(t: SiteThresholds, s_g: float, n: int) -> float:
    if t.mode == "logistic":
        return _sigmoid(t.w_sg * s_g + t.w_n * math.log1p(n) + t.bias)
    return float(s_g)


def passes(t: SiteThresholds, s_g: float, n: int) -> bool:
    if t.mode == "logistic":
        return fused_score(t, s_g, n) >= t.tau_score
    return s_g >= t.tau_low and n >= t.tau_n


def decide(t: SiteThresholds, s_g: float, ranked_refs: list[int],
           inliers_of: Callable[[int], int], top_k: int,
           early_exit: EarlyExit = "both") -> Decision:
    if early_exit != "none" and s_g < t.tau_reject:
        return Decision(False, fused_score(t, s_g, 0), "NO_MATCH", None, [])
    if (early_exit == "both" and t.early_accept and t.tau_accept is not None
            and s_g >= t.tau_accept):
        return Decision(True, 1.0, "MATCH", None, [])
    used: list[int] = []
    n = 0
    for ref in ranked_refs[:top_k]:
        used.append(ref)
        n = max(n, int(inliers_of(ref)))
        if early_exit != "none" and n >= t.tau_n:
            break
    ok = passes(t, s_g, n)
    return Decision(ok, fused_score(t, s_g, n), "MATCH" if ok else "NO_MATCH", n, used)
```

- [ ] **Step 4: 통과 확인**

Run: `uv run pytest tests/test_scorer.py -v`
Expected: 11 passed

- [ ] **Step 5: 커밋·푸시**

```bash
git add photo-verify/pv/scorer.py photo-verify/tests/test_scorer.py
git commit -m "feat: 사진 판정 임계값 형식과 조기 종료 판정 규칙 추가" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin HEAD:main
```

---

### Task 4: 전역 임베딩

**Files:**
- Create: `photo-verify/pv/global_embed.py`
- Test: `photo-verify/tests/test_global_embed.py`

**Interfaces:**
- Produces: `GlobalEmbedder` Protocol(`name: str`, `embed(images: list[np.ndarray]) -> np.ndarray` — 224×224 RGB uint8 목록 → `(B, D)` float32, L2 정규화), `gem(tokens: torch.Tensor, p: float = 3.0, eps: float = 1e-6) -> torch.Tensor`, `l2_normalize(x: np.ndarray) -> np.ndarray`, `to_tensor(images, mean=IMAGENET_MEAN, std=IMAGENET_STD) -> torch.Tensor`, `DinoV2Embedder(variant)`, `OpenClipEmbedder(name, arch, pretrained)`, `EMBEDDERS: dict[str, Callable]`, `make_embedder(name: str) -> GlobalEmbedder`
- 이름: `dinov2_vits14`, `dinov2_vitb14`, `clip_vitb16`, `siglip_vitb16`

- [ ] **Step 1: 실패하는 테스트 작성**

`photo-verify/tests/test_global_embed.py`:

```python
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
```

- [ ] **Step 2: 실패 확인**

Run: `uv run pytest tests/test_global_embed.py -v`
Expected: FAIL (`ModuleNotFoundError: No module named 'pv.global_embed'`)

- [ ] **Step 3: 구현**

`photo-verify/pv/global_embed.py`:

```python
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


class DinoV2Embedder:
    def __init__(self, variant: str = "dinov2_vitb14", p: float = 3.0):
        self.name = variant
        self.p = p
        self.model = torch.hub.load("facebookresearch/dinov2", variant,
                                    trust_repo=True, skip_validation=True).eval()

    @torch.inference_mode()
    def embed(self, images: list[np.ndarray]) -> np.ndarray:
        feats = self.model.forward_features(to_tensor(images))
        return l2_normalize(gem(feats["x_norm_patchtokens"], self.p).numpy())


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
```

- [ ] **Step 4: 통과 확인**

Run: `uv run pytest tests/test_global_embed.py -v`
Expected: 5 passed, 1 deselected

Run: `uv run pytest tests/test_global_embed.py -m model -v`
Expected: 1 passed. 실패하면 합성 장면이 DINOv2에 맞지 않는 것인지 확인하고 결과를 그대로 보고한다. 테스트를 약하게 고치지 않는다.

- [ ] **Step 5: 커밋·푸시**

```bash
git add photo-verify/pv/global_embed.py photo-verify/tests/test_global_embed.py
git commit -m "feat: DINOv2 GeM 전역 임베딩과 비교 백본 추가" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin HEAD:main
```

---

### Task 5: 국소 특징점 매칭과 기하 검증

**Files:**
- Create: `photo-verify/pv/local_match.py`
- Test: `photo-verify/tests/test_local_match.py`

**Interfaces:**
- Produces: `LocalFeatures(keypoints: (N,2) float32, descriptors: (N,D) float32, image_size: (2,) float32 [w,h])`, `LocalMatcher` Protocol(`name`, `extract(image) -> LocalFeatures`, `match(a, b) -> np.ndarray (K,2) int64`), `MIN_POINTS = 8`, `count_inliers(pts0, pts1, thresh_px=3.0) -> int`, `inliers_between(matcher, a, b) -> int`, `SiftMatcher(max_kp=1024, ratio=0.75)`(name `"sift"`), `LightGlueMatcher(features="aliked", max_kp=1024)`(name은 `"aliked"` 또는 `"superpoint"`), `make_matcher(name: str, max_kp: int = 1024) -> LocalMatcher`

- [ ] **Step 1: 실패하는 테스트 작성**

`photo-verify/tests/test_local_match.py`:

```python
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
```

- [ ] **Step 2: 실패 확인**

Run: `uv run pytest tests/test_local_match.py -v`
Expected: FAIL (`ModuleNotFoundError: No module named 'pv.local_match'`)

- [ ] **Step 3: 구현**

`photo-verify/pv/local_match.py`:

```python
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

    def extract(self, image: np.ndarray) -> LocalFeatures: ...

    def match(self, a: LocalFeatures, b: LocalFeatures) -> np.ndarray: ...


def _empty(image: np.ndarray, dim: int) -> LocalFeatures:
    return LocalFeatures(np.zeros((0, 2), np.float32), np.zeros((0, dim), np.float32),
                         np.float32([image.shape[1], image.shape[0]]))


def count_inliers(pts0: np.ndarray, pts1: np.ndarray, thresh_px: float = 3.0) -> int:
    if len(pts0) < MIN_POINTS:
        return 0
    _, mask = cv2.findFundamentalMat(np.asarray(pts0, np.float64), np.asarray(pts1, np.float64),
                                     cv2.USAC_MAGSAC, thresh_px, 0.999, 10000)
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
```

- [ ] **Step 4: 통과 확인**

Run: `uv run pytest tests/test_local_match.py -v`
Expected: 5 passed, 1 deselected

Run: `uv run pytest tests/test_local_match.py -m model -v`
Expected: 1 passed

- [ ] **Step 5: 커밋·푸시**

```bash
git add photo-verify/pv/local_match.py photo-verify/tests/test_local_match.py
git commit -m "feat: 특징점 매칭과 MAGSAC 기하 검증 추가" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin HEAD:main
```

---

### Task 6: 기준 갤러리 생성·저장·로드

**Files:**
- Create: `photo-verify/pv/gallery.py`, `photo-verify/tests/fakes.py`
- Test: `photo-verify/tests/test_gallery.py`

**Interfaces:**
- Consumes: `make_embedder`, `l2_normalize`, `make_matcher`, `LocalFeatures`, `decode_image`, `to_global_input`, `to_local_input`
- Produces: `Gallery(site_id, backbone, matcher, global_vecs: (M,D) float32, global_ref_idx: (M,) int64, local: list[LocalFeatures])` + `n_refs` 속성, `augment_views(img, seed=0, n_color=2, n_crop=2) -> list[np.ndarray]`, `build_gallery(site_id, refs: list[np.ndarray], embedder, matcher, augment=True, seed=0) -> Gallery`, `ref_scores(g, q: (D,)) -> (n_refs,) float32`, `save_gallery(g, path: Path)`, `load_gallery(path: Path) -> Gallery`, `load_ref_dir(d: Path, limit: int | None = None) -> list[np.ndarray]`
- CLI: `uv run python -m pv.gallery --refs <dir> --out <dir> --backbone dinov2_vitb14 --matcher aliked [--max-kp 1024] [--no-augment]`. refs 아래 하위 폴더 이름이 site_id다.
- 테스트 도구(`tests/fakes.py`): `FixedEmbedder(vec, name="fake")`, `MeanColorEmbedder(name="fake")`, `CountingMatcher(inner)`, `jpeg_bytes(arr) -> bytes`, `manual_gallery(site_id, refs, vecs, matcher, backbone="fake") -> Gallery`

- [ ] **Step 1: 테스트 도구와 실패하는 테스트 작성**

`photo-verify/tests/fakes.py`:

```python
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
```

`photo-verify/tests/test_gallery.py`:

```python
import numpy as np
import pytest

from fakes import MeanColorEmbedder, jpeg_bytes, manual_gallery
from pv.gallery import (augment_views, build_gallery, load_gallery,
                        load_ref_dir, ref_scores, save_gallery)
from pv.local_match import SiftMatcher
from pv.synth import make_scene


def test_build_with_augmentation_tracks_owners():
    g = build_gallery("gate", [make_scene(1), make_scene(2)], MeanColorEmbedder(), SiftMatcher())
    assert g.global_vecs.shape[0] == 10  # 기준 2장 × (원본 1 + 증강 4)
    assert g.global_ref_idx.tolist() == [0] * 5 + [1] * 5
    assert g.n_refs == 2 and g.backbone == "fake" and g.matcher == "sift"


def test_build_without_augmentation():
    g = build_gallery("gate", [make_scene(1)], MeanColorEmbedder(), SiftMatcher(), augment=False)
    assert g.global_vecs.shape[0] == 1


def test_empty_refs_rejected():
    with pytest.raises(ValueError):
        build_gallery("gate", [], MeanColorEmbedder(), SiftMatcher())


def test_augment_views_deterministic():
    img = make_scene(1)
    a, b = augment_views(img, seed=7), augment_views(img, seed=7)
    assert len(a) == 4 and all(np.array_equal(x, y) for x, y in zip(a, b))


def test_ref_scores_take_max_per_ref():
    m = SiftMatcher()
    g = manual_gallery("gate", [make_scene(1), make_scene(2)], [[1, 0], [0, 1]], m)
    scores = ref_scores(g, np.float32([0.6, 0.8]))
    assert np.allclose(scores, [0.6, 0.8])


def test_save_load_roundtrip(tmp_path):
    g = build_gallery("gate", [make_scene(1)], MeanColorEmbedder(), SiftMatcher())
    path = tmp_path / "gallery" / "gate.npz"
    save_gallery(g, path)
    h = load_gallery(path)
    assert (h.site_id, h.backbone, h.matcher, h.n_refs) == ("gate", "fake", "sift", 1)
    assert np.array_equal(h.global_vecs, g.global_vecs)
    assert np.array_equal(h.local[0].descriptors, g.local[0].descriptors)


def test_load_ref_dir_sorted_and_limited(tmp_path):
    for name, seed in (("b.jpg", 2), ("a.jpg", 1), ("c.txt", 3)):
        data = jpeg_bytes(make_scene(seed)) if name.endswith(".jpg") else b"x"
        (tmp_path / name).write_bytes(data)
    imgs = load_ref_dir(tmp_path)
    assert len(imgs) == 2
    assert len(load_ref_dir(tmp_path, limit=1)) == 1
```

- [ ] **Step 2: 실패 확인**

Run: `uv run pytest tests/test_gallery.py -v`
Expected: FAIL (`ModuleNotFoundError: No module named 'pv.gallery'`). `tests/`는 Task 1에서 `pythonpath`에 넣었으므로 `from fakes import ...`가 동작한다.

- [ ] **Step 3: 구현**

`photo-verify/pv/gallery.py`:

```python
"""거점별 기준 갤러리. 갤러리 파일은 정답이므로 private/photo-verify/gallery/에만 둔다."""
from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from pv.global_embed import GlobalEmbedder, make_embedder
from pv.local_match import LocalFeatures, LocalMatcher, make_matcher
from pv.preprocess import decode_image, to_global_input, to_local_input

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png"}


@dataclass
class Gallery:
    site_id: str
    backbone: str
    matcher: str
    global_vecs: np.ndarray
    global_ref_idx: np.ndarray
    local: list[LocalFeatures]

    @property
    def n_refs(self) -> int:
        return len(self.local)


def augment_views(img: np.ndarray, seed: int = 0, n_color: int = 2, n_crop: int = 2) -> list[np.ndarray]:
    """색상 변화와 무작위 crop. 좌우 반전은 글자·비대칭 구조를 바꾸므로 쓰지 않는다."""
    rng = np.random.default_rng(seed)
    out = []
    for _ in range(n_color):
        alpha, beta = rng.uniform(0.7, 1.3), rng.uniform(-25, 25)
        out.append(np.clip(img.astype(np.float32) * alpha + beta, 0, 255).astype(np.uint8))
    h, w = img.shape[:2]
    for _ in range(n_crop):
        s = rng.uniform(0.8, 0.95)
        ch, cw = int(h * s), int(w * s)
        y0, x0 = int(rng.integers(0, h - ch + 1)), int(rng.integers(0, w - cw + 1))
        out.append(np.ascontiguousarray(img[y0:y0 + ch, x0:x0 + cw]))
    return out


def build_gallery(site_id: str, refs: list[np.ndarray], embedder: GlobalEmbedder,
                  matcher: LocalMatcher, augment: bool = True, seed: int = 0) -> Gallery:
    if not refs:
        raise ValueError("no reference images")
    views, owners = [], []
    for i, img in enumerate(refs):
        vs = [img] + (augment_views(img, seed + i) if augment else [])
        views += [to_global_input(v) for v in vs]
        owners += [i] * len(vs)
    vecs = embedder.embed(views).astype(np.float32)
    local = [matcher.extract(to_local_input(img)) for img in refs]
    return Gallery(site_id, embedder.name, matcher.name, vecs, np.array(owners, np.int64), local)


def ref_scores(g: Gallery, q: np.ndarray) -> np.ndarray:
    sims = g.global_vecs @ np.asarray(q, np.float32)
    out = np.full(g.n_refs, -1.0, np.float32)
    np.maximum.at(out, g.global_ref_idx, sims.astype(np.float32))
    return out


def save_gallery(g: Gallery, path: Path) -> None:
    arrays = {"global_vecs": g.global_vecs, "global_ref_idx": g.global_ref_idx}
    for i, f in enumerate(g.local):
        arrays[f"kp_{i}"], arrays[f"desc_{i}"], arrays[f"size_{i}"] = f.keypoints, f.descriptors, f.image_size
    meta = json.dumps({"site_id": g.site_id, "backbone": g.backbone, "matcher": g.matcher, "n_refs": g.n_refs})
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(path, meta=np.array(meta), **arrays)


def load_gallery(path: Path) -> Gallery:
    with np.load(path, allow_pickle=False) as z:
        meta = json.loads(str(z["meta"]))
        local = [LocalFeatures(z[f"kp_{i}"], z[f"desc_{i}"], z[f"size_{i}"]) for i in range(meta["n_refs"])]
        return Gallery(meta["site_id"], meta["backbone"], meta["matcher"],
                       z["global_vecs"], z["global_ref_idx"], local)


def load_ref_dir(d: Path, limit: int | None = None) -> list[np.ndarray]:
    files = sorted(p for p in Path(d).iterdir() if p.suffix.lower() in IMAGE_SUFFIXES)
    if limit is not None:
        files = files[:limit]
    return [decode_image(p.read_bytes()) for p in files]


def main() -> None:
    ap = argparse.ArgumentParser(description="거점별 기준 갤러리 생성")
    ap.add_argument("--refs", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--backbone", default="dinov2_vitb14")
    ap.add_argument("--matcher", default="aliked")
    ap.add_argument("--max-kp", type=int, default=1024)
    ap.add_argument("--no-augment", action="store_true")
    args = ap.parse_args()
    embedder, matcher = make_embedder(args.backbone), make_matcher(args.matcher, args.max_kp)
    for site_dir in sorted(p for p in args.refs.iterdir() if p.is_dir()):
        g = build_gallery(site_dir.name, load_ref_dir(site_dir), embedder, matcher, augment=not args.no_augment)
        save_gallery(g, args.out / f"{site_dir.name}.npz")
        print(f"{site_dir.name}: 기준 {g.n_refs}장, 벡터 {len(g.global_vecs)}개")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: 통과 확인**

Run: `uv run pytest tests/test_gallery.py -v`
Expected: 7 passed

Run: `uv run pytest -v`
Expected: 지금까지의 테스트 모두 통과

- [ ] **Step 5: 커밋·푸시**

```bash
git add photo-verify/pv/gallery.py photo-verify/tests/fakes.py photo-verify/tests/test_gallery.py
git commit -m "feat: 거점별 기준 갤러리 생성과 저장 추가" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin HEAD:main
```

---

### Task 7: 판정 파이프라인

**Files:**
- Create: `photo-verify/pv/pipeline.py`
- Test: `photo-verify/tests/test_pipeline.py`

**Interfaces:**
- Consumes: `decode_image`, `to_global_input`, `to_local_input`, `check_quality`, `QualityConfig`, `Gallery`, `ref_scores`, `load_gallery`, `inliers_between`, `make_embedder`, `make_matcher`, `ThresholdConfig`, `decide`, `load_thresholds`, `EarlyExit`
- Produces:
  - `UnknownSite(KeyError)`
  - `VerifyResult(match: bool, score: float, reason_code: str, latency_ms: int)`
  - `Features(quality: str | None, s_g: float = 0.0, ranked_refs: list[int], inliers: dict[int, int], t_pre_ms: float, t_global_ms: float, t_extract_ms: float, t_pair_ms: dict[int, float])`
  - `compute_features(embedder, matcher, gallery, data: bytes, quality_cfg: QualityConfig, top_k: int, all_refs: bool = False) -> Features` (평가용, 조기 종료 없이 계산)
  - `Verifier(embedder, matcher, galleries: dict[str, Gallery], thresholds: ThresholdConfig)`, `Verifier.verify(site_id: str, data: bytes, early_exit: EarlyExit = "both") -> VerifyResult`, `Verifier.from_dir(data_dir: Path) -> Verifier` (`thresholds.json`, `gallery/<site>.npz`)
- 예외: 이미지 문제는 `InvalidImage`, 거점 문제는 `UnknownSite`. 생성자는 갤러리 누락이나 모델 불일치 시 `ValueError`.

- [ ] **Step 1: 실패하는 테스트 작성**

`photo-verify/tests/test_pipeline.py`:

```python
import numpy as np
import pytest

from fakes import CountingMatcher, FixedEmbedder, jpeg_bytes, manual_gallery
from pv.gallery import save_gallery
from pv.local_match import SiftMatcher
from pv.pipeline import UnknownSite, Verifier, compute_features
from pv.preprocess import InvalidImage, QualityConfig
from pv.scorer import SiteThresholds, ThresholdConfig, save_thresholds
from pv.synth import make_scene, warp_view

# SIFT는 다른 장면끼리도 우연한 일치점이 10개 안팎 나올 수 있어 tau_n을 25로 둔다.
RULE = SiteThresholds(tau_reject=0.5, tau_n=25, mode="rule", tau_low=0.5)


def setup(query_vec, refs=None, site=RULE):
    matcher = CountingMatcher(SiftMatcher())
    refs = refs or [make_scene(1)]
    g = manual_gallery("gate", refs, [[1.0, 0.0]] * len(refs), matcher, backbone="fake")
    matcher.extract_calls = 0
    cfg = ThresholdConfig("fake", "sift", 3, QualityConfig(), {"gate": site})
    return Verifier(FixedEmbedder(query_vec), matcher, {"gate": g}, cfg), matcher


def test_same_place_from_other_view_matches():
    v, _ = setup([1.0, 0.0])
    r = v.verify("gate", jpeg_bytes(warp_view(make_scene(1), seed=4, brightness=0.9)))
    assert (r.match, r.reason_code) == (True, "MATCH")
    assert r.latency_ms >= 0


def test_lookalike_with_perfect_global_score_is_rejected_by_stage2():
    v, m = setup([1.0, 0.0])  # s_g = 1.0
    r = v.verify("gate", jpeg_bytes(make_scene(2)))
    assert (r.match, r.reason_code) == (False, "NO_MATCH")
    assert m.extract_calls == 1  # 2단계를 실제로 거쳤다


def test_low_global_score_skips_stage2():
    v, m = setup([0.0, 1.0])  # s_g = 0.0
    r = v.verify("gate", jpeg_bytes(make_scene(1)))
    assert r.reason_code == "NO_MATCH" and m.extract_calls == 0


def test_dark_photo_asks_retake_without_models():
    v, m = setup([1.0, 0.0])
    r = v.verify("gate", jpeg_bytes(np.zeros((480, 640, 3), np.uint8)))
    assert (r.match, r.reason_code, r.score) == (False, "RETAKE", 0.0)
    assert v.embedder.calls == 0 and m.extract_calls == 0


def test_unknown_site_and_invalid_image():
    v, _ = setup([1.0, 0.0])
    with pytest.raises(UnknownSite):
        v.verify("nowhere", jpeg_bytes(make_scene(1)))
    with pytest.raises(InvalidImage):
        v.verify("gate", b"garbage")


def test_model_mismatch_fails_at_startup():
    matcher = SiftMatcher()
    g = manual_gallery("gate", [make_scene(1)], [[1.0, 0.0]], matcher, backbone="dinov2_vits14")
    cfg = ThresholdConfig("dinov2_vitb14", "sift", 3, QualityConfig(), {"gate": RULE})
    with pytest.raises(ValueError):
        Verifier(FixedEmbedder([1, 0], name="dinov2_vitb14"), matcher, {"gate": g}, cfg)


def test_missing_gallery_fails_at_startup():
    cfg = ThresholdConfig("fake", "sift", 3, QualityConfig(), {"gate": RULE})
    with pytest.raises(ValueError):
        Verifier(FixedEmbedder([1, 0]), SiftMatcher(), {}, cfg)


def test_compute_features_all_refs_with_timings():
    matcher = SiftMatcher()
    refs = [make_scene(1), make_scene(2)]
    g = manual_gallery("gate", refs, [[1, 0], [0.6, 0.8]], matcher)
    f = compute_features(FixedEmbedder([1, 0]), matcher, g, jpeg_bytes(make_scene(1)),
                         QualityConfig(), top_k=1, all_refs=True)
    assert f.quality is None and f.ranked_refs == [0, 1]
    assert set(f.inliers) == {0, 1} and f.inliers[0] > f.inliers[1]
    assert f.t_global_ms > 0 and f.t_extract_ms > 0 and set(f.t_pair_ms) == {0, 1}


def test_from_dir_loads_thresholds_and_galleries(tmp_path, monkeypatch):
    matcher = SiftMatcher()
    g = manual_gallery("gate", [make_scene(1)], [[1, 0]], matcher, backbone="fake")
    save_gallery(g, tmp_path / "gallery" / "gate.npz")
    save_thresholds(ThresholdConfig("fake", "sift", 3, QualityConfig(), {"gate": RULE}),
                    tmp_path / "thresholds.json")
    monkeypatch.setattr("pv.pipeline.make_embedder", lambda name: FixedEmbedder([1, 0], name=name))
    v = Verifier.from_dir(tmp_path)
    assert v.verify("gate", jpeg_bytes(warp_view(make_scene(1), seed=4))).match
```

- [ ] **Step 2: 실패 확인**

Run: `uv run pytest tests/test_pipeline.py -v`
Expected: FAIL (`ModuleNotFoundError: No module named 'pv.pipeline'`)

- [ ] **Step 3: 구현**

`photo-verify/pv/pipeline.py`:

```python
"""판정 파이프라인. verify는 운영용(지연 계산·조기 종료), compute_features는 평가용(전부 계산)."""
from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from pv.gallery import Gallery, load_gallery, ref_scores
from pv.global_embed import GlobalEmbedder, make_embedder
from pv.local_match import LocalMatcher, inliers_between, make_matcher
from pv.preprocess import QualityConfig, check_quality, decode_image, to_global_input, to_local_input
from pv.scorer import EarlyExit, ThresholdConfig, decide, load_thresholds


class UnknownSite(KeyError):
    """임계값이 없는 거점."""


@dataclass(frozen=True)
class VerifyResult:
    match: bool
    score: float
    reason_code: str
    latency_ms: int


@dataclass
class Features:
    quality: str | None
    s_g: float = 0.0
    ranked_refs: list[int] = field(default_factory=list)
    inliers: dict[int, int] = field(default_factory=dict)
    t_pre_ms: float = 0.0
    t_global_ms: float = 0.0
    t_extract_ms: float = 0.0
    t_pair_ms: dict[int, float] = field(default_factory=dict)


def _since_ms(t: float) -> float:
    return (time.perf_counter() - t) * 1000.0


def _prepare(data: bytes, quality_cfg: QualityConfig):
    img = decode_image(data)
    local_img = to_local_input(img)
    return img, local_img, check_quality(local_img, quality_cfg)


def _rank(embedder: GlobalEmbedder, gallery: Gallery, img: np.ndarray) -> tuple[float, list[int]]:
    scores = ref_scores(gallery, embedder.embed([to_global_input(img)])[0])
    ranked = [int(i) for i in np.argsort(-scores, kind="stable")]
    return float(scores[ranked[0]]), ranked


def compute_features(embedder: GlobalEmbedder, matcher: LocalMatcher, gallery: Gallery, data: bytes,
                     quality_cfg: QualityConfig, top_k: int, all_refs: bool = False) -> Features:
    t = time.perf_counter()
    img, local_img, quality = _prepare(data, quality_cfg)
    f = Features(quality=quality, t_pre_ms=_since_ms(t))
    if quality is not None:
        return f
    t = time.perf_counter()
    f.s_g, f.ranked_refs = _rank(embedder, gallery, img)
    f.t_global_ms = _since_ms(t)
    t = time.perf_counter()
    q = matcher.extract(local_img)
    f.t_extract_ms = _since_ms(t)
    for ref in (range(gallery.n_refs) if all_refs else f.ranked_refs[:top_k]):
        t = time.perf_counter()
        f.inliers[ref] = inliers_between(matcher, q, gallery.local[ref])
        f.t_pair_ms[ref] = _since_ms(t)
    return f


class Verifier:
    def __init__(self, embedder: GlobalEmbedder, matcher: LocalMatcher,
                 galleries: dict[str, Gallery], thresholds: ThresholdConfig):
        if (embedder.name, matcher.name) != (thresholds.backbone, thresholds.matcher):
            raise ValueError("loaded models do not match thresholds.json")
        for site_id in thresholds.sites:
            g = galleries.get(site_id)
            if g is None:
                raise ValueError(f"gallery missing for site {site_id}")
            if (g.backbone, g.matcher) != (thresholds.backbone, thresholds.matcher):
                raise ValueError(f"gallery for site {site_id} was built with other models")
        self.embedder, self.matcher = embedder, matcher
        self.galleries, self.thresholds = galleries, thresholds
        self._lock = threading.Lock()

    @classmethod
    def from_dir(cls, data_dir: Path) -> "Verifier":
        cfg = load_thresholds(Path(data_dir) / "thresholds.json")
        galleries = {s: load_gallery(Path(data_dir) / "gallery" / f"{s}.npz") for s in cfg.sites}
        return cls(make_embedder(cfg.backbone), make_matcher(cfg.matcher, cfg.max_keypoints), galleries, cfg)

    def verify(self, site_id: str, data: bytes, early_exit: EarlyExit = "both") -> VerifyResult:
        t0 = time.perf_counter()
        if site_id not in self.thresholds.sites:
            raise UnknownSite(site_id)
        with self._lock:
            img, local_img, quality = _prepare(data, self.thresholds.quality)
            if quality is not None:
                return VerifyResult(False, 0.0, "RETAKE", round(_since_ms(t0)))
            g, t = self.galleries[site_id], self.thresholds.sites[site_id]
            s_g, ranked = _rank(self.embedder, g, img)
            query = []

            def inliers_of(ref: int) -> int:
                if not query:
                    query.append(self.matcher.extract(local_img))
                return inliers_between(self.matcher, query[0], g.local[ref])

            d = decide(t, s_g, ranked, inliers_of, self.thresholds.top_k, early_exit)
        return VerifyResult(d.match, round(d.score, 4), d.reason_code, round(_since_ms(t0)))
```

`from_dir` 테스트는 `make_embedder`를 대역으로 바꾸고, `make_matcher("sift")`는 실제 SIFT를 쓴다.

- [ ] **Step 4: 통과 확인**

Run: `uv run pytest tests/test_pipeline.py -v`
Expected: 9 passed

- [ ] **Step 5: 커밋·푸시**

```bash
git add photo-verify/pv/pipeline.py photo-verify/tests/test_pipeline.py
git commit -m "feat: 사진 판정 파이프라인과 평가용 특징 계산 추가" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin HEAD:main
```

---

### Task 8: FastAPI 추론 서버

**Files:**
- Create: `photo-verify/pv/service.py`
- Test: `photo-verify/tests/test_service.py`
- Modify: `docs/superpowers/specs/2026-10-12-photo-verify-design.md` 5절 `service.py` 행과 7절

**Interfaces:**
- Consumes: `Verifier`, `VerifyResult`, `UnknownSite`, `InvalidImage`
- Produces: `create_app(verifier_factory: Callable[[], Verifier], api_key: str, max_bytes: int = 10 * 1024 * 1024, timeout_s: float = 8.0) -> FastAPI`, `app_from_env() -> FastAPI` (환경변수 `PV_API_KEY` 필수, `PV_DATA_DIR`(기본 `/data`), `PV_MAX_BYTES`, `PV_TIMEOUT_S`)
- HTTP: `GET /healthz` → `{"ok": true, "ready": bool}` (인증 없음, 거점 정보 없음). `POST /verify?site_id=<id>` 헤더 `X-PV-Key`, 본문은 이미지 원시 바이트 → 200 `{"match", "score", "reason_code", "latency_ms"}`. 오류는 Global Constraints의 코드를 쓰고, `site_id`가 없으면 FastAPI 기본 422를 돌려준다.

- [ ] **Step 1: 실패하는 테스트 작성**

`photo-verify/tests/test_service.py`:

```python
import tempfile
import time

import pytest
from fastapi.testclient import TestClient

from pv.pipeline import UnknownSite, VerifyResult
from pv.preprocess import InvalidImage
from pv.service import create_app

KEY = "test-key"
OK = VerifyResult(True, 0.91, "MATCH", 812)


class StubVerifier:
    def __init__(self, result=OK, exc=None, delay=0.0):
        self.result, self.exc, self.delay, self.seen = result, exc, delay, []

    def verify(self, site_id, data, early_exit="both"):
        self.seen.append((site_id, len(data)))
        if self.delay:
            time.sleep(self.delay)
        if self.exc:
            raise self.exc
        return self.result


def client(stub, **kw):
    return TestClient(create_app(lambda: stub, KEY, **kw))


def post(c, body=b"img", key=KEY, site="gate"):
    headers = {"Content-Type": "image/jpeg"}
    if key is not None:
        headers["X-PV-Key"] = key
    return c.post(f"/verify?site_id={site}", content=body, headers=headers)


def test_success_contract_has_exactly_four_fields():
    with client(StubVerifier()) as c:
        r = post(c)
    assert r.status_code == 200
    assert r.json() == {"match": True, "score": 0.91, "reason_code": "MATCH", "latency_ms": 812}


@pytest.mark.parametrize("key", [None, "wrong", ""])
def test_bad_key_is_401_and_verifier_not_called(key):
    stub = StubVerifier()
    with client(stub) as c:
        r = post(c, key=key)
    assert (r.status_code, r.json()) == (401, {"error": "UNAUTHORIZED"}) and stub.seen == []


@pytest.mark.parametrize("exc,status,code", [
    (UnknownSite("x"), 404, "UNKNOWN_SITE"),
    (InvalidImage("bad"), 400, "INVALID_IMAGE"),
    (RuntimeError("boom"), 503, "MODEL_ERROR"),
])
def test_error_mapping_hides_internals(exc, status, code):
    with client(StubVerifier(exc=exc)) as c:
        r = post(c)
    assert (r.status_code, r.json()) == (status, {"error": code})


def test_too_large_and_empty_body():
    stub = StubVerifier()
    with client(stub, max_bytes=1000) as c:
        assert post(c, body=b"x" * 1001).json() == {"error": "TOO_LARGE"}
        assert post(c, body=b"").json() == {"error": "INVALID_IMAGE"}
    assert stub.seen == []


def test_timeout_is_503():
    with client(StubVerifier(delay=0.5), timeout_s=0.1) as c:
        r = post(c)
    assert (r.status_code, r.json()) == (503, {"error": "TIMEOUT"})


def test_healthz_reports_ready_without_auth():
    with client(StubVerifier()) as c:
        assert c.get("/healthz").json() == {"ok": True, "ready": True}


def test_large_upload_never_touches_temp_files(monkeypatch):
    def forbidden(*a, **k):
        raise AssertionError("사진이 디스크에 쓰이면 안 된다")
    for name in ("TemporaryFile", "SpooledTemporaryFile", "NamedTemporaryFile", "mkstemp"):
        monkeypatch.setattr(tempfile, name, forbidden)
    stub = StubVerifier()
    with client(stub) as c:
        r = post(c, body=b"x" * (5 * 1024 * 1024))
    assert r.status_code == 200 and stub.seen == [("gate", 5 * 1024 * 1024)]


def test_missing_api_key_config_refuses_to_start():
    with pytest.raises(ValueError):
        create_app(lambda: StubVerifier(), "")


def test_openapi_docs_disabled():
    with client(StubVerifier()) as c:
        assert c.get("/docs").status_code == 404
```

- [ ] **Step 2: 실패 확인**

Run: `uv run pytest tests/test_service.py -v`
Expected: FAIL (`ModuleNotFoundError: No module named 'pv.service'`)

- [ ] **Step 3: 구현**

`photo-verify/pv/service.py`:

```python
"""추론 서버. 사진은 요청 본문에서 메모리로만 읽고 저장하지 않는다.

실행: PV_API_KEY=... PV_DATA_DIR=... uvicorn pv.service:app_from_env --factory
"""
from __future__ import annotations

import asyncio
import hmac
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Callable

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from pv.pipeline import UnknownSite, Verifier
from pv.preprocess import InvalidImage

DEFAULT_MAX_BYTES = 10 * 1024 * 1024


def _error(status: int, code: str) -> JSONResponse:
    return JSONResponse({"error": code}, status_code=status)


def create_app(verifier_factory: Callable[[], Verifier], api_key: str,
               max_bytes: int = DEFAULT_MAX_BYTES, timeout_s: float = 8.0) -> FastAPI:
    if not api_key:
        raise ValueError("PV_API_KEY is required")
    expected = api_key.encode("utf-8")
    state: dict = {"verifier": None}

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        state["verifier"] = await run_in_threadpool(verifier_factory)
        yield

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

    @app.get("/healthz")
    async def healthz():
        return {"ok": True, "ready": state["verifier"] is not None}

    @app.post("/verify")
    async def verify(request: Request, site_id: str):
        given = request.headers.get("x-pv-key", "").encode("utf-8")
        if not hmac.compare_digest(given, expected):
            return _error(401, "UNAUTHORIZED")
        verifier = state["verifier"]
        if verifier is None:
            return _error(503, "NOT_READY")
        declared = request.headers.get("content-length", "")
        if declared.isdigit() and int(declared) > max_bytes:
            return _error(400, "TOO_LARGE")
        body = bytearray()
        async for chunk in request.stream():
            body.extend(chunk)
            if len(body) > max_bytes:
                return _error(400, "TOO_LARGE")
        if not body:
            return _error(400, "INVALID_IMAGE")
        try:
            result = await asyncio.wait_for(run_in_threadpool(verifier.verify, site_id, bytes(body)), timeout_s)
        except UnknownSite:
            return _error(404, "UNKNOWN_SITE")
        except InvalidImage:
            return _error(400, "INVALID_IMAGE")
        except asyncio.TimeoutError:
            return _error(503, "TIMEOUT")
        except Exception:
            return _error(503, "MODEL_ERROR")
        return {"match": result.match, "score": result.score,
                "reason_code": result.reason_code, "latency_ms": result.latency_ms}

    return app


def app_from_env() -> FastAPI:
    data_dir = Path(os.environ.get("PV_DATA_DIR", "/data"))
    return create_app(lambda: Verifier.from_dir(data_dir), os.environ.get("PV_API_KEY", ""),
                      int(os.environ.get("PV_MAX_BYTES", DEFAULT_MAX_BYTES)),
                      float(os.environ.get("PV_TIMEOUT_S", "8")))
```

- [ ] **Step 4: 통과 확인**

Run: `uv run pytest tests/test_service.py -v`
Expected: 13 passed

- [ ] **Step 5: 스펙 동기화**

`docs/superpowers/specs/2026-10-12-photo-verify-design.md`를 고친다.
- 5절 `service.py` 행: "FastAPI `POST /verify` (multipart: `site_id`, `image`), 공유 키 헤더 인증, 파일 미저장"을 "FastAPI `POST /verify?site_id=` (본문은 이미지 원시 바이트, multipart는 1MB를 넘으면 임시 파일에 쓰므로 쓰지 않음), `X-PV-Key` 헤더 인증, 파일 미저장, `GET /healthz`"로 바꾼다.
- 7절 표에 `| 서버 준비 전 요청 | HTTP 503 NOT_READY |`와 `| site_id 누락 | HTTP 422 (FastAPI 기본) |` 행을 추가한다.

- [ ] **Step 6: 커밋·푸시**

```bash
git add photo-verify/pv/service.py photo-verify/tests/test_service.py docs/superpowers/specs/2026-10-12-photo-verify-design.md
git commit -m "feat: 사진 판정 FastAPI 추론 서버 추가" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin HEAD:main
```

---

### Task 9: 임계값 보정과 지표

**Files:**
- Create: `photo-verify/pv/calibrate.py`
- Test: `photo-verify/tests/test_calibrate.py`

**Interfaces:**
- Consumes: `SiteThresholds`, `passes`, `MIN_POINTS`
- Produces: `threshold_at_far(neg_scores, far=0.01, total: int | None = None) -> float` (점수 ≥ t인 오답이 `floor(far × total)`개 이하가 되는 t, 오답이 없으면 `-inf`), `tar_at_far(pos, neg, far=0.01) -> float`, `eer(pos, neg) -> float`, `auc(pos, neg) -> float`, `fit_tau_reject(pos_sg, max_miss=0.01) -> float`, `fit_tau_accept(neg_sg, margin=0.02) -> float | None`, `SiteSamples(s_g: np.ndarray, n: np.ndarray, y: np.ndarray)`, `MIN_FOR_LOGISTIC = 10`, `DEFAULT_TAU_N = 15`, `fit_site(samples: SiteSamples, far=0.01, margin=0.02) -> SiteThresholds` (`early_accept`는 항상 False. 켜는 결정은 Task 10에서 한다)
- 보정 원칙: FAR의 분모는 보정 fold 전체 오답 수다. 조기 거절로 걸러지는 오답은 이미 거절된 것으로 센다. logistic의 `tau_n`은 "`s_g`가 `tau_reject`일 때도 통과하는 최소 inlier 수"로 정한다. 그러면 순차 중단이 판정을 바꾸지 않는다.

- [ ] **Step 1: 실패하는 테스트 작성**

`photo-verify/tests/test_calibrate.py`:

```python
import math

import numpy as np

from pv.calibrate import (SiteSamples, auc, eer, fit_site, fit_tau_accept,
                          fit_tau_reject, tar_at_far, threshold_at_far)
from pv.scorer import passes


def test_threshold_at_far_allows_floor_far_times_negatives():
    neg = np.arange(100, dtype=float)
    t = threshold_at_far(neg, far=0.01)
    assert int((neg >= t).sum()) == 1
    assert int((neg >= threshold_at_far(neg, far=0.0)).sum()) == 0
    assert threshold_at_far([], far=0.01) == -math.inf


def test_threshold_at_far_uses_total_denominator():
    t = threshold_at_far([0.9, 0.8], far=0.01, total=200)  # 200개 중 2개까지 허용
    assert t <= 0.8


def test_tar_auc_eer_on_separated_scores():
    pos, neg = np.linspace(0.8, 1.0, 50), np.linspace(0.0, 0.5, 50)
    assert tar_at_far(pos, neg) == 1.0
    assert auc(pos, neg) == 1.0
    assert eer(pos, neg) == 0.0


def test_eer_near_half_on_identical_distributions():
    x = np.random.default_rng(0).uniform(0, 1, 2000)
    assert abs(eer(x[:1000], x[1000:]) - 0.5) < 0.05


def test_fit_tau_reject_misses_at_most_one_percent():
    pos = np.arange(100, dtype=float)
    t = fit_tau_reject(pos, 0.01)
    assert int((pos < t).sum()) <= 1


def test_fit_tau_accept_margin_and_disable():
    assert fit_tau_accept(np.array([0.5, 0.7])) == 0.72
    assert fit_tau_accept(np.array([0.99])) is None
    assert fit_tau_accept(np.array([])) is None


def _synthetic(rng, n_each=40):
    s_g = np.r_[rng.uniform(0.8, 0.95, n_each), rng.uniform(0.75, 0.9, n_each), rng.uniform(0.1, 0.3, n_each)]
    n = np.r_[rng.integers(60, 120, n_each), rng.integers(2, 10, n_each), rng.integers(0, 5, n_each)]
    y = np.r_[np.ones(n_each), np.zeros(2 * n_each)].astype(int)
    return SiteSamples(s_g, n.astype(float), y)


def test_fit_site_logistic_separates_and_stop_rule_is_safe():
    s = _synthetic(np.random.default_rng(1))
    t = fit_site(s)
    assert t.mode == "logistic" and not t.early_accept
    accept = np.array([sg >= t.tau_reject and passes(t, sg, int(n)) for sg, n in zip(s.s_g, s.n)])
    assert accept[s.y == 1].mean() >= 0.9
    assert accept[s.y == 0].mean() <= 0.01
    assert passes(t, t.tau_reject, t.tau_n)  # n이 tau_n에 이르면 더 매칭하지 않아도 통과


def test_fit_site_rule_when_few_samples():
    s = SiteSamples(np.array([0.9, 0.85, 0.3]), np.array([80.0, 70.0, 4.0]), np.array([1, 1, 0]))
    t = fit_site(s)
    assert t.mode == "rule" and t.tau_n >= 8 and t.tau_low == t.tau_reject
```

- [ ] **Step 2: 실패 확인**

Run: `uv run pytest tests/test_calibrate.py -v`
Expected: FAIL (`ModuleNotFoundError: No module named 'pv.calibrate'`)

- [ ] **Step 3: 구현**

`photo-verify/pv/calibrate.py`:

```python
"""거점별 임계값 보정과 평가 지표."""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score, roc_curve

from pv.local_match import MIN_POINTS
from pv.scorer import SiteThresholds

MIN_FOR_LOGISTIC = 10
DEFAULT_TAU_N = 15
NEVER = 10**9


def threshold_at_far(neg_scores, far: float = 0.01, total: int | None = None) -> float:
    neg = np.sort(np.asarray(neg_scores, np.float64))[::-1]
    if len(neg) == 0:
        return -math.inf
    k = int(math.floor(far * (total if total is not None else len(neg))))
    if k >= len(neg):
        return -math.inf
    return float(np.nextafter(neg[k], math.inf))


def tar_at_far(pos, neg, far: float = 0.01) -> float:
    pos = np.asarray(pos, np.float64)
    return float(np.mean(pos >= threshold_at_far(neg, far))) if len(pos) else float("nan")


def auc(pos, neg) -> float:
    y = np.r_[np.ones(len(pos)), np.zeros(len(neg))]
    return float(roc_auc_score(y, np.r_[pos, neg]))


def eer(pos, neg) -> float:
    y = np.r_[np.ones(len(pos)), np.zeros(len(neg))]
    fpr, tpr, _ = roc_curve(y, np.r_[pos, neg])
    fnr = 1 - tpr
    i = int(np.nanargmin(np.abs(fnr - fpr)))
    return float((fpr[i] + fnr[i]) / 2)


def fit_tau_reject(pos_sg, max_miss: float = 0.01) -> float:
    pos = np.sort(np.asarray(pos_sg, np.float64))
    if len(pos) == 0:
        return -math.inf
    return float(pos[int(math.floor(max_miss * len(pos)))])


def fit_tau_accept(neg_sg, margin: float = 0.02) -> float | None:
    if len(neg_sg) == 0:
        return None
    t = round(float(np.max(neg_sg)) + margin, 6)
    return t if t <= 1.0 else None


@dataclass(frozen=True)
class SiteSamples:
    s_g: np.ndarray
    n: np.ndarray
    y: np.ndarray


def _logistic_tau_n(w_sg: float, w_n: float, bias: float, tau_score: float, tau_reject: float) -> int:
    if w_n <= 0:
        return NEVER
    p = min(max(tau_score, 1e-6), 1 - 1e-6)
    s_worst = tau_reject if w_sg >= 0 else 1.0
    v = (math.log(p / (1 - p)) - bias - w_sg * s_worst) / w_n
    if v > 20:
        return NEVER
    return max(0, math.ceil(math.expm1(v)))


def fit_site(samples: SiteSamples, far: float = 0.01, margin: float = 0.02) -> SiteThresholds:
    pos, neg = samples.y == 1, samples.y == 0
    tau_reject = fit_tau_reject(samples.s_g[pos], far)
    tau_accept = fit_tau_accept(samples.s_g[neg], margin)
    surviving = neg & (samples.s_g >= tau_reject)
    total_neg = int(neg.sum())
    if pos.sum() >= MIN_FOR_LOGISTIC and neg.sum() >= MIN_FOR_LOGISTIC:
        x = np.c_[samples.s_g, np.log1p(samples.n)]
        lr = LogisticRegression(class_weight="balanced").fit(x, samples.y)
        w_sg, w_n = (float(c) for c in lr.coef_[0])
        bias = float(lr.intercept_[0])
        scores = 1.0 / (1.0 + np.exp(-(x @ np.array([w_sg, w_n]) + bias)))
        tau_score = threshold_at_far(scores[surviving], far, total=total_neg)
        tau_score = min(max(tau_score, 0.0), 1.0)
        return SiteThresholds(tau_reject=tau_reject, mode="logistic", w_sg=w_sg, w_n=w_n, bias=bias,
                              tau_score=tau_score,
                              tau_n=_logistic_tau_n(w_sg, w_n, bias, tau_score, tau_reject),
                              tau_accept=tau_accept)
    t_n = threshold_at_far(samples.n[surviving], far, total=total_neg)
    tau_n = DEFAULT_TAU_N if total_neg == 0 else max(MIN_POINTS, math.ceil(max(t_n, 0.0)))
    return SiteThresholds(tau_reject=tau_reject, tau_n=tau_n, mode="rule", tau_low=tau_reject,
                          tau_accept=tau_accept)
```

- [ ] **Step 4: 통과 확인**

Run: `uv run pytest tests/test_calibrate.py -v`
Expected: 8 passed

- [ ] **Step 5: 커밋·푸시**

```bash
git add photo-verify/pv/calibrate.py photo-verify/tests/test_calibrate.py
git commit -m "feat: 거점별 임계값 보정과 평가 지표 추가" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin HEAD:main
```

---

### Task 10: 평가 매니페스트·비교 실험·보고서와 촬영 지침

**Files:**
- Create: `photo-verify/pv/evaldata.py`, `photo-verify/pv/evaluate.py`, `photo-verify/eval/run_eval.py`, `photo-verify/docs/CAPTURE_GUIDE.md`
- Test: `photo-verify/tests/test_evaldata.py`, `photo-verify/tests/test_evaluate.py`

**Interfaces:**
- Consumes: `Features`, `compute_features`, `build_gallery`, `load_ref_dir`, `make_embedder`, `make_matcher`, `decide`, `fused_score`, `SiteThresholds`, `ThresholdConfig`, `save_thresholds`, `QualityConfig`, `fit_site`, `SiteSamples`, `threshold_at_far`, `auc`, `eer`, `summarize_ms`
- Produces:
  - `evaldata`: `Sample(path: Path, site_id: str, label: str, session: str, tags: dict[str, str])`, `LABELS = {"pos", "hard_neg", "easy_neg"}`, `TAG_COLUMNS = ("angle", "distance", "time", "weather", "occlusion")`, `load_manifest(path: Path) -> list[Sample]`, `assign_folds(samples) -> dict[str, int]` (회차→0/1), `cross_site_negatives(samples, sites) -> list[Sample]` (label `cross_neg`)
  - `evaluate`: `Row(sample, fold, f)` + `y`·`ok_quality` 속성, `n_topk(f, k)`, `n_all(f)`, `est_latency_ms(f, used)`, `Outcome`, `METHODS = ("A_global", "B_local", "C_none", "C_reject", "C_both")`, `evaluate(rows, top_k=3, far=0.01) -> dict[str, Outcome]`, `summarize(out) -> list[dict]`, `per_site(outcome) -> list[dict]`, `per_tag(outcome, tag) -> list[dict]`, `early_accept_safe(outcome) -> dict[str, bool]`, `fit_all(rows, top_k, far, safe) -> dict[str, SiteThresholds]`
- CLI: `uv run python eval/run_eval.py --manifest private/photo-verify/eval/manifest.csv --refs private/photo-verify/refs --out private/photo-verify/eval/results [--backbones ...] [--matchers ...] [--ref-counts 1 3 5] [--augment on off] [--top-k 3] [--max-kp 1024] [--far 0.01] [--no-cross-site] [--write-thresholds private/photo-verify/thresholds.json]`

- [ ] **Step 1: 실패하는 테스트 작성**

`photo-verify/tests/test_evaldata.py`:

```python
from pathlib import Path

import pytest

from pv.evaldata import assign_folds, cross_site_negatives, load_manifest

HEADER = "path,site_id,label,session,angle,distance,time,weather,occlusion\n"


def write(tmp_path, rows):
    p = tmp_path / "manifest.csv"
    p.write_text(HEADER + "".join(rows), encoding="utf-8")
    return p


def test_load_manifest_resolves_paths_and_tags(tmp_path):
    p = write(tmp_path, ["images/a.jpg,gate,pos,s1,front,near,day,clear,none\n"])
    [s] = load_manifest(p)
    assert s.path == tmp_path / "images" / "a.jpg"
    assert (s.site_id, s.label, s.session, s.tags["angle"]) == ("gate", "pos", "s1", "front")


def test_bad_label_and_missing_column_rejected(tmp_path):
    with pytest.raises(ValueError):
        load_manifest(write(tmp_path, ["a.jpg,gate,maybe,s1,,,,,\n"]))
    bad = tmp_path / "m2.csv"
    bad.write_text("path,site_id\na.jpg,gate\n", encoding="utf-8")
    with pytest.raises(ValueError):
        load_manifest(bad)


def test_folds_need_two_sessions(tmp_path):
    two = load_manifest(write(tmp_path, ["a.jpg,gate,pos,s1,,,,,\n", "b.jpg,gate,pos,s2,,,,,\n"]))
    assert assign_folds(two) == {"s1": 0, "s2": 1}
    one = load_manifest(write(tmp_path, ["a.jpg,gate,pos,s1,,,,,\n"]))
    with pytest.raises(ValueError):
        assign_folds(one)


def test_cross_site_negatives_from_other_sites(tmp_path):
    samples = load_manifest(write(tmp_path, ["a.jpg,gate,pos,s1,,,,,\n", "b.jpg,gate,hard_neg,s1,,,,,\n"]))
    out = cross_site_negatives(samples, ["gate", "yongbong"])
    assert [(s.site_id, s.label, s.path.name) for s in out] == [("yongbong", "cross_neg", "a.jpg")]
```

`photo-verify/tests/test_evaluate.py`:

```python
from pathlib import Path

import numpy as np

from pv.evaldata import Sample
from pv.evaluate import (Row, early_accept_safe, evaluate, fit_all, per_site,
                         per_tag, summarize)
from pv.pipeline import Features


def feat(s_g, n0, n1=0, quality=None):
    return Features(quality=quality, s_g=s_g, ranked_refs=[0, 1], inliers={0: n0, 1: n1},
                    t_pre_ms=10, t_global_ms=100, t_extract_ms=200, t_pair_ms={0: 300, 1: 300})


def rows(seed=0, per=20):
    rng = np.random.default_rng(seed)
    out = []
    for fold, session in ((0, "s1"), (1, "s2")):
        for i in range(per):
            tag = {"angle": "side" if i % 2 else "front"}
            out.append(Row(Sample(Path(f"p{fold}{i}"), "gate", "pos", session, tag), fold,
                           feat(rng.uniform(0.8, 0.95), int(rng.integers(60, 120)))))
            out.append(Row(Sample(Path(f"h{fold}{i}"), "gate", "hard_neg", session, {}), fold,
                           feat(rng.uniform(0.85, 0.99), int(rng.integers(2, 10)))))
            out.append(Row(Sample(Path(f"e{fold}{i}"), "gate", "easy_neg", session, {}), fold,
                           feat(rng.uniform(0.1, 0.3), int(rng.integers(0, 5)))))
    return out


def by_method(table):
    return {r["method"]: r for r in table}


def test_combined_beats_global_only_on_lookalikes():
    t = by_method(summarize(evaluate(rows())))
    assert t["C_reject"]["TAR"] >= 0.9 and t["C_reject"]["FAR"] <= 0.01
    assert t["A_global"]["TAR"] < t["C_reject"]["TAR"]


def test_early_reject_cuts_latency_for_easy_negatives():
    t = by_method(summarize(evaluate(rows())))
    assert t["C_reject"]["lat_mean"] < t["C_none"]["lat_mean"]
    # 조기 거절은 보정 fold의 정답 최솟값을 기준으로 하므로 정답을 약간 더 놓칠 수 있다
    assert t["C_reject"]["TAR"] >= t["C_none"]["TAR"] - 0.05


def test_retake_counts_as_rejection():
    rs = rows()
    rs.append(Row(Sample(Path("r"), "gate", "pos", "s1", {}), 0, feat(0.0, 0, quality="BLUR")))
    t = by_method(summarize(evaluate(rs)))
    assert 0 < t["C_reject"]["retake_rate_pos"] < 0.1


def test_per_site_and_tag_tables():
    out = evaluate(rows())
    assert per_site(out["C_reject"])[0]["site_id"] == "gate"
    assert {r["value"] for r in per_tag(out["C_reject"], "angle")} == {"front", "side"}


def test_early_accept_disabled_when_lookalikes_exceed_tau_accept():
    out = evaluate(rows())
    safe = early_accept_safe(out["C_both"])
    sites = fit_all(rows(), top_k=3, far=0.01, safe=safe)
    assert sites["gate"].early_accept is (safe["gate"] and sites["gate"].tau_accept is not None)
```

- [ ] **Step 2: 실패 확인**

Run: `uv run pytest tests/test_evaldata.py tests/test_evaluate.py -v`
Expected: FAIL (`ModuleNotFoundError`)

- [ ] **Step 3: evaldata 구현**

`photo-verify/pv/evaldata.py`:

```python
"""평가 매니페스트. 평가 사진과 매니페스트는 private/photo-verify/eval/에만 둔다."""
from __future__ import annotations

import csv
from dataclasses import dataclass, replace
from pathlib import Path

LABELS = {"pos", "hard_neg", "easy_neg"}
TAG_COLUMNS = ("angle", "distance", "time", "weather", "occlusion")
REQUIRED = ("path", "site_id", "label", "session") + TAG_COLUMNS


@dataclass(frozen=True)
class Sample:
    path: Path
    site_id: str
    label: str
    session: str
    tags: dict[str, str]


def load_manifest(path: Path) -> list[Sample]:
    path = Path(path)
    with path.open(encoding="utf-8", newline="") as fh:
        reader = csv.DictReader(fh)
        missing = [c for c in REQUIRED if c not in (reader.fieldnames or [])]
        if missing:
            raise ValueError(f"manifest columns missing: {missing}")
        out = []
        for i, row in enumerate(reader, start=2):
            if row["label"] not in LABELS:
                raise ValueError(f"line {i}: unknown label {row['label']!r}")
            out.append(Sample(path.parent / row["path"], row["site_id"], row["label"], row["session"],
                              {c: row[c] for c in TAG_COLUMNS}))
    return out


def assign_folds(samples: list[Sample]) -> dict[str, int]:
    sessions = sorted({s.session for s in samples})
    if len(sessions) < 2:
        raise ValueError("2-fold 평가에는 촬영 회차가 2개 이상 필요하다")
    return {s: i % 2 for i, s in enumerate(sessions)}


def cross_site_negatives(samples: list[Sample], sites: list[str]) -> list[Sample]:
    """다른 거점의 정답 사진을 이 거점의 오답으로 쓴다."""
    return [replace(s, site_id=other, label="cross_neg")
            for s in samples if s.label == "pos" for other in sites if other != s.site_id]
```

- [ ] **Step 4: evaluate 구현**

`photo-verify/pv/evaluate.py`:

```python
"""비교 실험 시뮬레이션. 특징을 한 번 계산해 두고 구조·조기 종료 방식을 바꿔 가며 판정한다."""
from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass, field, replace

import numpy as np

from pv.calibrate import SiteSamples, auc, eer, fit_site, threshold_at_far
from pv.evaldata import Sample
from pv.pipeline import Features
from pv.scorer import SiteThresholds, decide, fused_score
from pv.timing import summarize_ms

METHODS = ("A_global", "B_local", "C_none", "C_reject", "C_both")
NAN = float("nan")


@dataclass(frozen=True)
class Row:
    sample: Sample
    fold: int
    f: Features

    @property
    def y(self) -> int:
        return 1 if self.sample.label == "pos" else 0

    @property
    def ok_quality(self) -> bool:
        return self.f.quality is None


def n_topk(f: Features, k: int) -> int:
    return max((f.inliers.get(r, 0) for r in f.ranked_refs[:k]), default=0)


def n_all(f: Features) -> int:
    return max(f.inliers.values(), default=0)


def est_latency_ms(f: Features, used: list[int]) -> float:
    t = f.t_pre_ms + (0.0 if f.quality else f.t_global_ms)
    if used:
        t += f.t_extract_ms + sum(f.t_pair_ms[r] for r in used)
    return t


@dataclass
class Outcome:
    rows: list[Row] = field(default_factory=list)
    accept: list[bool] = field(default_factory=list)
    score: list[float | None] = field(default_factory=list)
    latency: list[float] = field(default_factory=list)
    early_accept: list[bool] = field(default_factory=list)

    def add(self, row: Row, accept: bool, score: float | None, latency: float, early: bool = False) -> None:
        self.rows.append(row)
        self.accept.append(bool(accept))
        self.score.append(score)
        self.latency.append(latency)
        self.early_accept.append(early)


def _samples(rows: list[Row], top_k: int) -> SiteSamples:
    good = [r for r in rows if r.ok_quality]
    return SiteSamples(np.array([r.f.s_g for r in good], float),
                       np.array([n_topk(r.f, top_k) for r in good], float),
                       np.array([r.y for r in good], int))


def evaluate(rows: list[Row], top_k: int = 3, far: float = 0.01) -> dict[str, Outcome]:
    out = {m: Outcome() for m in METHODS}
    for test_fold in (0, 1):
        for site in sorted({r.sample.site_id for r in rows}):
            cal = [r for r in rows if r.fold != test_fold and r.sample.site_id == site]
            test = [r for r in rows if r.fold == test_fold and r.sample.site_id == site]
            if not cal or not test:
                continue
            total_neg = sum(1 for r in cal if r.y == 0)
            cal_neg = [r for r in cal if r.y == 0 and r.ok_quality]
            thr_a = threshold_at_far([r.f.s_g for r in cal_neg], far, total=total_neg)
            thr_b = threshold_at_far([math.log1p(n_all(r.f)) for r in cal_neg], far, total=total_neg)
            t = fit_site(_samples(cal, top_k), far)
            for r in test:
                f = r.f
                if not r.ok_quality:
                    for m in METHODS:
                        out[m].add(r, False, None, est_latency_ms(f, []))
                    continue
                out["A_global"].add(r, f.s_g >= thr_a, f.s_g, f.t_pre_ms + f.t_global_ms)
                nb = math.log1p(n_all(f))
                out["B_local"].add(r, nb >= thr_b, nb, f.t_pre_ms + f.t_extract_ms + sum(f.t_pair_ms.values()))
                for name, mode in (("C_none", "none"), ("C_reject", "reject"), ("C_both", "both")):
                    tm = replace(t, early_accept=t.tau_accept is not None) if mode == "both" else t
                    d = decide(tm, f.s_g, f.ranked_refs, lambda ref, f=f: f.inliers[ref], top_k, mode)
                    out[name].add(r, d.match, fused_score(t, f.s_g, n_topk(f, top_k)),
                                  est_latency_ms(f, d.pairs_used), early=d.match and not d.pairs_used)
    return out


def _rates(rows: list[Row], accept: list[bool]) -> tuple[float, float]:
    y, a = np.array([r.y for r in rows]), np.array(accept, bool)
    tar = float(a[y == 1].mean()) if (y == 1).any() else NAN
    far_ = float(a[y == 0].mean()) if (y == 0).any() else NAN
    return tar, far_


def summarize(out: dict[str, Outcome]) -> list[dict]:
    table = []
    for method, o in out.items():
        tar, far_ = _rates(o.rows, o.accept)
        ps = [s for r, s in zip(o.rows, o.score) if s is not None and r.y == 1]
        ns = [s for r, s in zip(o.rows, o.score) if s is not None and r.y == 0]
        lat_samples = [lat for r, lat in zip(o.rows, o.latency) if r.ok_quality]
        lat = summarize_ms(lat_samples) if lat_samples else {"p50": NAN, "p95": NAN, "mean": NAN}
        pos_rows = [r for r in o.rows if r.y == 1]
        table.append({
            "method": method, "n_pos": len(pos_rows), "n_neg": len(o.rows) - len(pos_rows),
            "TAR": tar, "FAR": far_,
            "AUC": auc(ps, ns) if ps and ns else NAN, "EER": eer(ps, ns) if ps and ns else NAN,
            "lat_mean": lat["mean"], "lat_p50": lat["p50"], "lat_p95": lat["p95"],
            "early_false_accepts": sum(1 for r, e in zip(o.rows, o.early_accept) if e and r.y == 0),
            "retake_rate_pos": (sum(1 for r in pos_rows if not r.ok_quality) / len(pos_rows)) if pos_rows else NAN,
        })
    return table


def per_site(o: Outcome) -> list[dict]:
    groups: dict[str, list[int]] = defaultdict(list)
    for i, r in enumerate(o.rows):
        groups[r.sample.site_id].append(i)
    table = []
    for site, idx in sorted(groups.items()):
        tar, far_ = _rates([o.rows[i] for i in idx], [o.accept[i] for i in idx])
        table.append({"site_id": site, "TAR": tar, "FAR": far_, "n": len(idx)})
    return table


def per_tag(o: Outcome, tag: str) -> list[dict]:
    groups: dict[str, list[bool]] = defaultdict(list)
    for r, a in zip(o.rows, o.accept):
        if r.y == 1:
            groups[r.sample.tags.get(tag, "") or "(없음)"].append(a)
    return [{"tag": tag, "value": v, "TAR": float(np.mean(a)), "n": len(a)} for v, a in sorted(groups.items())]


def early_accept_safe(o: Outcome) -> dict[str, bool]:
    safe: dict[str, bool] = {}
    for r, e in zip(o.rows, o.early_accept):
        safe.setdefault(r.sample.site_id, True)
        if e and r.y == 0:
            safe[r.sample.site_id] = False
    return safe


def fit_all(rows: list[Row], top_k: int, far: float, safe: dict[str, bool]) -> dict[str, SiteThresholds]:
    sites = {}
    for site in sorted({r.sample.site_id for r in rows}):
        t = fit_site(_samples([r for r in rows if r.sample.site_id == site], top_k), far)
        sites[site] = replace(t, early_accept=bool(safe.get(site)) and t.tau_accept is not None)
    return sites
```

- [ ] **Step 5: 통과 확인**

Run: `uv run pytest tests/test_evaldata.py tests/test_evaluate.py -v`
Expected: 9 passed

`test_combined_beats_global_only_on_lookalikes`는 어려운 오답의 `s_g`가 정답보다 높게 겹치도록 만든 데이터다. A가 C보다 TAR이 낮아야 한다. 실패하면 데이터가 아니라 구현을 확인한다.

- [ ] **Step 6: 평가 CLI 작성**

`photo-verify/eval/run_eval.py`:

```python
"""평가셋 비교 실험과 보고서. 결과는 private/photo-verify/eval/results/에 쓴다."""
from __future__ import annotations

import argparse
import datetime as dt
import json
import platform
import sys
from dataclasses import asdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pv.evaldata import assign_folds, cross_site_negatives, load_manifest  # noqa: E402
from pv.evaluate import (Row, early_accept_safe, evaluate, fit_all, per_site,  # noqa: E402
                         per_tag, summarize)
from pv.gallery import build_gallery, load_ref_dir  # noqa: E402
from pv.global_embed import make_embedder  # noqa: E402
from pv.local_match import make_matcher  # noqa: E402
from pv.pipeline import Features, compute_features  # noqa: E402
from pv.preprocess import QualityConfig  # noqa: E402
from pv.scorer import ThresholdConfig, save_thresholds  # noqa: E402

TAGS = ("angle", "distance", "time", "weather", "occlusion")


def features_to_json(f: Features) -> dict:
    return asdict(f)


def features_from_json(d: dict) -> Features:
    d = dict(d)
    d["inliers"] = {int(k): int(v) for k, v in d["inliers"].items()}
    d["t_pair_ms"] = {int(k): float(v) for k, v in d["t_pair_ms"].items()}
    return Features(**d)


def md_table(rows: list[dict]) -> str:
    if not rows:
        return "(없음)\n"
    keys = list(rows[0])
    fmt = lambda v: f"{v:.3f}" if isinstance(v, float) else str(v)  # noqa: E731
    lines = ["| " + " | ".join(keys) + " |", "|" + "---|" * len(keys)]
    lines += ["| " + " | ".join(fmt(r[k]) for k in keys) + " |" for r in rows]
    return "\n".join(lines) + "\n"


def run_config(samples, folds, refs_root, out_dir, backbone, matcher_name, n_refs, augment, top_k, max_kp, cache):
    key = f"{backbone}__{matcher_name}__refs{n_refs}__aug{int(augment)}__kp{max_kp}"
    cache_path = out_dir / "cache" / f"{key}.jsonl"
    stored = {}
    if cache_path.exists():
        for line in cache_path.read_text(encoding="utf-8").splitlines():
            item = json.loads(line)
            stored[(item["path"], item["site_id"])] = features_from_json(item["f"])
    if ("e", backbone) not in cache:
        cache[("e", backbone)] = make_embedder(backbone)
    if ("m", matcher_name, max_kp) not in cache:
        cache[("m", matcher_name, max_kp)] = make_matcher(matcher_name, max_kp)
    embedder, matcher = cache[("e", backbone)], cache[("m", matcher_name, max_kp)]
    sites = sorted({s.site_id for s in samples})
    galleries = {s: build_gallery(s, load_ref_dir(refs_root / s, n_refs), embedder, matcher, augment) for s in sites}
    rows = []
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    with cache_path.open("a", encoding="utf-8") as fh:
        for s in samples:
            k = (str(s.path), s.site_id)
            if k not in stored:
                stored[k] = compute_features(embedder, matcher, galleries[s.site_id], s.path.read_bytes(),
                                             QualityConfig(), top_k, all_refs=True)
                fh.write(json.dumps({"path": k[0], "site_id": k[1], "f": features_to_json(stored[k])}) + "\n")
            rows.append(Row(s, folds[s.session], stored[k]))
    return key, rows


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", type=Path, required=True)
    ap.add_argument("--refs", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--backbones", nargs="+", default=["dinov2_vitb14"])
    ap.add_argument("--matchers", nargs="+", default=["aliked"])
    ap.add_argument("--ref-counts", type=int, nargs="+", default=[5])
    ap.add_argument("--augment", nargs="+", choices=["on", "off"], default=["on"])
    ap.add_argument("--top-k", type=int, default=3)
    ap.add_argument("--max-kp", type=int, default=1024)
    ap.add_argument("--far", type=float, default=0.01)
    ap.add_argument("--no-cross-site", action="store_true")
    ap.add_argument("--write-thresholds", type=Path)
    args = ap.parse_args()

    samples = load_manifest(args.manifest)
    folds = assign_folds(samples)
    if not args.no_cross_site:
        samples += cross_site_negatives(samples, sorted({s.site_id for s in samples}))
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    report = [f"# 사진 판정 평가 {stamp}\n",
              f"- 환경: {platform.processor()} / Python {platform.python_version()}",
              f"- 표본 {len(samples)}개, 회차 fold {folds}, top_k {args.top_k}, FAR 목표 {args.far}\n"]
    cache: dict = {}
    first = None
    for backbone in args.backbones:
        for matcher_name in args.matchers:
            for n_refs in args.ref_counts:
                for aug in args.augment:
                    key, rows = run_config(samples, folds, args.refs, args.out, backbone, matcher_name,
                                           n_refs, aug == "on", args.top_k, args.max_kp, cache)
                    out = evaluate(rows, args.top_k, args.far)
                    report += [f"\n## {key}\n", md_table(summarize(out)), "\n### 거점별 (C_reject)\n",
                               md_table(per_site(out["C_reject"]))]
                    for tag in TAGS:
                        report += [f"\n### 조건별 TAR: {tag} (C_reject)\n", md_table(per_tag(out["C_reject"], tag))]
                    if first is None:
                        first = (backbone, matcher_name, rows, early_accept_safe(out["C_both"]))
    args.out.mkdir(parents=True, exist_ok=True)
    path = args.out / f"report-{stamp}.md"
    path.write_text("\n".join(report), encoding="utf-8")
    print(f"보고서: {path}")
    if args.write_thresholds and first:
        backbone, matcher_name, rows, safe = first
        cfg = ThresholdConfig(backbone, matcher_name, args.top_k, QualityConfig(),
                              fit_all(rows, args.top_k, args.far, safe), args.max_kp)
        save_thresholds(cfg, args.write_thresholds)
        print(f"임계값: {args.write_thresholds} (첫 번째 설정 {backbone}+{matcher_name}, 전체 표본으로 보정)")


if __name__ == "__main__":
    main()
```

- [ ] **Step 7: 합성 매니페스트로 CLI 실행 확인**

임시 폴더에 합성 자료를 만들어 끝까지 실행되는지 확인한다(측정 결과가 아니라 실행 확인용).

```bash
uv run python - <<'EOF'
from pathlib import Path
import sys; sys.path.insert(0, "tests"); sys.path.insert(0, ".")
from fakes import jpeg_bytes
from pv.synth import make_scene, warp_view
root = Path("../private/photo-verify/_synthetic_check")
(root / "refs/demo").mkdir(parents=True, exist_ok=True)
(root / "eval/images").mkdir(parents=True, exist_ok=True)
(root / "refs/demo/r1.jpg").write_bytes(jpeg_bytes(make_scene(1)))
lines = ["path,site_id,label,session,angle,distance,time,weather,occlusion"]
for i in range(6):
    s = f"s{i % 2}"
    (root / f"eval/images/p{i}.jpg").write_bytes(jpeg_bytes(warp_view(make_scene(1), seed=10 + i)))
    (root / f"eval/images/n{i}.jpg").write_bytes(jpeg_bytes(make_scene(100 + i)))
    lines += [f"images/p{i}.jpg,demo,pos,{s},front,near,day,clear,none",
              f"images/n{i}.jpg,demo,easy_neg,{s},,,,,"]
(root / "eval/manifest.csv").write_text("\n".join(lines) + "\n", encoding="utf-8")
EOF
uv run python eval/run_eval.py --manifest ../private/photo-verify/_synthetic_check/eval/manifest.csv --refs ../private/photo-verify/_synthetic_check/refs --out ../private/photo-verify/_synthetic_check/results --backbones dinov2_vits14 --matchers sift --ref-counts 1 --no-cross-site
```

Expected: `보고서: ...report-*.md`가 출력되고 표에 5개 방법 행이 있다. 확인한 뒤 `../private/photo-verify/_synthetic_check`는 지운다(gitignore 대상이지만 실제 평가 자료와 섞이지 않게 한다).

- [ ] **Step 8: 촬영 지침 작성**

`photo-verify/docs/CAPTURE_GUIDE.md`:

```markdown
# 평가셋 촬영 지침

평가 사진과 기준 사진은 정답 자료다. `private/photo-verify/` 밖으로 옮기거나 커밋하지 않는다.

## 폴더
private/photo-verify/
  refs/<site_id>/*.jpg      기준 사진 (거점당 최대 5장, 평가 사진과 다른 회차)
  eval/images/...           평가 사진
  eval/manifest.csv         평가 목록

site_id: gate(정문), yongbong(용봉관), wall(추모의 벽), bongji(봉지)

## 회차
- 최소 2회차(예: 맑은 날 낮, 다른 날 저녁)로 나눠 찍는다. 2-fold 평가가 회차 단위로 나뉜다.
- 기준 사진은 평가에 쓰지 않는 별도 회차에서 고른다.

## 거점당 찍을 것
| 구분 | 수량 | 내용 |
|---|---|---|
| pos | 30~50장 | 정면·좌우 45도·측면, 가까이·멀리, 낮·저녁, 사람이 일부 가린 사진 |
| hard_neg | 15장 이상 | 인접 건물, 비슷한 표지석·조형물, 같은 양식의 다른 면 |
| easy_neg | 15장 이상 | 하늘, 바닥, 나무, 무관한 건물 |

- 참가자처럼 휴대폰 기본 카메라로 세로·가로를 섞어 찍는다. 확대(디지털 줌)는 쓰지 않는다.
- 사람 얼굴이 크게 나오지 않게 찍는다.
- 다른 거점의 정답 사진은 평가 도구가 자동으로 cross_neg로 쓴다. 따로 찍지 않아도 된다.

## manifest.csv
path,site_id,label,session,angle,distance,time,weather,occlusion
images/gate/s1_001.jpg,gate,pos,s1,front,near,day,clear,none
images/gate/s1_101.jpg,gate,hard_neg,s1,,,,,

- path: manifest.csv 기준 상대 경로
- label: pos / hard_neg / easy_neg
- angle: front / side45 / side, distance: near / far, time: day / evening, weather: clear / cloudy / rain, occlusion: none / partial
- 태그는 pos에만 채워도 된다. 비워 둔 값은 보고서에 "(없음)"으로 나온다.

## 실행
uv run python eval/run_eval.py --manifest ../private/photo-verify/eval/manifest.csv --refs ../private/photo-verify/refs --out ../private/photo-verify/eval/results --write-thresholds ../private/photo-verify/thresholds.json

논문 비교 실험 전체:
uv run python eval/run_eval.py ... --backbones dinov2_vitb14 dinov2_vits14 clip_vitb16 siglip_vitb16 --matchers aliked superpoint sift --ref-counts 1 3 5 --augment on off

- 첫 번째 설정(--backbones와 --matchers의 첫 값)으로 thresholds.json을 쓴다. 앱 기본값은 dinov2_vitb14 + aliked다.
- 보고서의 retake_rate_pos가 높으면 품질 기본값(흐림 60, 밝기 25~235)을 thresholds.json의 quality에서 낮춘다.
```

- [ ] **Step 9: 전체 테스트 후 커밋·푸시**

Run: `uv run pytest -v`
Expected: 전부 통과

```bash
git add photo-verify/pv/evaldata.py photo-verify/pv/evaluate.py photo-verify/eval/run_eval.py photo-verify/docs/CAPTURE_GUIDE.md photo-verify/tests/test_evaldata.py photo-verify/tests/test_evaluate.py
git commit -m "feat: 사진 판정 평가 도구와 촬영 지침 추가" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin HEAD:main
```

---

### Task 11: Docker 이미지, 합성 데모 데이터, HTTP 지연 실측

**Files:**
- Create: `photo-verify/pv/download_weights.py`, `photo-verify/pv/demo_data.py`, `photo-verify/bench/bench_http.py`, `photo-verify/Dockerfile`, `photo-verify/.dockerignore`
- Test: `photo-verify/tests/test_demo_data.py`
- Modify: `photo-verify/docs/LATENCY.md`

**Interfaces:**
- Consumes: `make_embedder`, `make_matcher`, `build_gallery`, `save_gallery`, `save_thresholds`, `SiteThresholds`, `ThresholdConfig`, `QualityConfig`, `make_scene`, `summarize_ms`, `Verifier.from_dir`
- Produces: `python -m pv.download_weights --backbone <n> --matcher <n>`, `pv.demo_data.write_demo(out_dir: Path, embedder, matcher) -> None` (합성 `demo` 거점, 실제 정답 아님), CLI `python -m pv.demo_data --out <dir> [--backbone ...] [--matcher ...]`, `bench/bench_http.py --url --key --site --image --runs`

- [ ] **Step 1: 실패하는 테스트 작성**

`photo-verify/tests/test_demo_data.py`:

```python
from fakes import MeanColorEmbedder, jpeg_bytes
from pv.demo_data import write_demo
from pv.local_match import SiftMatcher
from pv.pipeline import Verifier
from pv.synth import make_scene, warp_view


def test_demo_data_is_loadable_and_judges_synthetic_scene(tmp_path, monkeypatch):
    write_demo(tmp_path, MeanColorEmbedder(), SiftMatcher())
    assert (tmp_path / "thresholds.json").exists() and (tmp_path / "gallery" / "demo.npz").exists()
    monkeypatch.setattr("pv.pipeline.make_embedder", lambda name: MeanColorEmbedder(name))
    v = Verifier.from_dir(tmp_path)
    assert v.verify("demo", jpeg_bytes(warp_view(make_scene(1), seed=3))).match
    assert not v.verify("demo", jpeg_bytes(make_scene(50))).match
```

- [ ] **Step 2: 실패 확인**

Run: `uv run pytest tests/test_demo_data.py -v`
Expected: FAIL (`ModuleNotFoundError: No module named 'pv.demo_data'`)

- [ ] **Step 3: 구현**

`photo-verify/pv/demo_data.py`:

```python
"""컨테이너 동작 확인용 합성 demo 거점. 실제 정답이 아니며 운영에 쓰지 않는다."""
from __future__ import annotations

import argparse
from pathlib import Path

from pv.gallery import build_gallery, save_gallery
from pv.global_embed import make_embedder
from pv.local_match import make_matcher
from pv.preprocess import QualityConfig
from pv.scorer import SiteThresholds, ThresholdConfig, save_thresholds
from pv.synth import make_scene

DEMO_SITE = SiteThresholds(tau_reject=-1.0, tau_n=25, mode="rule", tau_low=-1.0)


def write_demo(out_dir: Path, embedder, matcher) -> None:
    g = build_gallery("demo", [make_scene(1)], embedder, matcher)
    save_gallery(g, Path(out_dir) / "gallery" / "demo.npz")
    save_thresholds(ThresholdConfig(embedder.name, matcher.name, 3, QualityConfig(), {"demo": DEMO_SITE}),
                    Path(out_dir) / "thresholds.json")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--backbone", default="dinov2_vitb14")
    ap.add_argument("--matcher", default="aliked")
    args = ap.parse_args()
    write_demo(args.out, make_embedder(args.backbone), make_matcher(args.matcher))
    print(f"합성 demo 자료: {args.out}")


if __name__ == "__main__":
    main()
```

`photo-verify/pv/download_weights.py`:

```python
"""이미지 빌드 시 가중치를 TORCH_HOME에 미리 받아 둔다."""
from __future__ import annotations

import argparse

from pv.global_embed import make_embedder
from pv.local_match import make_matcher


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--backbone", default="dinov2_vitb14")
    ap.add_argument("--matcher", default="aliked")
    args = ap.parse_args()
    make_embedder(args.backbone)
    make_matcher(args.matcher)
    print(f"가중치 준비 완료: {args.backbone}, {args.matcher}")


if __name__ == "__main__":
    main()
```

`photo-verify/bench/bench_http.py`:

```python
"""실행 중인 추론 서버의 판정 지연을 HTTP로 잰다.

사용: uv run python bench/bench_http.py --url http://localhost:8080 --key dev-key --site demo --image x.jpg --runs 30
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pv.timing import summarize_ms  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True)
    ap.add_argument("--key", required=True)
    ap.add_argument("--site", required=True)
    ap.add_argument("--image", type=Path, required=True)
    ap.add_argument("--runs", type=int, default=30)
    args = ap.parse_args()
    body = args.image.read_bytes()
    wall, server = [], []
    with httpx.Client(timeout=30) as c:
        c.post(f"{args.url}/verify", params={"site_id": args.site}, content=body,
               headers={"X-PV-Key": args.key, "Content-Type": "image/jpeg"})  # 예열
        for _ in range(args.runs):
            t = time.perf_counter()
            r = c.post(f"{args.url}/verify", params={"site_id": args.site}, content=body,
                       headers={"X-PV-Key": args.key, "Content-Type": "image/jpeg"})
            wall.append((time.perf_counter() - t) * 1000)
            r.raise_for_status()
            server.append(float(r.json()["latency_ms"]))
    print("응답 예:", r.json())
    print("왕복(ms):", summarize_ms(wall))
    print("서버 처리(ms):", summarize_ms(server))


if __name__ == "__main__":
    main()
```

`httpx`는 dev 그룹에만 있다. 벤치는 `uv run`(dev 포함)으로 실행한다.

`photo-verify/Dockerfile`:

```dockerfile
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PYTHONPATH=/app \
    TORCH_HOME=/opt/models UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy \
    PV_DATA_DIR=/data PORT=8080

RUN apt-get update \
 && apt-get install -y --no-install-recommends git libgl1 libglib2.0-0 \
 && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:0.11.23 /uv /usr/local/bin/uv

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev
COPY pv ./pv

ARG BACKBONE=dinov2_vitb14
ARG MATCHER=aliked
RUN /app/.venv/bin/python -m pv.download_weights --backbone ${BACKBONE} --matcher ${MATCHER} \
 && useradd --create-home --uid 10001 app \
 && chmod -R a+rX /opt/models

USER app
EXPOSE 8080
CMD ["sh", "-c", "exec /app/.venv/bin/uvicorn pv.service:app_from_env --factory --host 0.0.0.0 --port ${PORT}"]
```

`photo-verify/.dockerignore`:

```
.venv
**/__pycache__
.pytest_cache
tests
bench
eval
docs
*.onnx
```

- [ ] **Step 4: 통과 확인**

Run: `uv run pytest tests/test_demo_data.py -v`
Expected: 1 passed

- [ ] **Step 5: 이미지 빌드와 컨테이너 실행 확인**

```bash
docker build -t photo-verify:dev .
uv run python -m pv.demo_data --out ../private/photo-verify/demo-data
docker run --rm -d --name pv-dev -p 8080:8080 -e PV_API_KEY=dev-key --cpus 2 --memory 4g -v "$(pwd)/../private/photo-verify/demo-data:/data:ro" photo-verify:dev
curl -s http://localhost:8080/healthz
```

Expected: 빌드 성공. 모델 로드 후 `{"ok":true,"ready":true}`가 나온다. 바로 `ready:false`면 몇 초 뒤 다시 호출한다. `--cpus 2 --memory 4g`는 Cloud Run 설정과 맞춘 값이다.

Windows Git Bash에서 `-v` 경로가 깨지면 `-v "$(cygpath -w "$(pwd)/../private/photo-verify/demo-data"):/data:ro"`를 쓴다.

- [ ] **Step 6: HTTP 지연 실측**

```bash
uv run python - <<'EOF'
import sys; sys.path.insert(0, "tests"); sys.path.insert(0, ".")
from pathlib import Path
from fakes import jpeg_bytes
from pv.synth import make_scene, warp_view
Path("../private/photo-verify/demo-data/query.jpg").write_bytes(jpeg_bytes(warp_view(make_scene(1, 1600, 1200), seed=3)))
EOF
uv run python bench/bench_http.py --url http://localhost:8080 --key dev-key --site demo --image ../private/photo-verify/demo-data/query.jpg --runs 30
docker stop pv-dev
```

Expected: 응답 예(`reason_code`), 왕복·서버 처리 p50/p95가 출력된다.

`DEMO_SITE`는 `tau_reject=-1`이라 조기 거절 없이 2단계를 지나므로 최악 경로에 가깝다. `photo-verify/docs/LATENCY.md`에 "## Task 11 컨테이너 실측(2vCPU·4GB 제한)" 절을 추가하고, 출력과 2,000ms 기준 판정을 적는다. 넘으면 Task 12 진행 여부를 사용자에게 묻는다.

- [ ] **Step 7: 커밋·푸시**

```bash
git add photo-verify/pv/download_weights.py photo-verify/pv/demo_data.py photo-verify/bench/bench_http.py photo-verify/Dockerfile photo-verify/.dockerignore photo-verify/tests/test_demo_data.py photo-verify/docs/LATENCY.md
git commit -m "feat: 사진 판정 Docker 이미지와 HTTP 지연 실측 추가" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin HEAD:main
```

---

### Task 12 (조건부): ONNX 전역 임베딩

**실행 조건:** Task 1 또는 Task 11 실측에서 DINOv2 단계 p95가 500ms를 넘거나 전체 p95가 2,000ms를 넘고, 사용자가 ONNX 시도를 승인한 경우에만 진행한다. 진행하지 않으면 스펙 9절의 "ONNX 런타임"을 "PyTorch CPU (ONNX는 실측상 불필요해 보류)"로 고치고 이 Task를 건너뛴다.

**Files:**
- Create: `photo-verify/pv/onnx_embed.py`
- Modify: `photo-verify/pv/global_embed.py` (`make_embedder`), `photo-verify/Dockerfile`
- Test: `photo-verify/tests/test_onnx_embed.py`

**Interfaces:**
- Consumes: `gem`, `to_tensor`, `l2_normalize`, `DinoV2Embedder`
- Produces: `export_dinov2(variant: str, out_path: Path, p: float = 3.0) -> None`, `OnnxEmbedder(path: Path, name: str)`. `PV_ONNX_DIR` 환경변수가 있고 `<dir>/<name>.onnx`가 있으면 `make_embedder`가 OnnxEmbedder를 돌려준다. 이름은 백본 이름과 같아서 기존 갤러리와 호환된다.

- [ ] **Step 1: 실패하는 테스트 작성**

`photo-verify/tests/test_onnx_embed.py`:

```python
import numpy as np
import pytest

from pv.preprocess import to_global_input
from pv.synth import make_scene


@pytest.mark.model
def test_onnx_matches_torch(tmp_path, monkeypatch):
    from pv.global_embed import DinoV2Embedder, make_embedder
    from pv.onnx_embed import export_dinov2

    export_dinov2("dinov2_vits14", tmp_path / "dinov2_vits14.onnx")
    monkeypatch.setenv("PV_ONNX_DIR", str(tmp_path))
    onnx_emb = make_embedder("dinov2_vits14")
    assert type(onnx_emb).__name__ == "OnnxEmbedder"
    imgs = [to_global_input(make_scene(i)) for i in range(3)]
    a, b = DinoV2Embedder("dinov2_vits14").embed(imgs), onnx_emb.embed(imgs)
    assert np.all(np.sum(a * b, axis=1) > 0.999)
```

- [ ] **Step 2: 실패 확인**

Run: `uv sync --extra eval --extra onnx` 후 `uv run pytest tests/test_onnx_embed.py -m model -v`
Expected: FAIL (`ModuleNotFoundError: No module named 'pv.onnx_embed'`)

- [ ] **Step 3: 구현**

`photo-verify/pv/onnx_embed.py`:

```python
"""DINOv2+GeM을 224×224 고정 입력 ONNX로 내보내고 onnxruntime으로 실행한다."""
from __future__ import annotations

from pathlib import Path

import numpy as np
import torch

from pv.global_embed import gem, l2_normalize, to_tensor


class _GemHead(torch.nn.Module):
    def __init__(self, model: torch.nn.Module, p: float):
        super().__init__()
        self.model, self.p = model, p

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return gem(self.model.forward_features(x)["x_norm_patchtokens"], self.p)


def export_dinov2(variant: str, out_path: Path, p: float = 3.0) -> None:
    model = torch.hub.load("facebookresearch/dinov2", variant, trust_repo=True, skip_validation=True).eval()
    head = _GemHead(model, p).eval()
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    torch.onnx.export(head, torch.rand(1, 3, 224, 224), str(out_path), input_names=["pixels"],
                      output_names=["vec"], dynamic_axes={"pixels": {0: "b"}, "vec": {0: "b"}},
                      opset_version=17)


class OnnxEmbedder:
    def __init__(self, path: Path, name: str):
        import onnxruntime as ort

        self.name = name
        self.session = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])

    def embed(self, images: list[np.ndarray]) -> np.ndarray:
        x = to_tensor(images).numpy().astype(np.float32)
        return l2_normalize(self.session.run(None, {"pixels": x})[0])
```

`photo-verify/pv/global_embed.py`의 `make_embedder`를 아래로 바꾸고, 파일 위에 `import os`와 `from pathlib import Path`를 추가한다.

```python
def make_embedder(name: str) -> GlobalEmbedder:
    if name not in EMBEDDERS:
        raise KeyError(f"unknown backbone: {name}")
    onnx_dir = os.environ.get("PV_ONNX_DIR")
    if onnx_dir and (Path(onnx_dir) / f"{name}.onnx").exists():
        from pv.onnx_embed import OnnxEmbedder

        return OnnxEmbedder(Path(onnx_dir) / f"{name}.onnx", name)
    return EMBEDDERS[name]()
```

`photo-verify/Dockerfile`의 `uv sync --frozen --no-dev`를 `uv sync --frozen --no-dev --extra onnx`로 바꾼다. download_weights 줄 다음에 아래를 추가하고, `ENV`에 `PV_ONNX_DIR=/opt/onnx`를 추가한다.

```dockerfile
RUN /app/.venv/bin/python -c "from pathlib import Path; from pv.onnx_embed import export_dinov2; export_dinov2('${BACKBONE}', Path('/opt/onnx/${BACKBONE}.onnx'))" \
 && chmod -R a+rX /opt/onnx
```

- [ ] **Step 4: 통과 확인과 재측정**

Run: `uv run pytest tests/test_onnx_embed.py -m model -v`
Expected: 1 passed. 내보내기가 실패하면(DINOv2 위치 임베딩 보간 연산 등) 오류를 그대로 사용자에게 보고하고 이 Task를 멈춘다.

Run: `uv run pytest -v`
Expected: 전부 통과

Task 11 Step 5~6을 다시 실행해서 `LATENCY.md`에 "## Task 12 ONNX 적용 후" 절을 추가한다.

- [ ] **Step 5: 커밋·푸시**

```bash
git add photo-verify/pv/onnx_embed.py photo-verify/pv/global_embed.py photo-verify/Dockerfile photo-verify/tests/test_onnx_embed.py photo-verify/docs/LATENCY.md photo-verify/uv.lock
git commit -m "feat: DINOv2 전역 임베딩 ONNX 실행 경로 추가" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin HEAD:main
```

---

### Task 13: CI, 배포 안내, README

**Files:**
- Create: `.github/workflows/photo-verify.yml`, `photo-verify/README.md`, `photo-verify/docs/DEPLOY_CLOUD_RUN.md`
- Modify: 루트 `README.md`(사진 판정 디렉터리 안내 한 줄), `docs/superpowers/specs/2026-10-12-photo-verify-design.md` 상단 상태 줄

**Interfaces:**
- Consumes: 모든 이전 Task의 CLI·환경변수
- Produces: PR과 main push에서 `photo-verify/**` 변경 시 단위 테스트(`-m "not model"`)를 실행하는 CI

- [ ] **Step 1: CI 작성**

`.github/workflows/photo-verify.yml`:

```yaml
name: photo-verify

on:
  pull_request:
    paths: ["photo-verify/**", ".github/workflows/photo-verify.yml"]
  push:
    branches: [main]
    paths: ["photo-verify/**", ".github/workflows/photo-verify.yml"]

permissions:
  contents: read

jobs:
  unit:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    defaults:
      run:
        working-directory: photo-verify
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7
        with:
          persist-credentials: false
      - run: pipx install uv==0.11.23
      - run: uv sync --frozen
      - run: uv run pytest -v
```

기존 `ci.yml`과 같은 checkout SHA를 쓴다. setup-uv 액션 대신 pipx를 써서 SHA를 모르는 액션을 들이지 않는다.

- [ ] **Step 2: 배포 안내 작성**

`photo-verify/docs/DEPLOY_CLOUD_RUN.md`:

````markdown
# Cloud Run 배포 안내 (서울 리전)

실행은 김동욱이 직접 한다. 개인 명의 결제 계정을 쓰고, 비용은 월별 청구 내역을 근거로 나중에 정산한다.

## 0. 준비
```bash
PROJECT=<프로젝트 ID>
REGION=asia-northeast3
REPO=photo-verify
BUCKET=<비공개 버킷 이름>
gcloud config set project $PROJECT
gcloud services enable run.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com cloudbuild.googleapis.com
```

## 1. 예산 알림 (먼저 설정)
결제 계정 통화가 KRW라고 가정한다. 예산 알림은 비용을 막지 않으므로 메일을 받으면 직접 확인한다.
```bash
gcloud billing budgets create --billing-account=<결제 계정 ID> --display-name=photo-verify \
  --budget-amount=10000KRW --threshold-rule=percent=0.5 --threshold-rule=percent=0.9 --threshold-rule=percent=1.0
```

## 2. 이미지 올리기
```bash
gcloud artifacts repositories create $REPO --repository-format=docker --location=$REGION
gcloud builds submit photo-verify --tag $REGION-docker.pkg.dev/$PROJECT/$REPO/photo-verify:<버전>
```

## 3. 정답 자료와 비밀값
gallery/와 thresholds.json은 비공개 버킷에만 올린다. 공개 접근을 막는다.
```bash
gcloud storage buckets create gs://$BUCKET --location=$REGION --uniform-bucket-level-access --public-access-prevention
gcloud storage cp -r ../private/photo-verify/gallery ../private/photo-verify/thresholds.json gs://$BUCKET/
openssl rand -hex 32 | gcloud secrets create pv-api-key --data-file=-
```
같은 키를 Supabase Edge 비밀값에도 넣는다(앱 연동 단계).

## 4. 배포
```bash
gcloud run deploy photo-verify --image $REGION-docker.pkg.dev/$PROJECT/$REPO/photo-verify:<버전> \
  --region $REGION --cpu 2 --memory 4Gi --min-instances 0 --max-instances 2 --concurrency 2 --timeout 10 \
  --allow-unauthenticated --set-secrets PV_API_KEY=pv-api-key:latest \
  --add-volume name=data,type=cloud-storage,bucket=$BUCKET,readonly=true \
  --add-volume-mount volume=data,mount-path=/data
```
- `--allow-unauthenticated`: Cloud Run IAM 대신 앱의 X-PV-Key로 막는다. Edge가 Google ID 토큰을 만들 필요가 없다.
- Cloud Run 서비스 계정에 버킷 읽기 권한(roles/storage.objectViewer)을 준다.
- 행사 당일 운영 시간대에만 `gcloud run services update photo-verify --region $REGION --min-instances 1`, 끝나면 0으로 되돌린다.

## 5. 확인
```bash
URL=$(gcloud run services describe photo-verify --region $REGION --format 'value(status.url)')
curl -s $URL/healthz
uv run python bench/bench_http.py --url $URL --key <키> --site <site_id> --image <공개 가능한 시험 사진> --runs 20
```
콜드 스타트 시간(첫 요청)과 p95를 LATENCY.md에 적는다.

## Modal로 옮길 때
CPU p95가 2초를 넘으면 같은 이미지를 Modal GPU 함수로 올리고, gallery/와 thresholds.json은 Modal Volume으로 넘긴다. Edge의 추론 서버 주소 비밀값만 바꾼다. 이 경로는 실측 뒤 별도 안내로 작성한다.
````

- [ ] **Step 3: README 작성**

`photo-verify/README.md`:

```markdown
# 현장 사진 판정 (photo-verify)

기준 사진과 참가자 사진이 같은 장소·대상인지 판정한다. 설계: [스펙](../docs/superpowers/specs/2026-10-12-photo-verify-design.md)

## 구조
전처리·품질 → DINOv2+GeM 전역 유사도 → (낮으면 조기 거절) → ALIKED+LightGlue+MAGSAC inlier → 거점별 임계값

## 개발
uv sync --extra eval
uv run pytest            # 단위 테스트 (가중치 불필요)
uv run pytest -m model   # 사전학습 모델 테스트 (가중치 다운로드)

## 운영 흐름
1. 기준 사진: private/photo-verify/refs/<site_id>/*.jpg
2. 평가: docs/CAPTURE_GUIDE.md를 따라 평가셋을 찍고 eval/run_eval.py 실행 → thresholds.json
3. 갤러리: uv run python -m pv.gallery --refs ../private/photo-verify/refs --out ../private/photo-verify/gallery
4. 배포: docs/DEPLOY_CLOUD_RUN.md

## API
POST /verify?site_id=<id>  헤더 X-PV-Key, 본문 = JPEG/PNG 원시 바이트 (최대 10MB)
→ {"match": bool, "score": float, "reason_code": "MATCH|NO_MATCH|RETAKE", "latency_ms": int}
GET /healthz → {"ok": true, "ready": bool}

## 지켜야 할 것
- 기준 사진·갤러리·임계값·평가 사진은 정답이다. private/ 밖으로 옮기거나 커밋하지 않는다.
- 서버는 사진을 저장하지 않는다.
- 성능 수치는 docs/LATENCY.md와 평가 보고서의 실측값만 인용한다.
```

루트 `README.md`의 디렉터리 안내 위치에 다음 한 줄을 추가한다(기존 형식에 맞춘다).

```markdown
- `photo-verify/`: 현장 사진 판정 모델·평가 도구·추론 서버 ([안내](photo-verify/README.md))
```

스펙 상단 `- 상태: 설계 검토 중. 구현·평가 결과 없음.`을 `- 상태: 1단계 구현 완료(파이프라인·평가 도구·추론 서버). 평가셋 촬영·실측 전이라 성능 결과 없음.`으로 바꾼다. 실제 상태가 다르면 사실대로 적는다.

- [ ] **Step 4: 전체 확인**

Run: `uv run pytest -v`
Expected: 전부 통과

Run: `uv run pytest -m model -v`
Expected: 모델 테스트 전부 통과(Task 12를 건너뛰었으면 onnx 테스트는 파일이 없다)

Run: `git status --short`
Expected: `private/`, 가중치, `.venv`가 목록에 없다.

- [ ] **Step 5: 커밋·푸시**

```bash
git add .github/workflows/photo-verify.yml photo-verify/README.md photo-verify/docs/DEPLOY_CLOUD_RUN.md README.md docs/superpowers/specs/2026-10-12-photo-verify-design.md
git commit -m "docs: 사진 판정 CI·Cloud Run 배포 안내·README 추가" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin HEAD:main
```

푸시 후 GitHub Actions의 photo-verify 워크플로 결과를 확인하고, 통과·실패를 그대로 보고한다.
