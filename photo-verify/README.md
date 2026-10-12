# 현장 사진 판정 (photo-verify)

기준 사진과 참가자 사진이 같은 장소·대상인지 판정한다. 설계: [스펙](../docs/superpowers/specs/2026-10-12-photo-verify-design.md)

## 구조
전처리·품질 → DINOv2+GeM 전역 유사도 → (낮으면 조기 거절) → ALIKED+LightGlue+MAGSAC inlier → 거점별 임계값

DINOv2 hub 코드는 `pv/global_embed.py`의 `DINOV2_HUB`로 고정한다.

## 개발
```bash
uv sync --extra eval
uv run pytest            # 단위 테스트 (가중치 불필요)
uv run pytest -m model   # 사전학습 모델 테스트 (가중치 다운로드)
```

## 운영 흐름
1. 기준 사진: private/photo-verify/refs/<site_id>/*.jpg
2. 평가와 배포 자료: docs/CAPTURE_GUIDE.md를 따라 평가셋을 찍고 `eval/run_eval.py ... --write-deploy ../private/photo-verify` 실행 → thresholds.json + gallery/ (같은 기준 사진·설정으로 함께 만든다)
3. 배포: docs/DEPLOY_CLOUD_RUN.md

갤러리는 반드시 `--write-deploy`가 만든 것을 쓴다. `python -m pv.gallery`는 실험용이며, 설정(기준 사진 수·증강·max_kp)이나 기준 사진 지문이 thresholds.json과 다르면 서버가 시작을 거부한다.

## API
`POST /verify?site_id=<id>`  헤더 `X-PV-Key`, 본문 = JPEG/PNG 원시 바이트 (최대 10MB)
→ `{"match": bool, "score": float, "reason_code": "MATCH|NO_MATCH|RETAKE", "latency_ms": int}`
`GET /healthz` → `{"ok": true, "ready": bool}`

서버 실행: `uvicorn pv.service:app_from_env --factory`
환경변수: `PV_API_KEY`, `PV_DATA_DIR`(기본 `/data`), `PV_MAX_BYTES`, `PV_TIMEOUT_S`, `PV_TORCH_THREADS`(기본 2, torch·OpenCV 연산 스레드)

앱 연동: Supabase Edge 백엔드는 `score`와 `latency_ms`를 참가자 앱에 넘기지 않는다. 점수를 보여 주면 사진을 바꿔 가며 정답에 다가가는 탐색에 쓰일 수 있다. 앱에는 일치 여부(match)와 재촬영 요청(RETAKE)만 전달한다.

## 현재 상태
- 1단계(파이프라인·평가 도구·추론 서버) 구현 완료. 평가셋 촬영 전이라 정확도 결과는 없다.
- CPU 지연은 목표(2,000 ms)에 못 미친다. 연산 스레드를 2로 고정한 뒤 컨테이너(2 vCPU/4 GB) 실측이 1개 기준 사진 데모에서 p50 2064 ms, p95 2481 ms이다(고정 전 p50 5755 / p95 6398 ms). 자세한 값과 조건은 [docs/LATENCY.md](docs/LATENCY.md)를 본다.

## 지켜야 할 것
- 기준 사진·갤러리·임계값·평가 사진은 정답이다. private/ 밖으로 옮기거나 커밋하지 않는다.
- 서버는 사진을 저장하지 않는다.
- 성능 수치는 docs/LATENCY.md와 평가 보고서의 실측값만 인용한다.
