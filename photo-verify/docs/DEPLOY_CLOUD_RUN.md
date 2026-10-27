# Cloud Run 배포 안내 (서울 리전)

실행은 김동욱이 직접 한다. 개인 명의 결제 계정을 쓰고, 비용은 월별 청구 내역을 근거로 나중에 정산한다.

> **주의: 지연은 로컬 컨테이너 기준만 확인됐다.** 2단계 입력을 640px로 낮춘 뒤 컨테이너(2 vCPU/4 GB) 실측 서버 처리 p95는 최악 경로(기준 3장·3쌍)에서 1.35초다([LATENCY.md](LATENCY.md)). Cloud Run 실측과 콜드 스타트(모델 적재 + 첫 요청)는 아직 재지 않았다. `--timeout 10`, `PV_TIMEOUT_S=8`, min-instances 0 조합에서는 콜드 스타트가 제한을 넘을 수 있으므로, 시험 배포라면 `--cpu-boost`와 일시적 min-instances 1을 고려한다.

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
gallery/와 thresholds.json은 비공개 버킷에만 올린다. 공개 접근을 막는다. 둘은 `eval/run_eval.py --write-deploy ../private/photo-verify`가 한 번에 만든 것이어야 한다(갤러리를 다른 설정으로 따로 만들면 서버가 시작을 거부한다).
```bash
gcloud storage buckets create gs://$BUCKET --location=$REGION --uniform-bucket-level-access --public-access-prevention
gcloud storage cp -r ../private/photo-verify/gallery ../private/photo-verify/thresholds.json gs://$BUCKET/
openssl rand -hex 32 | gcloud secrets create pv-api-key --data-file=-
```
같은 키를 Supabase Edge 비밀값에도 넣는다(앱 연동 단계).

## 4. 서비스 계정과 권한 (배포 전, 어느 디렉터리에서나)
```bash
gcloud iam service-accounts create photo-verify-run --display-name "photo-verify Cloud Run"
SA=photo-verify-run@$PROJECT.iam.gserviceaccount.com
gcloud secrets add-iam-policy-binding pv-api-key --member "serviceAccount:$SA" --role roles/secretmanager.secretAccessor
gcloud storage buckets add-iam-policy-binding gs://$BUCKET --member "serviceAccount:$SA" --role roles/storage.objectViewer
```

## 5. 배포 (어느 디렉터리에서나)
```bash
gcloud run deploy photo-verify --image $REGION-docker.pkg.dev/$PROJECT/$REPO/photo-verify:<버전> \
  --region $REGION --cpu 2 --memory 4Gi --min-instances 0 --max-instances 2 --concurrency 1 --timeout 10 \
  --service-account $SA --allow-unauthenticated --set-secrets PV_API_KEY=pv-api-key:latest \
  --add-volume name=data,type=cloud-storage,bucket=$BUCKET,readonly=true \
  --add-volume-mount volume=data,mount-path=/data
```
- `--concurrency 1`: 인스턴스마다 모델 잠금이 하나라 판정은 한 번에 하나씩만 돈다. 동시 요청을 받으면 잠금 대기 중 시간 제한을 넘기므로, 추가 요청은 Cloud Run이 대기열에 두거나 인스턴스를 늘리게 한다.
- `--allow-unauthenticated`: Cloud Run IAM 대신 앱의 X-PV-Key로 막는다. Edge가 Google ID 토큰을 만들 필요가 없다.
- 행사 당일 운영 시간대에만 `gcloud run services update photo-verify --region $REGION --min-instances 1`, 끝나면 0으로 되돌린다.

## 6. 확인 (`photo-verify/`에서)
```bash
URL=$(gcloud run services describe photo-verify --region $REGION --format 'value(status.url)')
curl -s $URL/healthz
uv run python bench/bench_http.py --url $URL --key <키> --site <site_id> --image <공개 가능한 시험 사진> --runs 20
```
콜드 스타트 시간(첫 요청)과 p95를 LATENCY.md에 적는다.

## Modal로 옮길 때
Cloud Run 실측 p95가 2초를 넘으면 GPU 전환을 검토한다. 현재 이미지는 pytorch-cpu 인덱스의 CPU 전용 torch를 설치하므로 그대로는 GPU에서 쓸 수 없다. 같은 코드에 torch/torchvision만 CUDA 휠 인덱스에서 설치하는 GPU 이미지 변형이 필요하다. 그 이미지를 Modal GPU 함수로 올리고, gallery/와 thresholds.json은 Modal Volume으로 넘긴다. Edge는 추론 서버 주소 비밀값만 바꾼다. 이 경로는 결정 뒤 별도 안내로 작성한다.
