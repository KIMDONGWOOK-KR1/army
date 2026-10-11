# MINO 이야기 시연 코스

기준: 1차 `965239e360a99054d10724bb8e554fc68cd92d3c`. 브랜치: `feat/story-b`.
원본과 분리한 `army-story-b`에서 개발했으며 GitHub 푸시·PR은 하지 않았다. 압축 결과물의 추적 파일 284개는 기준 커밋과 바이트 일치했다.

이전의 한 역할 한 문항 각색을 MINO의 **정문 13개·용봉관 12개 세부 문항**과 전체 진행 나레이션으로 교체했다. 추모의 벽은 사용자의 후속 요청대로 기존 구현 그대로다. 상세 차이는 [장면별 대응표](MINO-COVERAGE.md), 실제 시험 결과는 [검증 기록](VALIDATION.md)을 참고한다.

새 전달본(2026-10-11)의 공통 입력 간소화·근거 자유 기록·확정 힌트 비용·공동 문장 조합과 조사 기록철 UI를 적용했다. [최신 UI/UX 변경·검증](UIUX-CURRENT.md)을 참고한다.

텍스트 중심 화면을 네 보직의 도구·보고 도장·자료 연결판·낱말 조합으로 개편했다. [대본 분석·게임 설계·최신 검증](GAMEPLAY-REDESIGN.md)을 참고한다.

브롤스타즈·클래시 로얄·포켓몬 GO·동물의 숲의 공식 퀘스트·보상 자료를 참고해 단서 봉투 개봉, 기록 조각 수집, 조사 수첩, 공동 사초 연출을 추가했다. [조사 근거·적용·검증](QUEST-DISCOVERY.md)을 참고한다.

봉인·뚜껑·종이를 따로 움직이는 개봉, 실제 수첩 칸으로 이동하는 기록, 네 조각이 맞춰지는 사초로 후속 모션을 보완했다. [모션 변경·검증·힉스필드 사용 판단](MOTION-POLISH.md)을 참고한다.

사건 카드 순서 변경과 공동 기록 낱말 배치에 손잡이 드래그를 추가했다. 누르기·키보드 대체 조작과 실시간 동작 줄이기를 유지한다. [직접 조작 변경·검증](INTERACTIVE-CLUES.md)을 참고한다.

## 실행

`web`에서 설치는 `npm ci`. 이 작업 환경은 다른 체크아웃과 패키지 변경이 섞이지 않도록 독립 임시 런타임의 패키지를 심볼릭 링크로 연결한다. 중복 생성 파일의 재발을 피하기 위해 `.next` 빌드 캐시도 같은 런타임에 연결했으며, 이 연결은 커밋하지 않는다.

서버 비공개 판정 자료는 현재 작업 폴더의 `web/.story-b.private.local.json`에 준비되어 있다. Git에는 포함하지 않는다. 다른 환경에서는 검수된 비공개 파일을 별도로 전달받아 이 위치에 두거나 `LOCAL_STORY_B_PRIVATE_FILE`로 경로를 지정해야 한다. 누락된 파일을 임의 값으로 대신하지 않으며 방 생성을 막는다.

파일 구조는 `StoryBAnswerInput` 타입을 따른다: `stages.gate/yongbong` 아래 `digits`와 `steps[문항ID].answer`, 텍스트 문항의 선택적 `acceptedAnswers`. 실제 키를 화면·문서·명령행 인수에 적지 않는다. 앱은 이를 `privateInput`으로 읽고 정답·허용 표기를 해시화한다.

```sh
cd web
NEXT_PUBLIC_BACKEND=local npm run build
python3 - <<'PYTHON'
import json, os, secrets, time
from pathlib import Path
runtime = Path('.story-b.runtime.private.local.json')
if not runtime.exists():
    settings = {'salt': secrets.token_hex(32), 'courseId': f'jnu-demo-dev-story-b-play-{int(time.time())}'}
    with os.fdopen(os.open(runtime, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600), 'w') as f:
        json.dump(settings, f)
else:
    settings = json.loads(runtime.read_text())
assert len(settings['salt']) >= 32 and settings['courseId'].startswith('jnu-demo-dev-')
os.environ.update(NEXT_PUBLIC_BACKEND='local', LOCAL_V2_PRESET='story-b',
                  LOCAL_V2_COURSE_ID=settings['courseId'], ANSWER_SALT=settings['salt'])
os.execvp('npm', ['npm', 'run', 'start', '--', '--port', '3013'])
PYTHON
```

같은 방을 계속 사용하려면 위 비공개 실행 설정을 보존한다. 기존의 실행마다 새 salt를 만드는 명령 대신 이 명령을 재사용한다. 시나리오 데이터가 바뀌면 검토 후 새 코스 ID를 사용하며, 화면만 바뀐 경우 현재 ID를 유지한다.

