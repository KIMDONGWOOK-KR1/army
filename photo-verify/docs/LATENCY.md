# CPU 지연 실측

## Task 1 스파이크 (2026-10-12, Claude Opus 5.5 에이전트)

명령: `uv run python bench/spike_latency.py --runs 20 --threads 2`
주의: 측정 PC는 22 논리 코어 개발 PC이다. Cloud Run 인스턴스(vCPU 2 등) 성능과 다를 수 있고, torch 스레드 수만 2로 제한했다.

- CPU: Intel64 Family 6 Model 170 Stepping 4, GenuineIntel / 논리 코어 22 / torch 스레드 2
- torch 2.14.1+cpu, Python 3.12.13, 반복 20회

| 단계 | p50 ms | p95 ms | 평균 ms |
|---|---|---|---|
| dinov2_vits14 224px | 78 | 106 | 85 |
| dinov2_vitb14 224px | 266 | 281 | 265 |
| ALIKED 추출 kp=512 | 2132 | 2321 | 2121 |
| LightGlue 1쌍 kp=512 | 77 | 140 | 90 |
| ALIKED 추출 kp=1024 | 2068 | 2397 | 2115 |
| LightGlue 1쌍 kp=1024 | 165 | 170 | 166 |

### 판정 1건 최악 경로 추정
- 계산: DINOv2-B p95 + ALIKED 추출 p95 + LightGlue 1쌍 p95 × 3 (top_k=3, 조기 종료 없음)
- kp=1024: 281 + 2397 + 170×3 = 3188 ms / kp=512: 281 + 2321 + 140×3 = 3022 ms
- 판정: 두 경우 모두 2,000ms 초과. CPU(Cloud Run) 유지 기준 미달이다. kp 512, 백본 S, ONNX(Task 12), Modal 중 무엇을 쓸지 사용자 결정이 필요하다.
- 관찰: ALIKED 추출이 kp 수와 무관하게 약 2.1초로 지연의 대부분을 차지한다(입력 1024x768, resize=None). kp를 줄여도 효과가 없고, 입력 해상도 축소나 ONNX가 후보이다. 이번 스파이크에서 해상도 변화는 측정하지 않았다. 백본을 S로 바꿔도 절감은 약 175ms(p95 기준 281→106)에 그친다.
- 위 계산은 쿼리 사진 1장의 추출 1회만 센다. 후보 3장의 특징점을 사전 계산해 두지 않으면 추출이 추가된다.

### 한계
- 합성 장면이라 실제 사진과 특징점 분포가 다르다. 최종 지연은 Task 11의 HTTP 실측과 Task 10의 평가셋 지연으로 다시 잰다.

## Task 11 컨테이너 실측(2vCPU·4GB 제한)
- 환경: `docker run --cpus 2 --memory 4g`, 이미지 `photo-verify:dev`(python 3.11-slim, DINOv2-B + ALIKED), 호스트 Windows 11 Docker Desktop(Linux 엔진). 합성 `demo` 거점(`tau_reject=-1`, 조기 거절 없음), 예열 1회 후 30회.
- 쿼리: 갤러리와 같은 장면(`make_scene(1)`)을 1600x1200으로 키우고 `warp_view(seed=3)`로 시점을 바꾼 뒤 언샤프 마스크로 선명도를 높인 사진. 단순 확대본은 라플라시안 분산이 약 14로 품질 검사(`blur_var_min=60`)에서 `RETAKE`(15ms)가 되어 지연 측정이 되지 않았다.
- DINOv2 허브 코드는 `facebookresearch/dinov2:7764ea0f912e53c92e82eb78a2a1631e92725fc8`로 고정했다.

```
응답 예: {'match': True, 'score': 0.9874, 'reason_code': 'MATCH', 'latency_ms': 5647}
왕복(ms): {'p50': 5801.98, 'p95': 6403.28, 'mean': 5909.09}
서버 처리(ms): {'p50': 5755.0, 'p95': 6398.0, 'mean': 5871.23}
```

- 판정: 서버 처리 p50 5,755ms, p95 6,398ms로 2,000ms 기준을 약 3배 초과한다. 컨테이너(2vCPU) CPU 추론은 기준 미달이며, Task 12 진행 여부(ONNX, 해상도 축소, kp 축소, Modal 등)는 사용자 결정이 필요하다.
- demo 갤러리는 기준 사진이 1장이라 2단계 쌍이 1개만 실행된다. 실제 거점은 기준 사진이 여러 장이라 2단계 쌍이 최대 3개까지 늘어나므로 이 수치보다 느릴 수 있다.
- 스파이크 추정(3.0~3.2초)보다 큰 이유 후보: 2vCPU 제한, 입력 1600x1200(스파이크는 1024x768), Docker Desktop 가상화 오버헤드. 구간별로 분리해 재지는 않았다.
- 이전 실행은 다른 장면을 쿼리로 써서 NO_MATCH였다; 수치 p50 6095/p95 6952ms.

## 스레드 고정 후 (2026-10-12, 최종 검토 반영)
- 변경: Dockerfile `OMP_NUM_THREADS=2 MKL_NUM_THREADS=2 PV_TORCH_THREADS=2`, `app_from_env`가 `torch.set_num_threads`·`cv2.setNumThreads`를 2로 고정. 그 전에는 torch가 호스트 코어 수만큼 스레드를 띄워 `--cpus 2` 제한에서 과다 구독됐다.
- 조건은 Task 11과 같다: 이미지 `photo-verify:dev` 재빌드, `pv.demo_data`로 demo 자료 재생성, `docker run --cpus 2 --memory 4g`, `PV_API_KEY=dev-key`, `/data` 읽기 전용 마운트, 같은 쿼리(`query.jpg`, 같은 장면 언샤프 마스크본), 예열 1회 후 30회.

```
응답 예: {'match': True, 'score': 0.9874, 'reason_code': 'MATCH', 'latency_ms': 2126}
왕복(ms): {'p50': 2070.67, 'p95': 2527.03, 'mean': 2150.66}
서버 처리(ms): {'p50': 2064.0, 'p95': 2481.0, 'mean': 2128.83}
```

- 판정: 서버 처리 p50 2,064ms, p95 2,481ms로 Task 11(p50 5,755 / p95 6,398ms)보다 약 2.6~2.8배 빨라졌지만 여전히 2,000ms 기준을 넘는다(p50도 약간 초과). 기준 미달이므로 지연 결정(ALIKED 입력 해상도 축소, kp 축소, ONNX, GPU 전환)은 여전히 사용자 결정이 필요하다.
- 기준 사진 1장 demo라 2단계 쌍이 1개뿐이다. 실제 거점(기준 여러 장)에서는 쌍이 최대 3개로 늘어 이보다 느릴 수 있다.
