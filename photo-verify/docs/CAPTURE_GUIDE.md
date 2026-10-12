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
- 보고서의 FAR은 평가 fold에서 실제로 나온 값이며, 보정 fold의 1% 목표보다 높을 수 있다. 논문에는 이 실측값을 그대로 보고한다.
- 보고서의 retake_rate_pos가 높으면 품질 기본값(흐림 60, 밝기 25~235)을 thresholds.json의 quality에서 낮춘다.