[로컬 시연](http://localhost:3013)에서 **작전 시작 → 새 작전 만들기**로 새 방을 만든다. 다른 세 기기는 참가 코드로 합류한다. 같은 와이파이의 폰에서는 서버 맥의 LAN 주소와 포트 3013을 사용한다. 도착은 시연용 모의 도착이며 현장 GPS 검증이 아니다.

기존 방은 생성 당시 코스를 계속 사용한다. 이번 다단계 미션을 보려면 새 코스 ID의 새 방을 사용한다. `LOCAL_V2_PRESET=story-b`에서는 **혼자 데모 체험**도 같은 네 거점을 사용한다. 화면 아래 보직 버튼으로 네 역할을 번갈아 맡는다. 각자 조사·보고·헌화·회고·공동 동의를 마쳐야 진행된다. 기존 두 거점 방이 열려 있다면 새 체험을 시작한다. 다른 preset의 기존 v1 시연은 유지한다.

## 1차 결과와 파일 비교

| 파일 | 변경 |
|---|---|
| `web/supabase/functions/_shared/story-b-course-v2.ts` | 새 코스·25단계·선행 조건·문항별 힌트·사초·회고·공동 문장. 추모 데이터는 원형 유지 |
| `web/lib/server/store.ts` | `story-b` preset 및 무시 목록의 비공개 입력 로더 |
| `web/supabase/functions/_shared/types.ts` | 선택적 문항 힌트·허용 표기 해시 타입 |
| `web/supabase/functions/_shared/prepare-course-v2.ts` | 힌트 검증·텍스트 허용 표기 해시화 |
| `web/supabase/functions/_shared/engine-v2.ts` | 허용 표기 비교·본인에게만 요청한 문항 힌트 투영 |
| `web/lib/narration.ts` | MINO 시작·보직·조사·발견·재시도·완료·예외·결과 대사. 기존 코스 대사 보존 |
| `web/components/next-stop.tsx` | 새 사초 가운데 문장·이동 카드 분기. 추모 전후 기존 글 유지 |
| `web/components/game-app.tsx` | 코스별 시작/준비/도착/사초 나레이션·역할별 준비·안전 안내 |
| `web/components/mission-v2.tsx` | 주파수 다이얼·다단계 입력·단계별 힌트·공식 링크·재시도/보고 대사 |
| `web/components/mission-v2.module.css` | 긴 선택지 줄바꿈·44px 입력·어절 단위 표시 |
| `web/components/yongbong-panel.tsx` | 외부 조사·자료 수신 대사 |
| `web/components/closing-v2.tsx` | 사초 3장 복기·공동 문장 미리보기·도움·완료 나레이션 |
| `web/components/closing-v2.module.css` | 새 기록 카드와 인용문의 Noto Serif 기록 글꼴 |
| `web/tests/helpers/story-b.ts` | 실제 정답을 쓰지 않는 합성 판정 fixture |
| `web/tests/story-b.test.ts` | 보존성·25단계 완주·별칭·힌트·비공개 투영·동의 버전 |
| `web/tests/e2e/story-b.spec.ts` | 네 독립 세션 정상 풀이·폰 레이아웃·대본 표시 |
| `web/tests/e2e/full-course.spec.ts` | 역할 간 선행 단계가 있는 코스도 해설 후 보고하도록 시험 순서 보완 |
| `web/playwright.story-b.config.ts` | 새 서버·Chrome/WebKit·정상/해설 경로, 정답 추적 기록 비활성화 |
| `docs/story-b/README.md`, `MINO-COVERAGE.md`, `VALIDATION.md` | 실행·장면별 적용/차이·검증·미정 사항 |

수정 금지 코스 5개와 음원 폴더·설정은 변경하지 않는다. 2026-10-11 후속 요청에 따라 3D 지도의 보행 여유 공간과 횡단 지점 표시를 수정했다. [보행·전체 체험 보완 기록](WALKTHROUGH-POLISH.md)을 참고한다. 실제 정답표·비밀키·원시 GPS 자료는 커밋하지 않는다. 주파수 전달 단서는 기존 규칙대로 지휘관에게만, 보고 후 숫자는 해당 역할에게만 제공한다.

## 사실 근거와 남은 확인

공식 자료 확인일: 2026-10-11. 학습용 오류 보고서와 유형 카드는 실제 사료가 아님을 화면에 표시한다. 자유 기록은 필수 항목·출처의 존재를 확인하며 역사적 정확성을 자동으로 인증하지 않는다.

- [전남대학교 민주길 — 정문](https://518trail.jnu.ac.kr/SubPage.aspx?PageCode=K20200): 사건 순서·집결·이동, 주변 조형물의 형태·설명.
- [전남대학교 민주길 — 용봉관](https://518trail.jnu.ac.kr/SubPage.aspx?PageCode=K21000): 건축 특징과 과거 쓰임. 특정 전시물의 현재 존재를 가정하지 않는다.
- [전남대학교 민주길 — 추모의 벽](https://518trail.jnu.ac.kr/SubPage.aspx?PageCode=K40600): 기존 추모 소개의 현장 대조용. 새 인물 문항은 추가하지 않는다.

허가된 사진, 최신 현장 안내·관람 가능 여부, 추모의 벽 좌표와 안전한 집결 위치, 자유 서술 검수 기준·시간 점수·랭킹은 별도 확인이 필요하다. 새 코스의 힌트 감점은 전달된 최신 기준을 적용했다. 실제 휴대전화 4대·현장 GPS·Supabase 배포 시험은 아직 수행하지 않았다.
