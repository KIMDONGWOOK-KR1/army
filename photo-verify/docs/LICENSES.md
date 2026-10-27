# 모델·라이브러리 라이선스 확인

확인 방법: 각 저장소 README 본문을 WebFetch로 읽어 요약한 내용이다. LICENSE 파일 원문을 직접 열어 대조하지는 않았으므로, 앱에 넣기 전에 LICENSE 원문을 한 번 더 확인한다. 페이지에 적혀 있지 않은 항목은 "미확인"이다.

| 구성 | 코드 라이선스 | 가중치 라이선스 | 확인한 곳 | 확인일 | 앱 사용 |
|---|---|---|---|---|---|
| DINOv2 | Apache-2.0 | Apache-2.0 (README: "code and model weights are released under the Apache License 2.0"). 단 Cell-DINO·XRay-DINO 가중치는 비상업 연구 라이선스이며 이 앱에서 쓰지 않는다 | https://github.com/facebookresearch/dinov2 | 2026-10-12 | 사용 예정 (ViT 백본만) |
| LightGlue | Apache-2.0 | Apache-2.0 (README: "pre-trained weights of LightGlue and the code ... Apache-2.0"). SuperPoint용 구성은 별도 제한 라이선스 | https://github.com/cvg/LightGlue | 2026-10-12 | 사용 예정 (ALIKED 조합) |
| ALIKED | BSD-3-Clause (README 라벨 및 LightGlue README 언급) | 미확인 (README에 가중치 라이선스 문구 없음, 모델 파일은 저장소 models/ 포함) | https://github.com/Shiaoming/ALIKED | 2026-10-12 | 사용 예정, 가중치 조건은 LICENSE 원문 확인 필요 |
| SuperPoint | 미확인 (README 본문에 명시 없음. LightGlue README는 "restrictive"라고만 표현) | 미확인 (LightGlue README: 사전학습 가중치도 제한 라이선스) | https://github.com/magicleap/SuperPointPretrainedNetwork | 2026-10-12 | 논문 비교만 |
| open_clip (CLIP, SigLIP) | 미확인 (README 본문에 명시 없음) | 미확인 (모델별 Hugging Face 모델 카드에서 확인 필요) | https://github.com/mlfoundations/open_clip | 2026-10-12 | 논문 비교만 |
