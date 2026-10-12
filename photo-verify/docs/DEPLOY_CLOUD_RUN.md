# Cloud Run 배포 안내 (서울 리전)

실행은 김동욱이 직접 한다. 개인 명의 결제 계정을 쓰고, 비용은 월별 청구 내역을 근거로 나중에 정산한다.

> **경고: 지연 목표 미달.** 컨테이너(2 vCPU/4 GB) 실측 p95는 약 6.4초로 2초 목표를 넘는다(docs/LATENCY.md). `--timeout 10`, `PV_TIMEOUT_S=8`, min-instances 0 조합에서는 콜드 스타트(모델 적재 + 첫 요청)가 제한을 넘을 가능성이 높고, 워밍된 요청도 간신히 들어간다. 실사용 전에 지연 결정(ALIKED 해상도 축소 / 다른 특징점 / GPU 전환)을 먼저 끝낸다. 시험 배포라면 `--cpu-boost`와 일시적 min-instances 1을 고려한다.

작업 디렉터리는 단계마다 적는다. 저장소 루트는 `army/`, 하위 프로젝트는 `photo-verify/`이다.

## 0. 준비 (어느 디렉터리에서나)
```bash
PROJECT=<프로젝트 ID>
REGION=asia-northeast3
REPO=photo-verify
BUCKET=<비공개 버킷 이름>
gcloud config set project $PROJECT
gcloud services enable run.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com cloudbuild.googleapis.com billingbudgets.googleapis.com
```

## 1. 예산 알림 (먼저 설정, 어느 디렉터리에서나)
결제 계정 통화가 KRW라고 가정한다. 예산 알림은 비용을 막지 않으므로 메일을 받으면 직접 확인한다.
```bash
gcloud billing budgets create --billing-account=<결제 계정 ID> --display-name=photo-verify \
  --budget-amount=10000KRW --threshold-rule=percent=0.5 --threshold-rule=percent=0.9 --threshold-rule=percent=1.0
```

## 2. 이미지 올리기 (저장소 루트에서)
```bash
gcloud artifacts repositories create $REPO --repository-format=docker --location=$REGION
gcloud builds submit photo-verify --tag $REGION-docker.pkg.dev/$PROJECT/$REPO/photo-verify:<버전>
```

## 3. 정답 자료와 비밀값 (`photo-verify/`에서. 경로의 `../private`은 저장소 루트의 private/)
gallery/와 thresholds.json은 비공개 버킷에만 올린다. 공개 접근을 막는다.
```bash
gcloud storage buckets create gs://$BUCKET --location=$REGION --uniform-bucket-level-access --public-access-prevention
gcloud storage cp -r ../private/photo-verify/gallery ../private/photo-verify/thresholds.json gs://$BUCKET/
openssl rand -hex 32 | gcloud secrets create pv-api-key --data-file=-
```
같은 키를 Supabase Edge 비밀값에도 넣는다(앱 연동 단계).

## 4. 배포 (어느 디렉터리에서나)
```bash
gcloud run deploy photo-verify --image $REGION-docker.pkg.dev/$PROJECT/$REPO/photo-verify:<버전> \
  --region $REGION --cpu 2 --memory 4Gi --min-instances 0 --max-instances 2 --concurrency 2 --timeout 10 \
  --allow-unauthenticated --set-secrets PV_API_KEY=pv-api-key:latest \
  --add-volume name=data,type=cloud-storage,bucket=$BUCKET,readonly=true \
  --add-volume-mount volume=data,mount-path=/data
```
- `--allow-unauthenticated`: Cloud Run IAM 대신 앱의 X-PV-Key로 막는다. Edge가 Google ID 토큰을 만들 필요가 없다.
- Cloud Run 서비스 계정에 버킷 읽기 권한(roles/storage.objectViewer)을 준다.
- 같은 서비스 계정에 비밀값 접근 권한을 준다(서비스 계정은 `gcloud run services describe`로 확인).
  ```bash
  gcloud secrets add-iam-policy-binding pv-api-key     --member=serviceAccount:<서비스 계정 이메일> --role=roles/secretmanager.secretAccessor
  ```
- 행사 당일 운영 시간대에만 `gcloud run services update photo-verify --region $REGION --min-instances 1`, 끝나면 0으로 되돌린다.

## 5. 확인 (`photo-verify/`에서)
```bash
URL=$(gcloud run services describe photo-verify --region $REGION --format 'value(status.url)')
curl -s $URL/healthz
uv run python bench/bench_http.py --url $URL --key <키> --site <site_id> --image <공개 가능한 시험 사진> --runs 20
```
콜드 스타트 시간(첫 요청)과 p95를 LATENCY.md에 적는다.

## Modal로 옮길 때
현재 실측이 이미 2초 기준을 넘었으므로 GPU 전환은 후보 중 하나로 남아 있다(결정 전). 현재 이미지는 pytorch-cpu 인덱스의 CPU 전용 torch를 설치하므로 그대로는 GPU에서 쓸 수 없다. 같은 코드에 torch/torchvision만 CUDA 휠 인덱스에서 설치하는 GPU 이미지 변형이 필요하다. 그 이미지를 Modal GPU 함수로 올리고, gallery/와 thresholds.json은 Modal Volume으로 넘긴다. Edge는 추론 서버 주소 비밀값만 바꾼다. 이 경로는 결정 뒤 별도 안내로 작성한다.
