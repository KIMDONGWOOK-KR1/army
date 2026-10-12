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
